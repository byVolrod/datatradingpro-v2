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
const { scrapeForexFactoryNews, getArticleContent, startFFNewsPoll, fetchCalendarActuals, fetchEventDetail } = require('./scrapers/forexfactory-news');
const { scrapeBlackRock } = require('./scrapers/blackrock');   // BlackRock Investment Institute — Weekly Commentary (PDF hebdo, Puppeteer best-effort)
const { scrapeResearchSpa, dateFromUrl: _dateFromUrlBr } = require('./scrapers/research-spa');   // Natixis / Danske — recherche sur sites SPA (Puppeteer best-effort) + extracteur de date d'URL
const { fetchTVCalendar, fetchTVCalendarFull } = require('./scrapers/tvcalendar');   // calendrier + actuals (HTTP TradingView, sans Cloudflare)
const { fetchAllRSS } = require('./scrapers/rss');   // ForexLive, FXStreet, WSJ, MarketWatch, Yahoo, Investing, Google News…
const { fetchCOTData } = require('./scrapers/cot');
const { fetchCommunityOutlook, refreshOutlookBg, forceFetchOutlook, clearOutlookCache, outlookTs } = require('./scrapers/myfxbook');
const auth = require('./auth');
const mailer = require('./mailer');   // emails (bienvenue, renouvellement, reset)
const ai = require('./ai');           // génération IA (Gemini gratuit, repli Claude)
const { concludeBias } = require('./lib/bias-calc');   // calcul DÉTERMINISTE de l'Overall Conclusion (pur, testable)
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
// Helmet : headers de sécurité (XSS, clickjacking, MIME sniffing, HSTS…).
// CSP : activée EN PRODUCTION seulement (dev local en http non impacté). Volontairement
// permissive (CDN https + inline/eval requis par amCharts/TradingView) pour ne rien casser,
// tout en apportant les protections clés : anti-clickjacking (frame-ancestors), blocage des
// plugins (object-src), anti-injection <base>, et passage forcé en https.
const _CSP_DIRECTIVES = {
  defaultSrc:      ["'self'"],
  scriptSrc:       ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https:'],
  styleSrc:        ["'self'", "'unsafe-inline'", 'https:'],
  imgSrc:          ["'self'", 'data:', 'blob:', 'https:'],
  fontSrc:         ["'self'", 'data:', 'https:'],
  connectSrc:      ["'self'", 'https:', 'wss:', 'ws:'],
  frameSrc:        ["'self'", 'https:', 'blob:'],   // blob: → PDF généré côté client (rapports Institution) embarqué en <iframe>
  workerSrc:       ["'self'", 'blob:'],
  objectSrc:       ["'none'"],
  baseUri:         ["'self'"],
  frameAncestors:  ["'self'"],
  upgradeInsecureRequests: [],
};
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production'
    ? { useDefaults: false, directives: _CSP_DIRECTIVES }
    : false,
  crossOriginEmbedderPolicy: false,
}));

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
// Répertoire des caches DURABLES : volume Docker (DATA_DIR) → survit aux rebuilds du conteneur
// (disque éphémère). CRUCIAL quand Supabase est bloqué (quota egress) : la sauvegarde durable
// habituelle (ai_cache/hist:*) est inaccessible, donc le fichier local DOIT persister, sinon
// chaque redéploiement EFFACE les news/rapports/biais scrappés et la liste « régresse ».
const _CACHE_DIR = process.env.DATA_DIR || __dirname;
try { if (_CACHE_DIR !== __dirname) fs.mkdirSync(_CACHE_DIR, { recursive: true }); } catch {}
const HISTORY_FILE = path.join(_CACHE_DIR, 'news_history.json');
const HISTORY_TTL  = 10 * 24 * 60 * 60 * 1000; // 10 jours (le recap hebdo a besoin de la semaine écoulée même généré en début de semaine suivante)
const SW_CACHE_FILE = path.join(_CACHE_DIR, 'cache_session_wraps.json');
const SW_MAX_AGE    = 30 * 24 * 60 * 60 * 1000; // 30 days
const BR_CACHE_FILE = path.join(_CACHE_DIR, 'cache_bank_research.json');
const BR_MAX_AGE    = 45 * 24 * 60 * 60 * 1000;   // 45 j (était 30) : plus de rapports des sources fréquentes (SEB/MUFG/ING…) remontent dans Institution

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

allNews = loadHistory().filter(item => item && !/^\s*\[?\s*primer\b/i.test(item.headline || '')).map(item => {   // purge des "PRIMER" déjà persistés
  if (item.category === 'Economic Commentary' && item.source === 'FinancialJuice') {
    const agency = _detectEconAgencyEarly(item.headline);
    if (agency) return { ...item, source: agency };
  }
  return item;
});

// ─── Session ──────────────────────────────────────────────────────────────────
const _sessionMw = session({
  name:     'dtp_session',
  secret:   process.env.SESSION_SECRET || 'dtp-secret-key-change-me',
  httpOnly: true,
  sameSite: 'lax',
  secure:   process.env.NODE_ENV === 'production',  // HTTPS uniquement en prod
  domain:   process.env.NODE_ENV === 'production' ? '.datatradingpro.com' : undefined,  // login PARTAGÉ apex ↔ www ↔ desk
  maxAge:   30 * 24 * 60 * 60 * 1000,   // 30 jours — l'utilisateur reste connecté
});
app.use(_sessionMw);

// ─── Présence "en ligne" (suivi des connexions WebSocket par utilisateur) ─────
const _onlineUsers = new Map();   // userId → nombre d'onglets/WS ouverts
function _isUserOnline(id) { return _onlineUsers.has(String(id)); }
function _wsUserIdFromReq(req) {
  try {
    const fakeRes = { end() {}, setHeader() {}, getHeader() {}, writeHead() {} };
    _sessionMw(req, fakeRes, () => {});
    return req.session && req.session.userId ? String(req.session.userId) : null;
  } catch { return null; }
}

// ─── Auth middleware ──────────────────────────────────────────────────────────
// Public = static assets (CSS/JS), login page, auth endpoints
const _PUBLIC_PATHS    = new Set(['/login', '/login.html', '/favicon.ico', '/healthz', '/api/ticker', '/api/pricing', '/api/version',
  '/week-ahead', '/week-ahead.html', '/api/week-ahead', '/api/calendar-events', '/api/week-ahead-news']);   // page Week Ahead PUBLIQUE
const _PUBLIC_PREFIXES = ['/css/', '/js/', '/api/auth/', '/api/whop/'];

// Version du build = le ?v= de app.js dans index.html. Exposée à /api/version : le client compare sa
// propre version à celle-ci et, si un nouveau déploiement est détecté, propose un rechargement en
// 1 clic (fini le « pas à jour » quand la session reste ouverte après un déploiement).
let BUILD_VERSION = '';
try { BUILD_VERSION = (fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8').match(/app\.js\?v=([0-9A-Za-z]+)/) || [])[1] || ''; } catch {}

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
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  // Le HTML ne doit JAMAIS être mis en cache : sinon le navigateur garde un index.html avec un
  // ?v= périmé et ne charge jamais le nouveau CSS/JS (cause des « pas à jour » récurrents).
  // Les assets CSS/JS restent cacheables (ils sont déjà bustés par ?v=YYYYMMDDx).
  setHeaders: (res, fp) => { if (/\.html$/i.test(fp)) res.setHeader('Cache-Control', 'no-cache, must-revalidate'); },
}));
app.use(express.json({ limit: '2mb' }));   // 2 Mo : autorise les pièces jointes chat (data URL base64)

// Health check (public) — pour le monitoring / keep-alive (Render, UptimeRobot…)
app.get('/healthz', (_req, res) => res.status(200).json({ ok: true, ts: Date.now() }));
// Version du build courant → le client détecte un nouveau déploiement et propose un rechargement.
app.get('/api/version', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json({ v: BUILD_VERSION }); });

// Redirection /login → déjà connecté va au dashboard
app.get('/login', (req, res) => {
  if (req.session?.userId) return res.redirect('/');
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/admin', requireAuth, requireAdmin, (_req, res) => {
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Galerie de prévisualisation des emails transactionnels (admin) : voir TOUS les emails rendus,
// avec données d'exemple + l'ordre réel des fournisseurs d'envoi. Aucun email n'est envoyé.
app.get('/admin/emails', requireAuth, requireAdmin, (_req, res) => {
  try { res.type('html').send(mailer.renderEmailGallery()); }
  catch (e) { res.status(500).send('Erreur preview emails: ' + e.message); }
});

// ─── Auth routes ──────────────────────────────────────────────────────────────
// ── Rate-limiting léger en mémoire (anti brute-force / abus, sans dépendance) ──
const _rlBuckets = new Map();   // clé → [timestamps]
function _clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.ip || req.socket?.remoteAddress || 'unknown';
}
function _rateLimited(key, max, windowMs) {
  const now = Date.now();
  const arr = (_rlBuckets.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now);
  _rlBuckets.set(key, arr);
  if (_rlBuckets.size > 5000) {                 // nettoyage anti-fuite mémoire
    for (const [k, v] of _rlBuckets) if (!v.length || now - v[v.length - 1] > windowMs) _rlBuckets.delete(k);
  }
  return arr.length > max;
}

app.post('/api/auth/login', async (req, res) => {
  // Anti brute-force : on ne compte QUE les ÉCHECS d'identifiants (un login réussi — ou un compte
  // suspendu/expiré au bon mot de passe — ne pénalise JAMAIS). Un utilisateur légitime qui recharge/teste
  // n'est donc jamais bloqué. Seuil : 20 échecs / 5 min / IP. (IP réelle via X-Forwarded-For nginx.)
  const _rlKey = 'login:' + _clientIp(req), _rlWin = 5 * 60 * 1000;
  const _fails = (_rlBuckets.get(_rlKey) || []).filter(t => Date.now() - t < _rlWin);
  if (_fails.length >= 20) {
    return res.status(429).json({ error: 'Trop de tentatives de connexion. Réessayez dans quelques minutes.' });
  }
  const { email, password } = req.body || {};
  if (!email || !password) return res.json({ error: 'Email et mot de passe requis' });
  try {
    const user = await auth.verifyLogin(email, password);
    if (!user) {
      _fails.push(Date.now()); _rlBuckets.set(_rlKey, _fails);   // ÉCHEC d'identifiants → compté (vrai brute-force)
      return res.json({ error: 'Email ou mot de passe incorrect' });
    }
    const _renewUrl = process.env.WHOP_RENEW_URL || 'https://whop.com/joined/justonetrader/products/jot-dtp/';
    if (user.suspended) {
      return res.json({ error: 'Votre abonnement n\'est plus actif. Renouvelez-le pour retrouver l\'accès complet au terminal.', renewTitle: 'Abonnement inactif', renewUrl: _renewUrl });
    }
    if (user.expired) {
      const d = new Date(user.expiresAt).toLocaleDateString('fr-FR');
      return res.json({ error: `Votre abonnement a expiré le ${d}. Renouvelez-le dès maintenant pour retrouver l'accès complet au terminal.`, renewTitle: 'Abonnement expiré', renewUrl: _renewUrl });
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
  // Anti-abus : max 5 demandes / 10 min / IP (au-delà, on ignore silencieusement)
  if (_rateLimited('forgot:' + _clientIp(req), 5, 10 * 60 * 1000)) return;
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
    // Essai gratuit : durée d'abonnement (création → expiration) ≤ ~1 semaine.
    let isTrial = false;
    const expiresAt = fresh.expires_at || null;
    if (expiresAt && fresh.created_at) {
      const span = new Date(expiresAt).getTime() - new Date(fresh.created_at).getTime();
      isTrial = span > 0 && span <= 8.5 * 24 * 60 * 60 * 1000;
    }
    const user = { id: fresh.id, email: fresh.email, name: fresh.name, role: fresh.role, plan: fresh.plan, active: !!fresh.active, expiresAt, isTrial };
    req.session.user = user; // maintenir la session à jour
    res.json({ loggedIn: true, user });
  } catch {
    // Fallback si DB inaccessible : utiliser la session
    res.json({ loggedIn: true, user: req.session.user });
  }
});

// ── Historique « Recent Searches » de la recherche symbole, PERSISTANT PAR COMPTE ──
// Stockage léger via le KV durable Supabase (auth.aiCacheSet/Get), clé symrecent:<userId> → suit la
// reconnexion (même sur un autre appareil). Valeur = { recent: [<6 codes de paire>] }. 0 schéma, 0 charge notable.
const _SYM_RX = /^[A-Z]{6}$/;
app.get('/api/sym-recent', async (req, res) => {
  if (!req.session?.userId) return res.json({ recent: [] });
  try {
    const v = await auth.aiCacheGet('symrecent:' + req.session.userId);
    const recent = (v && Array.isArray(v.recent)) ? v.recent.filter(p => typeof p === 'string' && _SYM_RX.test(p)).slice(0, 8) : [];
    res.json({ recent });
  } catch { res.json({ recent: [] }); }
});
app.post('/api/sym-recent', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ ok: false });
  try {
    const arr = Array.isArray(req.body?.recent) ? req.body.recent : [];
    const recent = arr.filter(p => typeof p === 'string' && _SYM_RX.test(p)).slice(0, 8);
    await auth.aiCacheSet('symrecent:' + req.session.userId, { recent });
    res.json({ ok: true, recent });
  } catch { res.status(500).json({ ok: false }); }
});

// ── PHOTO DE PROFIL (avatar) — persistante PAR COMPTE (KV Supabase avatar:<userId>, modèle symrecent).
// Stockée comme data URL (déjà compressée/recadrée côté client à ~256px → ~20-60 Ko). Suit la
// reconnexion → modifier sa photo sur un appareil la met à jour sur TOUS les autres. Préfixe hors purge 31j. ──
const _AV_MAX = 300000;   // garde-fou : data URL > ~300 Ko refusée (le client envoie ~40 Ko après recadrage)
app.get('/api/profile-avatar', async (req, res) => {
  res.set('Cache-Control', 'no-store');   // JAMAIS de cache navigateur : sinon une vieille réponse {avatar:null} se fige et la photo « ne suit pas » sur l'appareil
  if (!req.session?.userId) return res.status(401).json({ avatar: null });
  try {
    const v = await auth.aiCacheGet('avatar:' + req.session.userId, 8640000000000);
    const a = (v && typeof v.avatar === 'string') ? v.avatar : (typeof v === 'string' ? v : null);
    // deleted:true = photo SUPPRIMÉE volontairement (clé présente, avatar null) — distinct de
    // « jamais définie » (pas de clé) → le front peut migrer un vieux cache local vers le compte
    // SANS jamais ressusciter une photo que l'utilisateur a retirée.
    const deleted = !!(v && typeof v === 'object' && v.avatar === null);
    res.json({ avatar: (a && /^data:image\//.test(a)) ? a : null, deleted });
  } catch { res.json({ avatar: null }); }
});
app.post('/api/profile-avatar', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ ok: false });
  try {
    const a = req.body && req.body.avatar;
    if (a === null || a === '') { await auth.aiCacheSet('avatar:' + req.session.userId, { avatar: null }); return res.json({ ok: true, avatar: null }); }
    if (typeof a !== 'string' || !/^data:image\/(png|jpe?g|webp|gif);base64,/.test(a)) return res.status(400).json({ ok: false, error: 'format image invalide' });
    if (a.length > _AV_MAX) return res.status(413).json({ ok: false, error: 'image trop lourde (recadrez/compressez)' });
    await auth.aiCacheSet('avatar:' + req.session.userId, { avatar: a });
    res.json({ ok: true });
  } catch { res.status(500).json({ ok: false }); }
});

// ── JOURNAL DE TRADING — persistant PAR COMPTE (KV Supabase journal:<userId>, même modèle que
// symrecent : suit la reconnexion, même sur un autre appareil). Données PRIVÉES de l'utilisateur.
// Le préfixe 'journal:' n'est PAS dans AICACHE_PRUNABLE → jamais purgé par la rétention 31 j. ──
const _JR_MAX = 500;   // cap anti-abus / anti-OOM (≈ large pour un journal perso)
const _JR_KV_TTL = 8640000000000;   // « forever » côté cache RAM (la BDD reste la vérité)
// Colonnes CUSTOM (façon Notion) : valeurs libres par entrée, rangées dans un sac `props` (clé custom → valeur).
function _jrCleanProps(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return undefined;
  const out = {}; let n = 0;
  for (const k in p) {
    if (n++ >= 24) break;
    const kk = String(k).slice(0, 32); if (!kk) continue;
    const v = p[k];
    if (Array.isArray(v)) { const a = v.map(x => String(x || '').trim().slice(0, 30)).filter(Boolean).slice(0, 12); if (a.length) out[kk] = a; }
    else if (typeof v === 'number' && isFinite(v)) out[kk] = v;
    else if (v != null && v !== '') out[kk] = String(v).slice(0, 200);
  }
  return Object.keys(out).length ? out : undefined;
}
// Définitions de colonnes PAR COMPTE : ordre / masquage / renommage / colonnes custom (façon Notion).
function _jrCleanCols(arr) {
  if (!Array.isArray(arr)) return undefined;
  const seen = new Set(), out = [];
  for (const c of arr.slice(0, 40)) {
    if (!c || typeof c !== 'object') continue;
    const k = String(c.k || '').slice(0, 32); if (!k || seen.has(k)) continue; seen.add(k);
    const col = { k, builtin: c.builtin !== false, label: String(c.label || k).slice(0, 40), hidden: !!c.hidden };
    if (!col.builtin) { col.type = typeof c.type === 'string' ? c.type.slice(0, 10) : 'text'; const w = parseInt(c.w, 10); if (isFinite(w)) col.w = Math.max(70, Math.min(280, w)); }
    out.push(col);
  }
  return out.length ? out : undefined;
}
// Sections narratives du volet détail (façon page Notion) : clés fixes, texte long (analyse écrite).
const _JR_SECT_KEYS = ['fondaBias', 'technical', 'entry', 'management', 'close', 'erreur'];
function _jrCleanSections(o) {
  if (!o || typeof o !== 'object') return undefined;
  const out = {};
  for (const k of _JR_SECT_KEYS) { const v = o[k]; if (v != null && v !== '') out[k] = String(v).slice(0, 4000); }
  return Object.keys(out).length ? out : undefined;
}
function _jrCleanEntries(arr) {
  if (!Array.isArray(arr)) return [];
  const num = v => { const n = parseFloat(v); return isFinite(n) ? n : null; };
  const str = (v, n) => String(v == null ? '' : v).slice(0, n || 40);
  const tags = v => (Array.isArray(v) ? v : (v ? String(v).split(/[,;|]+/) : [])).map(x => String(x || '').trim().slice(0, 30)).filter(Boolean).slice(0, 12);
  return arr.map(e => e && typeof e === 'object' ? {
    id:    String(e.id || '').slice(0, 24) || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
    ts:    Number(e.ts) || Date.now(),
    pair:  String(e.pair || '').toUpperCase().replace(/[^A-Z0-9/.\-]/g, '').slice(0, 12),
    dir:   e.dir === 'SELL' ? 'SELL' : 'BUY',
    lots:  num(e.lots), entry: num(e.entry), exit: num(e.exit), pl: num(e.pl),
    note:  String(e.note || '').slice(0, 300),
    // ── champs riches (journal façon Notion / dashboard de stats) ──
    // Sélecteurs simples (1 valeur) : result/session/grade/account. Multi-tags (N valeurs) : conf/entryT/err/setup/tf/sl.
    result: str(e.result, 12), session: str(e.session, 24), grade: str(e.grade, 8), account: str(e.account, 32),
    fonda: num(e.fonda), rr: num(e.rr), risk: num(e.risk), r: num(e.r), pnlPct: num(e.pnlPct), equity: num(e.equity),
    conf: tags(e.conf), entryT: tags(e.entryT), err: tags(e.err), setup: tags(e.setup), tf: tags(e.tf), sl: tags(e.sl),
    sections: _jrCleanSections(e.sections),   // analyses écrites du volet détail (Fonda Bias, Technical, Entry…)
    props: _jrCleanProps(e.props),   // valeurs des colonnes custom
  } : null).filter(e => e && e.pair.length >= 2).slice(0, _JR_MAX);
}
app.get('/api/journal', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ entries: [] });
  if (req.session?.user?.role !== 'admin') return res.status(403).json({ entries: [], dev: true });   // fonctionnalité en développement → admins only
  try {
    const v = await auth.aiCacheGet('journal:' + req.session.userId, _JR_KV_TTL);
    // custom = false → gabarit DTP (options par défaut) ; true → journal PERSO importé (options de l'utilisateur uniquement)
    // cols = définitions de colonnes du compte (null → le client applique le gabarit standard)
    res.json({ entries: _jrCleanEntries(v && v.entries), custom: !!(v && v.custom), cols: (v && v.cols) || null });
  } catch { res.json({ entries: [], custom: false, cols: null }); }
});
app.post('/api/journal', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ ok: false });
  if (req.session?.user?.role !== 'admin') return res.status(403).json({ ok: false, dev: true });   // fonctionnalité en développement → admins only
  try {
    const entries = _jrCleanEntries(req.body && req.body.entries);
    const custom = !!(req.body && req.body.custom);   // mémorise si le compte a personnalisé son journal (import) → ne jamais re-proposer le gabarit DTP
    const cols = _jrCleanCols(req.body && req.body.cols);   // colonnes du compte (ordre/masquage/renommage/custom)
    const stored = { entries, custom }; if (cols) stored.cols = cols;
    await auth.aiCacheSet('journal:' + req.session.userId, stored);
    res.json({ ok: true, count: entries.length });
  } catch { res.status(500).json({ ok: false }); }
});

// ─── Admin routes (admin only) — tous async pour Supabase ────────────────────
app.get('/api/admin/users', requireAdmin, async (_req, res) => {
  try { res.json(await auth.getAllUsers()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Dashboard FINANCIER admin (KPIs + revenu estimé + prévision + Whop) ──────
//    Tout est calculé depuis la table users (données réelles). Le revenu est ESTIMÉ
//    à partir des prix connus (mensuel/annuel) et de la durée d'accès de chaque abonné.
const PRICE_MONTHLY = parseFloat(process.env.PRICE_MONTHLY) || 24.99;
const PRICE_ANNUAL  = parseFloat(process.env.PRICE_ANNUAL)  || 239.99;
app.get('/api/admin/finance', requireAdmin, async (_req, res) => {
  try {
    const users = await auth.getAllUsers();
    const now = Date.now(), DAY = 86400000;
    const monthKey = ts => { const d = new Date(ts); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
    const curMonth = monthKey(now);
    const lastMonth = monthKey(new Date(new Date().setUTCMonth(new Date().getUTCMonth() - 1)));

    // Classe un client → cycle + revenu mensuel-équivalent (mrr)
    const classify = u => {
      if (u.role !== 'client') return { cycle: 'staff', mrr: 0 };
      const crt = u.created_at ? new Date(u.created_at).getTime() : 0;
      const exp = u.expires_at ? new Date(u.expires_at).getTime() : 0;
      if (!exp) return { cycle: 'unlimited', mrr: 0 };                 // accès offert / illimité
      const span = crt ? exp - crt : 0;
      if (span > 0 && span <= 8.5 * DAY) return { cycle: 'trial', mrr: 0 };
      if (span >= 300 * DAY) return { cycle: 'annual', mrr: PRICE_ANNUAL / 12 };
      return { cycle: 'monthly', mrr: PRICE_MONTHLY };                 // mensuel (ou multi-mois ramené au mois)
    };

    const dist = { monthly: 0, annual: 0, trial: 0, unlimited: 0 };
    const signupsByMonth = {};                                        // 12 derniers mois
    for (let i = 11; i >= 0; i--) { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - i); signupsByMonth[monthKey(d.getTime())] = 0; }

    let totalUsers = users.length, clients = 0, activeSubs = 0, trials = 0, suspended = 0, expired = 0;
    let mrr = 0, atRiskMrr = 0, expiringSoon = 0, newThisMonth = 0, newLastMonth = 0, churned30 = 0, newSubs30 = 0;

    for (const u of users) {
      if (u.role === 'client') {
        clients++;
        const c = classify(u);
        const exp = u.expires_at ? new Date(u.expires_at).getTime() : 0;
        const isExpired = exp && exp < now;
        const isActive  = u.active && !isExpired;
        if (!u.active) suspended++;
        if (isExpired) expired++;
        // churn : abonnés payants expirés dans les 30 derniers jours
        if (exp && now - exp > 0 && now - exp <= 30 * DAY && c.mrr > 0) churned30++;
        if (isActive && c.cycle in dist) dist[c.cycle]++;
        if (isActive && c.mrr > 0) { activeSubs++; mrr += c.mrr; }
        if (isActive && c.cycle === 'trial') trials++;
        if (isActive && c.mrr > 0 && exp && exp - now > 0 && exp - now <= 7 * DAY) { expiringSoon++; atRiskMrr += c.mrr; }
      }
      // inscriptions par mois (tous comptes)
      if (u.created_at) {
        const mk = monthKey(new Date(u.created_at).getTime());
        if (mk in signupsByMonth) signupsByMonth[mk]++;
        if (mk === curMonth) newThisMonth++;
        if (mk === lastMonth) newLastMonth++;
        if (now - new Date(u.created_at).getTime() <= 30 * DAY && u.role === 'client' && classify(u).mrr > 0) newSubs30++;
      }
    }

    // Chiffres RÉELS Whop (si configuré) → priment sur l'estimation locale pour MRR + abonnés actifs.
    let whopStats = null;
    try { whopStats = await whop.getStats(PRICE_MONTHLY); } catch {}
    const useWhop = !!(whopStats && typeof whopStats.active === 'number');
    if (useWhop) { activeSubs = whopStats.active; mrr = whopStats.mrr; }

    const arr = mrr * 12;
    const arpu = activeSubs ? mrr / activeSubs : 0;
    const growthPct = newLastMonth ? ((newThisMonth - newLastMonth) / newLastMonth * 100) : (newThisMonth ? 100 : 0);
    const churnRate = (activeSubs + churned30) ? (churned30 / (activeSubs + churned30) * 100) : 0;
    const netAdds = newSubs30 - churned30;

    // Revenu NET par mois (12 derniers mois) = somme du MRR des clients RÉELLEMENT actifs ce mois-là.
    // Aucune projection/prévision : uniquement du net tombé.
    const revenueByMonth = {};
    for (let i = 11; i >= 0; i--) { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - i); revenueByMonth[monthKey(d.getTime())] = 0; }
    for (const u of users) {
      if (u.role !== 'client') continue;
      const c = classify(u); if (c.mrr <= 0) continue;
      const crt = u.created_at ? new Date(u.created_at).getTime() : 0;
      const exp = u.expires_at ? new Date(u.expires_at).getTime() : Number.POSITIVE_INFINITY;
      for (const mk of Object.keys(revenueByMonth)) {
        const [yy, mm] = mk.split('-').map(Number);
        const mStart = Date.UTC(yy, mm - 1, 1), mEnd = Date.UTC(yy, mm, 1) - 1;
        if (crt <= mEnd && exp >= mStart) revenueByMonth[mk] += c.mrr;
      }
    }
    Object.keys(revenueByMonth).forEach(k => { revenueByMonth[k] = +revenueByMonth[k].toFixed(2); });

    res.json({
      generatedAt: new Date().toISOString(),
      source: useWhop ? 'whop' : 'local',   // 'whop' = MRR/abonnés réels Whop ; 'local' = estimation table users
      pricing: { monthly: PRICE_MONTHLY, annual: PRICE_ANNUAL, currency: '€' },
      kpis: {
        totalUsers, clients, activeSubs, trials, suspended, expired,
        mrr: +mrr.toFixed(2), arr: +arr.toFixed(2), arpu: +arpu.toFixed(2),
        newThisMonth, newLastMonth, growthPct: +growthPct.toFixed(1),
        churned30, churnRate: +churnRate.toFixed(1), netAdds,
        expiringSoon, atRiskMrr: +atRiskMrr.toFixed(2),
      },
      distribution: dist,
      signupsByMonth,
      revenueByMonth,
      whop: { configured: (() => { try { return whop.configured(); } catch { return false; } })(), renewUrl: process.env.WHOP_RENEW_URL || 'https://whop.com/joined/justonetrader/products/jot-dtp/', webhookSecret: !!process.env.WHOP_WEBHOOK_SECRET },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Diagnostic IA — révèle l'état RÉEL des clés sur le serveur déployé (sans exposer
// les valeurs) + un test de génération en direct. Ouvre /api/admin/ai-status connecté
// en admin pour savoir si Gemini/Claude fonctionnent sur Render.
app.get('/api/admin/ai-status', requireAdmin, async (req, res) => {
  const st = (() => { try { return ai.status(); } catch { return { error: 'ai.status indisponible' }; } })();
  // Mode DRY par défaut : la page de statut ne déclenche PLUS de vraie génération à chaque ouverture
  // (en incident on la rafraîchit en boucle = RPD Gemini + crédits Claude gaspillés). ?live=1 = test réel.
  let test = { ok: null, dry: true, hint: 'ajouter ?live=1 pour un test de génération réel' };
  if (req.query.live === '1') {
    const t0 = Date.now();
    try {
      const out = await ai.generateText('Réponds exactement: OK', 20);
      test = { ok: true, ms: Date.now() - t0, sample: String(out).slice(0, 60) };
    } catch (e) {
      test = { ok: false, ms: Date.now() - t0, error: String(e && e.message || e).slice(0, 300) };
    }
  }
  // État du budget Gemini (pacing intra-journée) — pour voir la marge restante.
  let budget = null;
  try {
    _aiReset();
    const cap = _aiDailyCap();
    const dayTotal = Object.values(_aiUsage.dayCounts || {}).reduce((a, b) => a + b, 0);
    const frac = _aiDayFraction();
    budget = {
      monthlyBudget: GEMINI_MONTHLY_BUDGET,
      monthUsed: _aiUsage.total || 0,
      dailyCap: cap,
      usedToday: dayTotal,
      remainingToday: Math.max(0, cap - dayTotal),
      pacedCeilNow: Math.ceil(cap * frac) + AI_BURST,
      dayElapsed: Math.round(frac * 100) + '%',
      byCategory: _aiUsage.dayCounts || {},
      claudeOverBudgetByCategory: _aiUsage.claudeCounts || {},   // déversements Claude (crédits payants) du jour, comptés À PART
      weekend: _aiIsWeekend(),
    };
  } catch (e) { budget = { error: String(e && e.message || e) }; }
  res.json({
    mail: (() => { try { return mailer.getMailHealth(); } catch { return null; } })(),   // santé email (Gmail vérifié ?, envoyés/échoués)
    env: {
      GEMINI_API_KEY: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
      ANTHROPIC_API_KEY2: !!process.env.ANTHROPIC_API_KEY2,
      ANTHROPIC_API_KEY3: !!process.env.ANTHROPIC_API_KEY3,
      ANTHROPIC_API_KEY4: !!process.env.ANTHROPIC_API_KEY4,
    },
    ai: st,
    test,
    budget,
    swTitles: { total: _swCache.length, withAiTitle: _swCache.filter(w => w && w.aiTitle).length },
    // Usage learner (Phase 1) : ce que le système a APPRIS de la demande (créneau jour×heure × catégorie).
    learner: {
      currentSlot: _aiDemandSlot(), expectedNow: aiExpectedDemand(), slotsLearned: Object.keys(_aiDemand).length,
      busiestSlots: Object.entries(_aiDemand).map(([s, v]) => ({ slot: s, total: v._t || 0 })).sort((a, b) => b.total - a.total).slice(0, 6),
    },
  });
});

// TEST IA LISIBLE (admin) : lance une VRAIE génération et affiche QUEL provider a répondu + latence.
// Ouvre /api/admin/ai-test dans le navigateur (connecté en admin) — page HTML, pas du JSON brut.
app.get('/api/admin/ai-test', requireAdmin, async (_req, res) => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const snap = () => { try { return ai.status().usageToday || {}; } catch { return {}; } };
  const u0 = snap(); const t0 = Date.now();
  let ok = false, sample = '', err = '';
  try { const out = await ai.generateText('Réponds exactement: OK', 20); ok = true; sample = String(out).trim().slice(0, 100); }
  catch (e) { err = String((e && e.message) || e).slice(0, 220); }
  const ms = Date.now() - t0;
  const st = (() => { try { return ai.status(); } catch { return {}; } })();
  const u1 = st.usageToday || {}; const diff = k => (u1[k] || 0) - (u0[k] || 0);
  const provider = diff('gemini') > 0 ? 'Gemini' : diff('github') > 0 ? ('GitHub Models (' + ((st.github && st.github.model) || 'gpt-4o') + ')') : diff('openrouter') > 0 ? 'OpenRouter (:free)' : (diff('fallback') > 0 || diff('claude') > 0) ? 'Claude' : '—';
  const intel = st.intel || {}; const color = ok ? '#22c55e' : '#ef4444';
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test IA DTP</title>
  <style>body{background:#0c0c0e;color:#e5e7eb;font-family:-apple-system,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
  .box{background:#141416;border:1px solid #26262b;border-radius:12px;padding:30px 38px;max-width:600px;width:100%}
  .big{font-size:46px;text-align:center;line-height:1}h1{color:${color};font-size:22px;margin:8px 0 18px;text-align:center}
  table{width:100%;border-collapse:collapse;font-size:13px}td{padding:6px 4px;border-bottom:1px solid #1f1f24}td:first-child{color:#8a93a3;width:46%}
  code{background:#0a0a0c;padding:2px 7px;border-radius:5px;color:#f7941d}a{color:#f7941d}.muted{color:#6b7280;font-size:12px;margin-top:16px;text-align:center}</style></head>
  <body><div class="box"><div class="big">${ok ? '✅' : '❌'}</div><h1>${ok ? 'IA opérationnelle' : 'Échec IA'}</h1>
  <table>
    <tr><td>Provider qui a répondu</td><td><code>${esc(provider)}</code></td></tr>
    <tr><td>Latence</td><td>${ms} ms</td></tr>
    ${ok ? `<tr><td>Réponse</td><td><code>${esc(sample)}</code></td></tr>` : `<tr><td>Erreur</td><td style="color:#fca5a5;font-size:12px">${esc(err)}</td></tr>`}
    <tr><td>Ressources</td><td>Gemini ${st.geminiKeys || 0} clés · GitHub ${(st.github && st.github.tokens) || 0} tokens · Claude ${st.anthropicKeys || 0} clés</td></tr>
    <tr><td>Token-bucket RPM</td><td>${intel.rpmBucket != null ? intel.rpmBucket : '?'} / ${intel.rpmTarget || '?'}</td></tr>
    <tr><td>Breakers ouverts</td><td>${intel.breakersOpen != null ? intel.breakersOpen : '?'}</td></tr>
    <tr><td>Usage aujourd'hui</td><td>Gemini ${u1.gemini || 0} · GitHub ${u1.github || 0} · 429 ${u1.gemini429 || 0}</td></tr>
  </table>
  <p class="muted"><a href="/api/admin/ai-test">↻ Relancer le test</a></p></div></body></html>`;
  res.set('Content-Type', 'text/html; charset=utf-8').send(html);
});

// TEST D'ENVOI EMAIL (admin) : envoie un vrai email et affiche le canal qui a réussi.
// Ouvre dans le navigateur (connecté en admin) : /api/admin/mail-test  → vers ton propre email
//   ou /api/admin/mail-test?to=client@example.com  → vers une adresse précise.
app.get('/api/admin/mail-test', requireAdmin, async (req, res) => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const to = String(req.query.to || req.session.user.email || '').trim();
  const r = await mailer.sendTest(to).catch(e => ({ ok: false, provider: null, lastError: String(e && e.message || e) }));
  const color = r.ok ? '#22c55e' : '#ef4444';
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"><title>Test email DTP</title>
  <style>body{background:#0c0c0e;color:#e5e7eb;font-family:-apple-system,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
  .box{background:#141416;border:1px solid #26262b;border-radius:12px;padding:32px 40px;max-width:560px;text-align:center}
  .big{font-size:48px;line-height:1}h1{color:${color};font-size:22px;margin:10px 0}
  code{background:#0a0a0c;padding:2px 8px;border-radius:5px;color:#f7941d;font-size:13px}a{color:#f7941d}</style></head>
  <body><div class="box"><div class="big">${r.ok ? '✅' : '❌'}</div>
  <h1>${r.ok ? 'Email envoyé !' : "Échec de l'envoi"}</h1>
  <p>Destinataire : <code>${esc(to)}</code></p>
  ${r.ok
    ? `<p>Canal utilisé : <code>${esc(r.provider)}</code></p>
       <p style="color:#94a3b8;font-size:14px;margin-top:18px">👉 Vérifie <b>la boîte de réception</b> de ${esc(to)} (et au pire les spams).
       Si le canal est <b>API Gmail</b>, l'email arrive en boîte principale. 🎉</p>`
    : `<p style="color:#fca5a5;font-size:13px;word-break:break-word">${esc(r.lastError || 'erreur inconnue')}</p>`}
  <p style="margin-top:22px"><a href="/api/admin/mail-test?to=${encodeURIComponent(to)}">↻ Renvoyer</a></p></div></body></html>`;
  res.set('Content-Type', 'text/html; charset=utf-8').send(html);
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

// Message d'accueil envoyé automatiquement par le support à chaque NOUVEAU client (dans le chat).
// Message de bienvenue DYNAMIQUE : s'adapte à l'heure (Paris) → session active + recap d'analyste qui arrive.
function welcomeChat() {
  let h = 12;
  try { h = parseInt(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }).slice(0, 2), 10) || 12; } catch {}
  let sess, recap;
  if (h < 8)       { sess = 'asiatique';  recap = 'de la session américaine'; }   // nuit/tôt → US vient de clôturer
  else if (h < 13) { sess = 'de Londres'; recap = 'de la session asiatique'; }     // matin → l'Asie vient de clôturer
  else if (h < 17) { sess = 'américaine'; recap = 'de la session de Londres'; }    // après-midi → Londres clôture
  else             { sess = 'américaine'; recap = 'de la session américaine'; }    // soir → US en cours
  return "Bonjour et bienvenue sur DataTradingPro 👋\n\nJe suis là pour t'accompagner. Ton accès est activé : tu as le flux de news en temps réel, le calendrier économique, la force des devises et les analyses institutionnelles.\n\n"
    + `Pour bien démarrer pendant la session ${sess} : ouvre le rapport d'analyste (le recap ${recap} qui arrive) et le calendrier économique.\n\n`
    + "Une question ou besoin d'un coup de main ? Écris-moi directement ici, je te réponds. Bons trades !\n\nL'équipe DataTradingPro";
}
function _sendWelcomeChat(userId) {
  if (!userId) return;
  auth.chatInsert({ user_id: userId, sender: 'support', text: welcomeChat() }).catch(() => {});
}

// Envoi de bienvenue FIABLE + VISIBLE : on AWAIT, on LOGGE clairement le résultat, et on REMONTE
// le statut à l'appelant (fini le `.catch(()=>{})` muet — un mail raté ne disparaît plus en silence).
// La résilience d'envoi est déjà assurée par la cascade de fournisseurs côté mailer (OVH → Gmail API
// → Gmail SMTP). Si TOUS échouent → log d'erreur + alerte admin (best-effort).
async function _sendWelcomeReliable(d) {
  if (!d || !d.to) return { sent: false, skipped: true };
  try {
    const provider = await mailer.sendWelcome(d);   // string (canal gagnant) si OK, false sinon
    if (provider) { console.log(`[Welcome] ✅ envoyé via ${provider} → ${d.to}`); return { sent: true, provider }; }
    console.error(`[Welcome] ❌ AUCUN fournisseur n'a envoyé l'email de bienvenue → ${d.to}`);
  } catch (e) {
    console.error(`[Welcome] ❌ erreur d'envoi → ${d.to}: ${e.message}`);
  }
  // Échec définitif : on ALERTE l'admin (par un autre canal le cas échéant) pour ne JAMAIS rater un mail en silence.
  mailer.sendAdminAlert({ subject: `Email de bienvenue NON envoyé à ${d.to}`,
    html: `<p style="color:#cbd5e1;font-size:15px;line-height:1.6;">L'email de bienvenue n'a pas pu être envoyé à <b>${d.to}</b> (tous les fournisseurs ont échoué). Le compte est bien créé. Vérifie la santé Mail dans le panel admin (onglet IA &amp; Mail) et renvoie l'email depuis la fiche utilisateur.</p>` }).catch(() => {});
  return { sent: false, error: 'aucun fournisseur disponible' };
}

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const body = { ...req.body, expiresAt: computeExpiry(req.body) };
    const newUser = await auth.createUser(body);
    // Email + message de bienvenue : uniquement pour les CLIENTS (pas le staff admin/support).
    // On AWAIT l'envoi pour RENVOYER son statut → l'admin voit immédiatement si le mail est parti.
    let mail = { sent: false, skipped: true };
    if (body.email && (body.role || 'client') === 'client') {
      mail = await _sendWelcomeReliable({ to: body.email, name: body.name, password: body.password, expiresAt: body.expiresAt });
      _sendWelcomeChat(newUser && newUser.id);
    }
    res.json({ ok: true, mail });
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

    // Emails selon le changement de statut (non bloquant) — le client est notifié à chaque action admin
    const activeReq = 'active' in req.body
      ? (req.body.active === 1 || req.body.active === true || req.body.active === '1')
      : null;
    // Prolongation manuelle : l'admin a choisi une durée → nouvelle échéance dans le futur.
    const _newExp = fields.expiresAt || null;
    const _extended = !!req.body.duration && _newExp && new Date(_newExp).getTime() > Date.now();
    if (activeReq === false) {
      // Suspendu → renouvellement échoué
      auth.getUserById(id)
        .then(u => { if (u?.email && u.role === 'client') mailer.sendRenewalFailed({ to: u.email, name: u.name }); })
        .catch(() => {});
    } else if (activeReq === true && before && !before.active) {
      // Réactivé (était SUSPENDU → actif) → email de réactivation
      auth.getUserById(id)
        .then(u => { if (u?.email && u.role === 'client') mailer.sendReactivated({ to: u.email, name: u.name, expiresAt: u.expires_at }); })
        .catch(() => {});
    } else if (_extended) {
      // Prolongation/renouvellement MANUEL d'un compte déjà actif (y compris expiré-mais-actif) →
      // email « Abonnement renouvelé » (c'était le cas non couvert : compte expiré relancé de N jours).
      auth.getUserById(id)
        .then(u => { if (u?.email && u.role === 'client') mailer.sendRenewed({ to: u.email, name: u.name, expiresAt: u.expires_at }); })
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
    // Parrainage : rejoue les jours OFFERTS cumulés du membre, sinon le renouvellement Whop les écraserait.
    try {
      const _bonus = Number(await auth.aiCacheGet('refbonus:' + existing.id, 8640000000000).catch(() => 0)) || 0;
      if (_bonus > 0 && mem.expiresAt) {
        const _ext = new Date(new Date(mem.expiresAt).getTime() + _bonus * 86400000).toISOString();
        await auth.updateUser(existing.id, { expiresAt: _ext });
      }
    } catch (e) { console.error('[Referral] bonus reapply:', e.message); }
    // Anti-doublon DURABLE : Whop peut refire le MÊME renouvellement (retries du webhook, ou plusieurs
    // types d'events pour un seul paiement) → 1 SEUL email par (user, échéance). Clé = échéance, donc
    // un VRAI renouvellement (nouvelle date) ré-enverra bien un mail.
    const dedupKey = `whop-renew:${existing.id}:${mem.expiresAt || 'unlimited'}`;
    if (await auth.emailLogHas(dedupKey)) { console.log(`[Whop] Renouvellement déjà notifié (anti-doublon) → ${mem.email}`); return; }
    await auth.emailLogAdd(dedupKey);
    if (wasInactive) mailer.sendReactivated({ to: existing.email, name: existing.name, expiresAt: mem.expiresAt }).catch(() => {});
    else             mailer.sendRenewed({ to: existing.email, name: existing.name, expiresAt: mem.expiresAt }).catch(() => {});
    mailer.sendAdminRenewalNotice({ clientEmail: existing.email, clientName: existing.name, expiresAt: mem.expiresAt, isNew: false }).catch(() => {});
    console.log(`[Whop] Renouvelé: ${mem.email} → ${mem.expiresAt || 'illimité'}`);
  } else {
    // Anti-doublon : 1 seul mail de bienvenue par email (même si Whop refire l'event de création).
    const dedupKey = `whop-welcome:${mem.email}`;
    if (await auth.emailLogHas(dedupKey)) { console.log(`[Whop] Bienvenue déjà envoyée (anti-doublon) → ${mem.email}`); return; }
    const pwd = require('crypto').randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) + 'A1';
    const wu = await auth.createUser({ email: mem.email, password: pwd, name: '', role: 'client', plan: 'professionnel', expiresAt: mem.expiresAt });
    await auth.emailLogAdd(dedupKey);
    mailer.sendWelcome({ to: mem.email, name: '', password: pwd, expiresAt: mem.expiresAt }).catch(() => {});
    _sendWelcomeChat(wu && wu.id);
    mailer.sendAdminRenewalNotice({ clientEmail: mem.email, clientName: '', expiresAt: mem.expiresAt, isNew: true }).catch(() => {});
    console.log(`[Whop] Compte créé: ${mem.email}`);
    // Parrainage via lien d'affiliation Whop (?a=<username>) : l'adhésion porte l'username du
    // parrain → on crédite le filleul ICI, sans dépendre du cookie landing. Verrou referredby
    // = un filleul ne compte qu'une fois (même s'il repasse ensuite par la landing).
    try {
      const aff = mem.affiliateUsername && String(mem.affiliateUsername).toLowerCase();
      if (aff && wu && wu.id) {
        const refUid = await auth.aiCacheGet('whopaff:' + aff, 8640000000000).catch(() => null);
        const already = await auth.aiCacheGet('referredby:' + wu.id, 8640000000000).catch(() => null);
        if (refUid && String(refUid) !== String(wu.id) && !already) {
          await auth.aiCacheSet('referredby:' + wu.id, String(refUid)).catch(() => {});
          await _refCreditFilleul(String(refUid), wu);
          console.log(`[Referral] Filleul attribué via lien Whop: ${mem.email} → parrain ${refUid} (a=${aff})`);
        }
      }
    } catch (e) { console.error('[Referral] attribution Whop:', e.message); }
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
  // Sécurité : si un secret est configuré, le webhook doit le présenter (token URL ou header).
  // → empêche un tiers d'envoyer un faux event "cancel" pour suspendre un membre.
  // (Opt-in : tant que WHOP_WEBHOOK_SECRET n'est pas défini, comportement inchangé.)
  const _whSecret = process.env.WHOP_WEBHOOK_SECRET;
  if (_whSecret) {
    const provided = req.query.token || req.headers['x-webhook-token'] || req.headers['x-whop-token'];
    if (provided !== _whSecret) return res.status(403).json({ error: 'forbidden' });
  }
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

// ═══════════════════ PARRAINAGE (REFERRALS) ═══════════════════
// Stockage KV (table ai_cache — voir note anti-prune ci-dessous) :
//   referral:<userId>   = { code, count, referrals:[{email,at}], rewards, bonusDays, updatedAt }
//   refcodes:index      = { "<CODE>": "<userId>" }  ← index inverse, 1 clé unique gardée "chaude"
//   referredby:<userId> = "<parrainId>"             ← verrou : un filleul rattaché une seule fois
//   refbonus:<userId>   = <joursOfferts cumulés>    ← rejoué à chaque renouvellement Whop
// NB anti-prune : aiCachePrune supprime tout ce qui dépasse ~31 j → on RE-écrit (touch) ces clés à chaque
// chargement (GET /api/referrals), donc elles restent fraîches tant que l'abonné utilise le terminal.
const REF_TARGET     = parseInt(process.env.REFERRAL_TARGET || '3', 10);   // 3 parrainages = 1 mois offert
const REF_BONUS_DAYS = parseInt(process.env.REFERRAL_BONUS_DAYS || '30', 10);
const REF_MAX_AGE_DAYS = parseInt(process.env.REFERRAL_MAX_AGE_DAYS || '45', 10); // le filleul doit être un compte récent
// Le lien DOIT pointer vers la LANDING (et non Whop directement) : c'est elle qui capture ?ref= et
// pose le cookie dtp_ref partagé .datatradingpro.com, lu par le desk au 1er login du filleul. Un lien
// vers whop.com sautait cette étape → cookie jamais posé → AUCUN filleul jamais rattaché.
const REF_BASE_URL   = process.env.REFERRAL_BASE_URL || 'https://datatradingpro.com';
const KV_FOREVER     = 8640000000000;   // lit la valeur quel que soit son âge

// ── Lien d'affiliation WHOP (décision utilisateur) : le panneau Parrainages donne le lien Whop
// « ?a=<username> » — c'est Whop qui tracke le clic, attribue la vente et VERSE les 10 % récurrents.
// Le username Whop du membre est résolu par email via l'API (caché en KV), et on mémorise
// l'index inverse whopaff:<username> → userId pour créditer les filleuls via le webhook.
// Repli : si le membre n'a pas de username Whop résolvable, on redonne le lien landing ?ref= (cookie).
const REF_WHOP_BASE = process.env.REFERRAL_WHOP_BASE || 'https://whop.com/joined/justonetrader/products/jot-dtp/';
async function _refWhopAffiliate(uid) {
  try { const c = await auth.aiCacheGet('whopaffinfo:' + uid, KV_FOREVER); if (c && (c.pageUrl || c.username)) return c; } catch {}
  let info = null;
  try { const u = await auth.getUserById(uid); if (u && u.email) info = await whop.getAffiliateInfo(u.email); } catch {}
  if (info && (info.pageUrl || info.username)) {
    try {
      await auth.aiCacheSet('whopaffinfo:' + uid, info);
      if (info.username) await auth.aiCacheSet('whopaff:' + String(info.username).toLowerCase(), String(uid));   // index inverse (attribution webhook)
    } catch {}
    return info;
  }
  return null;
}

function _refMaskEmail(e) {
  e = String(e || ''); const i = e.indexOf('@');
  if (i < 1) return e || 'Filleul';
  const u = e.slice(0, i), d = e.slice(i + 1);
  return (u.length <= 2 ? u[0] + '*' : u.slice(0, 2) + '****') + '@' + d;
}
function _refCodeFor(userId) {
  const h = require('crypto').createHash('sha1').update('dtpref:' + String(userId)).digest('hex');
  const ab = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   // sans 0/O/1/I
  let n = parseInt(h.slice(0, 12), 16), s = '';
  for (let i = 0; i < 7; i++) { s += ab[n % ab.length]; n = Math.floor(n / ab.length); }
  return 'DTP-' + s;
}
function _refAddDaysISO(base, days) {
  const t = base ? new Date(base).getTime() : Date.now();
  const from = Math.max(isNaN(t) ? Date.now() : t, Date.now());
  return new Date(from + days * 86400000).toISOString();
}
async function _refIndexAdd(code, userId) {
  const idx = (await auth.aiCacheGet('refcodes:index', KV_FOREVER).catch(() => null)) || {};
  idx[code] = String(userId);
  await auth.aiCacheSet('refcodes:index', idx).catch(() => {});   // re-set ⇒ created_at rafraîchi ⇒ survit au prune
}
async function _refResolve(code) {
  const idx = (await auth.aiCacheGet('refcodes:index', KV_FOREVER).catch(() => null)) || {};
  return idx[code] || null;
}
async function _refGetRecord(userId) {
  let rec = await auth.aiCacheGet('referral:' + userId, KV_FOREVER).catch(() => null);
  if (!rec || !rec.code) rec = { code: _refCodeFor(userId), count: 0, referrals: [], rewards: 0, bonusDays: 0, updatedAt: Date.now() };
  return rec;
}
async function _refSaveRecord(userId, rec) {
  rec.updatedAt = Date.now();
  await auth.aiCacheSet('referral:' + userId, rec).catch(() => {});   // touch
  await _refIndexAdd(rec.code, userId);
}

// Données de parrainage du membre courant (et "touch" anti-prune)
app.get('/api/referrals', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non autorisé' });
  try {
    const uid = req.session.userId;
    const rec = await _refGetRecord(uid);
    await _refSaveRecord(uid, rec);
    const count = rec.count || 0;
    // Lien Whop d'affiliation en priorité (tracking + versement des 10 % par Whop) ; repli landing.
    // pageUrl = lien CANONIQUE renvoyé par Whop (affiliate_page_url) ; sinon on construit ?a=<username>.
    const aff = await _refWhopAffiliate(uid);
    const link = (aff && aff.pageUrl) ? aff.pageUrl
      : (aff && aff.username) ? REF_WHOP_BASE + '?a=' + encodeURIComponent(aff.username)
      : REF_BASE_URL + '/?ref=' + rec.code;
    res.json({
      ok: true, code: rec.code, link, whopAffiliate: !!aff,
      count, target: REF_TARGET, progress: count % REF_TARGET,
      untilNext: (REF_TARGET - (count % REF_TARGET)) % REF_TARGET || REF_TARGET,
      rewards: rec.rewards || 0, bonusDays: rec.bonusDays || 0,
      earnings: '0,00 €',   // modèle Whop affiliation : les gains réels viennent du dashboard Whop (à brancher)
      history: (rec.referrals || []).slice(-15).reverse()
    });
  } catch (e) { console.error('[Referral] get:', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Rattachement d'un filleul (appelé au 1er login du filleul via le cookie dtp_ref)
app.post('/api/referrals/claim', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non autorisé' });
  const me = req.session.userId;
  const code = String(req.body?.code || '').trim().toUpperCase();
  try {
    if (!/^DTP-[0-9A-Z]{4,}$/.test(code)) return res.json({ ok: false, reason: 'no-code' });
    if (await auth.aiCacheGet('referredby:' + me, KV_FOREVER).catch(() => null)) return res.json({ ok: false, reason: 'already' });
    const refUserId = await _refResolve(code);
    if (!refUserId) return res.json({ ok: false, reason: 'bad-code' });
    if (String(refUserId) === String(me)) return res.json({ ok: false, reason: 'self' });
    const meUser = await auth.getUserById(me).catch(() => null);
    if (meUser && meUser.created_at) {
      const ageDays = (Date.now() - new Date(meUser.created_at).getTime()) / 86400000;
      if (ageDays > REF_MAX_AGE_DAYS) return res.json({ ok: false, reason: 'too-old' });
    }
    await auth.aiCacheSet('referredby:' + me, String(refUserId)).catch(() => {});   // verrou immuable
    // Email de bienvenue au FILLEUL (programme : 3 inscrits = 1 mois offert)
    try {
      if (meUser && meUser.email) {
        let _refName = '';
        try { const _ru = await auth.getUserById(refUserId); _refName = (_ru && _ru.name) || ''; } catch {}
        mailer.sendReferredWelcome({ to: meUser.email, name: meUser.name, referrerName: _refName }).catch(() => {});
      }
    } catch {}
    const rewarded = await _refCreditFilleul(String(refUserId), meUser);
    res.json({ ok: true, rewarded });
  } catch (e) { console.error('[Referral] claim:', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Crédite UN filleul au parrain (compteur, récompense « 3 inscrits = +30 j », emails).
// Utilisé par la route claim (cookie landing) ET par le webhook Whop (lien d'affiliation ?a=).
async function _refCreditFilleul(refUserId, fillUser) {
  const rec = await _refGetRecord(refUserId);
  rec.referrals = rec.referrals || [];
  rec.referrals.push({ email: _refMaskEmail(fillUser && fillUser.email), at: Date.now() });
  rec.count = (rec.count || 0) + 1;
  let rewarded = false;
  if (rec.count % REF_TARGET === 0) {
    rec.rewards = (rec.rewards || 0) + 1;
    rec.bonusDays = (rec.bonusDays || 0) + REF_BONUS_DAYS;
    rewarded = true;
    try {
      const refU = await auth.getUserById(refUserId);
      if (refU && refU.role !== 'admin') {
        const newExp = _refAddDaysISO(refU.expires_at, REF_BONUS_DAYS);
        await auth.updateUser(refUserId, { expiresAt: newExp });               // +1 mois d'ACCÈS DTP (pas la facturation Whop)
        await auth.aiCacheSet('refbonus:' + refUserId, rec.bonusDays).catch(() => {});
        if (refU.email) {
          mailer.sendReferralReward({ to: refU.email, name: refU.name, count: rec.count, newExpiresAt: newExp }).catch(() => {});
          mailer.sendAdminReferralReward({ refEmail: refU.email, refName: refU.name, count: rec.count, newExpiresAt: newExp }).catch(() => {});
        }
      }
    } catch (e) { console.error('[Referral] reward grant:', e.message); }
  }
  await _refSaveRecord(refUserId, rec);
  if (!rewarded) {
    try {
      const refU = await auth.getUserById(refUserId);
      if (refU && refU.email) mailer.sendReferralCredited({ to: refU.email, name: refU.name, count: rec.count, untilNext: (REF_TARGET - (rec.count % REF_TARGET)) % REF_TARGET || REF_TARGET }).catch(() => {});
    } catch {}
  }
  return rewarded;
}

// ═══════════════════ CHAT SUPPORT ═══════════════════
// Indicateur "en train d'écrire" (poll) : { userId: { user: ts, support: ts } }
const _chatTyping = {};
function _markTyping(uid, who) { const u = _chatTyping[String(uid)] || (_chatTyping[String(uid)] = {}); u[who] = Date.now(); }
function _isTyping(uid, who) { const u = _chatTyping[String(uid)]; return !!(u && u[who] && Date.now() - u[who] < 5000); }

// Côté utilisateur : sa conversation avec le support (persistée en BDD/fichier).
app.get('/api/chat', async (req, res) => {
  const uid = req.session?.userId;
  if (!uid) return res.status(401).json({ error: 'Non autorisé' });
  try {
    const messages = await auth.chatList(uid);
    await auth.chatMarkRead(uid, 'support');   // l'utilisateur a lu les réponses du support
    res.json({ messages, typing: _isTyping(uid, 'support') });   // le support est-il en train d'écrire ?
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/chat', async (req, res) => {
  const uid = req.session?.userId;
  if (!uid) return res.status(401).json({ error: 'Non autorisé' });
  const text = (req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Message vide' });
  if (!/^data:/.test(text) && text.length > 4000) return res.status(400).json({ error: 'Message trop long (4000 caractères max)' });
  try {
    const msg = await auth.chatInsert({ user_id: uid, sender: 'user', text });
    res.json({ ok: true, message: msg });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// L'utilisateur tape → on le signale au support
app.post('/api/chat/typing', (req, res) => {
  if (!req.session?.userId) return res.json({ ok: false });
  _markTyping(req.session.userId, 'user'); res.json({ ok: true });
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
    const [threads, users] = await Promise.all([auth.chatThreads(), auth.getAllUsers()]);   // parallèle = 1 seul aller-retour
    const byId = new Map(users.map(u => [String(u.id), u]));
    res.json({ threads: threads.map(t => ({ ...t, name: byId.get(String(t.user_id))?.name || '', email: byId.get(String(t.user_id))?.email || '' })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// TOUS les utilisateurs (staff uniquement) avec statut "en ligne" → permet au support de
// contacter n'importe qui, pas seulement ceux qui ont déjà écrit. + recherche côté client.
app.get('/api/support/users', requireSupport, async (req, res) => {
  try {
    const me = String(req.session?.userId || '');
    const users = await auth.getAllUsers();
    res.json({
      users: users
        .filter(u => String(u.id) !== me)   // on ne se liste pas soi-même
        .map(u => ({ id: u.id, name: u.name || '', email: u.email || '', role: u.role || 'user', online: _isUserOnline(u.id) }))
        .sort((a, b) => (b.online - a.online) || (a.name || a.email).localeCompare(b.name || b.email)),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/chat/:userId', requireSupport, async (req, res) => {
  try {
    const messages = await auth.chatList(req.params.userId);
    await auth.chatMarkRead(req.params.userId, 'user');   // l'admin a lu les messages de l'utilisateur
    res.json({ messages, typing: _isTyping(req.params.userId, 'user') });   // le client est-il en train d'écrire ?
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Le support tape dans un thread → on le signale au client
app.post('/api/admin/chat/:userId/typing', requireSupport, (req, res) => {
  _markTyping(req.params.userId, 'support'); res.json({ ok: true });
});
app.post('/api/admin/chat/:userId', requireSupport, async (req, res) => {
  const text = (req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Message vide' });
  if (!/^data:/.test(text) && text.length > 4000) return res.status(400).json({ error: 'Message trop long (4000 caractères max)' });
  try {
    const msg = await auth.chatInsert({ user_id: req.params.userId, sender: 'support', text });
    res.json({ ok: true, message: msg });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Réaction emoji (👍 ❤️ 🔥) sur un message — client OU support ; toggle par réacteur
app.post('/api/chat/react', async (req, res) => {
  const who = req.session?.userId;
  if (!who) return res.status(401).json({ error: 'Non autorisé' });
  const { id, emoji } = req.body || {};
  if (!id || !emoji) return res.status(400).json({ error: 'Paramètres manquants' });
  try {
    const reactions = await auth.chatReact(id, emoji, who);
    res.json({ ok: reactions !== null, reactions });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Admin : supprimer un message
app.delete('/api/admin/chat/message/:id', requireSupport, async (req, res) => {
  try { res.json({ ok: await auth.chatDelete(req.params.id) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// Admin : modifier le texte d'un message
app.patch('/api/admin/chat/message/:id', requireSupport, async (req, res) => {
  const text = (req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Message vide' });
  try { const msg = await auth.chatUpdate(req.params.id, text); res.json({ ok: !!msg, message: msg }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// PRIMER : briefings auto-générés (Daily Recap, London Session/Opening, Asia-Pac…) → MASQUÉS du site
// (demande utilisateur). Détection robuste : flag interne _briefing OU titre commençant par « PRIMER ».
const _isPrimerNews = n => !!(n && (n._briefing || /^\s*\[?\s*primer\b/i.test(String(n.headline || ''))));
app.get('/api/news', (_req, res) => {
  const items = allNews.filter(n => !_isPrimerNews(n)).slice(0, 200);
  items.forEach(_cleanItemMd);   // titres/headlines sans markdown brut, même pour un JS en cache
  res.json({ items, total: items.length });
});

// PUBLIC (page Week Ahead) : MÊME flux que l'onglet News (allNews), projeté pour le ticker public.
app.get('/api/week-ahead-news', (_req, res) => {
  const items = (Array.isArray(allNews) ? allNews : []).filter(n => !_isPrimerNews(n)).slice(0, 120).map(n => ({
    headline: (n.headline || '').slice(0, 240),
    timestamp: n.timestamp || 0,
    category: n.category || (Array.isArray(n.tags) && n.tags[0]) || '',
    priority: n.priority || 'low',
    tags: Array.isArray(n.tags) ? n.tags.slice(0, 3) : [],
  }));
  res.json({ items, total: items.length });
});

// ── Macro AI Assistant : chat IA (Gemini→Claude) avec CONTEXTE marché réel + sources réelles ──
// Durci : (1) compté dans le budget via aiSmart('chat', priority:'user') — fini le bypass total ;
// (2) rate-limit PAR UTILISATEUR (rafale + jour) — un seul compte ne peut plus vider le quota ;
// (3) clé de cache DATÉE (jour) — une question marché ne ressert plus une réponse périmée ;
// (4) cache mémoire borné (anti-OOM).
const _aiChatMem = {};   // cache process (clé = hash question + jour) ; aussi persisté dans ai_cache
function _aiChatKey(q) { return 'aichat:' + _aiDay() + ':' + require('crypto').createHash('md5').update(q.toLowerCase().trim()).digest('hex').slice(0, 22); }
function _fmtDMY(ts) { const d = ts ? new Date(ts) : new Date(); const p = n => String(n).padStart(2, '0'); return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; }
// ── Quota Assistant IA Macro (admin + support exemptés). Durable via KV Supabase (survit aux
// redémarrages), reset quotidien minuit Paris. La limite n'est décomptée QUE sur une génération
// RÉELLE (les hits de cache sont gratuits) ; un anti-rafale (8/min) complète contre le spam. ──
const AI_CHAT_DAILY_LIMIT = parseInt(process.env.AI_CHAT_DAILY_LIMIT || '5', 10);
const _aiChatDay = {};   // cache mémoire { uid: { day, count } } — évite un read KV à chaque message
function _aiChatToday() { try { return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }); } catch { return new Date().toISOString().slice(0, 10); } }
async function _aiChatDailyCount(uid, day) {
  const rec = _aiChatDay[uid];
  if (rec && rec.day === day) return rec.count;
  let n = 0;
  try { const v = await auth.aiCacheGet('aichatcap:' + uid + ':' + day, 8640000000000); if (typeof v === 'number') n = v; else if (v && typeof v.count === 'number') n = v.count; } catch {}
  _aiChatDay[uid] = { day, count: n };
  return n;
}
async function _aiChatDailyIncr(uid, day) {
  const rec = (_aiChatDay[uid] && _aiChatDay[uid].day === day) ? _aiChatDay[uid] : (_aiChatDay[uid] = { day, count: 0 });
  rec.count += 1;
  try { await auth.aiCacheSet('aichatcap:' + uid + ':' + day, rec.count); } catch {}
}
app.post('/api/ai/chat', async (req, res) => {
  const q = String((req.body && req.body.message) || '').trim().slice(0, 600);
  if (!q) return res.status(400).json({ error: 'Message vide' });
  const _uid = req.session?.userId, _role = req.session?.user?.role;
  // Anti-rafale (8/min) : protège même les comptes exemptés de la limite/jour, sans toucher au quota durable.
  if (_rateLimited('aichat-burst:' + (_uid || req.ip || 'anon'), 8, 60 * 1000)) return res.status(429).json({ error: 'Trop de messages — réessayez dans une minute.' });
  // Sources RÉELLES = news récentes effectivement fournies en contexte à l'IA (pas de mock)
  const newsCtx = (Array.isArray(allNews) ? allNews : []).slice(0, 12);
  const sources = newsCtx.map(n => ({ name: n.source || n.category || 'Market Wire', date: _fmtDMY(n.timestamp) }));
  const key = _aiChatKey(q);
  let answer = _aiChatMem[key];
  if (!answer) { try { const c = await auth.aiCacheGet(key); if (c && typeof c === 'string') answer = c; } catch {} }
  if (!answer) {
    // Limite JOUR durable (staff exempté) — vérifiée SEULEMENT ici, avant une vraie génération
    // → les hits de cache ne consomment pas le quota. Message pro renvoyé comme réponse de l'assistant.
    let _limDay = null;
    if (_uid && _role !== 'admin' && _role !== 'support') {
      _limDay = _aiChatToday();
      if (await _aiChatDailyCount(_uid, _limDay) >= AI_CHAT_DAILY_LIMIT)
        return res.json({ answer: `Vous avez atteint la limite journalière de **${AI_CHAT_DAILY_LIMIT} requêtes** de l'Assistant IA Macro. Le compteur se réinitialise demain — merci de votre compréhension.`, sources: [] });
    }
    let biasLine = '';
    try { if (_smartBias && _smartBias.conclusion) biasLine = 'Current DTP Smart Bias conclusion by currency: ' + Object.entries(_smartBias.conclusion).map(([c, v]) => `${c}=${v}`).join(', ') + '.'; } catch {}
    // Contexte « AI Macro » complet (philosophie PMT : data éco + banques centrales + news + risk) :
    // on injecte AUSSI les prochaines échéances du calendrier et les taux directeurs + probas de
    // réunion (données TAUX réelles déjà en cache — zéro fetch, zéro coût supplémentaire).
    let calLine = '';
    try {
      const now = Date.now();
      const next = (Array.isArray(allCalendar) ? allCalendar : [])
        .filter(e => e && (e.timestamp || 0) > now && /high|medium/i.test(e.impact || ''))
        .sort((a, b) => a.timestamp - b.timestamp).slice(0, 5)
        .map(e => `${new Date(e.timestamp).toISOString().slice(5, 16).replace('T', ' ')}Z ${e.currency || ''} ${e.title || ''} (${e.impact})`);
      if (next.length) calLine = 'Upcoming economic calendar (high/medium impact):\n' + next.map(s => '- ' + s).join('\n');
    } catch {}
    let ratesLine = '';
    try {
      const parts = CB.map(b => {
        const rp = _rpCache && _rpCache.banks && _rpCache.banks[b.code];
        if (rp && rp.meetings && rp.meetings[0]) { const m = rp.meetings[0]; return `${b.bank} ${rp.rate}% (next ${m.date}: ${m.baseCase} ${Math.max(m.hold, m.hike, m.cut)}%)`; }
        const st = _ratesState && _ratesState.banks && _ratesState.banks[b.code];
        return st ? `${b.bank} ${st.rate}%` : null;
      }).filter(Boolean);
      if (parts.length) ratesLine = 'Central bank policy rates (market-implied next-meeting odds where available): ' + parts.join(', ') + '.';
    } catch {}
    const heads = newsCtx.map(n => '- ' + (n.headline || '')).filter(Boolean).join('\n');
    const prompt = `You are DTP's "Macro AI Assistant", an institutional macro/forex analyst on a professional trading terminal. Answer the user's question in ONE concise, data-driven paragraph (max ~140 words), institutional tone, no preamble, no disclaimer. Wrap key market terms in **double asterisks** to bold them (e.g. **weak bearish**, **EUR/USD**, central banks, **risk-off**).
${biasLine}
${ratesLine}
${calLine}
Recent market headlines (context):
${heads}

User question: ${q}`;
    try { answer = await aiSmart('chat', prompt, 380, { priority: 'user' }); } catch (e) { answer = null; }   // DANS le budget (part 'chat'), tier user
    if (answer && answer.trim()) {
      answer = answer.trim();
      if (_limDay) { try { await _aiChatDailyIncr(_uid, _limDay); } catch {} }   // ne décompte la limite/jour QUE sur une génération réussie (panne/échec = non facturé)
      if (Object.keys(_aiChatMem).length > 500) for (const k of Object.keys(_aiChatMem)) delete _aiChatMem[k];   // cap anti-OOM (reset simple)
      _aiChatMem[key] = answer; auth.aiCacheSet(key, answer).catch(() => {});
    }
    else answer = null;
  }
  if (!answer) return res.status(503).json({ error: 'AI temporairement indisponible' });
  res.json({ answer, sources });
});
app.get('/api/news/history', (req, res) => {
  const before = parseInt(req.query.before) || Date.now();
  const limit  = Math.min(parseInt(req.query.limit) || 100, 200);
  const items  = allNews
    .filter(i => i.timestamp < before && !_isPrimerNews(i))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
  items.forEach(_cleanItemMd);
  res.json({ items, total: allNews.length });
});
// Calendrier économique — endpoints AUTO-RÉPARANTS : si les données sont vides
// (démarrage à froid Render, disque éphémère, ou échec du scrape planifié), on
// déclenche un fetch à la demande (anti-tempête : un seul fetch concurrent).
let _calFetchInflight = null;
async function _ensureCalendar() {
  if (getCalendarRaw().length || (allCalendar && allCalendar.length)) return;
  if (!_calFetchInflight) {
    _calFetchInflight = scrapeForexFactory()
      .then(items => { if (Array.isArray(items) && items.length) allCalendar = items; })
      .catch(() => {})
      .finally(() => { _calFetchInflight = null; });
  }
  try { await _calFetchInflight; } catch {}
}
app.get('/api/calendar', async (_req, res) => {
  if (!allCalendar || !allCalendar.length) await _ensureCalendar();
  res.json({ items: allCalendar || [] });
});
// ── Actuals du calendrier : le flux XML FF n'a PAS d'actuals → on les lit sur la page FF
//    (1 seul fetch Puppeteer pour toute la table, profil CF chaud) puis on les superpose. ──
const _calActualsMap = new Map();   // "CUR|titrenorm" → { actual, forecast, previous }
let _calActualsAt = 0, _calActualsInflight = null;
const _calKey = (cur, title) => String(cur || '').toUpperCase().trim() + '|' + String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
// Clé DATÉE (jour UTC) : un événement récurrent (ex. "Crude Oil Inventories" chaque semaine) a
// un actual DIFFÉRENT à chaque parution → on ne réutilise jamais l'ancien.
const _calKeyDated = (cur, title, ts) => _calKey(cur, title) + '|' + (ts ? new Date(ts).toISOString().slice(0, 10) : '');

// ── PERSISTANCE des actuals (Supabase via aiCache, repli fichier) ──────────────────────────────
// La map est en mémoire → un redémarrage Render (veille/redeploy) la viderait et les ACTUAL
// disparaîtraient (TradingView ne ré-expose que ~5 jours). On la sauvegarde donc et on la recharge
// au démarrage → les valeurs sont CONSERVÉES et s'accumulent. Purge des entrées > 70 jours.
let _calActualsSaveTimer = null;
function _calActualsSave() {
  clearTimeout(_calActualsSaveTimer);
  _calActualsSaveTimer = setTimeout(() => {
    try {
      const cutoff = new Date(Date.now() - 70 * 86400000).toISOString().slice(0, 10);
      const obj = {};
      for (const [k, v] of _calActualsMap) {
        const day = k.slice(k.lastIndexOf('|') + 1);
        if (day && day < cutoff) { _calActualsMap.delete(k); continue; }   // purge ancien
        if (v && v.actual) obj[k] = v;                                     // on ne persiste que ce qui a un actual
      }
      auth.aiCacheSet('cal_actuals_v1', obj).catch(() => {});
    } catch {}
  }, 2500);
  if (_calActualsSaveTimer.unref) _calActualsSaveTimer.unref();
}
async function _calActualsLoad() {
  try {
    const obj = await auth.aiCacheGet('cal_actuals_v1');
    if (obj && typeof obj === 'object') {
      let n = 0;
      for (const [k, v] of Object.entries(obj)) { if (v && v.actual) { _calActualsMap.set(k, v); n++; } }
      console.log(`[CalActuals] ${n} actual(s) restauré(s) depuis le cache persistant`);
    }
  } catch (e) { console.error('[CalActuals] load', e.message); }
}

// ── Remplissage des Actuals depuis le FLUX DE NEWS (source fiable, indépendante de Cloudflare) ──
// Le flux XML FF n'a pas d'actuals et la page FF est protégée par CF sur Render. Mais nos news
// (FinancialJuice/InvestingLive/RSS) publient le résultat ("Services PMI 50.1 vs 48.2 expected").
// On rapproche chaque événement passé d'une news (mêmes mots-clés d'indicateur) en EXIGEANT que la
// prévision OU le précédent du calendrier apparaisse dans la news (corroboration → haute précision),
// puis on en extrait l'actual. Aucune valeur ambiguë n'est posée (jamais de fausse donnée).
const _CAL_DATA_RE = /\b(vs\.?|versus|exp\.?|expected|forecast|consensus|est\.?|actual|prelim|flash|prior|previous|m\/m|y\/y|q\/q)\b/i;
// NB : mom/yoy/qoq/final/flash NE sont PAS des stopwords ici → ils distinguent m/m vs y/y et flash vs final.
const _CAL_STOP = new Set(['the','a','of','for','and','data','rate','index','change','net','core','seasonally','adjusted','prelim','prel','total','new','spanish','german','french','italian','japanese','chinese','american','british','australian','canadian','swiss','spain','germany','france','italy','japan','china','america','britain','australia','canada','switzerland']);
// Pays → forme canonique (pour rapprocher "Italian"↔"Italy", "Spanish"↔"Spain"…) — token DISTINCTIF.
const _CAL_CTRY = { spanish:'es', spain:'es', italian:'it', italy:'it', german:'de', germany:'de', french:'fr', france:'fr', japanese:'jp', japan:'jp', chinese:'cn', china:'cn', american:'us', britain:'uk', british:'uk', australian:'au', australia:'au', canadian:'ca', canada:'ca', swiss:'ch', switzerland:'ch', spanish_:'es' };
function _calNumTokens(s) { return (String(s).match(/-?\d[\d,]*\.?\d*\s*[%KMBkmb]?/g) || []).map(x => x.replace(/\s+/g, '')); }
function _calNormNum(s) { return String(s || '').replace(/[, ]/g, '').toUpperCase().replace(/%$/, ''); }
function _calIndicatorTokens(title) {
  return String(title || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z/ ]/g, ' ').split(/\s+/)
    .filter(w => w.length >= 3 && !_CAL_STOP.has(w)).slice(0, 4);
}
function _calExtractActual(text, fc, pv, anchorTokens) {
  const nf = _calNormNum(fc), np = _calNormNum(pv);
  const _isYear = nx => /^(19|20)\d\d$/.test(nx);
  // 1) Format explicite "Actual: X"
  let m = text.match(/\bactual[:\s]+(-?\d[\d.,]*\s*[%kmb]?)/i);
  if (m) return m[1].replace(/\s+/g, '');
  // 2) Ancrage sur la prévision/le précédent CONNUS → l'actual est le nombre juste avant
  const nums = _calNumTokens(text);
  if (nums.length) {
    const norm = nums.map(_calNormNum);
    let idx = nf ? norm.indexOf(nf) : -1;
    if (idx < 0 && np) idx = norm.indexOf(np);
    if (idx > 0) { for (let j = idx - 1; j >= 0; j--) { if (norm[j] !== nf && norm[j] !== np && !_isYear(norm[j])) return nums[j]; } }
  }
  // 3) "<actual> vs/exp/forecast …" (gère un "(" éventuel : "54.4 (expect 52.3)")
  m = text.match(/(-?\d[\d.,]*\s*[%kmb]?)\s*\(?\s*(?:vs\.?|versus|exp|expected|forecast|consensus|est|prior|previous)\b/i);
  if (m) return m[1].replace(/\s+/g, '');
  // 4) Titre "INDICATEUR … VALEUR" sans repère (ex. "Spanish Unemployment Change -57.2K") :
  //    1er nombre APRÈS le dernier mot-clé indicateur, ≠ prévision/précédent, et pas une année.
  if (Array.isArray(anchorTokens) && anchorTokens.length) {
    const low = text.toLowerCase();
    let pos = -1;
    for (const t of anchorTokens) { const i = low.lastIndexOf(t); if (i >= 0 && i + t.length > pos) pos = i + t.length; }
    if (pos >= 0) {
      for (const x of _calNumTokens(text.slice(pos))) {
        const nx = _calNormNum(x);
        if (nx !== nf && nx !== np && !_isYear(nx)) return x;
      }
    }
  }
  return '';
}
// Pays/devise → regex de correspondance dans le texte de la news (pour ne pas confondre 2 pays)
const _CCY_RE = {
  USD: /\b(u\.?s\.?a?|united states|american|fed\b|dollar)\b/i,
  EUR: /\b(euro\w*|ecb|german\w*|france|french|spain|spanish|ital\w*|netherlands|dutch|portug\w*|greece|greek|ireland|irish|belg\w*|austria\w*)\b/i,
  GBP: /\b(u\.?k\.?|britain|british|england|sterling|boe\b|pound)\b/i,
  JPY: /\b(japan\w*|boj\b|\byen\b)\b/i,
  AUD: /\b(austral\w*|aussie|rba\b)\b/i,
  NZD: /\b(new zealand|\bnz\b|kiwi|rbnz\b)\b/i,
  CAD: /\b(canad\w*|boc\b)\b/i,
  CHF: /\b(switz\w*|swiss|snb\b)\b/i,
  CNY: /\b(chin\w*|pboc\b|yuan|renminbi)\b/i,
};
// Pays SPÉCIFIQUE détecté dans le titre (Spain≠Italy même si tous deux EUR) → regex stricte
const _SPEC_COUNTRY = [
  [/\b(spain|spanish)\b/i, /\b(spain|spanish)\b/i], [/\b(italy|italian)\b/i, /\b(italy|italian)\b/i],
  [/\b(german|germany)\b/i, /\b(german|germany)\b/i], [/\b(france|french)\b/i, /\b(france|french)\b/i],
  [/\b(netherlands|dutch)\b/i, /\b(netherlands|dutch)\b/i], [/\b(portugal|portuguese)\b/i, /\b(portugal|portuguese)\b/i],
];
function _eventCountryRe(ev) {
  const t = ev.title || '';
  for (const [kw, re] of _SPEC_COUNTRY) if (kw.test(t)) return re;
  return _CCY_RE[String(ev.currency || '').toUpperCase()] || null;
}
function _backfillActualsFromNews() {
  if (!Array.isArray(allNews) || !allNews.length) return 0;
  const now = Date.now();
  // Candidats = toute news récente CONTENANT UN CHIFFRE (les résultats "valeur seule" comme
  // "US ISM Services PMI 54.5" sont ainsi captés). La précision vient du filtre par-événement
  // ci-dessous (pays + indicateur + valeur ≠ prévision/précédent), pas de ce pré-filtre large.
  const news = allNews.filter(n => n && n.timestamp && now - n.timestamp < 4 * 86400000
    && /\d/.test((n.headline || '') + ' ' + (n.description || '')));
  if (!news.length) return 0;
  let filled = 0;
  for (const ev of getCalendarRaw()) {
    if (!ev || ev.timestamp > now) continue;                        // futur → pas d'actual
    if (/speaks|speech|holiday|meeting|member/i.test(ev.title || '')) continue;   // pas de valeur chiffrée
    const k = _calKeyDated(ev.currency, ev.title, ev.timestamp);
    if (_calActualsMap.get(k)?.actual) continue;                    // déjà rempli
    const cre = _eventCountryRe(ev);
    if (!cre) continue;
    // Acronymes du titre (PMI/GDP/CPI/ADP/ISM…) = signature très distinctive ; sinon le mot le + long
    const acronyms = (String(ev.title).match(/\b[A-Z]{2,5}\b/g) || []).map(a => a.toLowerCase());
    const longest  = _calIndicatorTokens(ev.title).sort((a, b) => b.length - a.length)[0] || '';
    if (!acronyms.length && longest.length < 4) continue;           // pas assez distinctif → on s'abstient
    for (const n of news) {
      if (Math.abs(n.timestamp - ev.timestamp) > 36 * 3600 * 1000) continue;   // ±36h
      const text = (n.headline || '') + ' ' + (n.description || '');
      if (!cre.test(text)) continue;                                // bon pays/devise
      const hay = text.toLowerCase();
      const sigOk = acronyms.length
        ? acronyms.every(a => new RegExp('\\b' + a + '\\b', 'i').test(hay))   // tous les acronymes présents
        : hay.includes(longest);                                              // sinon le mot-clé principal
      if (!sigOk) continue;
      const actual = _calExtractActual(text, ev.forecast, ev.previous, acronyms.length ? acronyms : [longest]);
      const na = _calNormNum(actual);
      if (actual && na !== _calNormNum(ev.forecast) && na !== _calNormNum(ev.previous)) {
        const prev = _calActualsMap.get(k) || {};
        _calActualsMap.set(k, { actual, forecast: ev.forecast || prev.forecast || '', previous: ev.previous || prev.previous || '' });
        filled++;
        break;
      }
    }
  }
  if (filled) _calActualsSave();
  return filled;
}
// ── SOURCE PRINCIPALE des actuals : TradingView (HTTP, sans Cloudflare). On rapproche chaque
//    événement TV (qui a un actual) de NOTRE événement par devise + même heure (±90 min) +
//    recouvrement de titre, puis on remplit la colonne Actual. Fiable et en temps réel.
function _calTitleTokens(title) {
  const words = String(title || '').toLowerCase()
    .replace(/m\/m/g, ' mom ').replace(/y\/y/g, ' yoy ').replace(/q\/q/g, ' qoq ')   // garde la périodicité distinctive
    .replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const out = new Set();
  for (const w of words) {
    if (_CAL_CTRY[w]) { out.add('ctry_' + _CAL_CTRY[w]); continue; }   // pays canonique distinctif
    if (w.length >= 3 && !_CAL_STOP.has(w)) out.add(w);
  }
  return out;
}
function _calOverlap(a, b) { let n = 0; for (const w of a) if (b.has(w)) n++; return n; }
let _tvActualsBusy = false;
async function _refreshTVActuals() {
  if (_tvActualsBusy) return 0;          // anti-empilement si un appel précédent traîne (réseau lent)
  _tvActualsBusy = true;
  try {
    return await _refreshTVActualsInner();
  } finally { _tvActualsBusy = false; }
}
async function _refreshTVActualsInner() {
  let tv;
  try { tv = await fetchTVCalendar(); } catch { return 0; }
  if (!Array.isArray(tv) || !tv.length) return 0;
  const ours = getCalendarRaw();
  const tvTok = tv.map(t => ({ t, tok: _calTitleTokens(t.title) }));
  // 1) DÉCALAGE HORAIRE : nos timestamps (parseEventTime) et TradingView (UTC) ont un offset de tz.
  //    On l'estime par la MÉDIANE des écarts sur les événements à candidat UNIQUE (titre distinctif).
  const diffs = [];
  for (const ev of ours) {
    const et = _calTitleTokens(ev.title); if (et.size < 2) continue;
    let max = 0, cnt = 0, cand = null;
    for (const x of tvTok) {
      if (x.t.currency !== ev.currency) continue;
      if (Math.abs(x.t.ts - ev.timestamp) > 30 * 3600000) continue;   // même semaine
      const ov = _calOverlap(et, x.tok);
      if (ov > max) { max = ov; cnt = 1; cand = x.t; }
      else if (ov === max && ov > 0) cnt++;
    }
    if (cand && max >= 2 && (cnt === 1 || max >= 3)) diffs.push(cand.ts - ev.timestamp);
  }
  let offset = 0;
  if (diffs.length >= 2) { diffs.sort((a, b) => a - b); offset = diffs[Math.floor(diffs.length / 2)]; }
  else {
    // Pas assez de repères → on essaie les décalages de fuseau usuels et on garde celui qui matche le +
    let bestN = -1;
    for (const off of [0, -4 * 3600000, -5 * 3600000, -3 * 3600000, 1 * 3600000, 2 * 3600000]) {
      let n = 0;
      for (const ev of ours) { const et = _calTitleTokens(ev.title); if (et.size < 2) continue;
        for (const x of tvTok) { if (x.t.currency === ev.currency && Math.abs((x.t.ts - off) - ev.timestamp) < 45 * 60000 && _calOverlap(et, x.tok) >= 2) { n++; break; } } }
      if (n > bestN) { bestN = n; offset = off; }
    }
  }
  // 2) REMPLISSAGE : recouvrement de titre MAX, puis le plus PROCHE en temps (corrigé du décalage).
  //    Indispensable car TradingView ne met pas le pays dans le titre (5 "Services PMI" EUR = même
  //    titre, distingués uniquement par l'heure).
  let filled = 0;
  for (const ev of ours) {
    if (!ev || (ev.actual && ev.actual !== '')) continue;
    const k = _calKeyDated(ev.currency, ev.title, ev.timestamp);
    if (_calActualsMap.get(k)?.actual) continue;
    const et = _calTitleTokens(ev.title); if (!et.size) continue;
    let best = null, bs = 0, bd = Infinity;
    for (const x of tvTok) {
      if (x.t.currency !== ev.currency) continue;
      const diff = Math.abs((x.t.ts - offset) - ev.timestamp);
      if (diff > 45 * 60 * 1000) continue;                            // ±45 min après correction
      const ov = _calOverlap(et, x.tok);
      if (ov < 1) continue;
      if (ov > bs || (ov === bs && diff < bd)) { bs = ov; bd = diff; best = x.t; }
    }
    if (best && bs >= 1) {
      _calActualsMap.set(k, { actual: best.actual, forecast: best.forecast || ev.forecast || '', previous: best.previous || ev.previous || '' });
      filled++;
    }
  }
  if (filled) _calActualsSave();
  return filled;
}
async function _refreshCalActuals(force) {
  // Throttle sur la TENTATIVE (pas le succès) : sinon, si FF échoue (Cloudflare), Puppeteer serait
  // relancé à CHAQUE requête calendrier → gâchis mémoire (risque 502). Espacé à 15 min.
  if (!force && Date.now() - _calActualsAt < 15 * 60 * 1000) return;
  if (_calActualsInflight) return _calActualsInflight;
  _calActualsAt = Date.now();
  _calActualsInflight = (async () => {
    try {
      const rows = await fetchCalendarActuals();
      if (Array.isArray(rows) && rows.length) {
        // Index des événements du calendrier par clé sans date → pour retrouver la date (clé datée)
        const evByKey = {};
        for (const ev of getCalendarRaw()) (evByKey[_calKey(ev.currency, ev.title)] ||= []).push(ev);
        for (const r of rows) {
          if (!r.title) continue;
          const evs = evByKey[_calKey(r.currency, r.title)];
          if (!evs || !evs.length) continue;
          const ev = evs.filter(e => e.timestamp <= Date.now()).sort((a, b) => b.timestamp - a.timestamp)[0] || evs[0];
          const k = _calKeyDated(ev.currency, ev.title, ev.timestamp);
          const prev = _calActualsMap.get(k) || {};
          // on n'écrase jamais une valeur connue par du vide (un scrape peut rater une cellule)
          _calActualsMap.set(k, {
            actual:   r.actual   || prev.actual   || '',
            forecast: r.forecast || prev.forecast || '',
            previous: r.previous || prev.previous || '',
          });
        }
        _calActualsSave();
      }
    } catch (e) { console.error('[CalActuals]', e.message); }
    finally { _calActualsInflight = null; }
  })();
  return _calActualsInflight;
}
function _overlayActuals(events) {
  if (!_calActualsMap.size) return events;
  return events.map(ev => {
    if (ev.actual && ev.actual !== '') return ev;                 // déjà un actual → on garde
    const a = _calActualsMap.get(_calKeyDated(ev.currency, ev.title, ev.timestamp));
    if (a && (a.actual || a.forecast || a.previous)) {
      return { ...ev, actual: a.actual || '', forecast: ev.forecast || a.forecast || '', previous: ev.previous || a.previous || '' };
    }
    return ev;
  });
}
// ── Calendrier construit DIRECTEMENT depuis TradingView (events + actual/forecast/previous +
// importance natifs → aucun matching, colonne ACTUAL exacte en temps réel + anciennes données). ──
let _tvCalCache = { ts: 0, items: [] };
async function _buildTVCalendar() {
  if (Date.now() - _tvCalCache.ts < 4 * 60 * 1000 && _tvCalCache.items.length) return _tvCalCache.items;
  let evs = null;
  try { evs = await fetchTVCalendarFull(); } catch {}
  if (!Array.isArray(evs) || !evs.length) return _tvCalCache.items;   // échec → on garde le dernier bon snapshot
  const items = evs.filter(e => e.impact === 'High' || e.impact === 'Medium').map(e => ({   // focus événements tradables
    id: 'tv-' + Buffer.from(e.title + '|' + e.currency + '|' + new Date(e.ts).toISOString().slice(0, 10)).toString('base64').slice(0, 18),
    timestamp: e.ts,
    time: new Date(e.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }),
    currency: e.currency, impact: e.impact, title: e.title,
    actual: e.actual || '', forecast: e.forecast || '', previous: e.previous || '',
    url: '',
  }));
  _tvCalCache = { ts: Date.now(), items };
  return items;
}
// ── HISTORIQUE GLISSANT du calendrier (60 j) : chaque événement PUBLIÉ (actual présent) est
// accumulé (mémoire + Supabase 'calhist:events') et fusionné dans /api/calendar-events.
// Raison : la fenêtre TradingView ne couvre que la semaine courante → les sous-indicateurs du
// Smart Bias (Economic Growth, Retail Sales…) tombaient sur « — » pour la plupart des devises.
// Avec l'historique, chaque devise garde sa DERNIÈRE publication réelle (GDP trimestriel compris).
let _calHist = new Map();   // clé "CCY|titre normalisé" → événement le plus récent
try { auth.aiCacheGet('calhist:events').then(v => { if (Array.isArray(v)) v.forEach(e => { if (e && e._k) _calHist.set(e._k, e); }); }).catch(() => {}); } catch {}
let _calHistDirty = false;
function _calHistKey(e) { return e.currency + '|' + String(e.title).toLowerCase().replace(/\s+/g, ' ').trim(); }
function _calHistAbsorb(items) {
  try {
    const cut = Date.now() - 60 * 86400000;
    for (const e of items || []) {
      if (!e || !e.currency || !e.title || e.actual == null || e.actual === '' || !((e.timestamp || 0) > cut)) continue;
      const k = _calHistKey(e);
      const prev = _calHist.get(k);
      if (!prev || (e.timestamp || 0) > (prev.timestamp || 0)) { _calHist.set(k, Object.assign({}, e, { _k: k })); _calHistDirty = true; }
    }
    for (const [k, e] of _calHist) if (!((e.timestamp || 0) > cut)) { _calHist.delete(k); _calHistDirty = true; }
    if (_calHist.size > 1200) {   // cap mémoire (anti-OOM)
      const keep = [..._calHist.values()].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 1000);
      _calHist = new Map(keep.map(e => [e._k, e])); _calHistDirty = true;
    }
  } catch {}
}
setInterval(() => { if (_calHistDirty) { _calHistDirty = false; auth.aiCacheSet('calhist:events', [..._calHist.values()]).catch(() => {}); } }, 5 * 60 * 1000);
function _calHistMerge(items) {
  const seen = new Set((items || []).filter(e => e && e.currency && e.title).map(_calHistKey));
  return (items || []).concat([..._calHist.values()].filter(e => !seen.has(e._k)));
}
app.get('/api/calendar-events', async (_req, res) => {
  // SOURCE PRINCIPALE : TradingView (actuals natifs, aucun matching) → exact + temps réel + anciennes données.
  let items = [];
  try { items = await _buildTVCalendar(); } catch {}
  if (items && items.length) { _calHistAbsorb(items); return res.json({ items: _calHistMerge(items) }); }

  // REPLI (si TradingView est indisponible) : ancienne logique faireconomy + overlay des actuals.
  if (!getCalendarRaw().length) await _ensureCalendar();
  try { await _refreshTVActuals(); } catch {}
  try { _backfillActualsFromNews(); } catch {}
  const its = _overlayActuals(getCalendarRaw());
  _calHistAbsorb(its);
  res.json({ items: _calHistMerge(its) });
});

// Détail d'un événement (Specs + History) lu sur la page FF — SANS Related Stories.
app.get('/api/calendar-detail', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.json({ specs: [], history: [] });
  try {
    const d = await fetchEventDetail(url);
    res.json({ specs: (d && d.specs) || [], history: (d && d.history) || [] });
  } catch (e) { res.json({ specs: [], history: [], error: e.message }); }
});

// Diagnostic des Actuals du calendrier (page HTML lisible → ouvre l'URL et screenshote-la).
app.get('/api/calendar-actuals-debug', async (_req, res) => {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  try {
    let tvCount = 0, tvErr = '';
    try { const tv = await fetchTVCalendar(); tvCount = (tv || []).length; } catch (e) { tvErr = e.message || String(e); }
    const filledTV = await _refreshTVActuals();
    const now = Date.now();
    const events = getCalendarRaw();
    const past = events.filter(e => e.timestamp <= now);
    const overlaid = _overlayActuals(events);
    const withActual = overlaid.filter(e => e.actual && e.actual !== '');
    const sampleFilled = overlaid.filter(e => e.actual && e.actual !== '' && e.timestamp <= now).slice(0, 24);
    const missing = _overlayActuals(past)
      .filter(e => (!e.actual || e.actual === '') && !/speaks|speech|holiday|meeting|member|auction|birthday/i.test(e.title || ''))
      .slice(0, 24);

    const row = (cells) => '<tr>' + cells.map(c => `<td style="padding:4px 9px;border-bottom:1px solid #222">${c}</td>`).join('') + '</tr>';
    const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<body style="background:#0d0d0d;color:#e8eaed;font-family:monospace;font-size:13px;padding:18px;line-height:1.5">
<h2 style="color:#f7941d">Diagnostic — Actuals calendrier (source : TradingView)</h2>
<div style="display:flex;gap:28px;flex-wrap:wrap;margin-bottom:18px">
  <div><b>API TradingView</b><br>événements reçus: <b style="color:${tvCount ? '#2ecc71' : '#ef4444'}">${tvCount}</b>${tvErr ? `<br><span style="color:#ef4444">erreur: ${esc(tvErr)}</span>` : ''}<br>${tvCount ? '✅ accessible depuis Render' : '❌ NON accessible (bloqué/timeout)'}</div>
  <div><b>Remplissage</b><br>actuals stockés (map): <b>${_calActualsMap.size}</b><br>remplis ce run: <b>${filledTV}</b></div>
  <div><b>Calendrier</b><br>événements: <b>${events.length}</b> · passés: <b>${past.length}</b><br>affichés AVEC actual: <b style="color:${withActual.length ? '#2ecc71' : '#ef4444'}">${withActual.length}</b></div>
</div>
<h3 style="color:#2ecc71">✅ Actuals remplis (échantillon)</h3>
${sampleFilled.length ? `<table style="border-collapse:collapse">${sampleFilled.map(e => row([esc(e.currency), esc(e.title), `<b style="color:#2ecc71">${esc(e.actual)}</b>`, 'fc:' + esc(e.forecast || '—')])).join('')}</table>` : '<div style="color:#ef4444">Aucun actual rempli — si "API TradingView" ci-dessus = 0, l\'API est bloquée depuis Render.</div>'}
<h3 style="color:#ef4444;margin-top:20px">Événements passés ENCORE sans actual (${missing.length})</h3>
<table style="border-collapse:collapse">${missing.map(e => row([esc(e.currency), esc(e.title), new Date(e.timestamp).toISOString().slice(5, 16).replace('T', ' ')])).join('')}</table>
</body>`;
    res.set('Content-Type', 'text/html; charset=utf-8').send(html);
  } catch (e) { res.status(500).send('<pre style="color:#ef4444">' + esc(e.message) + '</pre>'); }
});

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
          // Conserve le titre IA déjà calculé si le wrap existait déjà (évite régénération/relecture)
          const prev = merged.get(item.id);
          if (prev && prev.aiTitle) { item.aiTitle = prev.aiTitle; item.aiTitleV = prev.aiTitleV; }
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
        // Session détectée AVANT le timestamp → heure PAR SESSION (Asia ~04h < Europe ~10h < Americas ~18h UTC).
        // Sans pubDate réelle (scrape), les 3 wraps d'un même jour auraient sinon le MÊME timestamp NOON → on
        // ne distingue plus que l'Asie est sortie AVANT l'Europe. Les heures par session reflètent la vraie séquence.
        let session = 'Global', sh = 12;
        if      (/americas|north.american/.test(slug)) { session = 'Americas';     sh = 18; }
        else if (/europe/.test(slug))                  { session = 'European';     sh = 10; }
        else if (/asia.pacific|asian/.test(slug))      { session = 'Asia-Pacific'; sh = 4;  }
        const ts = Date.UTC(+ymd.slice(0,4), +ymd.slice(4,6) - 1, +ymd.slice(6,8), sh);
        if (!ts || ts < cutoff) continue;
        anyRecent = true;
        const link = `https://investinglive.com/news/${slug}/`;
        const id   = 'sw-' + Buffer.from(link).toString('base64').replace(/[^a-zA-Z0-9]/g,'').slice(-16);
        if (merged.has(id)) {
          // déjà présent (RSS = pubDate réelle, ou scrape antérieur). On CORRIGE juste un timestamp resté
          // sur l'ancien défaut NOON (12:00:00 pile) → heure par session, sans toucher au titre/contenu RSS.
          const ex = merged.get(id), dd = new Date(ex && ex.timestamp);
          if (ex && session !== 'Global' && dd.getUTCHours() === 12 && dd.getUTCMinutes() === 0 && dd.getUTCSeconds() === 0) ex.timestamp = ts;
          continue;
        }
        let title = slug.replace(/^investinglive-/,'').replace(/-\d{8}$/,'').replace(/-/g,' ').trim();
        title = title.charAt(0).toUpperCase() + title.slice(1);
        merged.set(id, { id, title, url: link, timestamp: ts, session, description: '', content: null, author: '', _source: 'investinglive' });
      }
      if (!pageHad || !anyRecent) break;       // plus d'articles, ou page entièrement hors-période
    } catch { break; }
  }

  const before = _swCache.length;
  _swCache = [...merged.values()]
    .filter(i => i.timestamp > cutoff)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 200);   // plafond DUR (anti-OOM Render)

  // ── Titres IA AVANT publication ──────────────────────────────────────────────
  // On génère les titres IA des nouveaux wraps AVANT d'écrire/diffuser, pour que le
  // wrap soit PUBLIÉ AVEC son titre (et non mis à jour après coup). Borné à 12 s :
  // si l'IA traîne, on publie quand même (le backfill périodique finira le reste).
  try { await Promise.race([_swEnsureAiTitles(true), new Promise(r => setTimeout(r, 12000))]); } catch {}

  try { fs.writeFileSync(SW_CACHE_FILE, JSON.stringify(_swCache)); } catch {}
  _persistHistory('session_wraps', _swCache);   // persistance durable (Supabase, rétention 1 mois)
  try { broadcast({ type: 'sw_update', items: _swCache }); } catch {}   // publication (titres déjà en place)
  console.log(`[SessionWraps] ${_swCache.length} wraps (was ${before}) — ${full ? 'full 30d' : 'quick'} refresh`);
  _swEnsureAiTitles().catch(() => {});           // backfill du reste (au-delà des 12 s), en arrière-plan
}

// ── Titre IA résumant chaque session wrap ────────────────────────────────────
// Remplace le titre brut générique ("Americas fx news wrap…") par un titre court qui
// CAPTE LE THÈME de la séance. Mis en cache DURABLEMENT (ai_cache "swt:<id>") → généré une
// seule fois par wrap ; quota maîtrisé (anti-burst + Gemini→Claude via aiSmart). Limité aux
// wraps RÉCENTS (ceux réellement consultés).
const SW_TITLE_V = 3;   // version du style de titre (bump → régénère les titres existants) ; v3 = EN FRANÇAIS

// Titre de SECOURS sans IA : extrait un titre lisible du contenu du wrap (1re phrase
// porteuse de sens), sans source/date/auteur. Appliqué immédiatement si l'IA est
// indisponible → on a TOUJOURS un titre propre ; l'IA ne fait qu'améliorer ensuite.
function _heuristicWrapTitle(w) {
  let src = (w.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!src) src = (w.title || '').replace(/\s+/g, ' ').trim();
  if (!src) return '';
  // Retire le boilerplate de tête type "Americas fx news wrap:" / "... wrap -" / "Headlines:"
  src = src.replace(/^[\w\s.,/&'-]*?\bwraps?\b\s*[:\-—–]?\s*/i, '').trim();
  src = src.replace(/^headlines?\s*[:\-—–]\s*/i, '').trim();
  // 1re phrase (jusqu'au point), sinon début du texte
  let t = (src.split(/(?<=[.!?])\s/)[0] || src).trim();
  if (t.length > 72) t = t.slice(0, 72).replace(/\s+\S*$/, '').trim() + '…';
  if (t.length < 8) return '';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

let _swTitleBusy = false;
async function _swEnsureAiTitles(internal = false) {
  if (_swTitleBusy) return false;
  _swTitleBusy = true;
  let changed = false;
  try {
    let budget = 3;        // max 3 générations IA/passage (abaissé pour le quota ; reste au passage suivant)
    let fetchBudget = 4;   // max récupérations de contenu par passage (wraps d'archive sans description)
    for (const w of _swCache.slice(0, 80)) {   // TOUS les wraps affichés dans l'onglet Analyst
      if (w.aiTitle && w.aiTitleV === SW_TITLE_V) continue;   // déjà au format courant (skip → 0 coût)
      try { const c = await auth.aiCacheGet('swt3:' + w.id); if (c && typeof c === 'string') { w.aiTitle = _stripMd(c); w.aiTitleV = SW_TITLE_V; changed = true; continue; } } catch {}   // cache des titres FR (swt3) — les anciens 'swt2' anglais sont ignorés → régénération en français

      // Si AUCUNE matière (wrap d'archive : description vide) → on RÉCUPÈRE le contenu pour pouvoir
      // titrer AVANT publication (garantit un sujet, ex. "Asia-Pac Session Recap: …" et non le préfixe seul).
      let body = (w.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (body.length < 30 && w.url && !w._noBody && fetchBudget > 0) {
        fetchBudget--;
        try {
          const data = await _fetchILContentHttp(w.url);
          const txt = ((data && data.points && data.points.join('. ')) || (data && data.html) || '')
            .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
          if (txt.length > 30) { w.description = txt.slice(0, 300); body = txt; }
          else w._noBody = true;   // pas de contenu exploitable → on ne re-fetch pas en boucle
        } catch { w._noBody = true; }
      }

      // Titre de secours immédiat (gratuit, sans IA) pour tout wrap encore sans titre —
      // s'applique même hors budget IA. L'IA l'améliorera ensuite si dispo.
      // Répare aussi les titres heuristiques DÉJÀ cachés qui ont gardé le boilerplate « Headlines: ».
      if (w.aiTitle && /^headlines?\s*[:\-—–]/i.test(w.aiTitle)) { const h = _heuristicWrapTitle(w); if (h && h !== w.aiTitle) { w.aiTitle = h; w.aiTitleV = 'h'; changed = true; } }
      if (!w.aiTitle) { const h = _heuristicWrapTitle(w); if (h) { w.aiTitle = h; w.aiTitleV = 'h'; changed = true; } }
      if (budget <= 0) continue;
      const src = (body || w.title || '').slice(0, 600);
      if (src.length < 30) continue;   // pas assez de matière → on garde le titre nettoyé
      if (!aiAllowed('analyst', { priority: 'background' })) { budget = 0; continue; }   // budget IA du jour épuisé → on garde le titre heuristique (gratuit)
      budget--;
      try {
        // generateText (Gemini→Claude) MAIS désormais compté dans le budget (aiNote) → protège le quota.
        const out = await ai.generateText(
          `Voici le résumé d'une session de marché (FX/indices/matières premières). Écris UN titre de presse ` +
          `PERCUTANT et CONCIS (idéalement 5 à 8 mots, max 9), EN FRANÇAIS, qui capte LE thème principal ` +
          `(garde tels quels les tickers/codes/acronymes : EUR, BoJ, XAU, S&P…). ` +
          `Style "headline" : direct, verbe fort, pas de remplissage. Interdits : le mot "wrap", toute mention ` +
          `de source, toute date, les guillemets. Réponds avec le titre SEUL.\n\n${src}`, 90);
        let t = _stripMd(String(out || '').split('\n')[0]).replace(/^["'\s]+|["'\s.]+$/g, '').slice(0, 90);   // jamais de ** dans le titre IA stocké
        if (t.length >= 8) { w.aiTitle = t; w.aiTitleV = SW_TITLE_V; changed = true; aiNote('analyst'); auth.aiCacheSet('swt3:' + w.id, t).catch(() => {}); continue; }
        throw new Error('titre IA vide');
      } catch {
        // IA indisponible → titre de secours heuristique (marqué 'h' → l'IA réessaiera
        // au prochain passage pour l'améliorer, mais l'utilisateur voit déjà un vrai titre).
        if (!w.aiTitle) { const h = _heuristicWrapTitle(w); if (h) { w.aiTitle = h; w.aiTitleV = 'h'; changed = true; } }
      }
    }
  } finally { _swTitleBusy = false; }
  // De nouveaux titres → on met à jour les clients + le fichier (sans re-scraper).
  // Si `internal` (appelé depuis le scrape AVANT publication), on laisse le scrape publier.
  if (changed && !internal) {
    try { fs.writeFileSync(SW_CACHE_FILE, JSON.stringify(_swCache)); } catch {}
    try { broadcast({ type: 'sw_update', items: _swCache }); } catch {}
  }
  return changed;
}
// Relance périodique (couvre les nouveaux wraps + le backfill échelonné)
setInterval(() => _swEnsureAiTitles().catch(() => {}), 15 * 60 * 1000);   // 15 min (éco quota ; titre heuristique immédiat en attendant)

app.get('/api/session-wraps', (_req, res) => {
  _swCache.forEach(_cleanItemMd);   // titre/aiTitle sans markdown brut, même pour un JS en cache
  res.json(_swCache);
  _swEnsureAiTitles().catch(() => {});   // génère les titres IA manquants dès l'ouverture de l'onglet
  if (Date.now() - _swFetchedAt > 20 * 60 * 1000) _fetchSessionWraps(false).catch(() => {});
});

// Rapports HEBDOMADAIRES (Weekly Market Recap + Global Economic Weekly) — servis directement
// depuis allNews quel que soit leur âge. Si le recap de la semaine écoulée manque, il est
// généré automatiquement en tâche de fond (verrou anti-spam) à la 1re ouverture de l'onglet Analyst.
let _weeklyGenLock = 0;
let _gewGenLock = 0;
// ── Snapshot Currency Strength FIGÉ dans le Weekly Recap : rouvert plus tard, le chart montre TOUJOURS
//    la semaine du rapport (plus de fenêtre glissante qui dérive). Downsample ~64 pts/devise (léger, inline). ──
function _csSnapshot(cs) {
  const MAX = 64, series = {};
  for (const c of (cs.currencies || [])) {
    const s = (cs.series && cs.series[c]) || [];
    if (s.length <= MAX) { series[c] = s.map(p => ({ t: p.t, v: p.v })); continue; }
    const step = (s.length - 1) / (MAX - 1), out = [];
    for (let i = 0; i < MAX; i++) { const p = s[Math.round(i * step)]; if (p) out.push({ t: p.t, v: p.v }); }
    series[c] = out;
  }
  return { currencies: [...(cs.currencies || [])], series };
}
function _currentMondayUtc() { const m = new Date(); const dow = m.getUTCDay(); m.setUTCDate(m.getUTCDate() - (dow === 0 ? 6 : dow - 1)); m.setUTCHours(0, 0, 0, 0); return m.getTime(); }
function _recapCoveredMonday(weekly) {   // lundi (00:00 UTC) de la semaine couverte, déduit de weekEnding "DD.MM.YYYY"
  try { const a = String(weekly && weekly.weekEnding || '').split('.').map(Number); if (a.length !== 3 || !a[0] || !a[1] || !a[2]) return 0; return Date.UTC(a[2], a[1] - 1, a[0]) - 4 * 86400000; } catch { return 0; }
}
let _wrCsBackfillBusy = false;
let _wrCsDiagDone = false;   // diagnostic CS backfill loggé une seule fois par process
// Version du Weekly Market Recap. RÈGLE : bumper À CHAQUE changement de langue/format du prompt, sinon un
// ancien rapport (autre langue) au même numéro est servi indéfiniment. v4 = rédigé EN FRANÇAIS (v3 avait été
// réutilisé pour une expérience ANGLAISE jour-par-jour → collision → recap reste en anglais). Const partagée.
const RECAP_VER = 4;
// Backfill (sans Gemini) du snapshot CS sur le recap COURANT généré avant cette fonctionnalité —
// tant qu'on est ENCORE dans sa semaine couverte (les données 'week' correspondent alors), puis persiste.
// Appelé à la fois sur /api/weekly-reports ET proactivement au boot (filet : si l'utilisateur n'ouvre
// pas l'onglet aujourd'hui, le recap est quand même figé avant que la semaine ne change).
async function _maybeBackfillRecapCs() {
  if (_wrCsBackfillBusy) return;
  // Cible DIRECTE : le recap de la semaine EN COURS qui n'a pas encore de snapshot (et seulement lui →
  // on ne fige jamais une mauvaise semaine, et on ignore les recaps archivés d'autres semaines).
  const monNow = _currentMondayUtc();
  const recaps = allNews.filter(i => i._reportType === 'Weekly Market Recap' && i._weekly && i._weekly.v >= RECAP_VER);
  const cur = recaps.find(i => !i._weekly.cs && _recapCoveredMonday(i._weekly) === monNow);
  if (!_wrCsDiagDone) { _wrCsDiagDone = true; console.log('[Weekly Recap] CS backfill check — recaps=' + recaps.length + ' monNow=' + new Date(monNow).toISOString().slice(0, 10) + ' ' + recaps.map(r => r._weekly.weekEnding + (r._weekly.cs ? '(cs)' : '(no-cs)')).join(',') + ' → cible=' + (cur ? cur._weekly.weekEnding : 'aucune')); }
  if (!cur) return;
  _wrCsBackfillBusy = true;
  try {
    const cs = await computeCurrencyStrength('week');
    if (cs && cs.currencies && cs.series) {
      cur._weekly.cs = _csSnapshot(cs);
      const wk = (cur.id || '').replace(/^dtp-mkt-recap-/, '').replace(/-\d+$/, '');
      if (wk) auth.weeklyReportSave(wk, cur).catch(() => {});
      console.log('[Weekly Recap] snapshot CS backfill ' + wk);
    }
  } catch (e) { console.warn('[Weekly Recap] backfill CS échec:', e.message); }
  finally { _wrCsBackfillBusy = false; }
}
// Filet proactif au boot : recharge les rapports persistés puis backfill (≈50 s après le démarrage).
setTimeout(() => { _loadPersistedWeekly(true).then(() => _maybeBackfillRecapCs()).catch(() => {}); }, 50000);
app.get('/api/weekly-reports', async (_req, res) => {
  // Recharge d'abord les rapports persistés (Supabase/fichier) → évite toute régénération inutile
  // et fait apparaître un rapport fraîchement injecté dans le store (throttle interne 30s).
  await _loadPersistedWeekly();

  const cutoff = Date.now() - 40 * 24 * 60 * 60 * 1000;
  const items = allNews.filter(i =>
    (i._reportType === 'Weekly Market Recap' || i._reportType === 'Global Economic Weekly') &&
    i.timestamp > cutoff
  ).sort((a, b) => b.timestamp - a.timestamp);

  // "Disponible" SEULEMENT si un recap au format RICHE (v2) existe. Sinon (absent OU ancien
  // format), on régénère automatiquement vers le format riche (force) — 1 appel Gemini, budget-gé.
  const current = items.find(i => i._reportType === 'Weekly Market Recap' && i._weekly && i._weekly.v >= RECAP_VER);

  _maybeBackfillRecapCs();   // fige le recap courant (snapshot CS) s'il n'en a pas encore — async, sans Gemini

  let generating = false;
  if (!current) {
    generating = true;
    if (Date.now() - _weeklyGenLock > 15 * 60 * 1000 && !(ai.backoffActive && ai.backoffActive())) {   // 1 tentative / 15 min max — suspendu pendant une panne IA totale (backoff)
      _weeklyGenLock = Date.now();
      generateWeeklyMarketRecap(true).catch(e => console.error('[Weekly Recap] auto-gen échec:', e.message));
    }
  }
  // Global Economic Weekly RICHE (Week Ahead façon PMT) : même logique d'auto-génération si absent.
  // v>=GEW_VER exigé → un GEW d'ANCIEN format (sans horaires multi-fuseaux ni commentaires) est
  // considéré périmé et régénéré automatiquement au format courant.
  const gewCurrent = items.find(i => i._reportType === 'Global Economic Weekly' && i._weekly && i._weekly.gew && (i._weekly.v || 0) >= GEW_VER && Array.isArray(i._weekly.days) && i._weekly.days.length);
  if (!gewCurrent) {
    generating = true;
    if (Date.now() - _gewGenLock > 15 * 60 * 1000 && !(ai.backoffActive && ai.backoffActive())) {
      _gewGenLock = Date.now();
      generateGlobalEconomicWeekly(true).catch(e => console.error('[GEW] auto-gen échec:', e.message));
    }
  }
  items.forEach(_cleanItemMd);   // recap/GEW : titres sans markdown brut, même pour un JS en cache
  res.json({ items, generating });
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
  }, 45_000);
  if (_ilIdleTimer.unref) _ilIdleTimer.unref();
}

async function _getIlBrowser() {
  if (_ilIdleTimer) { clearTimeout(_ilIdleTimer); _ilIdleTimer = null; }
  if (_ilBrowser) { try { await _ilBrowser.pages(); return _ilBrowser; } catch { _ilBrowser = null; } }
  _ilBrowser = await puppeteer.launch({
    executablePath: _resolveChrome(),
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu',
           '--single-process','--no-zygote','--disable-extensions',
           // Économie RAM (Render 512 Mo) : moins de processus + heap plafonné + services inutiles coupés
           '--disable-features=IsolateOrigins,site-per-process,TranslateUI',
           '--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding',
           '--disable-software-rasterizer','--disable-background-networking','--disable-default-apps','--disable-sync',
           '--mute-audio','--no-first-run','--js-flags=--max-old-space-size=192'],
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

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  RENDU HTML → PDF (Chrome partagé) — pour les rapports SANS PDF natif (MUFG, etc.)
//  Rend la page (imprimable) de la banque en VRAI PDF, fidèle, SANS restructuration IA.
//  Anti-OOM : 1 SEUL rendu à la fois (verrou) + cache disque (DATA_DIR) → Chrome non relancé à chaque ouverture.
// ════════════════════════════════════════════════════════════════════════════════════════════════
// Hôtes AUTORISÉS au rendu (anti-SSRF STRICT : Chrome ne doit JAMAIS rendre une URL arbitraire/interne).
const PDF_RENDER_HOSTS = /(^|\.)(mufgresearch\.com|mufgemea\.com|research-center\.amundi\.com|corporate\.nordea\.com|kbc\.com|scotiabank\.com|westpaciq\.com\.au|q-cam\.com|syzgroup\.com|lloydsbank\.com|research\.natixis\.com|hsbc\.com\.sg|wellsfargo\.bluematrix\.com|goldmansachs\.com|gspublishing\.com)$/i;
function _brRenderUrlFor(u, printUrl) { try { return PDF_RENDER_HOSTS.test(new URL(u).hostname) ? (printUrl || u) : ''; } catch { return ''; } }
const _crypto = require('crypto');
const _RENDER_DIR = path.join(_CACHE_DIR, 'render_pdf');
try { fs.mkdirSync(_RENDER_DIR, { recursive: true }); } catch {}
const _RENDER_VER = 'r2';   // bump → invalide TOUS les PDF rendus en cache (ex. logique anti-cookies changée)
function _renderCacheFile(url) { return path.join(_RENDER_DIR, _crypto.createHash('sha1').update(_RENDER_VER + '|' + String(url)).digest('hex') + '.pdf'); }
let _renderChain = Promise.resolve();   // sérialise les rendus (1 page.pdf à la fois → RAM maîtrisée)
function _renderPdf(url) {
  const run = _renderChain.then(() => _renderPdfInner(url), () => _renderPdfInner(url));
  _renderChain = run.then(() => {}, () => {});
  return run;
}
async function _renderPdfInner(url) {
  const browser = await _getIlBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1180, height: 1500 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 35000 });
    // Cookies/consent + overlays : (1) cliquer TOUS les boutons d'acceptation courants (multi-étapes),
    // (2) retirer les dialogues connus (Cookiebot/OneTrust/Usercentrics/TrustArc) + overlays fixes,
    // (3) lever le scroll-lock — sinon le PDF capture le popup cookies au lieu du rapport.
    await page.evaluate(() => { try {
      const RX = /^(accept all|accept all cookies|accept|tout accepter|accepter|j'accepte|i accept|autoriser tout|allow all|allow selection|use necessary cookies only|necessary only|necessary cookies only|reject non-essential cookies|reject all|agree|i agree|ok|got it|continue)$/i;
      const SUB = /(accept all cookies|accept all|allow all|use necessary cookies only|allow selection|reject non-essential|tout accepter|autoriser tout)/i;
      for (const b of document.querySelectorAll('button,a[role="button"],a[href="#"],input[type="submit"],input[type="button"]')) { const t = (b.innerText || b.textContent || b.value || '').trim(); if (t.length <= 40 && (RX.test(t) || SUB.test(t))) { try { b.click(); } catch {} } }
    } catch {} }).catch(() => {});
    await new Promise(r => setTimeout(r, 400));
    await page.evaluate(() => { try {
      const SEL = ['#CybotCookiebotDialog', '#CybotCookiebotDialogBodyUnderlay', '#onetrust-consent-sdk', '#onetrust-banner-sdk', '#usercentrics-root', '#usercentrics-cmp-ui', '[id*="truste"]', '[id*="cookie"]', '[class*="cookie-consent"]', '.cookieconsent', '#cookie-law-info-bar'];
      SEL.forEach(s => { try { document.querySelectorAll(s).forEach(e => e.remove()); } catch {} });
      try { document.querySelectorAll('[aria-modal="true"][role="dialog"], [role="alertdialog"]').forEach(d => { const txt = (d.innerText || '').toLowerCase(); if (/cookie|consent|gdpr|privacy/.test(txt)) d.remove(); }); } catch {}
      const KILL = ['cookie', 'consent', 'onetrust', 'cookiebot', 'cybotcookiebot', 'usercentrics', 'gdpr', 'cc-window', 'truste', 'privacy-banner'];
      document.querySelectorAll('div,section,aside,dialog,iframe').forEach(el => {
        const id = String(el.id || '').toLowerCase();
        const cn = el.className; const cls = String(cn && cn.baseVal !== undefined ? cn.baseVal : (cn || '')).toLowerCase();
        const hay = id + ' ' + cls;
        if (KILL.some(k => hay.includes(k))) { try { el.remove(); } catch {} return; }
        const st = getComputedStyle(el);
        if ((st.position === 'fixed' || st.position === 'sticky') && (parseInt(st.zIndex) || 0) >= 1000) el.style.display = 'none';
      });
      try {
        document.documentElement.className = String(document.documentElement.className || '').replace(/\b(cookie\S*|consent\S*|cc-\S*|modal-open|no-scroll|overflow-hidden)\b/gi, '');
        document.documentElement.style.overflow = 'visible';
        if (document.body) { document.body.className = String(document.body.className || '').replace(/\b(modal-open|no-scroll|overflow-hidden|cookie\S*)\b/gi, ''); document.body.style.overflow = 'visible'; document.body.style.position = 'static'; }
      } catch {}
    } catch {} }).catch(() => {});
    await page.evaluate(() => { try { window.scrollTo(0, document.body.scrollHeight); } catch {} }).catch(() => {});
    await new Promise(r => setTimeout(r, 250));
    const out = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
    return Buffer.from(out);
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
// ⚠️ RÉALITÉ : le quota gratuit Gemini est PAR PROJET Google (pas par clé). Si les clés partagent
// le même projet → UN seul quota partagé. Le quota se réinitialise CHAQUE JOUR → l'objectif est que
// la conso QUOTIDIENNE reste bien sous le quota gratuit du jour (et donc ça tient tout le mois).
// Budget abaissé pour tenir confortablement sur un quota gratuit mono-projet.
const GEMINI_MONTHLY_BUDGET = parseInt(process.env.GEMINI_MONTHLY_BUDGET, 10) || 7500;   // ~250 appels/jour lissés
const GEMINI_DAILY_MIN = parseInt(process.env.GEMINI_DAILY_MIN, 10) || 120;
const GEMINI_DAILY_MAX = parseInt(process.env.GEMINI_DAILY_MAX, 10) || 280;   // plafond DUR/jour → marge sous le free-tier
const AI_BURST         = parseInt(process.env.GEMINI_BURST, 10) || 18;   // tolérance de pic instantané (pacing)
const AI_USAGE_FILE = path.join(_CACHE_DIR, 'cache_ai_usage.json');
let _aiUsage = { month: '', day: '', total: 0, dayCounts: {} };
try { _aiUsage = Object.assign(_aiUsage, JSON.parse(fs.readFileSync(AI_USAGE_FILE, 'utf8'))); } catch {}
function _aiParis()     { return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' })); }
function _aiMonth()     { return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }).slice(0, 7); }
function _aiDay()       { return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }); }
function _aiIsWeekend() { const d = new Date().toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Europe/Paris' }); return d === 'Sat' || d === 'Sun'; }
function _aiDaysLeftInMonth() { const p = _aiParis(); const last = new Date(p.getFullYear(), p.getMonth() + 1, 0).getDate(); return Math.max(1, last - p.getDate() + 1); }
function _aiSave() { try { fs.writeFileSync(AI_USAGE_FILE, JSON.stringify(_aiUsage)); } catch {} }
// ── USAGE LEARNER (Phase 1) : profil de demande par (jour-semaine × heure × catégorie) → apprend les patterns ──
const AI_DEMAND_FILE = path.join(_CACHE_DIR, 'cache_ai_demand.json');
let _aiDemand = {};   // "wd-hh" → { _t: total, <category>: count }
try { _aiDemand = JSON.parse(fs.readFileSync(AI_DEMAND_FILE, 'utf8')) || {}; } catch {}
auth.aiCacheGet('aidemand:v1').then(d => { if (d && typeof d === 'object') _aiDemand = Object.assign({}, d, _aiDemand); }).catch(() => {});   // hydrate durable (survit aux redéploys)
function _aiDemandSlot() { const p = _aiParis(); return p.getDay() + '-' + p.getHours(); }   // 0(dim)-6 × 0-23h (Paris)
let _aiDemandSaveT = null;
function _aiDemandNote(category) {
  const slot = _aiDemandSlot();
  const s = _aiDemand[slot] || (_aiDemand[slot] = {});
  s[category] = (s[category] || 0) + 1; s._t = (s._t || 0) + 1;
  if (!_aiDemandSaveT) _aiDemandSaveT = setTimeout(() => { _aiDemandSaveT = null; try { fs.writeFileSync(AI_DEMAND_FILE, JSON.stringify(_aiDemand)); } catch {} auth.aiCacheSet('aidemand:v1', _aiDemand).catch(() => {}); }, 60000);
}
// Demande attendue pour un créneau (total observé sur l'historique) → base du prewarm prédictif (Phase 2).
function aiExpectedDemand(slot) { const s = _aiDemand[slot || _aiDemandSlot()]; return s ? (s._t || 0) : 0; }
// PHASE 2 (auto-amélioration) — détecteur de PRÉ-PIC : true si l'heure courante OU la suivante est un
// créneau CHARGÉ (≥ 80% de la moyenne des heures actives apprises), false si c'est un creux, null si pas
// assez de données. Sert à préchauffer JUSTE AVANT les heures de pointe apprises et à rester muet ailleurs.
function _aiDemandPrePeak() {
  if (Object.keys(_aiDemand).length < 24) return null;                       // bootstrap : < 24 créneaux observés → on n'impose rien
  let tot = 0, n = 0;
  for (const k in _aiDemand) { const h = parseInt(k.split('-')[1] || '', 10); if (h >= 8 && h < 21) { tot += (_aiDemand[k]._t || 0); n++; } }
  const avg = n ? tot / n : 0;
  if (avg <= 0) return null;
  const p = _aiParis(), wd = p.getDay(), hNow = p.getHours();
  const hNext = (hNow + 1) % 24, wdNext = (wd + Math.floor((hNow + 1) / 24)) % 7;
  const peak = Math.max(aiExpectedDemand(wd + '-' + hNow), aiExpectedDemand(wdNext + '-' + hNext));
  return peak >= avg * 0.8;                                                  // proche/au-dessus de la moyenne → pré-pic
}

// ════════════════ AI TELEMETRY & PREDICTION (monitoring + prévision d'épuisement) ════════════════
// On échantillonne ai.status() (déjà riche : santé par modèle/clé, 429, tokens) et on cumule les
// DELTAS dans des seaux HORAIRES persistés (ai_cache `aitel:<YYYY-MM-DDTHH>`, durables Supabase →
// survivent aux redéploys). Aucune modification du routage : couche d'OBSERVATION pure, additive.
let _telPrev = null, _telLiveStatus = null, _telDirty = false;
const _telBuckets = new Map();                                                   // hourKey → seau (flush périodique vers KV)
function _telHourKey(t) { return new Date(t || Date.now()).toISOString().slice(0, 13); }   // "2026-06-12T14"
function _telEmpty(hk) { return { hour: hk, gemini: { calls: 0, e429: 0, tokIn: 0, tokOut: 0 }, github: { calls: 0, fail: 0, tokIn: 0, tokOut: 0 }, openrouter: { calls: 0, fail: 0, tokIn: 0, tokOut: 0 }, claude: { calls: 0, fail: 0, tokIn: 0, tokOut: 0 }, fallback: 0 }; }
function _telBucket(hk) { let b = _telBuckets.get(hk); if (!b) { b = _telEmpty(hk); _telBuckets.set(hk, b); } return b; }
function _telSample() {
  let st; try { st = ai.status(); } catch { return; }
  _telLiveStatus = st;
  const u = st.usageToday || {}, tk = st.tokensToday || {};
  const cur = { day: st.today, gemini: u.gemini || 0, gemini429: u.gemini429 || 0, github: u.github || 0, githubFail: u.githubFail || 0,
    openrouter: u.openrouter || 0, openrouterFail: u.openrouterFail || 0,
    claude: u.claude || 0, claudeFail: u.claudeFail || 0, fallback: u.fallback || 0,
    gtIn: tk.geminiIn || 0, gtOut: tk.geminiOut || 0, ghIn: tk.githubIn || 0, ghOut: tk.githubOut || 0, orIn: tk.openrouterIn || 0, orOut: tk.openrouterOut || 0, clIn: tk.claudeIn || 0, clOut: tk.claudeOut || 0 };
  if (_telPrev) {
    const same = _telPrev.day === cur.day;                                      // jour changé → compteurs IA remis à 0 → cur EST le delta
    const dl = k => same ? Math.max(0, (cur[k] || 0) - (_telPrev[k] || 0)) : (cur[k] || 0);
    const b = _telBucket(_telHourKey());
    b.gemini.calls += dl('gemini'); b.gemini.e429 += dl('gemini429'); b.gemini.tokIn += dl('gtIn'); b.gemini.tokOut += dl('gtOut');
    b.github.calls += dl('github'); b.github.fail += dl('githubFail'); b.github.tokIn += dl('ghIn'); b.github.tokOut += dl('ghOut');
    if (b.openrouter) { b.openrouter.calls += dl('openrouter'); b.openrouter.fail += dl('openrouterFail'); b.openrouter.tokIn += dl('orIn'); b.openrouter.tokOut += dl('orOut'); }   // bucket récent (anciens en cache sans openrouter → ignorés)
    b.claude.calls += dl('claude'); b.claude.fail += dl('claudeFail'); b.claude.tokIn += dl('clIn'); b.claude.tokOut += dl('clOut');
    b.fallback += dl('fallback');
    if (dl('gemini') + dl('github') + dl('openrouter') + dl('claude') + dl('gemini429') + dl('fallback') > 0) _telDirty = true;
  }
  _telPrev = cur;
}
async function _telFlush() {
  if (_telDirty) { _telDirty = false; for (const [hk, b] of _telBuckets) { try { await auth.aiCacheSet('aitel:' + hk, b); } catch {} } }
  const cut = _telHourKey(Date.now() - 8 * 24 * 3600 * 1000);                    // ne garde que ~8 jours en mémoire
  for (const hk of [..._telBuckets.keys()]) if (hk < cut) _telBuckets.delete(hk);
}
async function _telLoadRange(hours) {
  const out = [];
  for (let i = hours - 1; i >= 0; i--) {
    const hk = _telHourKey(Date.now() - i * 3600 * 1000);
    let b = _telBuckets.get(hk);
    if (!b) { try { b = await auth.aiCacheGet('aitel:' + hk); } catch {} }
    out.push(b || _telEmpty(hk));
  }
  return out;
}
function _telHealthScore(keys, cooling, breakers, calls, errs) {
  if (!keys) return null;
  let s = 100;
  s -= Math.round((cooling / keys) * 60);                                        // clés gelées → forte pénalité
  s -= (breakers || 0) * 8;                                                       // circuit breakers ouverts
  if (calls > 0) s -= Math.round((errs / (calls + errs)) * 30);                  // taux d'échec
  return Math.max(0, Math.min(100, s));
}
// PRÉDICTION : épuisement du quota du jour, burn rate, demande à venir (learner Phase 1).
function _telForecast(buckets) {
  const cap = _aiDailyCap();
  const dayTotal = Object.values(_aiUsage.dayCounts || {}).reduce((a, b) => a + b, 0);
  const last3 = buckets.slice(-3);
  const calls3h = last3.reduce((s, b) => s + (b.gemini.calls || 0) + (b.github.calls || 0), 0);
  const ratePerHour = calls3h / Math.max(1, last3.length);
  const remaining = Math.max(0, cap - dayTotal);
  const hoursToExhaust = ratePerHour > 0.2 ? Math.round(remaining / ratePerHour * 10) / 10 : null;
  const p = _aiParis(), wd = p.getDay(), hNow = p.getHours(), nextHours = [];
  for (let i = 1; i <= 6; i++) { const h = (hNow + i) % 24, day = (wd + Math.floor((hNow + i) / 24)) % 7; nextHours.push({ h, expected: aiExpectedDemand(day + '-' + h) }); }
  return {
    dailyCap: cap, dayTotal, remaining, pctUsed: cap ? Math.round(dayTotal / cap * 100) : 0,
    ratePerHour: Math.round(ratePerHour * 10) / 10, hoursToExhaust,
    risk: !cap ? 'unknown' : (dayTotal >= cap ? 'exhausted' : (hoursToExhaust != null && hoursToExhaust < 3) ? 'high' : (dayTotal >= cap * 0.8 ? 'medium' : 'low')),
    quietHours: _aiQuietHours(), weekend: _aiIsWeekend(), dayFraction: Math.round(_aiDayFraction() * 100) / 100, nextHours,
    prewarmActive: (typeof _prewarmGate === 'function') ? _prewarmGate() : null,                   // préchauffage de fond en marche ?
    prePeak: (typeof _aiDemandPrePeak === 'function') ? _aiDemandPrePeak() : null,                 // Phase 2 : pré-pic de demande appris ?
    learnedSlots: Object.keys(_aiDemand).length,                                                   // nb de créneaux appris (maturité du learner)
  };
}
// Endpoint admin : santé providers + budget + tendance horaire + prévisions (alimente le dashboard).
app.get('/api/admin/ai-monitor', requireAdmin, async (req, res) => {
  try {
    const range = Math.min(168, Math.max(6, parseInt(req.query.hours, 10) || 24));
    const st = _telLiveStatus || (() => { try { return ai.status(); } catch { return {}; } })();
    const buckets = await _telLoadRange(range);
    const sum = (p, k) => buckets.reduce((s, b) => s + ((b[p] && b[p][k]) || 0), 0);
    const u = st.usageToday || {}, intel = st.intel || {};
    const providers = {
      gemini: { keys: st.geminiKeys || 0, coolingKeys: st.geminiCoolingNow || 0, breakersOpen: intel.breakersOpen || 0,
        pressure: intel.pressure || 0, effRpm: intel.effRpm || 0, rpmTarget: intel.rpmTarget || 0,
        callsToday: u.gemini || 0, err429Today: u.gemini429 || 0, callsWindow: sum('gemini', 'calls'), err429Window: sum('gemini', 'e429'), tokInWindow: sum('gemini', 'tokIn'), tokOutWindow: sum('gemini', 'tokOut') },
      github: { tokens: (st.github || {}).tokens || 0, models: ((st.github || {}).models || []).length || 1, coolingKeys: (st.github || {}).coolingNow || 0, callsToday: u.github || 0, failToday: u.githubFail || 0, failWindow: sum('github', 'fail'), callsWindow: sum('github', 'calls') },
      openrouter: { keys: (st.openrouter || {}).keys || 0, models: (st.openrouter || {}).models || 0, coolingKeys: (st.openrouter || {}).coolingNow || 0, callsToday: u.openrouter || 0, failToday: u.openrouterFail || 0 },
      claude: { keys: st.anthropicKeys || 0, usable: !!st.claudeUsable, usedToday: st.claudeUsedToday || 0, dailyMax: st.claudeDailyMax || 0, cooling: st.claudeCooling || [], callsToday: u.claude || 0, callsWindow: sum('claude', 'calls') },
    };
    const health = {
      gemini: _telHealthScore(providers.gemini.keys, providers.gemini.coolingKeys, providers.gemini.breakersOpen, providers.gemini.callsToday, providers.gemini.err429Today),
      github: providers.github.tokens ? _telHealthScore(providers.github.tokens, providers.github.coolingKeys, 0, providers.github.callsWindow, providers.github.failWindow) : null,
      openrouter: providers.openrouter.keys ? _telHealthScore(providers.openrouter.keys, providers.openrouter.coolingKeys, 0, providers.openrouter.callsToday, providers.openrouter.failToday) : null,
      claude: providers.claude.keys ? (providers.claude.usable ? Math.max(20, 100 - Math.round(providers.claude.usedToday / Math.max(1, providers.claude.dailyMax) * 100)) : 5) : null,
    };
    res.json({
      now: Date.now(), range,
      budget: Object.assign({ monthly: GEMINI_MONTHLY_BUDGET, monthUsed: _aiUsage.total || 0 }, _telForecast(buckets)),
      providers, health,
      categoriesToday: _aiUsage.dayCounts || {}, claudeToday: _aiUsage.claudeCounts || {},
      trend: buckets.map(b => ({ hour: b.hour, gemini: b.gemini.calls, github: b.github.calls, openrouter: (b.openrouter && b.openrouter.calls) || 0, claude: b.claude.calls, e429: b.gemini.e429, fallback: b.fallback })),
      backoff: st.backoff || {}, healthDetail: intel.health || [],
      mail: (() => { try { return mailer.getMailHealth(); } catch { return null; } })(),   // santé email (canal principal OVH, envoyés/échecs, dernier canal) → visible dans le panel
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ALERTES E-MAIL ADMIN (monitoring IA) : provider en rouge / quota proche épuisement / panne totale ──
// Anti-spam : cooldown PAR TYPE d'alerte (mémoire). Vérifié toutes les 5 min. force=true → ignore le cooldown (test).
const _aiAlertSent = {};
function _aiAlertDue(type, cooldownMs, force) { if (force) return true; const last = _aiAlertSent[type] || 0; if (Date.now() - last < cooldownMs) return false; _aiAlertSent[type] = Date.now(); return true; }
async function _aiAlertCheck(force) {
  let st; try { st = _telLiveStatus || ai.status(); } catch { return 0; }
  if (!st || !st.usageToday) return 0;
  let fc; try { fc = _telForecast(await _telLoadRange(3)); } catch { fc = null; }
  const out = [];
  if (fc && (fc.risk === 'exhausted' || fc.risk === 'high' || fc.pctUsed >= 90) && _aiAlertDue('quota', 4 * 3600 * 1000, force)) {
    out.push({ subject: 'Quota IA du jour à ' + fc.pctUsed + '%', html:
      '<p style="color:#cbd5e1;font-size:15px;line-height:1.6;">Le quota Gemini du jour est à <b>' + fc.pctUsed + '%</b> (' + fc.dayTotal + '/' + fc.dailyCap + ').'
      + (fc.hoursToExhaust != null ? ' Épuisement estimé dans ~<b>' + fc.hoursToExhaust + ' h</b>.' : '') + ' Risque : <b>' + fc.risk + '</b>.</p>'
      + '<p style="color:#cbd5e1;font-size:14px;">Le service continue (repli 0-token + GitHub/Claude) ; pense à ajouter une clé Gemini si ça revient souvent.</p>' });
  }
  const gemH = _telHealthScore(st.geminiKeys || 0, st.geminiCoolingNow || 0, (st.intel || {}).breakersOpen || 0, (st.usageToday || {}).gemini || 0, (st.usageToday || {}).gemini429 || 0);
  if (gemH != null && gemH < 25 && _aiAlertDue('gemini_red', 4 * 3600 * 1000, force)) {
    out.push({ subject: 'Gemini en rouge (santé ' + gemH + '/100)', html:
      '<p style="color:#cbd5e1;font-size:15px;line-height:1.6;">Le provider <b>Gemini</b> est dégradé : santé <b>' + gemH + '/100</b>, ' + (st.geminiCoolingNow || 0) + ' couple(s) (modèle, clé) en cooldown 429 — probable quota journalier épuisé.</p>'
      + '<p style="color:#cbd5e1;font-size:14px;">Le terminal bascule sur GitHub Models / Claude + repli déterministe. Ajoute une clé Gemini (GEMINI_API_KEY6…) si ça persiste.</p>' });
  }
  if (st.backoff && st.backoff.active && _aiAlertDue('backoff', 2 * 3600 * 1000, force)) {
    out.push({ subject: 'Panne IA totale (backoff actif)', html:
      '<p style="color:#cbd5e1;font-size:15px;line-height:1.6;">Tous les fournisseurs IA ont échoué en série (' + (st.backoff.totalFails || 0) + ' échecs) → <b>backoff global actif</b>. Le contenu reste servi via le cache + le repli 0-token, mais aucune nouvelle génération IA ne passe pour l\'instant.</p>' });
  }
  for (const a of out) { try { const r = await mailer.sendAdminAlert(a); console.log('[AI Alert] →', a.subject, r ? '(' + r + ')' : '(non envoyé)'); } catch (e) { console.warn('[AI Alert] échec:', e.message); } }
  return out.length;
}
// Test admin : envoie une alerte de TEST (vérif e-mail bout-en-bout, ignore le cooldown).
app.post('/api/admin/ai-alert-test', requireAdmin, async (req, res) => {
  try {
    const r = await mailer.sendAdminAlert({ subject: 'Test alerte IA (manuel)', to: (req.body && req.body.to) || undefined,
      html: '<p style="color:#cbd5e1;font-size:15px;line-height:1.6;">Test du système d\'alerte e-mail du monitoring IA. Si tu reçois ce message, les alertes automatiques (provider en rouge, quota proche épuisement, panne totale) fonctionnent.</p>' });
    res.json({ ok: !!r, channel: r || null });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
function _aiReset() {
  const mo = _aiMonth(), d = _aiDay();
  if (_aiUsage.month !== mo) { _aiUsage = { month: mo, day: d, total: 0, dayCounts: {}, claudeCounts: {} }; _aiSave(); }
  else if (_aiUsage.day !== d) { _aiUsage.day = d; _aiUsage.dayCounts = {}; _aiUsage.claudeCounts = {}; _aiSave(); }   // claudeCounts est un compteur DU JOUR → vidé au changement de jour (sinon la métrique « crédits Claude du jour » cumulait tout le mois)
}
function _aiDailyCap() {
  const remaining = Math.max(0, GEMINI_MONTHLY_BUDGET - (_aiUsage.total || 0));
  const paced = Math.floor(remaining / _aiDaysLeftInMonth());
  // Plancher confortable, plafond de sécurité free-tier.
  return Math.min(GEMINI_DAILY_MAX, Math.max(GEMINI_DAILY_MIN, paced));
}
// Fraction du jour écoulée (Paris, 0→1) — sert au pacing intra-journée.
function _aiDayFraction() {
  const p = _aiParis();
  return Math.min(1, (p.getHours() * 3600 + p.getMinutes() * 60 + p.getSeconds()) / 86400);
}
// Fenêtre CALME (heure de Paris) : 21h00 → 8h30 = on coupe l'IA de fond pour économiser le quota
// (peu d'activité la nuit). Réglable via AI_QUIET_START/AI_QUIET_END (minutes depuis minuit).
const AI_QUIET_START = parseInt(process.env.AI_QUIET_START, 10) || (21 * 60);      // 21:00
const AI_QUIET_END   = parseInt(process.env.AI_QUIET_END, 10)   || (8 * 60 + 30);  // 8:30 (aligné sur l'intention projet documentée)
function _aiQuietHours() {
  let h = 12, m = 0;
  try { const s = new Date().toLocaleString('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false }); h = parseInt(s.slice(0, 2), 10); m = parseInt(s.slice(3, 5), 10); } catch {}
  const mins = h * 60 + m;
  return AI_QUIET_START > AI_QUIET_END ? (mins >= AI_QUIET_START || mins < AI_QUIET_END) : (mins >= AI_QUIET_START && mins < AI_QUIET_END);
}
function aiAllowed(category, opts = {}) {
  _aiReset();
  const prio = opts.priority || 'normal';   // TIERS : 'user' (on-demand) > 'normal' > 'background' (préchauffage)
  if (_aiQuietHours() && !opts.scheduled && prio !== 'user') return false;   // 21h→7h : fond coupé (l'user passe quand même)
  const cap      = _aiDailyCap();
  const dayTotal = Object.values(_aiUsage.dayCounts).reduce((a, b) => a + b, 0);
  const catUsed  = _aiUsage.dayCounts[category] || 0;
  try { ai.setQuotaPressure(cap ? dayTotal / cap : 0); } catch {}     // throttling PRÉDICTIF : ralentit le débit avant saturation
  if (dayTotal >= cap) return false;                                   // plafond DUR du jour atteint
  // TIER BACKGROUND (préchauffage) : on RÉSERVE ~40% du quota du jour aux requêtes user ET au contenu
  // CRITIQUE planifié (narratifs Smart Bias, biais par banque, Week Ahead) → le préchauffage cède EN PREMIER
  // et bien plus tôt → on ne brûle jamais tout le quota sur du prewarming « au cas où ».
  if (prio === 'background' && dayTotal >= Math.floor(cap * 0.60)) return false;
  // PLANCHER pour le contenu PLANIFIÉ irremplaçable : les chemins 'user' (analyst/news/chat/outlook),
  // qui sautent pacing ET heures calmes et dont les parts cumulées dépassent 100%, pourraient saturer
  // le plafond dur et affamer les générations planifiées (narratifs, Week Ahead) — qui, elles, ne
  // basculent plus sur Claude. On réserve donc les 10% du haut au planifié (symétrique de la réserve background).
  if (prio === 'user' && !opts.scheduled && dayTotal >= Math.floor(cap * 0.90)) return false;
  // ── Pacing intra-journée ────────────────────────────────────────────────────
  // On n'autorise au plus que la PART ÉCOULÉE du jour (+ un petit burst) → la conso s'étale jusqu'au reset.
  // Sauf : générations PLANIFIÉES (opts.scheduled) ET priorité 'user' (l'utilisateur n'est jamais freiné).
  if (!opts.scheduled && prio !== 'user') {
    const pacedCeil = Math.ceil(cap * _aiDayFraction()) + AI_BURST;
    if (dayTotal >= pacedCeil) return false;
  }
  // Part du quota du jour allouée à une catégorie (PRIORITÉ = part plus grande). Le plafond DUR
  // du jour (dayTotal ≥ cap) reste la limite globale ; ces parts règlent qui passe en premier.
  const share = f => catUsed < Math.floor(cap * f);
  if (_aiIsWeekend()) {
    // Week-end (marchés fermés) : news OFF, mais on PRIORISE le contenu premium
    // (Analyst + AI Insights, Institution, Bias) → toujours frais à l'ouverture.
    if (category === 'news')    return !!opts.important && share(0.40);   // WE : news importantes (géopolitique, etc.)
    if (category === 'analyst') return share(0.45);   // Analyst + AI Insights
    if (category === 'bank')    return share(0.45);   // Institution (ING)
    if (category === 'bias')    return share(0.40);
    if (category === 'ratesbias') return share(0.18);   // biais TAUX : part modeste, hebdo
    if (category === 'weekahead') return share(0.22);   // éditorial Week Ahead : hebdo
    if (category === 'chat')    return share(0.30);     // chat Macro AI (désormais DANS le budget)
    if (category === 'outlook') return share(0.18);     // Analyst Outlook (désormais DANS le budget)
    return share(0.30);
  }
  // Semaine : PRIORITÉ aux onglets premium → Analyst/AI Insights (60%) + Institution (40%, désormais
  // activé en semaine grâce aux 3 clés). News importantes et Bias gardent une part plus modeste.
  // Sources premium ÉQUILIBRÉES à part égale (≈45 % chacune) : Analyst/AI Insights, News, Institution.
  // Bias un cran en dessous. Le plafond DUR du jour reste la limite globale.
  if (category === 'analyst') return share(0.45);                       // Analyst + AI Insights
  if (category === 'bank')    return share(0.45);                       // Institution (ING)
  if (category === 'news')    return !!opts.important && share(0.45);   // news importantes
  if (category === 'bias')    return share(0.30);
  if (category === 'ratesbias') return share(0.18);   // biais TAUX : part modeste, hebdo
  if (category === 'weekahead') return share(0.22);   // éditorial Week Ahead : hebdo
  if (category === 'chat')    return share(0.30);     // chat Macro AI (désormais DANS le budget)
  if (category === 'outlook') return share(0.18);     // Analyst Outlook (désormais DANS le budget)
  return false;
}
function aiNote(category) { _aiReset(); _aiUsage.dayCounts[category] = (_aiUsage.dayCounts[category] || 0) + 1; _aiUsage.total = (_aiUsage.total || 0) + 1; _aiSave(); _aiDemandNote(category); }
// Déversements Claude (crédits payants) : comptés À PART (claudeCounts) — visibles dans
// /api/admin/ai-status, mais HORS dayCounts/total pour ne pas amputer l'enveloppe Gemini.
function _aiNoteClaude(category) { _aiReset(); if (!_aiUsage.claudeCounts) _aiUsage.claudeCounts = {}; _aiUsage.claudeCounts[category] = (_aiUsage.claudeCounts[category] || 0) + 1; _aiSave(); }
// ── Persistance DURABLE de l'état budget (Supabase ai_cache) ────────────────
// Le fichier local disparaît à chaque rebuild Docker → le compteur mensuel repartait à 0 et le
// plafond/jour se recalculait trop généreux. On réplique désormais _aiUsage + le cap Claude en
// KV durable (modèle aidemand:v1) : hydratation au boot (max des totaux), écriture débouncée.
let _aiUsageSaveT = null;
{ const _origSave = _aiSave;
  _aiSave = function () {
    _origSave();
    if (!_aiUsageSaveT) _aiUsageSaveT = setTimeout(() => {
      _aiUsageSaveT = null;
      auth.aiCacheSet('aiusage:v1', _aiUsage).catch(() => {});
      try { auth.aiCacheSet('claudeuse:v1', ai.getClaudeState()).catch(() => {}); } catch {}
    }, 30000);
  };
}
auth.aiCacheGet('aiusage:v1').then(u => {
  if (!u || typeof u !== 'object') return;
  _aiReset();
  if (u.month === _aiUsage.month) {
    _aiUsage.total = Math.max(_aiUsage.total || 0, u.total || 0);             // max → un rebuild ne ré-ouvre jamais l'enveloppe
    if (u.day === _aiUsage.day && u.dayCounts) {
      for (const [k, v] of Object.entries(u.dayCounts)) _aiUsage.dayCounts[k] = Math.max(_aiUsage.dayCounts[k] || 0, v || 0);
      if (u.claudeCounts) { if (!_aiUsage.claudeCounts) _aiUsage.claudeCounts = {}; for (const [k, v] of Object.entries(u.claudeCounts)) _aiUsage.claudeCounts[k] = Math.max(_aiUsage.claudeCounts[k] || 0, v || 0); }   // max par clé (pas Object.assign : ne pas perdre les comptes locaux du boot)
    }
    _aiSave();
  }
}).catch(() => {});
auth.aiCacheGet('claudeuse:v1').then(s => { try { ai.hydrateClaudeState(s); } catch {} }).catch(() => {});

// ── Contexte LIVE du terminal injecté dans l'IA (système ÉVOLUTIF) ───────────
// Instantané COURT de l'état RÉEL du terminal (régime de risque, force des devises…),
// bâti à partir des données DÉJÀ calculées (zéro fetch). ai.js l'injecte dans CHAQUE appel
// (Gemini + Claude) → l'IA s'adapte en continu à l'état du marché → sorties évolutives.
function _aiTerminalContext() {
  try {
    const out = [`Now (UTC): ${new Date().toISOString().replace('T', ' ').slice(0, 16)}`];
    if (_riskData && _riskData.label) {
      out.push(`Global risk regime: ${_riskData.label}${typeof _riskData.score === 'number' ? ` (score ${_riskData.score})` : ''}`);
    }
    const cs = _csCache && _csCache['1d'] && _csCache['1d'].data;
    if (cs && cs.series && Array.isArray(cs.currencies)) {
      const lastV = c => { const a = (cs.series[c] || []).filter(d => d && d.v != null); return a.length ? a[a.length - 1].v : null; };
      const ranked = cs.currencies.map(c => [c, lastV(c)]).filter(x => x[1] != null).sort((a, b) => b[1] - a[1]);
      if (ranked.length >= 3) out.push(`Currency strength 24h (strongest→weakest): ${ranked.map(r => r[0]).join(' > ')}`);
    }
    return out.length ? out.join('\n') : null;
  } catch { return null; }
}
try { if (ai && typeof ai.setLiveContext === 'function') ai.setLiveContext(_aiTerminalContext); } catch {}

// ── Routeur IA unifié (pool Gemini gratuit + Claude multi-clés) ──────────────
// Politique (durcie après l'incident d'épuisement des crédits Anthropic) :
//   1) Budget Gemini OK → ai.generateText (Gemini→GitHub→Claude intégré). Le débit
//      n'est compté (aiNote) qu'APRÈS succès → un 429 ne consomme plus de budget.
//      Si l'échec a DÉJÀ traversé Claude (err.claudeTried), AUCUNE 2e passe.
//   2) Budget refusé → bascule Claude UNIQUEMENT pour les chemins utilisateur
//      (priority:'user') ou si l'appelant le demande EXPLICITEMENT
//      (opts.claudeOverBudget === true). Le fond/planifié n'use PLUS les crédits
//      payants par défaut : il attend son tour (self-heal) avec son fallback local.
//   3) Tout déversement Claude hors budget est compté à part (_aiNoteClaude) et
//      borné par le cap CLAUDE_DAILY_MAX (persisté) → coût toujours fini et visible.
async function aiSmart(category, prompt, maxTokens, opts = {}) {
  // Bascule Claude hors-budget : réservée aux requêtes UTILISATEUR (sauf opt-in/out explicite).
  const claudeOverBudget = (opts.claudeOverBudget === true) || (opts.claudeOverBudget !== false && opts.priority === 'user');
  if (aiAllowed(category, opts)) {
    try {
      // noClaude : si l'appelant interdit explicitement Claude (claudeOverBudget:false), on coupe
      // AUSSI le repli Claude in-cascade → un flux de fond ne dépense plus de crédits payants, in-budget compris.
      const out = await ai.generateText(prompt, maxTokens, { noClaude: opts.claudeOverBudget === false });
      aiNote(category);   // compté APRÈS succès → les 429/échecs ne brûlent plus le budget
      return out;
    } catch (e) {
      // generateText a DÉJÀ parcouru toute la cascade (Claude inclus, sauf si noClaude voulu) → on
      // ne repasse JAMAIS par Claude ici (ce serait soit redondant, soit contraire à claudeOverBudget:false).
      throw e;
    }
  }
  if (claudeOverBudget && ai.claudeUsable && ai.claudeUsable()) { const out = await ai.generateTextClaudeOnly(prompt, maxTokens); _aiNoteClaude(category); return out; }
  throw new Error('AI indisponible (budget Gemini épuisé' + (opts.priority === 'user' ? ', aucune clé Claude utilisable' : ' — fond : pas de bascule crédits payants') + ')');
}

// ── COALESCING des générations à la demande ──────────────────────────────────
// 2 requêtes IDENTIQUES simultanées (2 users ouvrent le même rapport, double-clic, retry front)
// partagent UNE seule génération au lieu d'en lancer deux : la 2e attend la promesse de la 1re.
// Gain direct en quota sous concurrence, zéro impact sur le chemin nominal (cache hit).
const _aiInflightMap = new Map();   // clé → Promise en cours
function _aiInflight(key, fn) {
  const cur = _aiInflightMap.get(key);
  if (cur) return cur;
  const p = Promise.resolve().then(fn).finally(() => { _aiInflightMap.delete(key); });
  _aiInflightMap.set(key, p);
  return p;
}

// Cache des segmentations IA (url → HTML sectionné) — persistant
const SW_SEG_FILE = path.join(_CACHE_DIR, 'cache_sw_seg.json');
const _swSegCache = _loadJsonMap(SW_SEG_FILE);
const SW_SEG_VER  = 'v4:';   // bump → régénère (v4 : en-têtes courts + CATÉGORISATION des listes plates "HEADLINES" en rubriques par thème)

// Cache des structurations IA des rapports de recherche (DailyFX ING…) — persistant, même logique que les wraps
const BR_SEG_FILE = path.join(_CACHE_DIR, 'cache_br_seg.json');
const _brSegCache = _loadJsonMap(BR_SEG_FILE);
const BR_PRINT_FILE = path.join(_CACHE_DIR, 'cache_br_print.json');
const _brPrintMap = _loadJsonMap(BR_PRINT_FILE);   // url -> URL imprimable absolue (PrintPage MUFG / rapport gspublishing Goldman) — GUID non dérivable → à persister
const BR_SEG_VER  = 'v3:';   // bump → régénère (v3 : purge les faux résumés fabriqués depuis des pages "vitrine"/teaser — garde anti-teaser ajoutée)
const SEG_FAIL_RETRY_MS = 6 * 3600 * 1000;   // un échec de segmentation est retenté après 6 h (répare les rapports figés en brut par une panne)
// État d'une entrée de cache de segmentation : 'ok' (HTML utilisable) · 'cooling' (échec récent <6h, ne pas régénérer)
// · 'retry' (échec ancien ≥6h OU null hérité → à régénérer) · 'absent'. Source unique de vérité, partagée route↔prewarm.
function _segState(v) {
  if (typeof v === 'string' && v.length > 50) return 'ok';
  if (v && typeof v === 'object' && v.f) return (Date.now() - v.f > SEG_FAIL_RETRY_MS) ? 'retry' : 'cooling';
  if (v === null) return 'retry';          // null hérité (avant le marqueur daté) → on retente
  return 'absent';
}

// ── PRÉCHAUFFAGE : segmente les rapports EN AVANCE (cache persistant) → ouverture INSTANTANÉE ──
// Le coût (Gemini) est payé en tâche de fond, jamais quand l'utilisateur ouvre un rapport.
async function _prewarmWrapSeg(item) {
  const url = item && item.url;
  if (!url || !url.startsWith('https://investinglive.com/')) return false;
  const stt = _segState(_swSegCache.get(SW_SEG_VER + url));
  if (stt === 'ok' || stt === 'cooling') return false;   // déjà segmenté, OU échec trop récent (<6h) → on n'insiste pas
  // Déjà dans le cache DURABLE Supabase ? → hydrate la mémoire, AUCUNE régénération (survit aux redéploys = grosse économie de quota Gemini).
  try { const dur = await auth.aiCacheGet('swseg:' + SW_SEG_VER + url); if (typeof dur === 'string' && dur.length > 50) { _swSegCache.set(SW_SEG_VER + url, dur); return false; } } catch {}
  if (!aiAllowed('analyst', { priority: 'background' })) return false;                     // respecte l'enveloppe budget Gemini
  try {
    let points = null;
    if (item.content && item.content.length > 100) points = _extractWrapPoints(_cleanWrapHtml(item.content));
    if (!points || points.length < 3) { const data = await _fetchILContentHttp(url); if (data && data.points && data.points.length >= 3) points = data.points; }
    if (!points || points.length < 3) return false;
    const seg = await _segmentWrapAI(points, { noClaude: true });            // PRÉCHAUFFAGE de fond → JAMAIS de crédits Claude (fallback = on retentera)
    if (seg) { aiNote('analyst'); _swSegCache.set(SW_SEG_VER + url, seg); _saveJsonMap(SW_SEG_FILE, _swSegCache); auth.aiCacheSet('swseg:' + SW_SEG_VER + url, seg).catch(() => {}); return true; }   // compté APRÈS succès + durable
    _swSegCache.set(SW_SEG_VER + url, { f: Date.now() });                    // échec → marqueur daté (retry 6h), plus de null permanent ni de débit
  } catch (e) { console.warn('[SW prewarm]', e.message); _swSegCache.set(SW_SEG_VER + url, { f: Date.now() }); }
  return false;
}
// ── PORTE du préchauffage INTELLIGENT (éco quota) ────────────────────────────
// Le préchauffage n'est plus qu'un POLISSAGE : la structure des recaps est déjà GRATUITE
// (_catHeadline, 0 token). On ne dépense donc du quota EN AVANCE que si TOUTES ces conditions
// tiennent ; sinon SILENCE TOTAL → le quota reste aux ouvertures réelles + au contenu hebdo.
//   1) PAS d'heures calmes (nuit 21h→8h30 = ZÉRO requête IA de fond),
//   2) PAS de pression budget (on s'arrête tôt : la réservation de fond cède à 45% du cap),
//   3) PAS de panne IA en cours (backoff global),
//   4) PHASE 2 (auto-amélioration) : on n'anticipe QUE près d'un pic de demande APPRIS.
function _prewarmGate() {
  if (_aiQuietHours()) return false;                                                  // nuit → aucun préchauffage
  if (typeof ai.backoffActive === 'function' && ai.backoffActive()) return false;     // IA en rade → on n'insiste pas
  const cap = _aiDailyCap();
  const dayTotal = Object.values(_aiUsage.dayCounts || {}).reduce((a, b) => a + b, 0);
  if (cap && dayTotal >= Math.floor(cap * 0.45)) return false;                        // budget déjà bien entamé → on réserve le reste aux users
  if (_aiDemandPrePeak() === false) return false;                                     // creux appris → on attend (préchauffe seulement avant la ruée)
  return true;
}
let _swPrewarmBusy = false;
async function _prewarmWrapSegs() {
  if (_swPrewarmBusy || !_prewarmGate()) return;
  _swPrewarmBusy = true;
  try {
    // Backlog réduit à 2/cycle (le polissage IA n'est plus prioritaire — la structure est gratuite).
    const todo = _swCache.filter(i => { if (!i.url || !i.url.startsWith('https://investinglive.com/')) return false; const s = _segState(_swSegCache.get(SW_SEG_VER + i.url)); return s === 'absent' || s === 'retry'; }).slice(0, 2);
    for (const item of todo) { if (!_prewarmGate() || !aiAllowed('analyst', { priority: 'background' })) break; await _prewarmWrapSeg(item); await new Promise(r => setTimeout(r, 1500)); }
  } finally { _swPrewarmBusy = false; }
}

// ── PRÉCHAUFFAGE DailyFX (ING) : structure EN AVANCE les rapports du jour → ouverture instantanée ──
// Réutilise l'endpoint /api/bank-research-content (même extraction + structuration IA + cache) via un
// appel local, pour ne PAS dupliquer la logique. Borné aux rapports récents non encore structurés.
let _brPrewarmBusy = false;
async function _prewarmBrSegs() {
  if (_brPrewarmBusy || !_prewarmGate()) return;
  _brPrewarmBusy = true;
  try {
    const dayCut = Date.now() - 4 * 24 * 60 * 60 * 1000;   // ~4 derniers jours → couvre tout le DailyFX récent de l'onglet
    const todo = (_brCache || [])
      .filter(i => { if (!i.url || !_brContentAllowed(i.url) || (i.timestamp || 0) <= dayCut) return false; const s = _segState(_brSegCache.get(BR_SEG_VER + i.url)); return s === 'absent' || s === 'retry'; })   // {f:ts} récent (<6h) = on n'insiste pas ; ≥6h = on retente
      .slice(0, 2);   // réduit à 2/cycle (polissage opportuniste, éco quota)
    for (const item of todo) {
      if (!_prewarmGate() || !aiAllowed('analyst', { priority: 'background' })) break;
      try { await axios.get(`http://127.0.0.1:${PORT}/api/bank-research-content?url=${encodeURIComponent(item.url)}`, { timeout: 30000 }); }
      catch (e) { console.warn('[BR prewarm]', e.message); }
      await new Promise(r => setTimeout(r, 1500));
    }
  } finally { _brPrewarmBusy = false; }
}

// Regroupe les titres d'un wrap en rubriques thématiques via Gemini
async function _segmentWrapAI(points, _opts = {}) {
  const prompt = `Voici, DANS L'ORDRE, les éléments BRUTS d'un récap de session de marché : des EN-TÊTES de section (lignes courtes en MAJUSCULES) et des puces de contenu.
Produis un rapport PROPRE et PROFESSIONNEL façon DataTradingPro (ton d'analyste institutionnel) :
- Détecte les en-têtes RÉELLEMENT présents (ex: "IRAN CONFLICT", "EUROPEAN TRADE: EQUITIES", "FX", "FIXED INCOME", "COMMODITIES", "TRADE/TARIFFS", "CENTRAL BANKS", "NOTABLE US HEADLINES", "GEOPOLITICS: RUSSIA-UKRAINE", "CRYPTO", "APAC TRADE", "NOTABLE ASIA-PAC HEADLINES", etc.) et garde-les EXACTEMENT tels quels (ne traduis pas, ne renomme pas).
- ⚠️ Si le rapport est surtout une LISTE PLATE de titres sous un en-tête générique ("HEADLINES", "NEWS"…), NE laisse PAS tout sous "HEADLINES" : RÉPARTIS chaque puce sous la rubrique adaptée à SON sujet (FX, COMMODITIES, EQUITIES, FIXED INCOME, CENTRAL BANKS, ECONOMIC DATA, GEOPOLITICS, ENERGY, TRADE/TARIFFS, CRYPTO…). Regroupe les puces par thème, dans un ordre logique. C'est la règle CLÉ : un récap doit toujours être catégorisé, jamais un simple tas de titres.
- Sous chaque en-tête, PEAUFINE/REFORMULE les puces en phrases claires, concises et professionnelles : corrige la grammaire, supprime les fragments, répétitions et le cruft, fais des phrases complètes qui se lisent comme un vrai récap d'analyste (pas un copier-coller brut).
RÈGLE ABSOLUE (prioritaire sur tout) : ne change JAMAIS les FAITS — chiffres, niveaux/prix, pourcentages, paires/tickers, noms, citations, dates, événements. N'INVENTE RIEN. Tu améliores UNIQUEMENT la formulation et la clarté, jamais le contenu factuel.
- Une ligne courte tout en MAJUSCULES = un EN-TÊTE (jamais une puce). Ignore le promotionnel/hors-sujet ("...at investingLive.com", etc.).
- EN-TÊTES COURTS type catégorie (FX, COMMODITIES, EQUITIES, FIXED INCOME, CENTRAL BANKS, ECONOMIC DATA, GEOPOLITICS, CRYPTO…). Un sous-rapport au titre LONG en minuscules (ex: "New Zealand Manufacturing Returns to Contraction…") → NE le garde PAS comme en-tête : range son contenu sous une catégorie COURTE adaptée.
- Chaque puce = UNE idée concise (≤30 mots), jamais un pavé multi-phrases (découpe les longs paragraphes en plusieurs puces courtes).
Réponds UNIQUEMENT en JSON valide : [{"section":"TITRE D'ORIGINE","items":["phrase reformulée 1","phrase 2"]}]
Éléments :
${points.map(p => '- ' + p).join('\n')}`;
  const text = await ai.generateText(prompt, 2500, _opts);   // _opts.noClaude=true depuis le préchauffage (pas de crédits payants en fond)
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return null;
  const arr = JSON.parse(m[0]);
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = '';
  for (const sec of arr) {
    if (!sec || !sec.section || !Array.isArray(sec.items) || !sec.items.length) continue;
    html += `<strong>${esc(sec.section)}</strong><ul>${sec.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
  }
  if (html.length > 50) { console.log(`[SW seg] OK -> ${arr.length} sections (wrap structure par IA)`); return html; }
  return null;
}

// Structure un ARTICLE de recherche EN PROSE (ex: ING THINK "FX Daily") en rubriques claires
// façon DataTradingPro/DTP. Réorganise + clarifie SANS JAMAIS inventer (mêmes garde-fous que les wraps).
// Renvoie du HTML <strong>SECTION</strong><ul><li>…</li></ul> ou null (→ on garde le HTML brut).
async function _structureArticleAI(text, title) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length < 220) return null;     // trop court pour valoir une passe IA
  const prompt = `Tu es analyste FX & macro pour un terminal pro (style DataTradingPro). Voici un rapport de recherche de banque (souvent un "FX Daily", rédigé en prose).
Réorganise-le en un rapport PROPRE structuré en RUBRIQUES claires, façon DataTradingPro :
- Choisis des EN-TÊTES pertinents D'APRÈS LE CONTENU réel (ex: "OVERVIEW", "USD", "EUR", "GBP", "JPY", "AUD", "RATES", "COMMODITIES", "CENTRAL BANKS", "WHAT TO WATCH", "RISK EVENTS"…). Ne crée jamais une rubrique sans contenu réel.
- Sous chaque en-tête, des phrases claires, concises et professionnelles (corrige grammaire, fragments, répétitions) : 1 à 4 puces par rubrique, qui se lisent comme un vrai récap d'analyste.
- EN-TÊTES COURTS (1 à 3 mots, type catégorie). Chaque puce = UNE idée concise (≤30 mots), jamais un pavé multi-phrases : découpe les longs paragraphes en plusieurs puces courtes.
RÈGLE ABSOLUE (prioritaire sur tout) : ne change JAMAIS les FAITS — chiffres, niveaux/prix, %, paires/tickers, banques centrales, prévisions, citations, dates. N'INVENTE RIEN, n'ajoute aucune opinion personnelle. Tu réorganises et clarifies UNIQUEMENT.
- Garde la langue d'origine du rapport (généralement l'anglais). Ignore le promotionnel/légal ("Download", disclaimers, "This publication has been prepared by…").
Réponds UNIQUEMENT en JSON valide : [{"section":"TITRE","items":["phrase 1","phrase 2"]}]
Titre : ${String(title || '').slice(0, 160)}
Rapport :
${clean.slice(0, 5200)}`;
  // Gemini uniquement (pas de bascule Claude ici → credit-safe ; le repli est le HTML brut)
  const out = await ai.generateText(prompt, 2200);
  const m = out.match(/\[[\s\S]*\]/);
  if (!m) return null;
  const arr = JSON.parse(m[0]);
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = '';
  for (const sec of arr) {
    if (!sec || !sec.section || !Array.isArray(sec.items) || !sec.items.length) continue;
    html += `<strong>${esc(sec.section)}</strong><ul>${sec.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
  }
  if (html.length > 80) { console.log(`[BR seg] OK -> ${arr.length} sections (DailyFX structure par IA)`); return html; }
  return null;
}

// Nettoyage HTML commun (retire médias/scripts)
// Retire les déclarations XML, prologs et commentaires HTML qui, injectés via innerHTML,
// fuyaient en "?xml version=..." dans le rendu des rapports.
function _stripXmlNoise(h) {
  return String(h || '')
    .replace(/<\?xml[\s\S]*?\?>/gi, '')          // <?xml version="1.0" encoding="UTF-8"?>
    .replace(/<\?[\s\S]*?\?>/g, '')              // autres instructions de traitement
    .replace(/<!DOCTYPE[^>]*>/gi, '')            // <!DOCTYPE …>
    .replace(/<!\[CDATA\[|\]\]>/g, '')           // marqueurs CDATA
    .replace(/<!--[\s\S]*?-->/g, '');            // commentaires HTML
}
function _cleanWrapHtml(h) {
  return _stripXmlNoise(h || '')
    .replace(/<img[^>]*>/gi, '').replace(/<figure[^>]*>[\s\S]*?<\/figure>/gi, '')
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').trim();
}

// Extrait la liste de titres (points) d'un HTML de wrap pour la segmentation IA
function _extractWrapPoints(html) {
  try {
    const $ = cheerio.load(html);
    const pts = [];
    $('h1, h2, h3, h4, strong, b, li, p').each((_, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      // En-tête de section = ligne COURTE entièrement en MAJUSCULES (ex: FX, COMMODITIES, IRAN CONFLICT,
      // EUROPEAN TRADE: EQUITIES, TRADE/TARIFFS…) → on la capte même < 12 car pour préserver la structure d'origine.
      const isHeader = t.length >= 2 && t.length <= 52 && t === t.toUpperCase() && /[A-Z]/.test(t) && /^[A-Z0-9][A-Z0-9 &:/'.\-]+$/.test(t);
      if (isHeader) { pts.push(t); return; }
      if (t.length >= 12 && t.length <= 240) pts.push(t);
    });
    return [...new Set(pts)];   // dédupe en gardant l'ordre
  } catch { return null; }
}

// Catégorisation 0-TOKEN d'un titre par mots-clés → structure les recaps en rubriques MÊME quand
// Gemini est à court de quota (repli déterministe), au lieu d'un tas plat sous « HEADLINES ».
function _catHeadline(t) {
  const s = ' ' + String(t).toLowerCase() + ' ';
  // Ordre = du PLUS spécifique au plus large : un titre « Nikkei up on Iran deal » va en EQUITIES
  // (sujet réel) et non en GEOPOLITICS ; le pur géopolitique (sans actif) tombe en GEOPOLITICS.
  if (/\b(rba|fed|fomc|ecb|boe|boj|boc|pboc|snb|rbnz|central bank|rate decision|rate hike|rate cut|rate hold|hawkish|dovish|policy meeting|reference rate|basis point|\bbps\b|governor|monetary policy)\b/.test(s)) return 'CENTRAL BANKS';
  if (/\b(pmi|gdp|cpi|ppi|inflation|manufacturing|retail sales|unemployment|jobless|payroll|nonfarm|economic data|confidence|sentiment|trade balance)\b/.test(s)) return 'ECONOMIC DATA';
  if (/\b(nikkei|s&p|nasdaq|dow jones|\bdow\b|\basx\b|ftse|\bdax\b|hang seng|kospi|sensex|equit|stocks?|shares?|share index|equity futures)\b/.test(s)) return 'EQUITIES';
  if (/\b(oil|crude|brent|wti|opec|gold|silver|copper|natural gas|\bgas\b|\benergy\b|commodit|bullion|platinum)\b/.test(s)) return 'COMMODITIES';
  if (/\b(bitcoin|btc|crypto|ethereum|\beth\b|solana|stablecoin)\b/.test(s)) return 'CRYPTO';
  if (/\b(usd|eur|gbp|jpy|chf|cad|aud|nzd|cny|yuan|dollar|euro|\byen\b|pound|sterling|\bfx\b|currenc|forex|exchange rate)\b/.test(s)) return 'FX';
  if (/\b(iran|israel|israeli|hamas|hezbollah|\bwar\b|conflict|strikes?|drone|tanker|hormuz|supreme leader|irgc|missile|military|sanction|geopolit|ukraine|russia|gaza|houthi)\b/.test(s)) return 'GEOPOLITICS';
  if (/\b(tariff|trade deal|trade talks?|trade war|\bwto\b|\bimport|\bexport|bridge)\b/.test(s)) return 'TRADE/TARIFFS';
  return 'HEADLINES';
}
const _CAT_ORDER = ['GEOPOLITICS', 'CENTRAL BANKS', 'ECONOMIC DATA', 'FX', 'FIXED INCOME', 'COMMODITIES', 'EQUITIES', 'CRYPTO', 'TRADE/TARIFFS', 'HEADLINES'];

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
    let seg = _swSegCache.get(SW_SEG_VER + url);
    if (seg === undefined) {                                   // pas en mémoire → cache DURABLE Supabase (survit aux redéploys Render éphémères)
      try { const dur = await auth.aiCacheGet('swseg:' + SW_SEG_VER + url); if (typeof dur === 'string' && dur.length > 50) { seg = dur; _swSegCache.set(SW_SEG_VER + url, dur); } } catch {}
    }
    // Échec mémorisé : null (héritage = définitif) ou {f:ts} (nouveau = TTL). Après 6 h on RETENTE
    // → les rapports figés en rendu brut par une panne (l'incident) se réparent tout seuls.
    if (seg === null) seg = undefined;
    else if (seg && typeof seg === 'object' && seg.f) seg = (Date.now() - seg.f > 6 * 3600 * 1000) ? undefined : null;
    if (seg === undefined && aiAllowed('analyst', { priority: 'user' })) {   // tier user : à l'ouverture, jamais freiné par les heures calmes
      seg = await _aiInflight('swseg:' + SW_SEG_VER + url, async () => {     // coalescing : ouvertures simultanées → 1 seule génération
        let s;
        try { s = await _segmentWrapAI(points); aiNote('analyst'); }
        catch (e) { console.warn('[SW seg AI]', e.message); s = null; }
        _swSegCache.set(SW_SEG_VER + url, s || { f: Date.now() });           // échec → marqueur daté (retry 6 h), plus de null permanent
        if (s) { _saveJsonMap(SW_SEG_FILE, _swSegCache); auth.aiCacheSet('swseg:' + SW_SEG_VER + url, s).catch(() => {}); }   // persiste (disque + Supabase durable)
        return s;
      });
    }
    if (seg && typeof seg === 'object') seg = null;   // marqueur d'échec → rendu brut pour cette requête
    if (seg) {
      if (cached) cached.content = seg;
      return res.json({ html: _stripSource(seg), source: 'ai' });
    }
  }

  // ── 1.55 REPLI STRUCTURANT DÉTERMINISTE (0 token) — MÊME STRUCTURE POUR TOUS LES RAPPORTS ──
  // Si la segmentation IA n'est pas (encore) disponible (quota, échec, rapport tout frais), on
  // construit les MÊMES rubriques <strong>SECTION</strong><ul>…</ul> à partir des points extraits :
  // en-têtes MAJUSCULES détectés tels quels, et tout ce qui précède le 1er en-tête sous « HEADLINES ».
  // → le viewer rend TOUJOURS la structure DTP (titres orange + puces), plus jamais une puce brute.
  // NON persisté dans le cache de segmentation → l'IA peaufinera au retry (6 h) et remplacera.
  if (points && points.length >= 3) {
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const isHead = t => t.length >= 2 && t.length <= 52 && t === t.toUpperCase() && /[A-Z]/.test(t) && /^[A-Z0-9][A-Z0-9 &:/'.\-]+$/.test(t);
    const isGeneric = t => /^(HEADLINES?|NEWS|TOP STORIES|LATEST|MARKET NEWS|OTHER)$/i.test(t.replace(/[:.]\s*$/, '').trim());
    const SKIP = /investinglive\.com|read more|see all|view all/i;
    const secs = []; let curSec = null; const auto = {};
    const getAuto = c => (auto[c] || (auto[c] = { section: c, items: [] }));
    for (const p of points) {
      const t = String(p).replace(/\s+/g, ' ').trim();
      if (!t || SKIP.test(t)) continue;
      if (isGeneric(t)) { curSec = null; continue; }                         // en-tête générique « HEADLINES » → on catégorise au lieu de tout empiler dessous
      if (isHead(t)) { curSec = { section: t, items: [] }; secs.push(curSec); continue; }
      const item = t.replace(/^headlines?\s*:\s*/i, '').trim();   // retire le boilerplate « Headlines: »
      if (!item) continue;
      if (curSec) curSec.items.push(item);                                    // sous une VRAIE rubrique détectée à la source
      else getAuto(_catHeadline(item)).items.push(item);                      // sinon → catégorisation 0-token par mot-clé
    }
    _CAT_ORDER.forEach(c => { if (auto[c] && auto[c].items.length) secs.push(auto[c]); });   // rubriques auto dans un ordre logique
    let autoHtml = '';
    for (const s2 of secs) { if (s2.items.length) autoHtml += `<strong>${esc(s2.section)}</strong><ul>${s2.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`; }
    if (autoHtml.length > 80) {
      console.log(`[SW seg] repli structurant catégorisé -> ${secs.length} section(s) (0 token)`);
      return res.json({ html: _stripSource(autoHtml), source: 'auto' });
    }
  }

  // ── 1.6 Sinon, HTML brut (RSS/HTTP) ──────────────────────────────────────────
  if (rawHtml && rawHtml.length > 100) {
    if (cached) cached.content = rawHtml;
    return res.json({ html: _stripSource(rawHtml), source: 'raw' });
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
      return res.json({ html: _stripSource(clean), source: 'puppeteer' });
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
  { url: 'https://blog.syzgroup.com/fast-food-for-thought/rss.xml', institution: 'Syz Group', source: 'syz', paged: false },   // Syz Group « Fast Food for Thought » (HubSpot RSS)
  // FXStreet et ActionForex retirés sur demande.
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
    const desc = $('description', el).text()
      .replace(/<[^>]*>/g, '')
      // retire les artefacts de flux : "The post … appeared first on …", "[…]", "Read more / Lire la suite"
      .replace(/the post\b[\s\S]*?appeared first on[\s\S]*$/i, '')
      .replace(/\[\s*(?:&#8230;|…|\.\.\.)\s*\][\s\S]*$/i, '')
      .replace(/\b(?:read more|continue reading|lire la suite(?: du rapport)?)\b[\s\S]*$/i, '')
      .replace(/&#8230;|…/g, '')
      .replace(/\s+/g, ' ').trim().slice(0, 400);
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

// MUFG Research (banque Mitsubishi UFJ) — pas de flux RSS : on scrape la page liste /fx/
// (cartes en HTML statique, AUCUN login). Le contenu de chaque article est récupéré à
// l'ouverture par /api/bank-research-content. Badge "MUFG".
const _MONTHS_RE = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
// AVANT : seul /fx/ était scrapé → on RATAIT tous les rapports macro/rates/credit (ex: "US Labor Update" en /macro/).
// MAINTENANT : on scrape les 4 catégories MUFG. La liste est paginée en JS (le HTTP ne voit que la page 1),
// donc on ajoute aussi une liste de rapports importants par URL directe (pour les anciens hors page 1).
const MUFG_CATS  = ['fx', 'macro', 'rates', 'credit'];
const MUFG_EXTRA = ['https://www.mufgresearch.com/macro/us-labor-update-may-8-2026/'];

function _mufgParseDate(slug) {
  let dm = slug.match(new RegExp('(\\d{1,2})-(' + _MONTHS_RE + ')[a-z]*-(\\d{4})', 'i'));   // DD-month-YYYY (ex: 18-may-2026)
  if (dm) { const d = new Date(`${dm[2]} ${dm[1]} ${dm[3]}`); if (!isNaN(d.getTime())) return d.getTime(); }
  dm = slug.match(new RegExp('(' + _MONTHS_RE + ')[a-z]*-(\\d{1,2})-(\\d{4})', 'i'));        // month-DD-YYYY (ex: may-8-2026)
  if (dm) { const d = new Date(`${dm[1]} ${dm[2]} ${dm[3]}`); if (!isNaN(d.getTime())) return d.getTime(); }
  return null;
}
function _mufgAdd(merged, seen, href, cat, cutoff) {
  href = (href || '').trim();
  if (!new RegExp('^/' + cat + '/[a-z]', 'i').test(href) || seen.has(href)) return;   // exclut /cat/ et la pagination /cat/?page=
  seen.add(href);
  const link = 'https://www.mufgresearch.com' + href;
  const slug = href.replace(new RegExp('^/' + cat + '/', 'i'), '').replace(/\/+$/, '');
  const ts = _mufgParseDate(slug) || Date.now();
  if (ts < cutoff) return;
  const title = slug
    .replace(new RegExp('-(\\d{1,2}-(?:' + _MONTHS_RE + ')[a-z]*|(?:' + _MONTHS_RE + ')[a-z]*-\\d{1,2})-\\d{4}$', 'i'), '')
    .replace(/-/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\b(Fx|Us|Usd|Eur|Jpy|Gbp|Cad|Aud|Nzd|Chf|Cny|Ai|Ecb|Boj|Fed|Cpi|Gdp|Em)\b/gi, m => m.toUpperCase());
  const id = 'br-' + Buffer.from(link).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(-16);
  if (merged.has(id)) return;
  merged.set(id, { id, title, url: link, timestamp: ts, categories: [cat.toUpperCase()], description: '', institution: 'MUFG', _source: 'mufg' });
}
async function _fetchMufgInto(merged, cutoff, UA) {
  const seen = new Set();
  for (const cat of MUFG_CATS) {
    try {
      const r = await axios.get('https://www.mufgresearch.com/' + cat + '/', {
        timeout: 12000, headers: { 'User-Agent': UA }, validateStatus: s => s < 500,
      });
      if (r.status !== 200) continue;
      const $ = cheerio.load(r.data);
      $('.card a[href^="/' + cat + '/"]').each((_, a) => _mufgAdd(merged, seen, $(a).attr('href'), cat, cutoff));
    } catch (e) { console.warn('[MUFG ' + cat + ']', e.message); }
  }
  // Rapports importants ajoutés à la main (hors page 1 statique de la liste).
  for (const url of MUFG_EXTRA) {
    try { const u = new URL(url); _mufgAdd(merged, seen, u.pathname, u.pathname.split('/')[1], cutoff); } catch {}
  }
}

// SEB Research (banque SEB) — SPA, mais on tape DIRECTEMENT son API JSON publique :
// mapi/v2/reports?language=English&assetclass=<FX|Central Banks|Macro>. Le filtre language=English
// ne renvoie QUE les rapports au titre anglais (exigence). Le corps (heading+text) est dans l'API
// → pas de Puppeteer, pas de PDF à parser. Badge "SEB".
const SEB_ASSET_CLASSES = ['FX', 'Central Banks', 'Macro'];
function _cleanSebText(heading, text) {
  let h = String(text || '').replace(/&nbsp;/gi, ' ');
  h = _stripSource(h);                                   // retire disclaimers / mentions résiduelles
  return ((heading ? `<h3>${heading}</h3>` : '') + h).replace(/\s{3,}/g, '\n').trim();
}
async function _fetchSebInto(merged, cutoff, UA) {
  for (const ac of SEB_ASSET_CLASSES) {
    try {
      const url = `https://research.sebgroup.com/mapi/v2/reports?nbrows=25&language=English&assetclass=${encodeURIComponent(ac)}&ingress=2000`;
      const r = await axios.get(url, { timeout: 12000, headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://research.sebgroup.com/macro-ficc' }, validateStatus: s => s < 500 });
      if (r.status !== 200 || !r.data || !Array.isArray(r.data.reports)) continue;
      for (const rep of r.data.reports) {
        const title = String(rep.title || '').trim();
        if (!title || !/[a-z]/i.test(title)) continue;
        // Sécurité "titre anglais" : on écarte les titres avec lettres nordiques (å, ä, ö, ø, æ).
        if (/[åäöøæ]/i.test(title)) continue;
        const ts = rep.publishedDate ? (new Date(rep.publishedDate).getTime() || Date.now()) : Date.now();
        if (ts < cutoff) continue;
        const link = `https://research.sebgroup.com/macro-ficc/reports/${rep.articleId}`;
        const id = 'br-' + Buffer.from('seb-' + rep.articleId).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(-16);
        // PDF natif SEB : l'API expose PARFOIS rep.attachment.fileName (PDF public). Sinon, l'endpoint
        // « Open as PDF » de SEB (api/puppeteer/mficc/{id}) renvoie le VRAI PDF du rapport pour TOUS les
        // articles (vérifié : Content-Type application/pdf) → on l'utilise en repli pour que CHAQUE rapport
        // SEB s'affiche en PDF brut (et non en texte structuré). Proxifié via /api/pdf-proxy (sebgroup.com whitelisté).
        const _sebPdf = (rep.attachment && rep.attachment.fileExtension === 'pdf' && typeof rep.attachment.fileName === 'string' && /^https?:\/\//.test(rep.attachment.fileName))
          ? rep.attachment.fileName
          : `https://research.sebgroup.com/api/puppeteer/mficc/${rep.articleId}`;
        if (merged.has(id)) {   // déjà présent (autre asset class OU cache persistant) → on met juste _pdfUrl à jour
          const _ex = merged.get(id); if (_ex && _sebPdf && _ex._pdfUrl !== _sebPdf) _ex._pdfUrl = _sebPdf;
          continue;
        }
        const body = _cleanSebText(rep.heading, rep.text);
        if (body.replace(/<[^>]*>/g, '').trim().length < 60) continue;
        const desc = String(rep.ingress || rep.text || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
        merged.set(id, {
          id, title, url: link, timestamp: ts, _pdfUrl: _sebPdf,
          // displayTags de SEB = OBJETS → on extrait la chaîne (sinon « [object Object] » en tag).
          categories: (() => {
            const dt = Array.isArray(rep.displayTags) ? rep.displayTags.map(t => typeof t === 'string' ? t : (t && (t.name || t.tag || t.label || t.value || t.text || t.title)) || '').filter(Boolean) : [];
            const ac = Array.isArray(rep.assetClass) ? rep.assetClass.filter(x => typeof x === 'string') : (typeof rep.assetClass === 'string' ? [rep.assetClass] : []);
            return (dt.length ? dt : (ac.length ? ac : ['FX'])).slice(0, 6);
          })(),
          description: desc, institution: 'SEB', _source: 'seb',
          fullContent: body,   // contenu déjà fourni par l'API → affiché directement (aucun re-fetch)
        });
      }
    } catch (e) { console.warn('[SEB]', e.message); }
  }
}

// Scotiabank Economics — landing pages "Global Week Ahead" + "Global Outlook & Forecast Tables".
// HTML statique : la landing liste les posts (titre + date dans le slug), chaque post a le
// contenu complet (récupéré à l'ouverture). Badge "Scotia".
const SCOTIA_PAGES = [
  { url: 'https://www.scotiabank.com/ca/en/about/economics/economics-publications.global-week-ahead.html', kw: 'global-week-ahead', cat: 'Macro' },
  { url: 'https://www.scotiabank.com/ca/en/about/economics/economics-publications.global-outlook-and-forecast-tables.html', kw: 'forecast-tables', cat: 'Macro' },
];
async function _fetchScotiaInto(merged, cutoff, UA) {
  for (const page of SCOTIA_PAGES) {
    try {
      const r = await axios.get(page.url, { timeout: 12000, headers: { 'User-Agent': UA }, validateStatus: s => s < 500 });
      if (r.status !== 200) continue;
      const $ = cheerio.load(r.data);
      const seen = new Set(); const posts = [];
      $('a[href*="/post."]').each((_, a) => {
        const href = ($(a).attr('href') || '').trim();
        if (!/\/post\./i.test(href) || !new RegExp(page.kw, 'i').test(href)) return;
        const title = $(a).text().replace(/\s+/g, ' ').trim();
        if (!title || title.length < 10) return;
        const link = href.startsWith('http') ? href : 'https://www.scotiabank.com' + href;
        if (seen.has(link)) return; seen.add(link);
        // Date depuis le slug : "…week-ahead.may-22--2026.html" ou "…forecast-tables.2026.march-24--2026.html"
        let ts = Date.now();
        const dm = href.match(/\.([a-z]+)-(\d{1,2})-+(\d{4})\.html/i);
        if (dm) { const d = new Date(`${dm[1]} ${dm[2]} ${dm[3]}`); if (!isNaN(d.getTime())) ts = d.getTime(); }
        posts.push({ title, link, ts });
      });
      // Publications ESPACÉES (hebdo/trimestriel) → on garde les 6 plus récentes, SANS cutoff d'âge
      // (sinon les "forecast tables" — dernières datant de plusieurs semaines — seraient exclues).
      posts.sort((a, b) => b.ts - a.ts).slice(0, 6).forEach(p => {
        const id = 'br-' + Buffer.from(p.link).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(-16);
        if (merged.has(id)) return;
        merged.set(id, { id, title: p.title, url: p.link, timestamp: p.ts, categories: [page.cat], description: '', institution: 'Scotiabank', _source: 'scotia' });
      });
    } catch (e) { console.warn('[Scotia]', e.message); }
  }
}

// BlackRock Investment Institute — "Weekly market commentary" (PDF hebdo officiels).
// Page derrière Akamai (403 en HTTP) → découverte via Puppeteer (scrapers/blackrock.js, best-effort).
// On garde TOUJOURS un seed 2026 (liens PDF officiels vérifiés) pour le backfill, même si Akamai
// bloque. Chaque item = lien direct vers le VRAI PDF (ouvert/embarqué côté client, aucune extraction serveur).
const BLACKROCK_SEED = [
  'https://www.blackrock.com/us/individual/literature/market-commentary/weekly-investment-commentary-en-us-20260112-us-earnings-broadening-strength.pdf',
  'https://www.blackrock.com/us/individual/literature/market-commentary/weekly-investment-commentary-en-us-20260302-rethinking-long-term-investing.pdf',
  'https://www.blackrock.com/us/individual/literature/market-commentary/weekly-investment-commentary-en-us-20260309-gauging-the-mideast-supply-shock.pdf',
  'https://www.blackrock.com/us/individual/literature/market-commentary/weekly-investment-commentary-en-us-20260330-mideast-shock-fuels-investing-themes.pdf',
  'https://www.blackrock.com/us/individual/literature/market-commentary/weekly-investment-commentary-en-us-20260413-back-to-overweight-us-stocks.pdf',
  'https://www.blackrock.com/us/individual/literature/market-commentary/weekly-investment-commentary-en-us-20260504-earnings-strength-keeps-us-risk-on.pdf',
  'https://www.blackrock.com/us/individual/literature/market-commentary/weekly-investment-commentary-en-us-20260511-record-us-stocks-disconnect-or-not.pdf',
  'https://www.blackrock.com/us/individual/literature/market-commentary/weekly-investment-commentary-en-us-20260406-spotting-pockets-of-em-resilience.pdf',
  'https://www.blackrock.com/corporate/literature/market-commentary/weekly-investment-commentary-en-us-20260420-a-supercharged-ai-mega-force.pdf',
  'https://www.blackrock.com/us/individual/literature/market-commentary/weekly-investment-commentary-en-us-20260427-persistent-inflation-constrains-policy.pdf',
  'https://www.blackrock.com/corporate/literature/market-commentary/weekly-investment-commentary-en-us-20260518-upping-developed-stocks-strategically.pdf',
];
function _blackrockItemFromUrl(url) {
  const m = String(url || '').match(/weekly-investment-commentary-en-us-(\d{4})(\d{2})(\d{2})-([a-z0-9-]+)\.pdf/i);
  if (!m) return null;
  const ts = Date.parse(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`);
  if (isNaN(ts)) return null;
  const title = m[4].replace(/-/g, ' ').trim()
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\b(Us|Uk|Eu|Ai|Fx|Em|Esg|Ecb|Boj|Boe|Fed|Rba|Gdp|Cpi|Q1|Q2|Q3|Q4)\b/gi, x => x.toUpperCase());
  const id = 'br-' + Buffer.from('blackrock-' + m[1] + m[2] + m[3] + '-' + m[4]).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(-16);
  return { id, title, url: url.split('#')[0].split('?')[0], timestamp: ts, categories: ['Macro'], description: '', institution: 'BlackRock', _source: 'blackrock', _pdf: true };
}
async function _fetchBlackRockInto(merged) {
  // 1) Seed 2026 — toujours présent (0 fetch, garanti même si Akamai bloque le scrape).
  for (const u of BLACKROCK_SEED) { const it = _blackrockItemFromUrl(u); if (it && !merged.has(it.id)) merged.set(it.id, it); }
  // 2) Découverte temps réel des nouveaux PDF (Puppeteer best-effort, échec silencieux).
  try {
    const found = await scrapeBlackRock();
    for (const f of (found || [])) { const it = _blackrockItemFromUrl(f && f.url); if (it && !merged.has(it.id)) merged.set(it.id, it); }
  } catch (e) { console.warn('[BlackRock] découverte échec:', e.message); }
}

// Natixis (Morning Line FX) + Danske (recherche) — sites SPA, Puppeteer best-effort (scrapers/research-spa.js).
// Heuristique STRICTE → aucune pollution si bloqué/gated. Items = lien vers l'original (ouvert sur le site banque).
const RESEARCH_SPA_SITES = [
  { name: 'Natixis', institution: 'Natixis', source: 'natixis', host: 'natixis.com',
    url: 'https://www.research.natixis.com/Site/en/forex/latest-publications?type=MORNING_LINE',
    hrefRe: /natixis\.com\/(?:Site\/[a-z]{2}\/(?:latest-publications\/publication|publication|forex|fixed-income|economy|cross-asset)\/.+|articles\/.+)/i,
    seed: [
      { title: '2026: Entering a New Market Regime', url: 'https://home.cib.natixis.com/articles/2026-entering-a-new-market-regime', date: '2026-01-15' },
    ] },
  { name: 'Danske', institution: 'Danske', source: 'danske', host: 'danskebank.com',
    url: 'https://research.danskebank.com/research/',
    hrefRe: /danskebank\.com\/.*(?:\/link\/[a-z0-9]+\/\$file\/.+\.pdf|research\/article|\/article\/|articlekey|researchkey|insights\/\d{4}\/\d+|\/[0-9a-f]{8,})/i,
    seed: [
      { title: 'FX Forecast Update', url: 'https://research.danskebank.com/link/FXForecastUpdate170426/$file/FX%20ForecastUpdate_170426.pdf', date: '2026-04-17', pdf: true },
      { title: 'Weekly Focus', url: 'https://research.danskebank.com/link/WeeklyFocus060326/$file/Weekly%20Focus_060326.pdf', date: '2026-03-06', pdf: true },
      { title: 'Nordic Outlook (March 2026)', url: 'https://research.danskebank.com/link/NordicOutlook,March26/$file/Nordic%20Outlook,%20March%2026.pdf', date: '2026-03-04', pdf: true },
      { title: 'FX Forecast Update — USD to weather AI valuation woes', url: 'https://research.danskebank.com/link/FXForecastUpdate181125/$file/FX%20Forecast%20Update_181125.pdf', date: '2025-11-18', pdf: true },
    ] },
  { name: 'UniCredit', institution: 'UniCredit', source: 'unicredit', host: 'unicreditgroup.eu',
    url: 'https://www.unicreditgroup.eu/en/business/our-investment-insights.html',
    hrefRe: /unicreditgroup\.eu\/content\/dam\/unicreditgroup-eu\/documents\/en\/business\/OurInvestmentInsights\/[^"'\s]+\.pdf/i,
    seed: [
      { title: 'The Compass Checkpoint — dernière édition (Investment Institute)', url: 'https://www.unicreditgroup.eu/content/dam/unicreditgroup-eu/documents/en/business/OurInvestmentInsights/DEF_ENG_MO.pdf', date: '2026-04-21', pdf: true },
      { title: 'The Compass 2026: A Strategic Guide for Investors in a Year of Adjustment', url: 'https://www.unicreditgroup.eu/content/dam/unicreditgroup-eu/documents/en/business/OurInvestmentInsights/The-Compass-2026_English.pdf', date: '2025-12-04', pdf: true },
      { title: 'The Compass 2026 — Strategic Outlook (press release)', url: 'https://www.unicreditgroup.eu/en/press-media/press-releases/2025/december/unicredit-investment-institute-presents--the-compass-2026---a-st.html', date: '2025-12-04' },
      { title: 'The Investment Institute — The Compass Checkpoint, 16 July 2025', url: 'https://www.unicreditgroup.eu/content/dam/unicreditgroup-eu/documents/en/business/OurInvestmentInsights/DEF_ENG_MO_JUL25.pdf', date: '2025-07-16', pdf: true },
    ] },
  { name: 'Société Générale', institution: 'Societe Generale', source: 'socgen', host: 'societegenerale.com',
    url: 'https://wholesale.banking.societegenerale.com/en/news-insights/all-news-insights/tagfilter/cross-asset-research/',
    hrefRe: /societegenerale\.com\/(?:en\/news-insights\/.*news-details\/news\/[^"'?#\s]+\/|[^"'\s]*\.pdf)/i,
    seed: [
      { title: "Asia's 2026 Market Outlook: Resilience amid rotation", url: 'https://wholesale.banking.societegenerale.com/en/news-insights/all-news-insights/news-details/news/asias-2026-market-outlook-resilience-amid-rotation-1/', date: '2025-12-11' },
      { title: 'Structured Products in 2026: Redefining Control in Uncertain Markets', url: 'https://wholesale.banking.societegenerale.com/en/news-insights/all-news-insights/news-details/news/structured-products-in-2026-redefining-control-in-uncertain-markets/', date: '2025-12-08' },
      { title: 'Weekly Update — In 2026, governments will shape interest rates', url: 'https://www.privatebanking.societegenerale.com/en/insights/weekly-update-2026-will-the-governments-that-will-shape-the-interest-rates/', date: '2025-12-05', pdf: true },
      { title: 'The ECB can cut its rates further (SG Cross Asset Research)', url: 'https://wholesale.banking.societegenerale.com/en/news-insights/all-news-insights/news-details/news/the-ecb-can-cut-its-rates-further/', date: '2025-05-06' },
    ] },
  { name: 'CIBC', institution: 'CIBC', source: 'cibc', host: 'cibccm.com', jina: true, proxy: true,
    url: 'https://economics.cibccm.com/',
    hrefRe: /cibccm\.com\/cds\?(?:[^"'\s]*&)?(?:flag=E&)?id=[0-9a-f-]{8,}/i,
    seed: [
      { title: 'Economics — The Week Ahead (Mar 30 – Apr 3, 2026)', url: 'https://economics.cibccm.com/cds?id=d3922370-e2fa-4a54-9738-caadcdef12be&flag=E', date: '2026-03-27', pdf: true },
      { title: 'Economics — In Focus (March 2, 2026)', url: 'https://economics.cibccm.com/cds?id=e07b6277-f16e-4c01-889b-97a0c37210b0&flag=E', date: '2026-03-02', pdf: true },
      { title: 'Economics — Economic Flash! (February 27, 2026)', url: 'https://economics.cibccm.com/cds?id=73b0487c-2691-47dc-a05d-b540ddd20d76&flag=E', date: '2026-02-27', pdf: true },
      { title: 'Economics & FICC Strategy — Forecast Update Table (February 11, 2026)', url: 'https://economics.cibccm.com/cds?id=397aa355-2b74-4665-abb8-f63b2d4be59e&flag=E', date: '2026-02-11', pdf: true },
      { title: 'Economics — The Week Ahead (Feb 2 – 6, 2026)', url: 'https://economics.cibccm.com/cds?id=8b680879-2c84-4142-ac28-449cd08cbc9b&flag=E', date: '2026-02-02', pdf: true },
    ] },
  { name: 'Nordea', institution: 'Nordea', source: 'nordea', host: 'nordea.com',
    url: 'https://corporate.nordea.com/research/series/181/macro-markets-strategy',
    hrefRe: /nordea\.com\/article\/\d+\/.+/i,
    seed: [
      { title: 'Macro & Markets: The inflation shock may outlast the war', url: 'https://corporate.nordea.com/article/103780/macro-markets-the-inflation-shock-may-outlast-the-war', date: '2026-05-03' },
      { title: 'Macro & Markets Forecast Edition: from cuts to hikes', url: 'https://corporate.nordea.com/article/103467/macro-markets-forecast-edition-from-cuts-to-hikes', date: '2026-04-17' },
      { title: 'Macro & Markets forecast edition: Recent dollar strength may prove temporary', url: 'https://corporate.nordea.com/article/103088/macro-markets-forecast-edition-recent-dollar-strength-may-prove-temporary', date: '2026-03-13' },
      { title: 'Macro & Markets forecast edition: Central banks on hold', url: 'https://corporate.nordea.com/article/102801/macro-markets-forecast-edition-central-banks-on-hold', date: '2026-02-13' },
      { title: 'Macro & Markets: Warsh\'s way or the highway', url: 'https://corporate.nordea.com/article/102685/macro-markets-warshs-way-or-the-highway', date: '2026-02-05' },
    ] },
  { name: 'Lloyds Bank', institution: 'Lloyds Bank', source: 'lloyds', host: 'lloydsbank.com',
    url: 'https://www.lloydsbank.com/business/resource-centre/insight.html',
    hrefRe: /lloydsbank\.com\/business\/resource-centre\/insight\/[^"'\s]+\.html/i,   // insight UNIQUEMENT (corporate-banking = pages produit, pas des rapports)
    seed: [
      { title: 'Market Insights Weekly', url: 'https://www.lloydsbank.com/business/resource-centre/insight/market-insights-weekly.html', date: '2026-06-08' },
      { title: 'Business Barometer', url: 'https://www.lloydsbank.com/business/resource-centre/insight/business-barometer.html', date: '2026-06-01' },
      { title: 'UK Sector Tracker', url: 'https://www.lloydsbank.com/business/resource-centre/insight/uk-sector-tracker.html', date: '2026-05-28' },
    ] },
  { name: 'KBC', institution: 'KBC', source: 'kbc', host: 'kbc.com', jina: true,
    url: 'https://www.kbc.com/en/economics.html',
    hrefRe: /kbc\.com\/en\/economics\/publications\/[^"'\s]+\.html/i,
    seed: [
      { title: 'Rising energy prices are pulling climate action in two directions', url: 'https://www.kbc.com/en/economics/publications/hogere-energieprijzen-trekken-klimaatactie-in-twee-richtingen.html', date: '2026-06-02' },
      { title: 'Economic Perspectives May 2026', url: 'https://www.kbc.com/en/economics/publications/economic-perspectives-may-2026.html', date: '2026-05-22' },
      { title: 'The misery index revisited: what it tells us on the eve of yet another shock', url: 'https://www.kbc.com/en/economics/publications/the-misery-index-revisited.html', date: '2026-03-17' },
      { title: 'Economic Perspectives April 2026', url: 'https://www.kbc.com/en/economics/publications/economic-perspectives-april-2026.html', date: '2026-04-21' },
      { title: 'Economic Perspectives March 2026', url: 'https://www.kbc.com/en/economics/publications/economic-perspectives-march-2026.html', date: '2026-03-23' },
      { title: 'Economic Perspectives February 2026', url: 'https://www.kbc.com/en/economics/publications/economic-perspectives-february-2026.html', date: '2026-02-16' },
    ] },
  { name: 'Amundi', institution: 'Amundi', source: 'amundi', host: 'research-center.amundi.com',
    url: 'https://research-center.amundi.com/',
    hrefRe: /research-center\.amundi\.com\/article\/[^"'\s]+/i,
    seed: [
      { title: 'Global Investment Views — June 2026', url: 'https://research-center.amundi.com/article/global-investment-views-june-2026', date: '2026-06-04' },
      { title: 'Global Investment Views — May 2026', url: 'https://research-center.amundi.com/article/global-investment-views-may-2026', date: '2026-05-06' },
      { title: 'Cross Asset Investment Strategy — May 2026', url: 'https://research-center.amundi.com/article/cross-asset-investment-strategy-may-2026', date: '2026-05-05' },
      { title: 'Rethinking global diversification', url: 'https://research-center.amundi.com/article/rethinking-global-diversification', date: '2026-05-22' },
    ] },
  { name: 'Westpac', institution: 'Westpac', source: 'westpac', host: 'westpaciq.com.au',
    url: 'https://www.westpaciq.com.au/economics',
    hrefRe: /westpaciq\.com\.au\/(?:economics|markets|article|publications?|research)\/[^"'\s]+/i,
    seed: [
      { title: 'Australian Business Conditions and Confidence, May', url: 'https://www.westpaciq.com.au/economics/2026/06/australian-business-conditions-may-2026', date: '2026-06-09' },
      { title: 'Consumer Sentiment — Consumers still down in the dumps', url: 'https://www.westpaciq.com.au/economics/2026/06/matthew-csi-video-june-2026', date: '2026-06-10' },
      { title: 'Morning Report', url: 'https://www.westpaciq.com.au/economics/2026/06/Morning-report-10-Jun-2026', date: '2026-06-10' },
      { title: 'Around the Grounds — Markets', url: 'https://www.westpaciq.com.au/markets/2026/06/around-the-grounds-20260610', date: '2026-06-10' },
    ] },
  { name: 'QCAM', institution: 'QCAM', source: 'qcam', host: 'q-cam.com',
    url: 'https://q-cam.com/news-publications/',
    hrefRe: /q-cam\.com\/news_type\/[^"'\s]+/i,
    seed: [
      { title: 'QCAM Insight — Currency Update March 2026', url: 'https://q-cam.com/news_type/qcam-insight-currency-update-march-2026/', date: '2026-03-24' },
      { title: 'FX Now! The Week Ahead — An FX compass in Central Bank Weeks', url: 'https://q-cam.com/news_type/fx-now-the-week-ahead/', date: '2026-03-16' },
      { title: 'Temporary Shock or Game Changer?', url: 'https://q-cam.com/news_type/temporary-shock-or-game-changer/', date: '2026-03-05' },
      { title: 'Two-Way Volatility Risks — QCAM Monthly (January 2026)', url: 'https://q-cam.com/news_type/two-way-volatility-risks-qcam-monthly-january-2026/', date: '2026-01-08' },
    ] },
  { name: 'Goldman Sachs', institution: 'Goldman Sachs', source: 'goldman', host: 'goldmansachs.com',
    url: 'https://www.goldmansachs.com/insights/outlooks',
    hrefRe: /goldmansachs\.com\/(?:insights\/(?:articles|goldman-sachs-research|outlooks)\/|pdfs\/insights\/)[^"'\s]+/i,
    seed: [
      { title: 'Macro Outlook 2026: Sturdy Growth, Stagnant Jobs, Stable Prices', url: 'https://www.goldmansachs.com/insights/goldman-sachs-research/macro-outlook-2026-sturdy-growth-stagnant-jobs-stable-prices', date: '2025-11-18' },
      { title: 'Markets Outlook 2026: Some Like It Hot', url: 'https://www.goldmansachs.com/insights/goldman-sachs-research/markets-outlook-2026-some-like-it-hot', date: '2025-11-19' },
      { title: 'The Global Economy Is Forecast to Post "Sturdy" Growth of 2.8% in 2026', url: 'https://www.goldmansachs.com/insights/articles/the-global-economy-forecast-to-post-sturdy-growth-in-2026', date: '2025-11-18' },
      { title: 'Global Stocks Are Projected to Return 11% in the Next 12 Months', url: 'https://www.goldmansachs.com/insights/articles/global-stocks-are-projected-to-return-11-percent-in-next-12-months', date: '2025-11-20' },
      { title: 'Commodity Outlook 2026: Ride the Power Race and Supply Waves', url: 'https://www.goldmansachs.com/insights/goldman-sachs-research/commodity-outlook-2026-ride-the-power-race-and-supply-waves', date: '2025-11-21' },
      { title: 'Commodities Outlook 2026 (PDF)', url: 'https://www.goldmansachs.com/pdfs/insights/goldman-sachs-research/2026-outlooks/CommoditiesOutlook2026.pdf', date: '2025-11-21', pdf: true },
    ] },
];
// ── PROXY résidentiel optionnel (débloque les CDN qui filtrent l'IP datacenter du VPS, ex. CIBC) ──
// Configuré UNIQUEMENT via la variable d'env RESEARCH_PROXY_URL = http://user:pass@host:port
// (jamais en dur / jamais committé — même règle que les clés API). Absente → comportement inchangé.
// On parse une fois ; _proxyAxiosOpts() renvoie { proxy } pour axios, _proxyServerArg() l'arg Chrome.
let _RESEARCH_PROXY = null;
(function () {
  const u = process.env.RESEARCH_PROXY_URL;
  if (!u) return;
  try {
    const p = new URL(u);
    _RESEARCH_PROXY = {
      protocol: (p.protocol || 'http:').replace(':', ''),
      host: p.hostname,
      port: +p.port || (p.protocol === 'https:' ? 443 : 80),
      username: p.username ? decodeURIComponent(p.username) : '',
      password: p.password ? decodeURIComponent(p.password) : '',
    };
    console.log(`[Research] Proxy résidentiel actif (${_RESEARCH_PROXY.host}:${_RESEARCH_PROXY.port}) → sites proxy:true routés via proxy`);
  } catch (e) { console.warn('[Research] RESEARCH_PROXY_URL invalide (ignoré):', e.message); }
})();
function _proxyAxiosOpts() {
  if (!_RESEARCH_PROXY) return {};
  const { protocol, host, port, username, password } = _RESEARCH_PROXY;
  const proxy = { protocol, host, port };
  if (username) proxy.auth = { username, password };
  return { proxy };
}

async function _fetchResearchSpaInto(merged, cutoff) {
  for (const cfg of RESEARCH_SPA_SITES) {
    // Seeds = rapports réels connus (garantis, 0 fetch) → remplissent l'onglet même si le scrape est bloqué.
    for (const s of (cfg.seed || [])) {
      const ts = Date.parse(s.date + 'T12:00:00Z'); if (isNaN(ts)) continue;
      const id = 'br-' + Buffer.from(s.url).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(-16);
      if (merged.has(id)) continue;
      const it = { id, title: s.title, url: s.url, timestamp: ts, categories: ['Macro'], description: '', institution: cfg.institution, _source: cfg.source };
      if (s.pdf) it._pdf = true;
      merged.set(id, it);
    }
    // Découverte live (best-effort, échec silencieux)
    try {
      const pubs = await scrapeResearchSpa(cfg);
      for (const p of (pubs || [])) {
        if (!p || !p.url || (p.ts && p.ts < cutoff)) continue;
        const id = 'br-' + Buffer.from(p.url).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(-16);
        if (merged.has(id)) continue;
        merged.set(id, { id, title: p.title, url: p.url, timestamp: Math.min(p.ts || Date.now(), Date.now()), categories: ['Macro'], description: '', institution: cfg.institution, _source: cfg.source });
      }
    } catch (e) { console.warn(`[ResearchSPA ${cfg.source}] échec:`, e.message); }

    // Repli HTTP direct (axios+cheerio) — certains sites sont SERVER-RENDERED (ex. KBC) : leurs liens
    // d'articles sont déjà dans le HTML initial alors que Puppeteer headless est bloqué/sert une autre
    // page. On tente donc une extraction directe, en PLUS du scrape Puppeteer. Les sites anti-bot/SPA
    // renvoient 403 / 0 lien → no-op silencieux. Dédupliqué (mêmes IDs que seeds + Puppeteer).
    try {
      const r = await axios.get(cfg.url, { timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' }, validateStatus: s => s < 500 });
      if (r.status === 200 && typeof r.data === 'string') {
        const $ = cheerio.load(r.data); const _seen = new Set(); let _added = 0;
        $('a[href]').each((_, a) => {
          let href = ($(a).attr('href') || '').trim(); if (!href) return;
          try { href = new URL(href, cfg.url).href; } catch { return; }
          if (href.indexOf(cfg.host) < 0 || !cfg.hrefRe.test(href)) return;
          const key = href.split('#')[0];
          if (_seen.has(key)) return; _seen.add(key);
          const title = ($(a).text() || '').replace(/\s+/g, ' ').trim();
          if (title.length < 14 || title.length > 200 || title.split(/\s+/).length < 3) return;
          const id = 'br-' + Buffer.from(key).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(-16);
          if (merged.has(id)) return;
          const ts = Math.min(((_dateFromUrlBr && _dateFromUrlBr(key)) || Date.now()), Date.now());   // jamais de date future
          if (ts < cutoff) return;
          merged.set(id, { id, title, url: key, timestamp: ts, categories: ['Macro'], description: '', institution: cfg.institution, _source: cfg.source });
          _added++;
        });
        if (_added) console.log(`[ResearchHTTP ${cfg.source}] +${_added} lien(s) (server-rendered)`);
      }
    } catch {}

    // Repli PROXY RÉSIDENTIEL (sites cfg.proxy:true, ex. CIBC) — requête DIRECTE au site via le
    // proxy résidentiel : l'IP n'est plus celle du datacenter → le CDN ne bloque plus, on récupère
    // le vrai HTML et on en extrait les liens d'articles. N'agit QUE si RESEARCH_PROXY_URL est défini.
    if (cfg.proxy && _RESEARCH_PROXY) {
      try {
        const r = await axios.get(cfg.url, {
          timeout: 20000,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' },
          validateStatus: s => s < 500,
          ..._proxyAxiosOpts(),
        });
        if (r.status === 200 && typeof r.data === 'string') {
          const $ = cheerio.load(r.data); const _seen = new Set(); let _added = 0;
          $('a[href]').each((_, a) => {
            let href = ($(a).attr('href') || '').trim(); if (!href) return;
            try { href = new URL(href, cfg.url).href; } catch { return; }
            if (href.indexOf(cfg.host) < 0 || !cfg.hrefRe.test(href)) return;
            const key = href.split('#')[0];
            if (_seen.has(key)) return; _seen.add(key);
            const title = ($(a).text() || '').replace(/\s+/g, ' ').trim();
            if (title.length < 14 || title.length > 200 || title.split(/\s+/).length < 3) return;
            const id = 'br-' + Buffer.from(key).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(-16);
            if (merged.has(id)) return;
            const ts = Math.min(((_dateFromUrlBr && _dateFromUrlBr(key)) || Date.now()), Date.now());
            if (ts < cutoff) return;
            merged.set(id, { id, title, url: key, timestamp: ts, categories: ['Macro'], description: '', institution: cfg.institution, _source: cfg.source });
            _added++;
          });
          console.log(`[ResearchPROXY ${cfg.source}] HTTP ${r.status} → +${_added} lien(s) (via proxy résidentiel)`);
        } else {
          console.log(`[ResearchPROXY ${cfg.source}] HTTP ${r.status} (le proxy n'a pas débloqué — vérifier le proxy)`);
        }
      } catch (e) { console.warn(`[ResearchPROXY ${cfg.source}] échec:`, e.message); }
    }

    // Repli LECTEUR (r.jina.ai) — CIBC/KBC : leur CDN bloque l'IP datacenter du VPS (403 en direct
    // ET en headless). Le lecteur public r.jina.ai rend la page (JS compris) depuis SON infra et
    // renvoie du markdown ; on en extrait les liens [titre](url) matchant le pattern de la banque.
    // Ciblé (flag jina:true sur la config), best-effort, silencieux en échec.
    if (cfg.jina) {
      try {
        const jr = await axios.get('https://r.jina.ai/' + cfg.url, {
          timeout: 25000,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          validateStatus: s => s < 500,
        });
        if (jr.status === 200 && typeof jr.data === 'string') {
          const md = jr.data; const _seen = new Set(); let _added = 0;
          const reMd = /\[([^\]]{14,200})\]\((https?:[^)\s]+)\)/g; let mm;
          while ((mm = reMd.exec(md))) {
            const title = mm[1].replace(/\s+/g, ' ').trim();
            const href  = mm[2];
            if (href.indexOf(cfg.host) < 0 || !cfg.hrefRe.test(href)) continue;
            const key = href.split('#')[0];
            if (_seen.has(key)) continue; _seen.add(key);
            if (title.split(/\s+/).length < 3) continue;
            const id = 'br-' + Buffer.from(key).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(-16);
            if (merged.has(id)) continue;
            const ts = Math.min(((_dateFromUrlBr && _dateFromUrlBr(key)) || Date.now()), Date.now());
            if (ts < cutoff) continue;
            merged.set(id, { id, title: title.slice(0, 160), url: key, timestamp: ts, categories: ['Macro'], description: '', institution: cfg.institution, _source: cfg.source });
            _added++;
          }
          if (_added) console.log(`[ResearchJINA ${cfg.source}] +${_added} lien(s) (via lecteur)`);
        }
      } catch {}
    }
  }
}

// Wells Fargo — CIB Economics. Page en HTML SERVEUR (pas de SPA/anti-bot) → scrape direct axios+cheerio
// des liens "bluematrix.com/docs/html/<uuid>.html". Les UUID sont des pointeurs STABLES vers la DERNIÈRE
// version de chaque rapport → on les seed (toujours à jour, timestamp=now) + on scrape pour en découvrir d'autres.
const WELLS_REPORTS = [
  { t: 'Weekly Economic & Financial Commentary', u: 'https://wellsfargo.bluematrix.com/docs/html/a5739dfc-1156-4c35-90f9-d20a060ff19a.html' },
  { t: 'U.S. Economic Outlook',                  u: 'https://wellsfargo.bluematrix.com/docs/html/821dcc50-5a10-4396-b646-5fe7118b76e5.html' },
  { t: 'International Economic Outlook',          u: 'https://wellsfargo.bluematrix.com/docs/html/b5b3c955-d0d5-4790-87fd-3aa28403ad96.html' },
  { t: 'U.S. Economic Forecast',                 u: 'https://wellsfargo.bluematrix.com/docs/html/88d2eafa-3a64-4cca-b013-4093132d9c99.html' },
  { t: 'International Economic Forecast',         u: 'https://wellsfargo.bluematrix.com/docs/html/5a40089f-bd2f-46bb-bf5e-afff22061029.html' },
];
async function _fetchWellsInto(merged, UA) {
  const now = Date.now();
  WELLS_REPORTS.forEach((r, i) => {
    const id = 'br-' + Buffer.from(r.u).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(-16);
    if (!merged.has(id)) merged.set(id, { id, title: r.t, url: r.u, timestamp: now - i * 3600000, categories: ['Macro'], description: '', institution: 'Wells Fargo', _source: 'wells' });
  });
  try {
    const res = await axios.get('https://www.wellsfargo.com/cib/insights/economics/', { timeout: 12000, headers: { 'User-Agent': UA }, validateStatus: s => s < 500 });
    if (res.status === 200) {
      const $ = cheerio.load(res.data);
      $('a[href*="bluematrix.com/docs/html"]').each((_, a) => {
        let href = ($(a).attr('href') || '').trim();
        if (href.startsWith('//')) href = 'https:' + href;
        if (!/^https?:\/\//.test(href)) return;
        href = href.split('#')[0];
        const title = ($(a).text() || '').replace(/\s+/g, ' ').trim();
        if (title.length < 6) return;
        const id = 'br-' + Buffer.from(href).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(-16);
        if (!merged.has(id)) merged.set(id, { id, title: title.slice(0, 120), url: href, timestamp: Date.now(), categories: ['Macro'], description: '', institution: 'Wells Fargo', _source: 'wells' });
      });
    }
  } catch (e) { console.warn('[Wells] scrape échec:', e.message); }
}

// HSBC — Wealth Insights (Singapour). Page en HTML SERVEUR (non bloquée, pas de login) → scrape direct
// axios+cheerio des articles "/wealth/insights/<cat>/<sous-cat>/<slug>/" + seed des derniers connus (datés).
const HSBC_BASE = 'https://www.hsbc.com.sg';
const HSBC_SEED = [
  { t: 'FX Viewpoint: GBP — Resilient, but two key risks', u: '/wealth/insights/fx-insights/fx-viewpoint/gbp-resilient-but-two-key-risks/', d: '2026-05-19' },
  { t: 'FX Viewpoint: "Risk-on" rally, but questions remain', u: '/wealth/insights/fx-insights/fx-viewpoint/risk-on-rally-but-questions-remain/', d: '2026-05-11' },
  { t: 'FX Viewpoint Flash: JPY — FX Intervention?', u: '/wealth/insights/fx-insights/fx-viewpoint/jpy-fx-intervention/', d: '2026-05-05' },
  { t: 'Investment Outlook: HSBC Perspectives Q3 2026', u: '/wealth/insights/market-outlook/investment-outlook/the-new-investment-trifecta-ai-energy-and-defence/', d: '2026-05-21' },
  { t: 'Trump-Xi summit – managed rivalry helps stabilise expectations', u: '/wealth/insights/market-outlook/special-coverage/trump-xi-summit-managed-rivalry-helps-stabilise-expectations/', d: '2026-05-18' },
  { t: 'Fed holds firm as inflation and uncertainty persist', u: '/wealth/insights/market-outlook/special-coverage/fed-holds-firm-as-inflation-and-uncertainty-persist/', d: '2026-04-30' },
  { t: 'Investment Monthly: A bullish outlook still requires strategic diversification', u: '/wealth/insights/asset-class-views/investment-monthly/a-bullish-outlook-still-requires-strategic-diversification/', d: '2026-01-09' },
];
async function _fetchHsbcInto(merged, UA) {
  HSBC_SEED.forEach(s => {
    const url = HSBC_BASE + s.u;
    const ts = Date.parse(s.d + 'T12:00:00Z'); if (isNaN(ts)) return;
    const id = 'br-' + Buffer.from(url).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(-16);
    if (!merged.has(id)) merged.set(id, { id, title: s.t, url, timestamp: ts, categories: ['Macro'], description: '', institution: 'HSBC', _source: 'hsbc' });
  });
  try {
    const res = await axios.get(HSBC_BASE + '/wealth/insights/', { timeout: 12000, headers: { 'User-Agent': UA }, validateStatus: s => s < 500 });
    if (res.status === 200) {
      const $ = cheerio.load(res.data);
      const seen = new Set();
      $('a[href*="/wealth/insights/"]').each((_, a) => {
        let href = ($(a).attr('href') || '').trim().split('#')[0].split('?')[0];
        if (!href.startsWith('http')) href = HSBC_BASE + (href.startsWith('/') ? href : '/' + href);
        const segs = href.replace(/^https?:\/\/[^/]+/, '').split('/').filter(Boolean);
        if (segs.length < 4) return;   // article = cat/sous-cat/slug (≥4 segments) ; on écarte les pages catégories
        const title = ($(a).text() || '').replace(/\s+/g, ' ').trim();
        if (title.length < 12 || title.length > 160 || seen.has(href)) return; seen.add(href);
        const id = 'br-' + Buffer.from(href).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(-16);
        if (!merged.has(id)) merged.set(id, { id, title: title.slice(0, 120), url: href, timestamp: Date.now(), categories: ['Macro'], description: '', institution: 'HSBC', _source: 'hsbc' });
      });
    }
  } catch (e) { console.warn('[HSBC] scrape échec:', e.message); }
}

// ── Filtre de pertinence Institution (vision du terminal : macro / FX / taux / commodities) ──
// Écarte le BRUIT que les scrapers ramènent inévitablement : liens de navigation et pages produit,
// communication corporate (récompenses, communiqués, événements, dons, interviews), marketing ESG,
// gestion de patrimoine, ancres génériques (« Read the article »), et archives périmées (titre
// finissant par une année ≤ 2024). Les vrais rapports macro/FX ne matchent aucun de ces motifs.
const _BR_NOISE = new RegExp([
  // ancres génériques / navigation / pages produit (pas des rapports)
  '^read the article$', '^listen to the podcast$', '^click here', '^download here',
  'product terms', 'terms (&|and) conditions', 'commercial banking online', 'payment solutions',
  'open account platform', 'liquidity and accounts', 'charities and not-for-profit',
  '^consumer & technology$', '^infrastructure, energy & industrials$', '^real estate and housing$',
  '^sustainable finance & transition$',
  // communication corporate / RP (hors recherche)
  'press release', 'shortlisted', 'award', 'happy holidays', 'donation', 'invited to',
  'fund launch', 'launches with', 'marks one year', 'featured on', 'interview (on|with)',
  'strengthens presence', 'supported women', 'investors day', 'fintech forum', 'event with',
  // marketing ESG / gestion de patrimoine (hors vision macro/FX)
  'why esg matters', 'esg research', 'road to esg', 'esg integration', 'esg lens', 'esg thema',
  'hub for all esg', '^esg\\b', 'positive impact finance',
  'legacy planning', 'premier elite', 'affluent investor',
].join('|'), 'i');
const _BR_STALE_YEAR = /\b(20[01][0-9]|202[0-4])\s*$/;   // titre finissant par une année ≤ 2024 = archive
function _brIsNoise(t) { t = String(t || '').trim(); return !t || _BR_NOISE.test(t) || _BR_STALE_YEAR.test(t); }

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

  // MUFG (scrape HTML, pas de RSS) — fusionné dans le même cache
  await _fetchMufgInto(merged, cutoff, UA);
  // SEB (API JSON publique, titres anglais uniquement) — fusionné dans le même cache
  await _fetchSebInto(merged, cutoff, UA);
  // Scotiabank Economics (HTML statique) — fusionné dans le même cache
  await _fetchScotiaInto(merged, cutoff, UA);
  // BlackRock Investment Institute (PDF hebdo) — seed 2026 garanti + découverte Puppeteer best-effort
  await _fetchBlackRockInto(merged);
  // Natixis (Morning Line) + Danske + UniCredit — recherche sur sites SPA, Puppeteer best-effort (échec silencieux)
  await _fetchResearchSpaInto(merged, cutoff);
  // Wells Fargo — CIB Economics (HTML serveur, scrape direct + rapports phares seedés)
  await _fetchWellsInto(merged, UA);
  // HSBC — Wealth Insights (HTML serveur, scrape direct + derniers articles seedés)
  await _fetchHsbcInto(merged, UA);

  const before = _brCache.length;
  // BlackRock = on garde TOUT (backfill 2026 complet ; items légers, sans fullContent).
  // Les autres sources gardent les 180 plus récentes (cutoff d'âge, sauf Scotiabank, exempté).
  const _nowTs = Date.now();
  const _all  = [...merged.values()]
    .filter(i => i && !_brIsNoise(i.title))   // filtre de pertinence (vision macro/FX du terminal)
    .map(i => (i.timestamp > _nowTs) ? { ...i, timestamp: _nowTs } : i);   // jamais de rapport « daté dans le futur » (mauvais parsing d'URL)
  const _keepAll = i => ['blackrock', 'danske', 'natixis', 'unicredit', 'wells', 'socgen', 'hsbc', 'cibc', 'nordea', 'lloyds', 'kbc', 'amundi', 'westpac', 'qcam', 'goldman'].includes(i._source);   // sources manuelles/SPA : on garde TOUT (seeds + live), hors plafond d'âge
  const _bron = _all.filter(_keepAll);
  const _rest = _all.filter(i => !_keepAll(i))
    .filter(i => i.timestamp > cutoff || i._source === 'scotia')
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 260);   // plafond DUR (anti-OOM : chaque item peut porter un fullContent) — relevé 180→260
  _brCache = [..._bron, ..._rest].sort((a, b) => b.timestamp - a.timestamp);

  try { fs.writeFileSync(BR_CACHE_FILE, JSON.stringify(_brCache)); } catch {}
  _persistHistory('bank_research', _brCache);   // persistance durable (Supabase, rétention 1 mois)
  console.log(`[BankResearch] ${_brCache.length} articles (was ${before}) — ${full ? 'full 30d' : 'quick'} refresh`);
}

// ═══ Convera "Daily Market Updates" → injectés dans le FEED NEWS en [MARKET UPDATE] ═══
// Flux RSS WordPress (content:encoded = rapport complet AVEC images). On nettoie (source
// retirée, images résolues), on préfixe le titre, on tague "Analysis" et on stocke le
// rapport complet (item.fullContent) affiché directement à l'ouverture.
const CONVERA_FEED = 'https://convera.com/blog/topic/market-insights/fx-research/daily-market-updates/feed/';
let _converaFetchedAt = 0;
function _cleanConveraHtml(html) {
  let h = String(html || '').replace(/^<!\[CDATA\[|\]\]>$/g, '');
  const $ = cheerio.load(`<div id="_cv">${h}</div>`);
  // bruit + tout ce qui référence la source
  $('#_cv script, #_cv style, #_cv iframe, #_cv form, [class*="share"], [class*="social"], [class*="related"], [class*="subscribe"], [class*="newsletter"], [class*="author"], [class*="cta"], [class*="wp-block-buttons"]').remove();
  // images lazy → src réel
  $('#_cv img').each((_, img) => {
    const $i = $(img);
    const real = $i.attr('data-src') || $i.attr('data-lazy-src') || $i.attr('src') || '';
    if (real) $i.attr('src', real);
    $i.removeAttr('data-src').removeAttr('data-lazy-src').removeAttr('srcset').removeAttr('loading');
    const s = $i.attr('src') || '';
    if (!s || /^data:|placeholder|spacer/i.test(s)) $i.remove();
  });
  // retire liens/mentions de la source Convera + "the post … appeared first on"
  $('#_cv a').each((_, a) => { if (/convera/i.test($(a).attr('href') || '')) $(a).replaceWith($(a).text()); });
  let out = ($('#_cv').html() || '');
  out = out
    .replace(/<p[^>]*>\s*the post[\s\S]*?appeared first on[\s\S]*?<\/p>/gi, '')
    .replace(/the post\b[^<]*?appeared first on[^<]*?\.?/gi, '')
    .replace(/(?:read more|continue reading)\b[^<]*/gi, '')
    // Attribution VISIBLE seulement (jamais dans les URLs d'images) : "Source: Convera", "© Convera"…
    .replace(/(?:source|written by|©|copyright)\s*:?\s*convera[^<.]*\.?/gi, '')
    // Pied de page Convera : "Have a question? Ask…@convera.com" + disclaimer "*The (FX) rates published…"
    .replace(/<p[^>]*>\s*have a question\?[\s\S]*?<\/p>/gi, '')
    .replace(/have a question\?[^<]*@[^<\s]+/gi, '')
    .replace(/<p[^>]*>\s*\*?\s*the (?:fx )?rates published[\s\S]*?<\/p>/gi, '')
    .replace(/\*?\s*the (?:fx )?rates published by[\s\S]*?(?:financial offer|other sites)[^<.]*\.?/gi, '')
    .replace(/<p[^>]*>\s*\*[\s\S]*?(?:research purposes only|financial offer)[\s\S]*?<\/p>/gi, '')
    .replace(/ask\s*market\s*insights@convera\.com/gi, '')
    .trim();
  return out;
}
async function _fetchConveraUpdates() {
  _converaFetchedAt = Date.now();
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
  try {
    const r = await axios.get(CONVERA_FEED, { timeout: 12000, headers: { 'User-Agent': UA }, validateStatus: s => s < 500 });
    if (r.status !== 200) return;
    const cutoff = Date.now() - 10 * 24 * 60 * 60 * 1000;   // 10 jours
    const items = r.data.match(/<item>[\s\S]*?<\/item>/g) || [];
    const added = [];
    for (const it of items) {
      const title = ((it.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').replace(/^<!\[CDATA\[|\]\]>$/g, '').trim();
      const link  = ((it.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim();
      const pub   = ((it.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '').trim();
      const enc   = (it.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/) || [])[1] || '';
      if (!title) continue;
      const ts = pub ? (new Date(pub).getTime() || Date.now()) : Date.now();
      if (ts < cutoff) continue;
      const content = _cleanConveraHtml(enc);
      if (content.replace(/<[^>]*>/g, '').trim().length < 80) continue;   // pas de vrai contenu
      const id = 'mu-convera-' + Buffer.from(link || title).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(-14);
      const desc = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 280);
      added.push({
        id, headline: '[MARKET UPDATE] - ' + title, timestamp: ts,
        time: new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }),
        category: 'Market Analysis', source: '', priority: 'normal',
        tags: ['Analysis'], description: desc, fullContent: content, _marketUpdate: true,
      });
    }
    const have = new Set(allNews.map(i => i.id));
    const fresh = added.filter(i => !have.has(i.id));
    if (fresh.length) {
      allNews = [...fresh, ...allNews].sort((a, b) => b.timestamp - a.timestamp).slice(0, 2000);
      saveHistory();
      try { broadcast({ type: 'news_update', items: fresh, total: allNews.length }); } catch {}
      console.log(`[Convera] +${fresh.length} market update(s) injecté(s) dans le feed`);
    }
  } catch (e) { console.warn('[Convera]', e.message); }
}

// ═══ Persistance DURABLE des historiques scrappés (Supabase, rétention ~1 mois) ═══
// But : après un redémarrage Render (disque éphémère), RECHARGER les session wraps et
// la recherche institution depuis la BDD au lieu de tout re-scraper / re-solliciter l'IA.
// L'IA (segmentation, insights) reste en DERNIER RECOURS — ici on ne stocke que le scrap.
const HISTORY_KEEP_MS = 31 * 24 * 60 * 60 * 1000;   // ~1 mois
function _histPrune(arr) { const min = Date.now() - HISTORY_KEEP_MS; return (arr || []).filter(i => i && (i.timestamp || 0) >= min); }
let _histSaveTimers = {};
function _persistHistory(key, arr) {
  // débattu (max 1 écriture / 5 s par clé) pour ne pas marteler la BDD
  clearTimeout(_histSaveTimers[key]);
  _histSaveTimers[key] = setTimeout(() => {
    const cap = key === 'bank_research' ? 500 : 120;   // assez large pour restaurer TOUT le feed après un redémarrage (sinon affichage partiel « 100 of 100 »)
    // On NE persiste PAS le lourd `fullContent`/`content` (re-scrapé au démarrage) → payload BDD léger.
    const light = _histPrune(arr).slice(0, cap).map(({ fullContent, content, ...rest }) => rest);
    auth.aiCacheSet('hist:' + key, light).catch(() => {});
  }, 5000);
  if (_histSaveTimers[key].unref) _histSaveTimers[key].unref();
}
async function _loadPersistedHistories() {
  try {
    const sw = await auth.aiCacheGet('hist:session_wraps');
    if (Array.isArray(sw) && sw.length) {
      const have = new Set(_swCache.map(i => i.id));
      const add  = _histPrune(sw).filter(i => i && i.id && !have.has(i.id));
      if (add.length) { _swCache = [..._swCache, ...add].sort((a, b) => b.timestamp - a.timestamp); console.log(`[History] ${add.length} session wrap(s) rechargé(s) depuis la BDD (0 scrape)`); }
    }
  } catch (e) { console.warn('[History] reload wraps:', e.message); }
  try {
    const br = await auth.aiCacheGet('hist:bank_research');
    if (Array.isArray(br) && br.length) {
      const have = new Set(_brCache.map(i => i.id));
      const add  = _histPrune(br).filter(i => i && i.id && !have.has(i.id) && !_brIsNoise(i.title));   // le bruit déjà persisté ne revient pas
      if (add.length) { _brCache = [..._brCache, ...add].sort((a, b) => b.timestamp - a.timestamp); console.log(`[History] ${add.length} article(s) institution rechargé(s) depuis la BDD (0 scrape)`); }
    }
  } catch (e) { console.warn('[History] reload research:', e.message); }
}

app.get('/api/bank-research', (_req, res) => {
  _brCache.forEach(_cleanItemMd);   // titres sans markdown brut, même pour un JS en cache
  res.json(_brCache);
  // Résilience : si le cache est VIDE (ex. cold-start avant le 1er scrape) → on déclenche tout de
  // suite une récupération (et on recharge aussi depuis le stockage durable). Sinon refresh normal.
  if (_brCache.length === 0) {
    _fetchBankResearch(false).catch(() => {});
    _loadPersistedHistories().catch(() => {});   // recharge aussi depuis le stockage durable (Supabase)
  } else if (Date.now() - _brFetchedAt > 20 * 60 * 1000) {
    _fetchBankResearch(false).catch(() => {});
  }
});

// ── FX Daily (ING THINK) → rapport dédié dans l'onglet Analyst ───────────────
// On réutilise le flux ING déjà récupéré (_brCache) et on isole la série "FX Daily"
// (think.ing.com/market/fx/). Le reader Analyst gère déjà les items _source:'ing-think'.
app.get('/api/fx-daily', (_req, res) => {
  const items = _brCache
    .filter(i => i._source === 'ing-think' && /^\s*FX Daily\b/i.test(i.title || ''))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 30)
    .map(i => ({ ...i, _reportType: 'FX Daily' }));
  items.forEach(_cleanItemMd);   // titres sans markdown brut, même pour un JS en cache
  res.json(items);
  if (Date.now() - _brFetchedAt > 20 * 60 * 1000) _fetchBankResearch(false).catch(() => {});
});

// Retire les lignes d'attribution de source/auteur de tout HTML de rapport (aucune source affichée)
function _stripSource(html) {
  return _stripXmlNoise(html || '')
    // paragraphes entiers d'attribution (auteur, "by X", domaine source)
    .replace(/<p[^>]*>\s*(?:this article was written by|written by\b|by\s+[A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+){0,3}\s*$)[\s\S]*?<\/p>/gi, '')
    .replace(/<p[^>]*>[^<]*\bat\s+(?:investinglive|forexlive|think\.ing|fxstreet|actionforex)\.com[^<]*<\/p>/gi, '')
    // bloc auteur ING ("Author", "Senior … Economist", "Read more / Download / Disclaimer")
    .replace(/<p[^>]*>\s*(?:read (?:this )?article|download|disclaimer|content disclaimer|this publication)[\s\S]*?<\/p>/gi, '')
    // phrase d'attribution complète (hors balises), jusqu'au domaine source
    .replace(/(?:this article was written by|written by)\b[^<]*?\b(?:investinglive|forexlive|think\.ing|fxstreet|actionforex)\.com\.?/gi, '')
    .replace(/\bat\s+(?:investinglive|forexlive|think\.ing|fxstreet|actionforex)\.com\.?/gi, '')
    // en-tête "Authors" + titres de section auteur (ING) → retirés (aucun auteur affiché)
    .replace(/<(h[1-6])[^>]*>\s*authors?\s*<\/\1>/gi, '')
    .replace(/<p[^>]*>\s*authors?\s*<\/p>/gi, '')
    // crédits photo / "Source:" résiduels
    .replace(/<p[^>]*>\s*(?:source|photo|image)\s*:[\s\S]*?<\/p>/gi, '')
    // "The post … appeared first on …" (pied de page WordPress des flux ActionForex/FXStreet)
    .replace(/<p[^>]*>\s*the post[\s\S]*?appeared first on[\s\S]*?<\/p>/gi, '')
    .replace(/the post\b[^<]*?appeared first on[^<]*?(?:actionforex|fxstreet|forexlive)[^<]*\.?/gi, '')
    // liens / mentions "Read more / Continue reading / Lire la suite / Full report"
    .replace(/<a[^>]*>\s*(?:read more|continue reading|read the full[^<]*|full (?:report|article|story)|lire la suite[^<]*)\s*<\/a>/gi, '')
    .replace(/(?:read more|continue reading|lire la suite(?: du rapport)?|read the full (?:report|article|story))\s*(?:[»>→…]|\.\.\.)?/gi, '')
    // marqueurs de troncature "[…]" / "[&#8230;]" / "(...)"
    .replace(/\[\s*(?:&#8230;|…|\.\.\.)\s*\]/g, '')
    // ── Pied de page MUFG/Natixis : "For other … please download the PDF version attached
    //    at the top of this page" + liens "Disclaimer / Terms and Conditions" → retirés (le
    //    rapport complet est déjà dans le corps ; on ne garde QUE le rapport, propre).
    .replace(/<p[^>]*>\s*for other[\s\S]*?download the pdf[\s\S]*?<\/p>/gi, '')
    .replace(/for other (?:currenc(?:y|ies)|pages?|markets?)[^.<]*?(?:please )?download the pdf version[^.<]*\.?/gi, '')
    .replace(/(?:please )?download the (?:full )?pdf version[^.<]*(?:attached[^.<]*)?\.?/gi, '')
    .replace(/<a[^>]*>\s*(?:disclaimer|terms\s*(?:and|&)\s*conditions|terms of use|privacy policy|cookie policy)\s*<\/a>/gi, '')
    .replace(/\bdisclaimer\s+terms\s+(?:and|&)\s+conditions\b\.?/gi, '')
    .replace(/(?:\s|>)(?:disclaimer|terms\s+(?:and|&)\s+conditions|terms of use)\s*(?=<|\s*$)/gi, ' ')
    .trim();
}

// Markdown (lecteur r.jina.ai) → HTML simple pour AFFICHER le rapport tel quel. Retire les images
// markdown + la syntaxe de liens (garde le texte), découpe en titres / listes / paragraphes.
function _jinaMdToHtml(md) {
  const strip = s => String(s).replace(/[*_\x60]+/g, '').trim();
  return String(md || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')              // images markdown → retirées
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')            // liens → texte seul
    .split(/\n{2,}/).map(b => b.trim()).filter(Boolean)
    .map(b => {
      const h = b.match(/^#{1,4}\s+(.+)/);
      if (h) return '<h3>' + strip(h[1]) + '</h3>';
      if (/^\s*[-*+]\s+/.test(b)) {
        const items = b.split(/\n/).filter(l => /^\s*[-*+]\s+/.test(l))
          .map(l => '<li>' + strip(l.replace(/^\s*[-*+]\s+/, '')) + '</li>').join('');
        return '<ul>' + items + '</ul>';
      }
      return '<p>' + strip(b.replace(/\n/g, ' ')) + '</p>';
    }).join('\n');
}
// Déduplique un titre où la même longue phrase est répétée (scrape « PHRASE date PHRASE »).
function _dedupTitle(t) {
  t = String(t || '').replace(/\s+/g, ' ').trim();
  for (let len = Math.floor(t.length / 2); len >= 18; len--) {
    const pre = t.slice(0, len).trim();
    if (pre.length < 18) continue;
    const idx = t.indexOf(pre, pre.length);              // la même phrase réapparaît plus loin ?
    if (idx >= 0) return (pre + ' ' + t.slice(pre.length, idx)).replace(/\s+/g, ' ').trim();
  }
  return t;
}

const _BR_CONTENT_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(think\.ing\.com|mufgresearch\.com|scotiabank\.com|bluematrix\.com|hsbc\.com\.sg|syzgroup\.com|danskebank\.com|unicreditgroup\.eu|kbc\.com|corporate\.nordea\.com|economics\.cibccm\.com|research-center\.amundi\.com|q-cam\.com)\//i;
// Liste d'hôtes autorisée DÉRIVÉE des configs de sources (RESEARCH_SPA_SITES) + quelques hôtes statiques
// (SEB, etc.). But : ne plus jamais oublier une banque → toute source ajoutée est AUTOMATIQUEMENT
// extractible (Natixis, SocGen, Lloyds, Westpac, Goldman…). Le repli jina gère ensuite le contenu JS/anti-bot.
const _BR_ALLOW_HOSTS = (() => {
  const s = new Set(['sebgroup.com']);   // SEB (fournit aussi fullContent, mais on autorise par sécurité)
  try { for (const cfg of RESEARCH_SPA_SITES) { if (cfg && cfg.host) s.add(String(cfg.host).toLowerCase()); } } catch {}
  return [...s];
})();
// Autorisé si : (a) l'ancienne regex matche (sous-hôtes précis : think.ing.com, economics.cibccm.com…),
// OU (b) l'hôte == un host de source configuré, OU (c) en est un sous-domaine (suffixe « .host » strict,
// pour bloquer « evilwestpaciq.com.au »). HTTPS uniquement.
function _brContentAllowed(url) {
  if (!url || typeof url !== 'string') return false;
  if (_BR_CONTENT_HOSTS.test(url)) return true;
  let host;
  try { const u = new URL(url); if (u.protocol !== 'https:') return false; host = u.hostname.toLowerCase(); }
  catch { return false; }
  return _BR_ALLOW_HOSTS.some(h => host === h || host.endsWith('.' + h));
}
app.get('/api/bank-research-content', async (req, res) => {
  const { url } = req.query;
  if (!_brContentAllowed(url)) return res.json({ html: '' });
  // Déjà structuré (cache chaud) → réponse instantanée : on évite le re-fetch + le lecteur jina
  // (le front retombe sur item.description / dateStr pour le sous-titre et la date).
  try {
    const _hot = _brSegCache.get(BR_SEG_VER + url);
    if (_hot && typeof _hot === 'object' && _hot.thin) return res.json({ html: '', source: 'thin', pdfUrl: _hot.pdfUrl || '', subtitle: '', date: '', section: 'Research', country: '', articleType: 'Article' });   // page vitrine/teaser déjà détectée → on renvoie le vrai PDF (ou la carte), jamais un faux résumé
    if (typeof _hot === 'string' && _hot.length > 80) return res.json({ html: _stripSource(_hot), source: 'ai', renderUrl: _brRenderUrlFor(url, _brPrintMap.get(url)), subtitle: '', date: '', section: 'Research', country: '', articleType: 'Article' });
  } catch {}
  let _origin = 'https://think.ing.com';
  try { _origin = new URL(url).origin; } catch {}
  try {
    let r;
    try {
      r = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        validateStatus: () => true,
      });
    } catch (e) { r = { data: '' }; }   // fetch direct KO (timeout/DNS/reset) → on N'ABANDONNE PAS : extraction vide puis repli jina
    const $ = cheerio.load(r.data || '');

    // Lien vers le VRAI PDF du rapport (ING Think « download-link », ou tout /downloads/pdf/ ou .pdf)
    // → affiché TEL QUEL côté client (proxifié), SANS aucune restructuration IA.
    let _realPdf = '', _printUrl = '';
    try {
      const _dl = $('a[data-cy="download-link"]').attr('href')
               || $('a[href*="/downloads/pdf/"]').attr('href') || '';
      if (_dl) _realPdf = new URL(_dl, _origin).href;
      // Page imprimable (MUFG « PrintPage », variantes printview) → meilleure cible de rendu PDF que l'article
      const _pp = $('a[href*="/umbraco/surface/download/PrintPage/"]').attr('href')
               || $('a[href*="printview"]').attr('href') || '';
      if (_pp) _printUrl = new URL(_pp, _origin).href;
      // Goldman Sachs : la page /insights est une vitrine (mur cookie + bouton « Read the Report »).
      // Le VRAI rapport est sur gspublishing.com (public, propre) → on le rend LUI.
      if (/(^|\.)goldmansachs\.com$/i.test(new URL(url).hostname)) {
        const _gs = $('a[href*="gspublishing.com/content/research/"]').attr('href')
                 || $('a[data-addressable-id="read-the-report"]').attr('href') || '';
        if (_gs) _printUrl = new URL(_gs, _origin).href;
      }
      if (_printUrl) { try { _brPrintMap.set(url, _printUrl); _saveJsonMap(BR_PRINT_FILE, _brPrintMap); } catch {} }   // persiste (GUID/URL non dérivable)
      else { const _saved = _brPrintMap.get(url); if (typeof _saved === 'string' && _saved) _printUrl = _saved; }       // repli : URL imprimable déjà connue
    } catch {}

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
                  || (/think\.ing\.com/i.test(url) ? 'ING Think Research' : 'Research');

    // Extraire le pays/region tag (ING Think affiche ex: "FRANCE", "NETHERLANDS")
    const country = $('[class*="article-tag"], [class*="country"], [class*="region"], .tag-label')
                      .first().text().trim().toUpperCase()
                  || $('meta[property="article:tag"]').attr('content')?.toUpperCase()
                  || '';

    // Extraire le type d'article (Article, Analysis, Report…)
    const articleType = $('.article-type, [class*="article-type"], [class*="content-type"]').first().text().trim()
                      || $('meta[property="og:type"]').attr('content')
                      || 'Article';

    // Remove noise (garder les images et figures) — y compris boutons de partage / téléchargement,
    // modales et "quick links" (MUFG) qui salissent le rendu.
    $('script,style,nav,header,footer,iframe,form,.cookie-banner,'
      + '[class*="social"],[class*="related"],[class*="subscribe"],[class*="newsletter"],[class*="sidebar"],[class*="widget"],'
      + '[class*="share"],[id*="share"],[class*="sharethis"],[class*="addthis"],[class*="download"],'
      + '[class*="quick-link"],[class*="quick-links"],[class*="publication-modal"],[class*="pmc__"],[class*="breadcrumb"],'
      + '[class*="author"],[class*="contributor"],[class*="byline"],[rel="author"],[class*="profile-card"],[class*="bio"],'
      + '[class*="disclaimer"],[class*="cta"],[class*="signup"],[class*="paywall"],#comments').remove();

    // Retire les liens/boutons isolés "Share / Download / Print / PDF / Tweet / Email"
    $('a, button').each((_, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      if (/^(share|download|print|tweet|email|pdf|copy link|save|follow|subscribe)\b/i.test(t) && t.length < 24) $(el).remove();
    });

    // ── Résout les images LAZY-LOAD (WordPress/ActionForex : la vraie URL est dans data-src,
    // le src n'étant qu'un placeholder) → sinon image cassée. On normalise vers un src valide.
    $('img').each((_, img) => {
      const $i = $(img);
      const real = $i.attr('data-src') || $i.attr('data-lazy-src') || $i.attr('data-original')
                || ($i.attr('data-srcset') || '').trim().split(/\s+/)[0] || '';
      const cur = $i.attr('src') || '';
      // remplace si src manquant / placeholder (data:, blank, spacer…)
      if (real && (!cur || /^data:|blank|placeholder|spacer|lazy/i.test(cur))) $i.attr('src', real);
      $i.removeAttr('loading').removeAttr('data-src').removeAttr('data-lazy-src').removeAttr('data-original').removeAttr('srcset').removeAttr('data-srcset');
      const finalSrc = $i.attr('src') || '';
      if (!finalSrc || /^data:|blank|placeholder|spacer/i.test(finalSrc)) $i.remove();   // aucune image valide → on retire (pas de cassé)
    });

    // Extract body HTML (avec images) — inclut .blog-content (MUFG)
    // Scotiabank : le corps est réparti sur plusieurs composants cmp-text/c--body → on les concatène.
    let body = '';
    if (/scotiabank\.com/i.test(url)) {
      body = $('[class*="cmp-text"], [class*="c--body"]').map((_, el) => $(el).html()).get().join('\n');
    }
    body = body
      || $('.blog-content, [class*="blog-content"], [class*="article-body"], [class*="article__body"], [class*="article-content"], [class*="post-content"], .content-body, article .content, .entry-content, .wysiwyg, .rich-text').first().html()
      || $('main article').first().html()
      || $('main').first().html()
      || $('article').first().html()
      || $('[role="main"]').first().html()
      || $('body').html()   // dernier recours : tout le body (déjà nettoyé des scripts/nav/footer/partage) → garantit un contenu PDF-isable
      || '';

    // Corriger les URLs relatives des images → absolues (selon l'hôte réel de l'article)
    let clean = body
      .replace(/src="\/([^"]*)"/g, `src="${_origin}/$1"`)
      .replace(/srcset="\/([^"]*)"/g, `srcset="${_origin}/$1"`)
      .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')   // SVG déco uniquement
      .replace(/\s{3,}/g, '\n')
      .trim();

    // ── Repli LECTEUR r.jina.ai : si l'extraction directe est trop maigre (KBC/Goldman/CIBC : page
    //    rendue en JS côté client OU anti-bot → cheerio ne voit qu'un shell vide), on récupère le
    //    TEXTE RÉEL via le lecteur public (qui rend le JS depuis son infra) → le rapport s'affiche
    //    pour de vrai (fini la carte « protégé »). Best-effort, silencieux en cas d'échec.
    const _plainLen = clean.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().length;
    if (_plainLen < 300) {
      try {
        const jr = await axios.get('https://r.jina.ai/' + url, {
          timeout: 25000,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          validateStatus: s => s < 500,
        });
        if (jr.status === 200 && typeof jr.data === 'string') {
          let md = jr.data;
          const mc = md.indexOf('Markdown Content:');                 // en-tête ajouté par le lecteur
          if (mc >= 0) md = md.slice(mc + 'Markdown Content:'.length);
          const jhtml = _jinaMdToHtml(md.trim());
          if (jhtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().length > _plainLen + 200) clean = jhtml;
        }
      } catch {}
    }

    // Format date nicely
    let dateFormatted = '';
    if (pubDate) {
      try {
        dateFormatted = new Date(pubDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
      } catch { dateFormatted = pubDate; }
    }

    // ── GARDE ANTI « PAGE VITRINE / TEASER » (fix QCAM FX Quick Sheets, généralisé) ──
    // Certaines pages ne sont PAS l'article : juste une accroche marketing (CTA « Subscribe »)
    // avec le VRAI rapport en PDF téléchargeable. Avant : le texte promo (>220 car) passait à l'IA
    // qui le réorganisait en un FAUX rapport (« OVERVIEW / PUBLICATIONS »). Désormais :
    //  • texte réel trop maigre (<350)  → on NE fabrique RIEN ;
    //  • OU page d'accroche (signature teaser) AVEC un PDF intégré → on renvoie le VRAI PDF.
    // Le front affiche alors le PDF natif (ou la carte « ouvrir l'original »), jamais un résumé inventé.
    let _embeddedPdf = '';
    try { const _pm = String(r.data || '').match(/href=["']([^"'\s]+\.pdf)(?:["'?#]|$)/i); if (_pm) _embeddedPdf = new URL(_pm[1], _origin).href; } catch {}
    const _plainTxt  = clean.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const _teaserSig = /subscribe\s+(now|to)\b|receive it (each|at the start)|delivered to you|sign\s*up\b|provided for free|download (the )?(full |complete )?(report|pdf|publication)/i.test(_plainTxt);
    if (_plainTxt.length < 350 || (_embeddedPdf && _plainTxt.length < 2000 && _teaserSig)) {
      try { _brSegCache.set(BR_SEG_VER + url, { f: Date.now(), thin: true, pdfUrl: _embeddedPdf }); } catch {}   // marqueur : ne pas re-générer ; précache 'cooling'
      return res.json({ html: '', source: 'thin', pdfUrl: _embeddedPdf, subtitle, date: dateFormatted, section, country, articleType });
    }

    // ── Structuration IA en rubriques claires façon DTP (DailyFX/recherche en prose) ──
    //  Persistée (hot + Supabase durable), budget-aware (Gemini only) ; repli = HTML brut d'origine.
    let outHtml = clean, outSource = 'raw';
    try {
      const key = BR_SEG_VER + url;
      let seg = _brSegCache.get(key);
      if (seg === undefined) {                                  // pas en cache chaud → tente le cache durable
        try { const dur = await auth.aiCacheGet('brseg:' + key); if (typeof dur === 'string' && dur.length > 80) { seg = dur; _brSegCache.set(key, dur); } } catch {}
      }
      // Échec mémorisé : null (héritage) ou {f:ts} → retry après 6 h (répare les articles figés en brut par une panne)
      if (seg === null) seg = undefined;
      else if (seg && typeof seg === 'object' && seg.f) seg = (Date.now() - seg.f > 6 * 3600 * 1000) ? undefined : null;
      if (seg === undefined && aiAllowed('analyst', { priority: 'user' })) {   // ni chaud ni durable → on génère (tier user : ouverture)
        const plain = clean
          .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]*>/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
        seg = await _aiInflight('brseg:' + key, async () => {   // coalescing : ouvertures simultanées → 1 seule génération
          let s;
          try { s = await _structureArticleAI(plain, subtitle || ''); aiNote('analyst'); }
          catch (e) { console.warn('[BR struct AI]', e.message); s = null; }
          _brSegCache.set(key, s || { f: Date.now() });         // échec → marqueur daté (retry 6 h), plus de null permanent
          if (s) { _saveJsonMap(BR_SEG_FILE, _brSegCache); auth.aiCacheSet('brseg:' + key, s).catch(() => {}); }
          return s;
        });
      }
      if (seg && typeof seg === 'object') seg = null;           // marqueur d'échec → rendu brut pour cette requête
      if (typeof seg === 'string' && seg.length > 80) { outHtml = seg; outSource = 'ai'; }
    } catch (e) { console.warn('[BR struct]', e.message); }

    res.json({ html: _stripSource(outHtml), source: outSource, pdfUrl: _realPdf, renderUrl: _brRenderUrlFor(url, _printUrl), subtitle, date: dateFormatted, section, country, articleType });
  } catch (e) {
    res.json({ html: '', error: e.message });
  }
});

// ─── Proxy PDF : ressert un PDF de banque distant DEPUIS le domaine DTP (même origine) ──────────
// Indispensable car certains PDF (ING Think…) renvoient X-Frame-Options: SAMEORIGIN et refusent
// d'être embarqués cross-origin. On affiche donc le PDF via ce proxy → iframe même-origine = OK.
// Whitelist STRICTE des hôtes (anti-SSRF / anti-open-proxy) + HTTPS only + vérif content-type=pdf.
const PDF_PROXY_HOSTS = /(^|\.)(think\.ing\.com|blackrock\.com|danskebank\.com|unicreditgroup\.eu|societegenerale\.com|cibccm\.com|goldmansachs\.com|sebgroup\.com)$/i;
app.get('/api/pdf-proxy', async (req, res) => {
  const u = String(req.query.url || '');
  let host = '';
  try { const p = new URL(u); if (p.protocol !== 'https:') return res.status(400).send('https only'); host = p.hostname.toLowerCase(); }
  catch { return res.status(400).send('bad url'); }
  if (!PDF_PROXY_HOSTS.test(host)) return res.status(403).send('host not allowed');
  try {
    const r = await axios.get(u, {
      responseType: 'arraybuffer',
      timeout: 25000,
      maxContentLength: 30 * 1024 * 1024,
      maxRedirects: 3,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/pdf,*/*' },
      validateStatus: s => s >= 200 && s < 400,
    });
    const ct = String(r.headers['content-type'] || '');
    if (!/pdf/i.test(ct)) return res.status(415).send('not a pdf');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(Buffer.from(r.data));
  } catch (e) { return res.status(502).send('pdf fetch failed'); }
});

// ─── Rendu HTML→PDF à la volée (rapports SANS PDF natif : MUFG…), mis en cache disque, whitelist stricte ──
app.get('/api/pdf-render', async (req, res) => {
  const u = String(req.query.url || '');
  let host = '';
  try { const p = new URL(u); if (p.protocol !== 'https:') return res.status(400).send('https only'); host = p.hostname.toLowerCase(); }
  catch { return res.status(400).send('bad url'); }
  if (!PDF_RENDER_HOSTS.test(host)) return res.status(403).send('host not allowed');
  const cacheFile = _renderCacheFile(u);
  try {
    const st = fs.statSync(cacheFile);
    if (Date.now() - st.mtimeMs < 30 * 24 * 3600 * 1000) {   // cache 30 j → pas de re-rendu
      res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'inline'); res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(cacheFile);
    }
  } catch {}
  try {
    const buf = await _renderPdf(u);
    if (!buf || buf.length < 1200 || buf.slice(0, 5).toString('latin1') !== '%PDF-') return res.status(502).send('render failed');
    try { fs.writeFileSync(cacheFile, buf); } catch {}
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'inline'); res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(buf);
  } catch (e) { console.warn('[pdf-render]', e.message); return res.status(502).send('render failed'); }
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
  // "force" = rafraîchissement EN ARRIÈRE-PLAN (on ne vide PAS le cache → on sert tout de
  // suite les données courantes, le nouveau jeu arrivera au prochain rafraîchissement client).
  if (force) refreshOutlookBg();
  try {
    const data = await fetchCommunityOutlook(period);   // instantané (cache) ; ne bloque qu'au tout 1er chargement
    const ts = (typeof outlookTs === 'function' && outlookTs()) || Date.now();
    res.json({ symbols: data, period, updatedAt: new Date(ts).toISOString(), updatedTs: ts });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/status', (_req, res) => res.json({
  total: allNews.length,
  lastUpdate: new Date().toISOString(),
  clients: wss.clients.size,
}));

// ─── AI Insights : 4-6 résumés clés d'un rapport (cartes en haut du rapport) ──
const INSIGHTS_FILE = path.join(_CACHE_DIR, 'cache_insights.json');
const _insightsCache = _loadJsonMap(INSIGHTS_FILE);   // persistant → pas de réappel Gemini à la réouverture
// Secours SANS IA : extrait des phrases clés du rapport → les cartes s'affichent toujours,
// même quand le quota Gemini est épuisé.
const _SRC_LINE_RE = /this article was written by|\bwritten by\s+[\w.\- ]+\s+at\b|\bat\s+(?:investinglive|forexlive|think\.ing|fxstreet|actionforex)\.com|follow .* on (?:twitter|x)\b|©\s*\d{4}/i;
function _fallbackInsights(text, title, lines) {
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const tnorm = norm(title).slice(0, 80);
  // Nettoie + dédoublonne une liste de candidats → renvoie au plus 6 phrases propres (cartes distinctes).
  const _clean = (arr, minLen) => {
    const seen = new Set(); const out = [];
    for (let s of (arr || [])) {
      s = String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
            .replace(/\s*(?:…|\.{2,})\s*$/, '').trim();                         // pas de "…" final
      if (s.length < (minLen || 24) || !/[a-z]/i.test(s)) continue;
      if (_SRC_LINE_RE.test(s)) continue;                                       // pas de ligne source
      const n = norm(s);
      // N'utilise JAMAIS le TITRE comme insight (sinon il s'affiche en 1re carte).
      if (tnorm.length > 10 && (n === tnorm || n.startsWith(tnorm) || tnorm.startsWith(n.slice(0, 60)))) continue;
      if (seen.has(n)) continue; seen.add(n);
      out.push(s);
      if (out.length >= 6) break;
    }
    return out;
  };
  // 1) Lignes structurées fournies (puces réelles du rapport) → 1 carte par puce = plusieurs petites cases.
  if (Array.isArray(lines) && lines.length) {
    const cards = _clean(lines, 18);
    if (cards.length >= 2) return cards.map(_insCard);
  }
  // 2) Sinon : découpage par phrases.
  const parts = _clean(String(text).split(/(?<=[.!?])\s+|\n+/), 28);
  return parts.map(_insCard);
}
// ── Détection ACTIF + DIRECTION d'une phrase (0 token) — badges BUY/SELL/NEUTRAL même sans IA ──
// Clone PMT : chaque carte qui cite un actif (paire FX, devise, indice, or, pétrole…) reçoit son
// badge selon la direction décrite par le rapport ; sinon carte narrative sans badge.
const _INS_ASSET_RES = [
  [/\b([A-Z]{3}\/[A-Z]{3})\b/, m => m[1].toUpperCase()],
  [/\b(eurusd|gbpusd|usdjpy|usdchf|usdcad|audusd|nzdusd|eurgbp|eurjpy|gbpjpy)\b/i, m => m[1].toUpperCase().replace(/^(\w{3})(\w{3})$/, '$1/$2')],
  [/\b(gold|xau)\b/i, () => 'Gold'], [/\b(silver|xag)\b/i, () => 'Silver'],
  [/\b(wti|brent|crude|oil price)/i, () => 'Oil'], [/\bnatural gas\b/i, () => 'NatGas'],
  [/\b(s&p ?500|spx)\b/i, () => 'S&P 500'], [/\bnasdaq\b/i, () => 'Nasdaq'], [/\b(dow jones|the dow)\b/i, () => 'Dow'],
  [/\bnikkei\b/i, () => 'Nikkei'], [/\bdax\b/i, () => 'DAX'], [/\bftse\b/i, () => 'FTSE'],
  [/\b(bitcoin|btc)\b/i, () => 'BTC'],
  [/\b(USD|EUR|GBP|JPY|CHF|CAD|AUD|NZD)\b/, m => m[1]],
  [/\bdollar\b/i, () => 'USD'], [/\beuro\b/i, () => 'EUR'], [/\b(sterling|pound)\b/i, () => 'GBP'], [/\byen\b/i, () => 'JPY'],
];
const _INS_UP = /\b(rallie[ds]?|rally|surg\w+|jump\w+|climb\w+|gain\w+|rose|rises?|rising|higher|advanc\w+|strength\w+|firmer|spik\w+|soar\w+|outperform\w+|extended? gains|en hausse|grimp\w+|s'appr[ée]ci\w+|bondi\w+)\b/i;
const _INS_DN = /\b(f[ae]ll|fell|drops?|dropped|slid\w*|declin\w+|sank|plung\w+|tumbl\w+|weaken\w+|lower|soften\w+|losses|slump\w+|retreat\w+|underperform\w+|en baisse|recul\w+|chut\w+|s'affaibli\w+)\b/i;
function _insCard(s) {
  let asset = null;
  for (const [re, fn] of _INS_ASSET_RES) { const m = s.match(re); if (m) { asset = fn(m); break; } }
  if (!asset) return { asset: null, signal: null, text: s };
  const up = _INS_UP.test(s), dn = _INS_DN.test(s);
  const signal = up && !dn ? 'BUY' : (dn && !up ? 'SELL' : 'NEUTRAL');
  return { asset, signal, text: s };
}
// ── Cartes COURTES + sans doublon (façon PMT) ────────────────────────────────
// PMT = 1 phrase concise par carte, 1 carte par actif. On applique à TOUTES les
// sources (IA, secours extractif, cache) → fini les pavés et les doublons d'actif.
function _shortInsight(s) {
  s = String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const sentences = s.match(/[^.!?]+[.!?]+/g) || [s];
  let out = (sentences[0] || s).trim();
  if (out.length < 45 && sentences[1]) out = (out + ' ' + sentences[1].trim()).trim();   // 1re phrase trop courte → on en garde 2
  if (out.length > 180) out = out.slice(0, 177).replace(/\s+\S*$/, '').replace(/[,;:–-]+$/, '').trim() + '…';
  return out;
}
function _finalizeInsights(arr) {
  const seenAsset = new Set(), seenText = new Set(), out = [];
  for (let o of (arr || [])) {
    if (typeof o === 'string') o = { asset: null, signal: null, text: o };
    if (!o || !o.text) continue;
    const text = _shortInsight(o.text);
    if (!text || text.length < 9) continue;
    const tk = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 48);
    if (tk && seenText.has(tk)) continue;                      // texte (quasi) identique → doublon
    const a = String(o.asset || '').toUpperCase();
    if (a && seenAsset.has(a)) continue;                       // un SEUL insight par actif (façon PMT)
    if (a) seenAsset.add(a);
    if (tk) seenText.add(tk);
    out.push({ asset: o.asset || null, signal: o.signal || null, text });
    if (out.length >= 10) break;                               // PMT en montre ~10
  }
  return out;
}
app.post('/api/report-insights', async (req, res) => {
  const { id, text, title, lines } = req.body || {};
  const _lines = Array.isArray(lines) ? lines.slice(0, 40) : null;   // puces réelles du rapport (fallback propre)
  const clean = String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length < 60) return res.json({ insights: [] });
  const key = 'v6fr:' + (id || clean.slice(0, 100));   // v6fr = bump : insights régénérés EN FRANÇAIS (les anciens, en anglais, sont ignorés)
  if (_insightsCache.has(key)) return res.json({ insights: _finalizeInsights(_insightsCache.get(key)) });
  // Cache DURABLE (Supabase ai_cache) : survit aux redémarrages Render → pas de requête
  // IA en double quand un utilisateur rouvre un rapport après un redéploiement.
  try {
    const stored = await auth.aiCacheGet('ins:' + key);
    if (stored && Array.isArray(stored) && stored.length) { _insightsCache.set(key, stored); return res.json({ insights: _finalizeInsights(stored) }); }
  } catch {}
  try {
    const prompt = `Tu es analyste FX & marchés pour un terminal pro (style DataTradingPro). À partir de ce rapport (recherche de banque, note macro OU recap de session), génère 8 à 10 "insights" courts pour un carrousel "AI Insights", classés par importance.
PRIORITÉ ABSOLUE — cartes par ACTIF avec SIGNAL : pour CHAQUE devise/paire réellement analysée ("USD/JPY","EUR/USD","GBP/USD","AUD/USD","USD/CAD","EUR/GBP","US Dollar","EUR","GBP","JPY","CHF","CAD","AUD","NZD"…) ET chaque actif clé ("Spot Gold","Brent Crude","S&P 500","US 10Y","Bitcoin"…), donne un signal dès que le rapport implique une direction : "BUY" (haussier), "SELL" (baissier) ou "NEUTRAL" (équilibré). C'est LE cœur de la valeur → vise le MAXIMUM de cartes signal, devises/paires EN PREMIER.
Ajoute 1 à 3 cartes NARRATIVES de contexte (géopolitique, tarifs, énergie, banques centrales, sentiment…) → asset=null ET signal=null.
Si un actif est cité SANS direction nette → signal=null.
Règles STRICTES :
- JAMAIS d'actif générique vague ("FX","Markets","Macro","Forex","Currencies") → pour ceux-là, fais-en un insight narratif (asset=null).
- "text": UNE SEULE phrase brève (max 20 mots), EN FRANÇAIS, orientée trader (le driver clé + l'impact). PAS de 2e phrase, pas de pavé. (Garde les tickers/codes tels quels : USD/JPY, S&P 500, Brent…)
- N'invente rien : base-toi uniquement sur le rapport.
Réponds UNIQUEMENT en JSON : {"insights":[{"asset":"USD/JPY"|null,"signal":"BUY"|"SELL"|"NEUTRAL"|null,"text":"..."}]}
Rapport :
${clean.slice(0, 4500)}`;
    // Insights de rapport = catégorie "analyst", TIER USER (clic direct : jamais freiné par les heures
    // calmes, bascule Claude autorisée) + COALESCING (2 clics simultanés sur le même rapport = 1 appel).
    const out = await _aiInflight('ins:' + key, () => aiSmart('analyst', prompt, 1100, { priority: 'user' }));
    const m = out.match(/\{[\s\S]*\}/);
    const _GENERIC = /^(fx|forex|markets?|macro|currenc(?:y|ies)|the market|general|n\/?a)$/i;
    const insights = m
      ? (JSON.parse(m[0]).insights || [])
          .filter(o => o && typeof o.text === 'string' && o.text.length > 8)
          .map(o => {
            let asset = _stripMd(String(o.asset == null ? '' : o.asset)).slice(0, 40);
            if (_GENERIC.test(asset)) asset = '';                       // actif générique → carte narrative
            let signal = String(o.signal || o.bias || '').trim().toUpperCase();
            if (signal === 'BULLISH') signal = 'BUY';
            else if (signal === 'BEARISH') signal = 'SELL';
            if (!['BUY', 'SELL', 'NEUTRAL'].includes(signal)) signal = '';
            if (!asset) signal = '';                                    // pas de badge sans actif
            return { asset: asset || null, signal: signal || null, text: _stripMd(String(o.text)) };
          })
          .slice(0, 12)
      : [];
    const finalized = _finalizeInsights(insights);   // raccourci + dédoublonné AVANT mise en cache → données propres durables
    if (finalized.length) {
      _insightsCache.set(key, finalized);
      _saveJsonMap(INSIGHTS_FILE, _insightsCache);   // persiste les succès sur disque (hot cache)
      auth.aiCacheSet('ins:' + key, finalized).catch(() => {});   // + durable (Supabase) anti-régénération
      return res.json({ insights: finalized });
    }
    res.json({ insights: _finalizeInsights(_fallbackInsights(clean, title, _lines)), fallback: true });   // Gemini vide → secours extractif
  } catch (e) {
    console.error('[Insights]', e.message);
    res.json({ insights: _finalizeInsights(_fallbackInsights(clean, title, _lines)), fallback: true });   // quota/erreur → secours extractif
  }
});

// ─── AI Analysis endpoint ─────────────────────────────────────────────────────
// Cache persistant (survit aux redémarrages Render) → on ne re-paie jamais Gemini pour la même news
const ANALYSE_CACHE_FILE = path.join(_CACHE_DIR, 'cache_analyse.json');
const _analyseCache = _loadJsonMap(ANALYSE_CACHE_FILE);
app.post('/api/analyse', async (req, res) => {
  const { headline, category, description } = req.body || {};
  if (!headline) return res.status(400).json({ error: 'headline required' });

  const cacheKey = headline.substring(0, 100);
  if (_analyseCache.has(cacheKey)) return res.json(_analyseCache.get(cacheKey));

  // Sans IA : l'Analyse ne ferait que RÉPÉTER la description (déjà montrée dans Info) → on renvoie
  // VIDE pour masquer le tag Analyse (pas de répétition). L'Analyse n'apparaît QUE si l'IA produit
  // une vraie analyse distincte. (L'IA est la SEULE source d'une analyse de valeur.)
  const _analyseFallback = () => [];

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
- Add ANALYTICAL value: drivers, implications, levels, what it means for the trade — do NOT restate the headline or just repeat the figures.
- Name only the instruments genuinely relevant here (e.g. EUR/USD, Brent, XAU/USD, US10Y) — skip if none.
- Explain the concrete causal mechanism for THIS story, not generic phrasing.
- Max 22 words per bullet. Vary the angle per news; do not reuse the same wording across news.
- NEVER include source/author attribution.
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

// ─── Info "tag" : résumé Gemini clair & synthétique (style rapport DTP), cache persistant ──
const INFO_CACHE_FILE = path.join(_CACHE_DIR, 'cache_news_info.json');
const _infoCache = _loadJsonMap(INFO_CACHE_FILE);
app.post('/api/news-info', async (req, res) => {
  const { id, headline, category, description } = req.body || {};
  const rawDesc = String(description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!headline || rawDesc.length < 30) return res.json({ bullets: [] });

  // Clé de cache : id de la news si fourni, sinon empreinte du titre
  const cacheKey = id || headline.substring(0, 120);
  if (_infoCache.has(cacheKey)) return res.json(_infoCache.get(cacheKey));

  // Budget Gemini : semaine = news IMPORTANTES uniquement. L'importance est décidée CÔTÉ SERVEUR
  // (regex fort-impact sur le titre/catégorie) — le flag client n'est plus qu'un simple indice,
  // il ne peut plus consommer la part 'news' (45% du cap) sur des news quelconques.
  const _srvImportant = /\b(fed|fomc|powell|ecb|bce|lagarde|boe|bailey|boj|ueda|snb|boc|rba|rbnz|cpi|inflation|nfp|payrolls?|gdp|pib|rate (decision|cut|hike)|interest rate|emergency|intervention|war|missile|strike|ceasefire|sanctions?|default|bailout|opec)\b/i
    .test(String(headline || '') + ' ' + String(category || ''));
  const _newsImportant = !!req.body.important && _srvImportant;
  if (!aiAllowed('news', { important: _newsImportant, priority: 'user' })) return res.json({ bullets: [] });   // pré-check rapide (évite de bâtir le prompt si budget épuisé)

  try {
    const text = await aiSmart('news', `You are an editor for a professional financial news terminal (trading-desk style).
Summarise the story below into clear bullets capturing the KEY FACTS of THIS specific news (never a template).
RULES:
- 3 to 6 bullets depending on the real substance (more concrete facts = more bullets; never padding).
- Keep the exact key figures and specifics (percentages, levels, dates, places, programs, names).
- Put **bold** (markdown double asterisks) on the single most important phrase or number — sparingly (0 to 2 times total in the whole answer).
- If the story enumerates a list (e.g. four demands/points/conditions), you MAY add ONE short header line ending with a colon (e.g. "Four points:") then that list as bullets right after.
- One clear idea per bullet, neutral factual tone, no investment advice.
- NEVER mention the news outlet or source: drop any "via X", "Reuters reports", "according to <agency/newspaper>", and all outlet names.
- Same language as the source (usually English → answer in English).
- Reply ONLY with the lines: bullets start with •, the optional single header line ends with ":". No preamble, no conclusion.

Headline: ${headline}
Category: ${category || '—'}
Content: ${rawDesc.substring(0, 1100)}`, 650, { important: _newsImportant, priority: 'user', claudeOverBudget: false });   // compté APRÈS succès + zéro crédit Claude pour ce flux (fallback local = bullets vides)

    const bullets = [];
    text.split('\n').map(l => l.trim()).filter(Boolean).forEach(l => {
      if (/^[•\-\*]/.test(l)) { const b = l.replace(/^[•\-\*]\s*/, '').trim(); if (b) bullets.push(b); }
      else if (l.length <= 46 && /\S.{1,44}:$/.test(l) && !/[.!?]/.test(l.slice(0, -1))) bullets.push(l);   // ligne sous-titre
    });

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
const REACT_CACHE_FILE = path.join(_CACHE_DIR, 'cache_reaction.json');
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

// Rassemble TOUTES les données pertinentes du terminal pour une paire (force des devises,
// COT, sentiment retail contrarien, risk on/off) → bloc texte injecté dans le prompt :
// l'IA conclut le biais à partir de l'ensemble, pas des seuls titres. Tout est servi depuis
// le cache (instantané) ; chaque source est tolérante aux pannes (try/catch indépendants).
async function _gatherTerminalContext(pair) {
  const [base, quote] = String(pair || '').toUpperCase().split('/').map(s => s.trim());
  if (!base || !quote) return '';
  const lines = [];
  // 1) Force des devises (dernière valeur de chaque devise)
  try {
    const s = await computeCurrencyStrength('today');
    const last = c => { const a = s && s.series && s.series[c]; return (a && a.length) ? a[a.length - 1].v : null; };
    const sb = last(base), sq = last(quote);
    if (sb != null || sq != null) {
      const verdict = (sb != null && sq != null) ? (sb > sq ? `${base} stronger` : sq > sb ? `${quote} stronger` : 'balanced') : 'n/a';
      lines.push(`Currency strength (today): ${base}=${sb != null ? sb.toFixed(2) : 'n/a'}, ${quote}=${sq != null ? sq.toFixed(2) : 'n/a'} → ${verdict}`);
    }
  } catch {}
  // 2) COT — positionnement spéculatif (leveraged funds) = signal de tendance
  try {
    const cot = await fetchCOTData('lev_money');
    const f = k => (cot || []).find(x => x.key === k);
    const cbp = f(base), cqp = f(quote);
    if (cbp) lines.push(`COT ${base}: ${cbp.longPct}% long / ${cbp.shortPct}% short (net ${cbp.net > 0 ? '+' : ''}${cbp.net})`);
    if (cqp) lines.push(`COT ${quote}: ${cqp.longPct}% long / ${cqp.shortPct}% short (net ${cqp.net > 0 ? '+' : ''}${cqp.net})`);
  } catch {}
  // 3) Sentiment retail (Myfxbook) = signal CONTRARIEN
  try {
    const ro = await fetchCommunityOutlook('H1');
    const r = (ro || []).find(x => x.symbol === base + quote);
    if (r) lines.push(`Retail sentiment ${base}/${quote}: ${r.longPct}% long / ${r.shortPct}% short — contrarian read: crowd ${r.longPct > r.shortPct ? 'net LONG → bearish bias' : 'net SHORT → bullish bias'}`);
  } catch {}
  // 4) Risk sentiment global (safe-haven vs risk-on)
  try {
    const risk = await fetchRiskSentiment();
    if (risk && risk.label) lines.push(`Global risk sentiment: ${risk.label}${typeof risk.score === 'number' ? ` (score ${risk.score.toFixed(2)})` : ''}`);
  } catch {}
  return lines.join('\n');
}

app.post('/api/analyst-outlook', async (req, res) => {
  const { pair, cb, headlines } = req.body || {};
  if (!pair) return res.status(400).json({ error: 'pair required' });

  // Clé de cache : paire + heure (bucket horaire) UNIQUEMENT — fini les `headlines` du client
  // dans la clé (cache contournable à volonté = générations infinies). Rafraîchi au plus 1×/h/paire.
  const _hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
  const cacheKey = `${pair}:${_hourBucket}`;
  if (_outlookCache.has(cacheKey)) return res.json(_outlookCache.get(cacheKey));

  try {
    const terminal = await _gatherTerminalContext(pair).catch(() => '');
    const text = await aiSmart('outlook', `You are a professional forex analyst. Provide a structured market outlook for ${pair}.

CONCLUDE the bias by weighing ALL the terminal data below TOGETHER (not a single factor):
- Currency strength & COT (leveraged funds) = momentum/trend signals.
- Retail sentiment = CONTRARIAN (crowd heavily long → bearish, heavily short → bullish).
- Global risk sentiment drives safe-havens (USD, JPY, CHF, Gold) vs risk currencies (AUD, NZD, CAD).
- Recent headlines = catalysts.

Pair: ${pair}
Central banks: ${cb || 'N/A'}

TERMINAL DATA:
${terminal || 'No positioning data available.'}

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
Base "bias", "confidence" and "summary" on the WEIGHT OF EVIDENCE across the terminal data above. Be specific. Use actual levels where known. Max 3 levels. Output only valid JSON.`, 700, { priority: 'user' });
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

// ─── DTP Daily US Opening Briefing ──────────────────────────────────────────
// Auto-generated at 14:45 Paris (≈ 08:45 NY) and injected directly into the news feed

const _US_BRIEFING_ID_PREFIX = 'dtp-us-briefing-';

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
      headline:    `PRIMER - DTP Daily US Opening News — ${shortDate}`,
      description,
      category:    'Market Analysis',
      source:      'DTP',
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

// ─── Generic DTP daily briefing generator ────────────────────────────────────

function generateDailyBriefing({ idPrefix, reportType, cutoffHours, force = false, buildFn, dateOffset = 0 }) {
  // dateOffset=0 → today, dateOffset=1 → yesterday
  const targetTs  = Date.now() - dateOffset * 24 * 60 * 60 * 1000;
  const targetDate = new Date(targetTs);
  const dateKey   = new Date(targetDate.toLocaleString('en-US', { timeZone: 'Europe/Paris' }))
                      .toISOString().slice(0, 10);

  const todayPrefix = idPrefix + dateKey;
  if (!force && allNews.some(i => (i.id || '').startsWith(todayPrefix))) {
    console.log(`[DTP] ${reportType} already generated for ${dateKey}, skipping.`);
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
    source:      'DTP',
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
  console.log(`[DTP] "${item.headline}" → ${bullets.length} bullets (${recent.length} items)`);
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

// Bruit/faible valeur à exclure des rapports (social, promo, opinions hors-sujet)
const _RECAP_NOISE = /(is\s+\w+\s+a\s+buy|should you buy|i think this is|most[- ]fair criticism|analysis today at|read more at|click here|sign up|subscrib|webinar|giveaway|promo|sponsored|advertisement|top \d+ (stocks|picks)|motley fool|zacks|^@|\bRT @)/i;
function _recapClean(items) {
  return (items || []).filter(i => i && i.headline && !_RECAP_NOISE.test(i.headline) && i.headline.replace(/[^a-z0-9]/gi, '').length >= 14);
}

// ─── Nettoyage markdown brut (À LA SOURCE) ───────────────────────────────────
// L'IA renvoie parfois du gras/italique markdown (**…**, *…*, `…`, __…__, ~~…~~, # titres,
// > citations, [txt](url)). On ne veut JAMAIS afficher ces caractères tels quels dans un rapport.
// → On nettoie la donnée AVANT stockage : peu importe le point de rendu (textContent, esc, innerHTML),
//   le texte servi est propre. Le texte est conservé, seuls les marqueurs disparaissent.
function _stripMd(s) {
  if (s == null) return s;
  return String(s)
    .replace(/```[\s\S]*?```/g, '')           // blocs de code
    .replace(/`([^`]+)`/g, '$1')              // code inline
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')      // ***gras+ital***
    .replace(/\*\*(.+?)\*\*/g, '$1')          // **gras**
    .replace(/__(.+?)__/g, '$1')              // __gras__
    .replace(/~~(.+?)~~/g, '$1')              // ~~barré~~
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')  // [texte](url) → texte
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '') // # titres
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')      // > citations
    .replace(/\*+/g, '')                       // astérisques résiduelles (non appariées)
    .replace(/[ \t]+\n/g, '\n')               // espaces avant saut de ligne
    .replace(/[ \t]{2,}/g, ' ')               // espaces multiples (préserve \n\n des paragraphes)
    .trim();
}

// Nettoie EN PLACE les champs texte affichés d'un item (titre / headline / _weekly.title) de tout
// markdown brut. Appelé AU SERVE des endpoints → la donnée envoyée au client est toujours propre,
// quelle que soit la version du JS en cache, et corrige rétroactivement les rapports DÉJÀ stockés
// avec des ** (générés avant le nettoyage à la source). La mutation purge aussi la RAM partagée.
function _cleanItemMd(it) {
  if (!it || typeof it !== 'object') return it;
  if (typeof it.title === 'string')    it.title    = _stripMd(_dedupTitle(it.title));    // + dédup « PHRASE date PHRASE »
  if (typeof it.headline === 'string') it.headline = _stripMd(_dedupTitle(it.headline));
  if (typeof it.aiTitle === 'string')  it.aiTitle  = _stripMd(it.aiTitle);   // titre IA des session wraps (sinon ** dans le titre de carte)
  if (it._weekly && typeof it._weekly.title === 'string') it._weekly.title = _stripMd(it._weekly.title);
  return it;
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
    console.log(`[DTP] ${reportType} already generated for ${weekKey}, skipping.`); return;
  }
  if (force) allNews = allNews.filter(i => !(i.id || '').startsWith(weekPrefix));

  const cutoff  = now - 7 * 24 * 60 * 60 * 1000;
  const recent  = _recapClean(allNews.filter(i => i.timestamp > cutoff && !i._briefing));
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
    category: 'Market Analysis', source: 'DTP', time: timeStr, timestamp: now,
    priority: 'normal', tags: tags.length ? tags : [reportType],
    _briefing: true, _reportType: reportType,
  };
  allNews = [item, ...allNews].slice(0, 2000);
  saveHistory();
  broadcast({ type: 'news_update', items: [{ ...item, _new: true }], total: allNews.length });
  console.log(`[DTP] "${item.headline}" → ${bullets.length} bullets (7d window)`);
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
  // Titre plus parlant : si pas d'accroche forte (peu/pas de données), on évite le fade "Markets Update"
  let subtitle = _briefingSubtitle(reportType, s, ['Fed','ECB','BoJ']);
  if (/:\s*Markets Update$/.test(subtitle)) subtitle = `${reportType} — Synthèse hebdomadaire des marchés`;
  return { subtitle, bullets, tags: _briefingTags(s, ['Weekly Recap','FX','Markets']) };
}

// ─── Wrappers (async for schedule .catch() compatibility) ────────────────────
async function generateAsiaOpeningBriefing(force = false, dateOffset = 0) {
  return generateDailyBriefing({ idPrefix: 'dtp-asia-briefing-', reportType: 'Asia Opening Preparation', cutoffHours: 12, force, buildFn: buildAsiaOpening, dateOffset });
}
async function generateLondonRecap(force = false, dateOffset = 0) {
  return generateDailyBriefing({ idPrefix: 'dtp-london-recap-', reportType: 'London Session Recap', cutoffHours: 9, force, buildFn: buildLondonRecap, dateOffset });
}
async function generateUSRecap(force = false, dateOffset = 0) {
  return generateDailyBriefing({ idPrefix: 'dtp-us-recap-', reportType: 'US Session Recap', cutoffHours: 10, force, buildFn: buildUSRecap, dateOffset });
}
async function generateDailyEventReview(force = false, dateOffset = 0) {
  return generateDailyBriefing({ idPrefix: 'dtp-daily-review-', reportType: 'Daily Event Review', cutoffHours: 24, force, buildFn: buildDailyReview, dateOffset });
}
async function _generateUSOpeningNew(force = false, dateOffset = 0) {
  return generateDailyBriefing({ idPrefix: 'dtp-us-briefing-', reportType: 'US Opening Preparation', cutoffHours: 8, force, buildFn: buildUSOpening, dateOffset });
}
async function generateLondonOpeningBriefing(force = false, dateOffset = 0) {
  return generateDailyBriefing({ idPrefix: 'dtp-london-opening-', reportType: 'London Opening Preparation', cutoffHours: 10, force, buildFn: buildLondonOpening, dateOffset });
}
async function generateDailyMarketRecap(force = false, dateOffset = 0) {
  return generateDailyBriefing({ idPrefix: 'dtp-daily-recap-', reportType: 'Daily Market Recap', cutoffHours: 24, force, buildFn: buildDailyMarketRecap, dateOffset });
}
// ── GLOBAL ECONOMIC WEEKLY — « Week Ahead » PROSPECTIF façon PMT (distinct du Weekly Recap rétrospectif) :
// AI Insights (cartes + paires) + « The Week Ahead: Highlights » (narratif IA) + « Consensus Forecasts »
// JOUR PAR JOUR (lundi→vendredi) depuis le calendrier (forecast/previous par événement). 1 appel IA/semaine.
const GEW_VER = 4;   // v4 = horaire CLAIR pour un public FR (heure de Paris + GMT) au lieu du multi-fuseau confus CST/GMT/EDT ; français — bump = régén auto
// Heure d'un événement, LISIBLE pour un utilisateur français : heure de PARIS (sa référence) + GMT.
// 100% calculé depuis le timestamp (zéro IA). Ex. « mar. 03:00 (Paris) · 02:00 GMT ».
function _gewTimes(ts /* , ccy (ignoré) */) {
  const d = new Date(ts);
  const f = (tz, withDay) => { try { return new Intl.DateTimeFormat('fr-FR', { timeZone: tz, hour12: false, ...(withDay ? { weekday: 'short' } : {}), hour: '2-digit', minute: '2-digit' }).format(d); } catch { return ''; } };
  const paris = f('Europe/Paris', true), gmt = f('UTC', false);
  return paris ? `${paris} (Paris) · ${gmt} GMT` : (gmt ? `${gmt} GMT` : '');
}
async function generateGlobalEconomicWeekly(force = false) {
  const idPrefix = 'dtp-econ-weekly-', now = Date.now();
  // Semaine À VENIR (lundi→vendredi UTC) : week-end/vendredi → semaine prochaine ; lun-jeu → semaine en cours.
  const _now = new Date(), dow = _now.getUTCDay();
  const monday = new Date(_now);
  if (dow === 0) monday.setUTCDate(_now.getUTCDate() + 1);
  else if (dow >= 5) monday.setUTCDate(_now.getUTCDate() + (8 - dow));
  else monday.setUTCDate(_now.getUTCDate() - (dow - 1));
  monday.setUTCHours(0, 0, 0, 0);
  const friday = new Date(monday); friday.setUTCDate(monday.getUTCDate() + 4); friday.setUTCHours(23, 59, 59, 999);
  const weekStart = monday.getTime(), weekEnd = friday.getTime();
  const _MOIS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const weekRange = `Week of ${monday.getUTCDate()}–${friday.getUTCDate()} ${_MOIS[monday.getUTCMonth()]} ${monday.getUTCFullYear()}`;
  const _j1 = new Date(monday.getUTCFullYear(), 0, 1);
  const wk = Math.ceil(((monday - _j1) / 86400000 + _j1.getDay() + 1) / 7);
  const weekKey = `${monday.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
  const weekPrefix = idPrefix + weekKey;

  // « riche » = GEW au format COURANT (v>=GEW_VER) avec des jours/événements (un GEW vide — calendrier
  // pas encore chargé — ou d'ancien format ne compte pas → régénéré).
  const _isRich = i => i._reportType === 'Global Economic Weekly' && i._weekly && i._weekly.gew && (i._weekly.v || 0) >= GEW_VER && Array.isArray(i._weekly.days) && i._weekly.days.length;
  if (!force && allNews.some(i => (i.id || '').startsWith(weekPrefix) && _isRich(i))) {
    return allNews.find(i => (i.id || '').startsWith(weekPrefix) && _isRich(i)) || null;
  }

  // ── Événements programmés de la semaine à venir (High/Med), groupés par jour ──
  // SOURCE : calendrier TradingView (primaire, couvre la semaine à venir + forecast/previous), comme
  // /api/calendar-events. Repli sur allCalendar (ForexFactory) si TradingView indisponible.
  let _gewCal = [];
  try { _gewCal = await _buildTVCalendar(); } catch {}
  if (!_gewCal || !_gewCal.length) _gewCal = allCalendar || [];
  const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const CCY_CTRY = { USD: 'US', EUR: 'Eurozone', GBP: 'UK', JPY: 'Japan', CHF: 'Switzerland', CAD: 'Canada', AUD: 'Australia', NZD: 'New Zealand', CNY: 'China' };
  const seen = new Set();
  const evClean = _gewCal
    .filter(e => e && e.timestamp >= weekStart && e.timestamp <= weekEnd && (e.impact === 'High' || e.impact === 'Medium') && e.title)
    .filter(e => { const k = (e.title || '') + '|' + (e.currency || '') + '|' + new Date(e.timestamp).toISOString().slice(0, 10); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.timestamp - b.timestamp);
  const daysMap = {};
  for (const e of evClean) {
    const dn = DOW[new Date(e.timestamp).getUTCDay()];
    if (!ORDER.includes(dn)) continue;
    (daysMap[dn] = daysMap[dn] || []).push({
      time: _gewTimes(e.timestamp, e.currency), country: CCY_CTRY[e.currency] || e.currency || '', currency: e.currency || '',
      title: String(e.title).slice(0, 90), impact: e.impact === 'High' ? 'HIGH' : 'MED',
      forecast: String(e.forecast || '').slice(0, 20), previous: String(e.previous || '').slice(0, 20),
    });
  }
  const days = ORDER.filter(dn => daysMap[dn]).map(dn => {
    const dt = new Date(monday); dt.setUTCDate(monday.getUTCDate() + ORDER.indexOf(dn));
    return { day: dn, date: `${dt.getUTCDate()} ${_MOIS[dt.getUTCMonth()]}`, events: daysMap[dn].slice(0, 14) };
  });
  const nEv = days.reduce((n, d) => n + d.events.length, 0);
  // Pas d'événements (calendrier de la semaine à venir pas encore chargé / week-end de boot) → on NE
  // génère PAS un rapport vide et on NE touche PAS à un GEW existant (auto-réessai au prochain accès).
  if (nEv === 0) { console.warn(`[GEW] aucun événement programmé pour ${weekKey} → pas de génération (réessai ultérieur)`); return null; }
  allNews = allNews.filter(i => i._reportType !== 'Global Economic Weekly');   // un seul GEW à la fois (remplacé seulement si on a de vrais events)

  // Événements PHARES (High) pour le titre + le narratif Highlights
  const marquee = evClean.filter(e => e.impact === 'High')
    .map(e => `${DOW[new Date(e.timestamp).getUTCDay()]}: ${CCY_CTRY[e.currency] || e.currency} ${e.title}${e.forecast ? ` (consensus ${e.forecast}, prev ${e.previous || '—'})` : ''}`);
  const recentCtx = _recapClean(allNews.filter(i => i.timestamp > now - 7 * 86400000 && !i._briefing))
    .slice(0, 40).map(i => `[${i.category || ''}] ${i.headline}`);

  // ── IA : titre + Highlights (narratif) + insights + paires (prospectif). Repli déterministe si IA KO. ──
  let title = 'Global Economic Weekly', highlights = '', insights = [], pairs = [];
  if (nEv > 0) {
    const prompt = `You are a senior macro strategist writing the WEEK AHEAD preview ("Global Economic Weekly") for a professional FX & markets desk (depth comparable to a top-tier bank's week-ahead note). The COMING trading week (Monday–Friday) is defined by the scheduled HIGH-IMPACT events below. Write ALL output text IN FRENCH (français soigné), polished, specific and FORWARD-LOOKING — keep tickers/codes/central-bank acronyms as-is (USD/JPY, S&P 500, Fed, BoJ, BoE…). Return ONLY valid JSON (no preamble, no markdown fences):
{
  "title": "Global Economic Weekly: <titre accrocheur EN FRANÇAIS nommant les 2-3 thèmes phares, ex. 'Fed, inflation et banques centrales : une semaine à hauts risques pour les marchés'>",
  "highlights": "<a RICH, COMPLETE editorial of 5 to 7 substantial paragraphs (~500-750 words total), in the style of an Econoday/Prime-Terminal 'Week Ahead: Highlights' note. Lead with the single biggest event of the week (usually the marquee central-bank decision): what consensus expects and the exact level/move, the policy dilemma and dual-mandate tension, named officials and their leanings, the dissent/vote picture, the data backdrop (inflation, labour, growth, geopolitics), the schedule (statement/press-conference times), and the concrete market implications across FX, rates and equities. Then cover the other marquee events. Write full, finished paragraphs — NEVER cut a sentence mid-way. Separate paragraphs with \\n\\n.>",
  "insights": ["<forward-looking standalone insight, 1 sentence>", "... 5 to 6 cards"],
  "pairs": [ { "pair": "USD/JPY", "bias": "BUY", "text": "<one sentence: directional view for the WEEK AHEAD given the scheduled events>" } ]
}
Rules: 5 to 7 key pairs/instruments (USD/JPY, EUR/USD, GBP/USD, AUD/USD, XAU/USD, USD/CAD…); "bias" is exactly "BUY", "SELL" or "NEUTRAL". Ground EVERYTHING in the scheduled events — no invented data. No URLs, no source attributions.

UPCOMING WEEK — KEY SCHEDULED EVENTS (consensus vs previous):
${marquee.join('\n') || '(no high-impact events scheduled)'}

RECENT MACRO CONTEXT (past week, for tone only):
${recentCtx.join('\n')}`;
    try {
      _aiReset();
      const text = await ai.generateText(prompt, 6000);   // marge généreuse → highlights complet, jamais tronqué
      aiNote('weekly');
      const m = text.match(/\{[\s\S]*\}/);
      const parsed = m ? JSON.parse(m[0]) : null;
      if (parsed) {
        title = _stripMd(String(parsed.title || title));   // jamais de markdown brut dans le titre
        if (!/global economic weekly/i.test(title)) title = 'Global Economic Weekly: ' + title.replace(/^global economic weekly:?\s*/i, '');
        highlights = _stripMd(String(parsed.highlights || ''));
        insights = Array.isArray(parsed.insights) ? parsed.insights.filter(Boolean).map(s => _stripMd(String(s))).slice(0, 6) : [];
        pairs = Array.isArray(parsed.pairs) ? parsed.pairs.filter(p => p && p.pair).map(p => ({ pair: String(p.pair).trim(), bias: (['BUY', 'SELL', 'NEUTRAL'].includes(String(p.bias || '').toUpperCase()) ? String(p.bias).toUpperCase() : 'NEUTRAL'), text: _stripMd(String(p.text || '')) })).slice(0, 8) : [];
      }
    } catch (e) { console.warn('[GEW] IA échec → repli déterministe:', e.message); }
  }
  // Repli déterministe (IA indisponible / pas de réponse) : titre + insights depuis les events phares.
  if (!insights.length) insights = marquee.slice(0, 6);
  if (title === 'Global Economic Weekly') {
    const cb = evClean.find(e => /\b(FOMC|Fed|Rate Decision|Announcement|Policy|Interest Rate|BoJ|BoE|ECB|SNB|RBA|BoC|RBNZ)\b/i.test(e.title));
    title = 'Global Economic Weekly: ' + (cb ? `${CCY_CTRY[cb.currency] || cb.currency} ${cb.title} Headlines a Busy Week` : 'Key Data and Central Banks in the Week Ahead');
  }

  // ── Commentaire d'analyse PAR ÉVÉNEMENT (style Econoday) — UN seul appel groupé, caché (1×/sem).
  // Best-effort : IA indisponible → events affichés SANS commentaire (jamais d'invention). On ne
  // tente que si le 1er appel a réussi (highlights présent) → ne gaspille pas le quota en panne IA.
  if (highlights) {
    try {
      const flat = []; days.forEach(d => (d.events || []).forEach(e => flat.push(e)));
      if (flat.length) {
        const list = flat.map((e, i) => `${i + 1}. ${e.country} ${e.title}${e.forecast ? ` — consensus ${e.forecast}${e.previous ? `, previous ${e.previous}` : ''}` : (e.previous ? ` — previous ${e.previous}` : '')}`).join('\n');
        const cprompt = `You are an Econoday-style economist. For EACH scheduled event below, write ONE concise, specific analyst sentence EN FRANÇAIS: what the consensus implies versus the previous reading and why it matters for markets. Keep tickers/codes/acronyms as-is. Ground EVERYTHING in the numbers provided — invent nothing, add no ranges. Return ONLY valid JSON mapping each event number to its French sentence, e.g. {"1":"Le consensus table sur ...","2":"..."}.

EVENTS:
${list}`;
        const ct = await ai.generateText(cprompt, 4000);
        aiNote('weekly');
        const cm = ct.match(/\{[\s\S]*\}/);
        if (cm) { const obj = JSON.parse(cm[0]); flat.forEach((e, i) => { const c = obj[String(i + 1)]; if (typeof c === 'string' && c.trim().length > 15) e.comment = _stripMd(c).slice(0, 420); }); }
        const done = flat.filter(e => e.comment).length;
        console.log(`[GEW] commentaires par event : ${done}/${flat.length}`);
      }
    } catch (e) { console.warn('[GEW] commentaires par event indispo:', e.message); }
  }

  const weekly = { v: GEW_VER, gew: true, title, weekRange, highlights, insights, pairs, days };
  // Description texte (recherche/affichage simple)
  const descParts = [weekRange, highlights ? highlights.replace(/\n+/g, ' ').slice(0, 400) : ''];
  days.forEach(d => { descParts.push('\n' + d.day + ' ' + d.date); d.events.forEach(e => descParts.push(`- ${e.country} ${e.title}${e.forecast ? ' — cons. ' + e.forecast + (e.previous ? ' / prev ' + e.previous : '') : ''}`)); });
  const timeStr = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  const item = {
    id: weekPrefix + '-' + now,
    headline: `${title} — ${weekRange}`,
    description: descParts.filter(Boolean).join('\n'),
    category: 'Market Analysis', source: 'DTP', time: timeStr, timestamp: now,
    priority: 'normal', tags: ['Week Ahead', 'Global Economy', 'Macro'],
    _briefing: true, _reportType: 'Global Economic Weekly', _weekly: weekly,
  };
  allNews = [item, ...allNews].slice(0, 2000);
  saveHistory();
  auth.weeklyReportSave(weekKey, item).catch(e => console.warn('[GEW] persist échec:', e.message));
  try { broadcast({ type: 'news_update', items: [{ ...item, _new: true }], total: allNews.length }); } catch {}
  console.log(`[GEW] ${weekly.highlights ? 'IA' : 'repli'} ${weekKey} (${weekRange}) — ${days.length} jours, ${nEv} events, ${pairs.length} paires`);
  return item;
}
// Vendredi le plus récent (≤ maintenant) — utilisé pour la mention "Week Ending: dd.mm.yyyy"
function _mostRecentFriday() {
  const d = new Date();
  const diff = (d.getUTCDay() - 5 + 7) % 7;   // jours écoulés depuis vendredi
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

// ── Weekly Market Recap RICHE (Gemini → JSON structuré) ──
// Copie de la logique DataTradingPro : résumé global, cartes d'insights, Key Macro Highlights,
// et analyse détaillée par devise (USD…NZD). Renvoie null si l'IA échoue (→ fallback par règles).
async function generateWeeklyRecapAI(force = false) {
  const idPrefix = 'dtp-mkt-recap-';
  const now  = Date.now();
  // On clé le recap sur la SEMAINE COUVERTE (celle se terminant le vendredi écoulé),
  // pas sur le jour de génération → une génération en milieu de semaine (pour voir la semaine
  // dernière) n'empêche pas la génération du samedi pour la semaine en cours.
  const fri  = _mostRecentFriday();
  const jan1 = new Date(fri.getUTCFullYear(), 0, 1);
  const wk   = Math.ceil(((fri - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  const weekKey    = `${fri.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
  const weekPrefix = idPrefix + weekKey;
  const weekEnding = `${String(fri.getUTCDate()).padStart(2,'0')}.${String(fri.getUTCMonth()+1).padStart(2,'0')}.${fri.getUTCFullYear()}`;
  // Le Weekly Recap est PUBLIÉ le SAMEDI (lendemain du vendredi couvert) → on le DATE au samedi
  // (peu importe le jour réel de génération : une régénération en milieu de semaine reste datée du samedi).
  const sat = new Date(fri); sat.setUTCDate(fri.getUTCDate() + 1); sat.setUTCHours(6, 0, 0, 0);
  const satTs = sat.getTime();
  // Plage de la semaine en français : "Semaine du 25 au 29 mai 2026" (lundi → vendredi)
  const _MOIS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  const mon = new Date(fri); mon.setUTCDate(fri.getUTCDate() - 4);   // lundi de la semaine couverte
  const d1 = mon.getUTCDate(), m1 = mon.getUTCMonth(), y1 = mon.getUTCFullYear();
  const d2 = fri.getUTCDate(), m2 = fri.getUTCMonth(), y2 = fri.getUTCFullYear();
  const weekRange = (m1 === m2 && y1 === y2) ? `Semaine du ${d1} au ${d2} ${_MOIS_FR[m2]} ${y2}`
    : (y1 === y2)                            ? `Semaine du ${d1} ${_MOIS_FR[m1]} au ${d2} ${_MOIS_FR[m2]} ${y2}`
    :                                          `Semaine du ${d1} ${_MOIS_FR[m1]} ${y1} au ${d2} ${_MOIS_FR[m2]} ${y2}`;

  // On considère "déjà généré" UNIQUEMENT si un recap au format RICHE (v2) existe pour la semaine.
  const _isV2 = i => i._reportType === 'Weekly Market Recap' && i._weekly && i._weekly.v >= RECAP_VER;
  if (!force && allNews.some(i => (i.id || '').startsWith(weekPrefix) && _isV2(i))) {
    console.log(`[Weekly Recap] déjà généré (v2) pour ${weekKey}, skip.`);
    return allNews.find(i => (i.id || '').startsWith(weekPrefix) && _isV2(i)) || null;
  }
  // Anti-doublon STRICT : on génère un recap unique → on retire TOUS les Weekly Market Recap
  // précédents d'allNews (les anciennes semaines restent conservées dans le store weekly_reports).
  allNews = allNews.filter(i => i._reportType !== 'Weekly Market Recap');

  // Fenêtre = LA SEMAINE COUVERTE (lundi 00:00 → vendredi 23:59 UTC), pas un simple "7 derniers jours".
  // → le recap reflète EXACTEMENT ce qui s'est passé sur les sessions de cette semaine-là.
  const _wEnd = new Date(fri); _wEnd.setUTCHours(23, 59, 59, 999);
  const weekEnd = _wEnd.getTime();
  const _wStart = new Date(fri); _wStart.setUTCDate(fri.getUTCDate() - 4); _wStart.setUTCHours(0, 0, 0, 0);
  const weekStart = _wStart.getTime();
  const inWeek = t => t >= weekStart && t <= weekEnd;

  // 1) SESSION WRAPS de la semaine (onglet Analyst) — source PRIMAIRE. On récupère leur CONTENU
  //    (pas que les titres), du lundi matin au vendredi soir.
  const wrapsRaw = (_swCache || []).filter(i => inWeek(i.timestamp)).sort((a, b) => b.timestamp - a.timestamp); // récent → ancien
  const _wrapDetails = await Promise.allSettled(wrapsRaw.slice(0, 10).map(async w => {
    let pts = (w.content && w.content.length > 100) ? _extractWrapPoints(_cleanWrapHtml(w.content)) : null;
    if ((!pts || pts.length < 3) && w.url) { try { const d = await _fetchILContentHttp(w.url); pts = d.points; } catch {} }
    return { w, pts: (pts || []).filter(p => !_RECAP_NOISE.test(p)).slice(0, 18) };
  }));
  const wrapDetailed = _wrapDetails.filter(r => r.status === 'fulfilled').map(r => r.value);
  // Corpus wraps détaillé : [Session] Titre — point1 · point2 · …
  const wraps = wrapDetailed.map(({ w, pts }) =>
    `[${w.session || 'Wrap'}] ${w.title}${pts.length ? ' — ' + pts.join(' · ') : (w.description ? ' — ' + w.description : '')}`);
  // Message de CLÔTURE de la semaine (wrap le plus récent = vendredi soir) → base du titre
  const closing = wrapDetailed[0];
  const closingMsg = closing ? `[${closing.w.session || 'Wrap'}] ${closing.w.title}${closing.pts.length ? '. ' + closing.pts.slice(0, 4).join('. ') : ''}` : '';
  const weekItemsRaw = _recapClean(allNews.filter(i => inWeek(i.timestamp) && !i._briefing));
  // 2) RÉSULTATS du calendrier économique de la semaine — sources COMBINÉES :
  //    a) données publiées présentes dans allNews (Actual ou catégorie *Data*) — fiable pour la semaine écoulée,
  //    b) + le calendrier allCalendar (prospectif/récent) avec valeur publiée.
  const _isDataResult = i => /actual/i.test(i.description || '') || /\bData\b|Economic Commentary/.test(i.category || '');
  const calItems = [
    ...weekItemsRaw.filter(_isDataResult),
    ...(allCalendar || []).filter(i => inWeek(i.timestamp) && /actual/i.test(i.description || '')),
  ];
  const _calSeen = new Set();
  const calDedup = calItems.filter(i => { const k = (i.headline || i.title || '') + i.timestamp; if (_calSeen.has(k)) return false; _calSeen.add(k); return true; });
  const cal = calDedup.map(i => `${i.country || i.currency || i.category || ''} ${i.headline || i.title || ''}${/actual/i.test(i.description || '') ? ' — ' + String(i.description).replace(/\s+/g, ' ').trim().slice(0, 160) : ''}`);
  //    c) RÉSULTATS extraits du CONTENU des session wraps (« DATA RECAP », chiffres vs attentes).
  //       Source la PLUS FIABLE pour une semaine ÉCOULÉE : les wraps sont persistés 30 j, alors que
  //       le flux ForexFactory ne couvre que la semaine courante + la suivante (pas « semaine dernière »).
  const _DATA_KW = /\b(CPI|PPI|PCE|GDP|PMI|ISM|NFP|non[-\s]?farm|payrolls?|unemployment|jobless|claims|retail sales|inflation|core|durable goods|trade balance|current account|consumer confidence|consumer sentiment|industrial production|factory orders|housing starts|building permits|home sales|wages?|earnings|rate decision|interest rate)\b/i;
  const _looksLikeData = s => {
    const t = String(s);
    if (!/\d/.test(t)) return false;   // un résultat chiffré
    return _DATA_KW.test(t) || /\b(vs\.?|exp\.?|expected|forecast|actual|prev\.?|previous|consensus|est\.?)\b/i.test(t);
  };
  const _seenWrapData = new Set(cal.map(l => l.toLowerCase()));
  for (const { pts } of wrapDetailed) {
    for (const p of (pts || [])) {
      if (cal.length >= 120) break;
      if (!_looksLikeData(p)) continue;
      const line = String(p).replace(/\s+/g, ' ').trim().slice(0, 200);
      const k = line.toLowerCase();
      if (_seenWrapData.has(k)) continue;
      _seenWrapData.add(k);
      cal.push(line);
    }
  }
  // 3) Autres titres macro de la semaine en complément (nettoyés du bruit social/promo)
  const news = weekItemsRaw.slice(0, 120).map(i => `[${i.category || ''}] ${i.headline}`);

  if (!wraps.length && !cal.length && !news.length) {
    console.warn('[Weekly Recap] aucune donnée de la semaine → pas de génération'); return null;
  }
  const corpus = [
    '=== CLOSING MESSAGE OF THE WEEK (latest Friday wrap — base the TITLE on this) ===', closingMsg || '(none)',
    '', '=== SESSION WRAPS (this week, Monday→Friday) ===', ...wraps.slice(0, 60),
    '', '=== ECONOMIC CALENDAR RESULTS (this week) ===', ...cal.slice(0, 90),
    '', '=== OTHER MACRO HEADLINES ===', ...news,
  ].join('\n');

  const CCY = ['USD','EUR','JPY','GBP','CHF','AUD','CAD','NZD'];

  const prompt = `You are a senior macro strategist writing the institutional WEEKLY MARKET RECAP for a professional FX & markets desk (style and depth comparable to a top-tier bank's weekly review). The trading week (Monday–Friday) just closed. Write ALL output text IN FRENCH (français soigné, précis, professionnel) — smart, analytical and specific. Keep tickers/codes/central-bank acronyms as-is (USD/JPY, Fed, BoJ, BoE…).

Quality bar: cite concrete drivers (central bank names and officials, specific data prints with actual vs forecast where available, geopolitical events, oil/equity/yield moves). Each currency narrative must read like a real desk note — multi-paragraph, day-by-day where relevant, explaining the "why" behind moves, not generic filler.

Base the recap PRIMARILY on the SESSION WRAPS and the ECONOMIC CALENDAR RESULTS below (these are the authoritative week-in-review sources), using the other headlines only as supporting context. Produce the recap and return ONLY valid JSON (no preamble, no markdown fences) with EXACTLY this shape:
{
  "title": "Weekly Market Recap: <titre accrocheur EN FRANÇAIS — DÉRIVÉ du MESSAGE DE CLÔTURE DE LA SEMAINE (sa 1re phrase clé), ex. 'Les marchés terminent en hausse alors que ...'>",
  "summary": "<2 to 4 sentence global overview of how markets traded this week>",
  "insights": ["<concise standalone insight, 1 sentence>", "... 4 to 6 thematic insight cards"],
  "pairs": [ { "pair": "USD/JPY", "bias": "SELL", "text": "<one concise sentence: why this directional bias for the week>" } ],
  "macro": [
    { "heading": "<macro theme, e.g. Middle East Geopolitics>", "bullets": ["**Sub-topic:** one or two detailed sentences", "..."] }
  ],
  "currencies": {
    "USD": {
      "analysis": "<concise but COMPLETE narrative of the US dollar's week, grounded in the session wraps: how it traded day by day, the concrete drivers (central banks, data, geopolitics, flows) and the resulting bias. Clear and well-explained, no filler.>",
      "drivers": [ { "heading": "<driver theme, e.g. Fed Policy Expectations>", "detail": "<1 to 2 sentences explaining how this drove the currency this week>" } ]
    },
    "EUR": { "analysis": "...", "drivers": [ ... ] },
    "JPY": { "analysis": "...", "drivers": [ ... ] },
    "GBP": { "analysis": "...", "drivers": [ ... ] },
    "CHF": { "analysis": "...", "drivers": [ ... ] },
    "AUD": { "analysis": "...", "drivers": [ ... ] },
    "CAD": { "analysis": "...", "drivers": [ ... ] },
    "NZD": { "analysis": "...", "drivers": [ ... ] }
  }
}
Rules:
- 4 to 6 macro themes; 4 to 6 thematic insight cards.
- "pairs": 5 to 7 KEY pairs/instruments (e.g. USD/JPY, EUR/USD, GBP/USD, AUD/NZD, USD/CAD, Gold) with a directional bias for the COMING week — "bias" is exactly "BUY", "SELL" or "NEUTRAL".
- EVERY currency in [${CCY.join(', ')}] must be present, each with a substantive, CONCISE-but-COMPLETE "analysis" (explain what happened to that currency this week, based on the session wraps) AND 4 to 8 "drivers" (heading + detail).
- No source attributions, no URLs.

Week's data (session wraps + economic calendar results + headlines):
${corpus}`;

  // Budget Gemini : le Weekly Recap est PRIORITAIRE (1 appel/semaine, rapport phare).
  // On l'autorise même si le budget mensuel souple est atteint (dépassement max ~4 appels/mois,
  // négligeable), tout en le COMPTANT (aiNote 'weekly') pour la transparence. Seul vrai plafond
  // restant : le quota DUR quotidien de Google (429) → bascule alors en fallback par règles.
  _aiReset();
  let parsed = null;
  try {
    const text = await ai.generateText(prompt, 8192);   // gros JSON (8 devises × analyse + drivers)
    aiNote('weekly');                                    // 1 requête Gemini consommée → comptée dans le budget
    const m = text.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
  } catch (e) { console.warn('[Weekly Recap] IA échec:', e.message); parsed = null; }
  const aiOk = !!(parsed && parsed.currencies && typeof parsed.currencies === 'object');

  let weekly;
  if (aiOk) {
    // ── Format RICHE (Gemini) ──
    let baseTitle = _stripMd(String(parsed.title || 'Weekly Market Recap'));
    if (!/recap/i.test(baseTitle)) baseTitle = 'Weekly Market Recap: ' + baseTitle;
    weekly = {
      v: RECAP_VER, title: baseTitle, weekEnding, weekRange,   // rédigé EN FRANÇAIS (RECAP_VER)
      summary:    _stripMd(parsed.summary || ''),
      insights:   Array.isArray(parsed.insights) ? parsed.insights.filter(Boolean).map(s => _stripMd(String(s))).slice(0, 6) : [],
      pairs:      Array.isArray(parsed.pairs) ? parsed.pairs
                    .filter(p => p && p.pair)
                    .map(p => ({ pair: String(p.pair).trim(), bias: String(p.bias || 'NEUTRAL').toUpperCase().replace(/[^A-Z]/g,''), text: _stripMd(String(p.text || '')) }))
                    .map(p => ({ ...p, bias: ['BUY','SELL','NEUTRAL'].includes(p.bias) ? p.bias : 'NEUTRAL' }))
                    .slice(0, 8) : [],
      macro:      Array.isArray(parsed.macro) ? parsed.macro.filter(s => s && s.heading).map(s => ({ ...s, heading: _stripMd(String(s.heading)), bullets: Array.isArray(s.bullets) ? s.bullets.map(b => _stripMd(String(b))) : s.bullets, detail: s.detail != null ? _stripMd(String(s.detail)) : s.detail })).slice(0, 6) : [],
      currencies: {},
    };
    for (const c of CCY) {
      const v = parsed.currencies[c];
      if (!v) continue;
      if (typeof v === 'string') weekly.currencies[c] = { analysis: _stripMd(v), drivers: [] };
      else weekly.currencies[c] = {
        analysis: _stripMd(String(v.analysis || '')),
        drivers: Array.isArray(v.drivers)
          ? v.drivers.filter(x => x && x.heading).map(x => ({ heading: _stripMd(String(x.heading)), detail: _stripMd(String(x.detail || '')) })).slice(0, 9)
          : [],
      };
    }
  } else {
    // ── Fallback PAR RÈGLES — MÊME semaine (dates correctes), à partir des wraps/données de la semaine.
    console.warn('[Weekly Recap] IA indisponible (quota ?) → fallback par règles daté sur la semaine couverte');
    const CB = new Set(['Fed','ECB','BoJ','BoE','BoC','RBA','SNB','RBNZ','PBOC']);
    const DATA = new Set(['Economic Commentary','EU Data','US Data','UK Data','Swiss Data','Japanese Data','Canadian Data','Australian Data','Chinese Data','New Zealand Data']);
    const grp = (label, arr) => arr.length ? { heading: label, bullets: arr.slice(0, 6).map(i => i.headline) } : null;
    const macro = [
      grp('Central Banks & Policy', weekItemsRaw.filter(i => CB.has(i.category))),
      grp('Economic Data',          weekItemsRaw.filter(i => DATA.has(i.category))),
      grp('Geopolitics',            weekItemsRaw.filter(i => i.category === 'Geopolitical')),
      grp('FX & Commodities',       weekItemsRaw.filter(i => /FX Flows|Market Analysis|Energy|Metals/.test(i.category || ''))),
    ].filter(Boolean);
    // Titre DYNAMIQUE dérivé du wrap de CLÔTURE du vendredi (même logique que le titre IA),
    // au lieu d'un libellé générique → le titre "parle" de la semaine même sans IA.
    let fbTitle = 'Weekly Market Recap';
    if (closing && closing.w && closing.w.title) {
      let t = String(closing.w.title)
        .replace(/^\s*\[[^\]]*\]\s*/, '')           // retire un préfixe [Session]
        .replace(/.*\bwrap[:\s-]+/i, '')            // retire "… markets wrap:"
        .replace(/\s+/g, ' ').trim();
      if (t.length > 3) fbTitle = _stripMd('Weekly Market Recap: ' + t.charAt(0).toUpperCase() + t.slice(1));
    }
    weekly = {
      v: 1,
      title: fbTitle,
      weekEnding, weekRange,
      summary: `Synthèse de la ${weekRange.toLowerCase()} : ${wrapsRaw.length} session(s) de marché et ${cal.length} résultat(s) économique(s) majeur(s) suivis.`,
      insights: wrapsRaw.slice(0, 6).map(i => _stripMd((i.title || '').replace(/\s+/g, ' '))).filter(Boolean),
      pairs: [],
      macro,
      currencies: {},   // pas d'analyse par devise sans IA
    };
  }

  // Snapshot Currency Strength de la SEMAINE COUVERTE → figé dans le rapport. Uniquement si on génère
  // PENDANT cette semaine (ex. le samedi : 'week' = la semaine qui vient de se clore) ; sinon on s'abstient
  // (mieux vaut le repli live que figer une mauvaise semaine).
  weekly.weekKey = weekKey;
  try {
    if (_currentMondayUtc() === weekStart) {
      const _cs = await computeCurrencyStrength('week');
      if (_cs && _cs.currencies && _cs.series) weekly.cs = _csSnapshot(_cs);
    }
  } catch (e) { console.warn('[Weekly Recap] snapshot CS échec:', e.message); }

  // Description texte (fallback/recherche/affichage simple)
  const descParts = [weekly.summary];
  weekly.macro.forEach(s => { descParts.push('\n' + s.heading); (s.bullets||[]).forEach(b => descParts.push('- ' + String(b).replace(/\*\*/g,''))); });
  for (const c of CCY) if (weekly.currencies[c]) descParts.push('\n' + c + ': ' + weekly.currencies[c].analysis);
  const timeStr = new Date().toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/Paris' });

  const item = {
    id: weekPrefix + '-' + now,
    headline: `${weekly.title} Week Ending: ${weekEnding}`,   // carte liste = format référence (titre + Week Ending)
    description: descParts.filter(Boolean).join('\n'),
    category: 'Market Analysis', source: 'DTP', time: timeStr, timestamp: satTs,   // daté au SAMEDI
    priority: 'normal', tags: ['Weekly Recap', 'Markets', 'FX'],
    _briefing: true, _reportType: 'Weekly Market Recap', _weekly: weekly,
  };
  allNews = [item, ...allNews].slice(0, 2000);
  saveHistory();
  // Persistance DURABLE (Supabase) → après un redémarrage Render on RECHARGE au lieu de régénérer (économie Gemini)
  auth.weeklyReportSave(weekKey, item).catch(e => console.warn('[Weekly Recap] sauvegarde persistante échec:', e.message));
  try { broadcast({ type: 'news_update', items: [{ ...item, _new: true }], total: allNews.length }); } catch {}
  console.log(`[Weekly Recap] ${weekly.v >= 2 ? 'IA v2' : 'fallback'} ${weekKey} (${weekRange}) — ${Object.keys(weekly.currencies).length} devises, ${weekly.insights.length} insights`);
  return item;
}

// Recharge les rapports hebdo persistés (Supabase/fichier) dans allNews — SANS appel Gemini.
// Rejouable (throttle 30s) : un rapport injecté dans le store apparaît au prochain accès, sans redémarrage.
let _weeklyLoadTs = 0;
async function _loadPersistedWeekly(force = false) {
  if (!force && Date.now() - _weeklyLoadTs < 30000) return;
  _weeklyLoadTs = Date.now();
  try {
    const reports = await auth.weeklyReportList();
    let added = 0, hasV2 = false;
    for (const r of reports) {
      if (!r || !r.id) continue;
      if (r._reportType === 'Weekly Market Recap' && r._weekly && r._weekly.v >= RECAP_VER) hasV2 = true;
      if (!allNews.some(i => i.id === r.id)) { allNews.unshift(r); added++; }
    }
    // Si un recap au format riche (v2) est présent, on purge les anciens recaps obsolètes (anti-doublon)
    if (hasV2) allNews = allNews.filter(i => !(i._reportType === 'Weekly Market Recap' && !(i._weekly && i._weekly.v >= RECAP_VER)));
    if (added) { allNews = allNews.slice(0, 2000); console.log(`[Weekly Recap] ${added} rapport(s) rechargé(s) depuis le stockage persistant (0 requête Gemini)`); }
  } catch (e) { console.warn('[Weekly Recap] rechargement persistant échec:', e.message); }
}

async function generateWeeklyMarketRecap(force = false) {
  // generateWeeklyRecapAI gère TOUT : format riche (IA) OU fallback par règles, mais TOUJOURS daté
  // sur la semaine couverte (vendredi écoulé). On n'utilise plus le briefing générique (mal daté).
  try {
    return await generateWeeklyRecapAI(force);
  } catch (e) { console.warn('[Weekly Recap] génération échouée:', e.message); return null; }
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
  // Rapports HEBDOMADAIRES — SAMEDI 02h00 PARIS (tous les marchés mondiaux fermés pour la semaine ; même créneau que le groupe Bias/Week Ahead)
  const weekly = [
    { fn: () => generateGlobalEconomicWeekly(false),  h: 2, m: 0,  name: 'Global Economic Weekly' },
    { fn: () => generateWeeklyMarketRecap(false),     h: 2, m: 5,  name: 'Weekly Market Recap'    },
  ];

  function msToNextParis(h, m) {
    const now    = new Date();
    const paris  = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const target = new Date(paris);
    target.setHours(h, m, 0, 0);
    if (paris >= target) target.setDate(target.getDate() + 1);
    return target.getTime() - paris.getTime();
  }
  // Prochain SAMEDI à h:m HEURE DE PARIS — pour les rapports hebdo (marchés fermés ; même créneau que le groupe Bias/Week Ahead)
  function msToNextSaturdayParis(h, m) {
    const now    = new Date();
    const paris  = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const target = new Date(paris);
    target.setDate(paris.getDate() + ((6 - paris.getDay() + 7) % 7));   // 6 = samedi
    target.setHours(h, m, 0, 0);
    if (target <= paris) target.setDate(target.getDate() + 7);
    return target.getTime() - paris.getTime();
  }

  for (const { fn, h, m, name } of daily) {
    const delay = msToNextParis(h, m);
    console.log(`[DTP] ${name} scheduled in ${Math.round(delay / 60000)} min`);
    setTimeout(function run() {
      fn().catch(e => console.error(`[DTP] ${name} failed:`, e.message));
      setInterval(() => fn().catch(e => console.error(`[DTP] ${name} failed:`, e.message)), 24 * 60 * 60 * 1000);
    }, delay);
  }
  for (const { fn, h, m, name } of weekly) {
    const delay = msToNextSaturdayParis(h, m);
    console.log(`[DTP] ${name} (samedi ${h}h${String(m).padStart(2,'0')} Paris) dans ${Math.round(delay / 60000)} min`);
    setTimeout(function run() {
      fn().catch(e => console.error(`[DTP] ${name} failed:`, e.message));
      setInterval(() => fn().catch(e => console.error(`[DTP] ${name} failed:`, e.message)), 7 * 24 * 60 * 60 * 1000);
    }, delay);
  }

  // Au démarrage (ex: après un redéploiement) : on génère les rapports d'ouverture du jour
  // s'ils n'existent pas encore (dédup intégrée). Assemblage par règles → pas de quota Gemini.
  setTimeout(async () => {
    // 1) On RECHARGE d'abord les rapports hebdo persistés (Supabase) → pas de régénération Gemini inutile
    await _loadPersistedWeekly();

    daily.forEach(({ fn, name }) => fn().catch(e => console.error(`[DTP] startup ${name} failed:`, e.message)));

    // RATTRAPAGE HEBDO : si Render dormait/​a redémarré le week-end, les rapports hebdo
    // (samedi 02h Paris) n'ont pas été générés. La dédup par semaine ISO + le rechargement
    // persistant ci-dessus évitent tout doublon ET toute régénération inutile.
    // Garde-fou : uniquement samedi/dimanche (UTC), pas en milieu de semaine.
    const uDay = new Date().getUTCDay();   // 0=dim, 6=sam
    if (uDay === 6 || uDay === 0) {
      weekly.forEach(({ fn, name }) => fn().catch(e => console.error(`[DTP] rattrapage hebdo ${name} échec:`, e.message)));
    }
  }, 25 * 1000);
})();

// ═══════════════════ ONGLET BIAS — biais directionnel hebdomadaire (Gemini) ═══════════════════
// Généré automatiquement chaque dimanche, mis en cache (persistant) → l'onglet l'affiche tel quel.
const BIAS_FILE = path.join(_CACHE_DIR, 'cache_bias.json');
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
  if (req.query.force === '1' && req.session?.user?.role === 'admin') { try { await generateWeeklyBias(true); } catch {} }   // force=1 réservé ADMIN (génération lourde non gardée)
  else if (!_biasCache)        { try { await generateWeeklyBias(true); } catch {} }
  res.json(_biasCache || { items: [], overview: '', week: '' });
});

// ─── Smart Bias Tracker : matrice 8 devises × indicateurs (Gemini + Trend calculé) ───
const SMART_BIAS_FILE = path.join(_CACHE_DIR, 'cache_smart_bias.json');
const BIAS_VER = 'v14-recap';   // v14 : nouvel indicateur « Weekly Recap » (synthèse DTP de la semaine écoulée : Weekly Market Recap + Global Economic Weekly, pairs BUY/SELL + analyse par devise) + v13d (bande 0.25) + v13c (calendrier TV) + v13 (prompt directionnel) ; bump = régén au boot
const SB_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'CHF'];
// Matrice de départ (snapshot de la semaine de référence) → l'onglet est rempli dès le 1er affichage,
// puis la vraie génération Gemini l'écrase (dimanche / dès que le quota revient).
const _sbMk = a => Object.fromEntries(SB_CURRENCIES.map((c, i) => [c, a[i]]));
const SMART_BIAS_SEED = {
  // Daté à -14 j (toujours en 2026, et toujours > 7 j → reste "stale" donc déclenche la régén au boot,
  // tout en affichant une semaine de l'année courante si jamais le seed est servi avant la régén).
  generatedAt: Date.now() - 14 * 24 * 60 * 60 * 1000,
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
// Recharge le bias DURABLE (Supabase) s'il est plus frais que le disque/seed (le disque Render est éphémère).
try { auth.aiCacheGet('smartbias:matrix').then(b => { if (b && Array.isArray(b.rows) && b.rows.length && b.generatedAt && (!_smartBias.generatedAt || b.generatedAt > _smartBias.generatedAt)) _smartBias = b; }).catch(() => {}); } catch {}
// ── Versioning Smart Bias : historique des semaines (max 5), durable (fichier + Supabase) ──
const SMART_BIAS_HIST_FILE = path.join(_CACHE_DIR, 'cache_smart_bias_history.json');
// Clé de semaine du bias = la semaine À TRADER (N). Généré le samedi (Paris) à partir de la semaine
// écoulée (N-1) → libellé de la semaine SUIVANTE (week-end → lundi suivant). Aligné sur _sbWeekLabel (front).
function _sbWeekKey(ts) { const d = new Date(new Date(ts).toLocaleString('en-US', { timeZone: 'Europe/Paris' })); const dow = d.getDay() || 7; const m = new Date(d); m.setDate(d.getDate() - dow + 1); m.setHours(0, 0, 0, 0); if (dow >= 6) m.setDate(m.getDate() + 7); return m.getFullYear() + '-' + (m.getMonth() + 1) + '-' + m.getDate(); }
let _smartBiasHistory = [];
try { const h = JSON.parse(fs.readFileSync(SMART_BIAS_HIST_FILE, 'utf8')); if (Array.isArray(h)) _smartBiasHistory = h; } catch {}
try { auth.aiCacheGet('smartbias:history').then(h => { if (Array.isArray(h) && h.length) { const cur = (_smartBiasHistory[0] && _smartBiasHistory[0].generatedAt) || 0; const dur = (h[0] && h[0].generatedAt) || 0; if (dur >= cur) _smartBiasHistory = h; } }).catch(() => {}); } catch {}
const SB_GEM_ROWS = [
  { key: 'fundamental', label: 'Fundamental Data' },
  { key: 'bankOverview', label: 'Bank Overview' },
  { key: 'weeklyRecap', label: 'Weekly Recap' },   // synthèse DTP de la semaine écoulée (Weekly Market Recap + Global Economic Weekly)
  { key: 'hedgeFund', label: 'Hedge Fund Positioning' },
  { key: 'retail', label: 'Retail Positioning' },
  { key: 'monetary', label: 'Monetary Policy' },
  // seasonality : NON géré par l'IA → calculé en dur depuis la saisonnalité réelle (cf. _sbSeasonalityRow)
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

// Technical RÉEL : direction de la force de la devise sur 1 JOUR (lecture court terme du prix),
// DISTINCT de Trend qui, lui, mesure la pente sur la semaine. 0 IA, 0 invention.
async function _sbTechnicalRow() {
  const out = {};
  try {
    const cs = await computeCurrencyStrength('1d');
    SB_CURRENCIES.forEach(c => {
      const s = cs?.series?.[c];
      if (!s || s.length < 2) { out[c] = 'Range'; return; }
      const d = s[s.length - 1].v - s[0].v;
      out[c] = d > 0.3 ? 'Uptrend' : d < -0.3 ? 'Downtrend' : 'Range';
    });
  } catch { SB_CURRENCIES.forEach(c => out[c] = 'Range'); }
  return out;
}

// Sentiment RÉEL : régime de risque global (Risk Sentiment du terminal, _riskData.pct ∈ [-100;+100])
// mappé par PROFIL de devise — risk-on → pro-cycliques (AUD/NZD/CAD) haussières & refuges
// (USD/JPY/CHF) baissiers ; inverse en risk-off. Mapping FX standard, 100% data-driven.
const _SB_RISK_PROFILE = { AUD: 1, NZD: 1, CAD: 0.8, EUR: 0.4, GBP: 0.4, USD: -0.5, JPY: -1, CHF: -1 };
function _sbSentimentRow() {
  const out = {};
  const pct = (_riskData && typeof _riskData.pct === 'number') ? _riskData.pct : 0;   // >0 risk-on, <0 risk-off
  SB_CURRENCIES.forEach(c => {
    const v = pct * (_SB_RISK_PROFILE[c] || 0);
    out[c] = v > 15 ? 'Bullish' : v < -15 ? 'Bearish' : 'Neutral';
  });
  return out;
}

// Biais par BANQUE et par devise, dérivé de la recherche RÉELLE de chaque banque (onglet Institution).
// → Couvre AUTOMATIQUEMENT toute banque présente dans _brCache : ajouter une source banque dans
//   Institution la fait apparaître ici. 1 appel IA/banque (hebdo, caché). Repli : {} (le front retombe
//   alors sur les positions de trade). N'invente rien (basé sur les titres de recherche réels).
async function _sbBankStances() {
  if (!Array.isArray(_brCache) || !_brCache.length) return {};
  const cutoff = Date.now() - 35 * 24 * 60 * 60 * 1000;   // ~5 semaines : couvre TOUTES les banques (certaines publient moins souvent que 2 semaines)
  const _strip = h => String(h || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const byBank = new Map();
  for (const a of _brCache) {
    if (!a || !a.institution || (a.timestamp || 0) < cutoff) continue;
    const arr = byBank.get(a.institution) || [];
    if (arr.length < 6) {
      // Biais basé sur le CONTENU RÉEL de la recherche (pas juste le titre) : fullContent (SEB/PDF) →
      // contenu structuré IA en cache (_brSegCache) → description → titre. C'est la matière de l'onglet Institution.
      const _seg = a.url ? _brSegCache.get(BR_SEG_VER + a.url) : null;
      const body = a.fullContent || (typeof _seg === 'string' ? _seg : '') || a.description || '';   // (le cache peut contenir un marqueur d'échec {f:ts} → ignoré)
      arr.push(`• ${a.title || ''}. ${_strip(body)}`.slice(0, 1300));
    }
    byBank.set(a.institution, arr);
  }
  const out = {};
  const OKV = ['Very Bullish', 'Bullish', 'Neutral', 'Bearish', 'Very Bearish'];
  let consecFail = 0;   // circuit breaker DOUX : on n'arrête qu'après 3 échecs IA d'AFFILÉE (un échec ponctuel/RPM ne tue plus toutes les banques suivantes) ; remis à 0 à chaque succès
  const prev = (_smartBias && _smartBias.bankStances) || {};   // biais déjà déterminés aux passes précédentes
  for (const [bank, heads] of byBank) {
    const clean = (bank || '').replace(/\s+Research$/i, '').trim();
    if (prev[clean] && Object.keys(prev[clean]).length) { out[clean] = prev[clean]; continue; }   // DÉJÀ fait → on garde, on ne re-dépense PAS le quota dessus → chaque passe traite des banques NOUVELLES (progression)
    const st = {};
    if (consecFail < 3 && aiAllowed('bank', { scheduled: true })) {
      const digest = heads.join('\n\n').slice(0, 3500);
      const prompt = `Tu es analyste FX. D'après UNIQUEMENT la recherche récente (articles / notes / PDF) de la banque "${bank}" ci-dessous, déduis son biais directionnel sur chaque devise majeure (${SB_CURRENCIES.join(', ')}).
Réponds UNIQUEMENT en JSON: {${SB_CURRENCIES.map(c => `"${c}":"Bullish|Bearish|Neutral"`).join(',')}}. Si la banque ne se prononce pas clairement sur une devise → "Neutral". N'invente RIEN.

Recherche ${bank} :
${digest}`;
      try {
        const t = await aiSmart('bank', prompt, 220, { scheduled: true });   // (aiSmart compte déjà via aiNote — le double débit de la part 'bank' est supprimé)
        const m = (t || '').match(/\{[\s\S]*\}/);
        if (m) { const obj = JSON.parse(m[0]); for (const c of SB_CURRENCIES) if (OKV.includes(obj[c])) st[c] = obj[c]; }
        consecFail = 0;   // succès → on continue sur toutes les banques suivantes
      } catch (e) { consecFail++; }   // échec ponctuel → on tente la banque suivante ; 3 d'affilée → on s'arrête (reprise au prochain retry)
    }
    out[clean] = st;   // TOUJOURS lister la banque (Neutral pour les devises sans biais IA → jamais de faux biais)
  }
  return out;
}

// Seasonality RÉELLE (même méthodo que market-bulls : rendement moyen du mois civil sur 5 ans),
// dérivée de la courbe saisonnière déjà calculée par FX List (_seasonal) → AUCUN fetch en plus, AUCUNE IA.
// Par paire : rendement saisonnier du MOIS COURANT = seasonal[m] - seasonal[m-1] (courbe cumulée Jan→Déc).
// Agrégation par devise comme la force : la devise de base gagne quand la paire monte, la devise de cotation perd.
async function _sbSeasonalityRow() {
  const out = {};
  try {
    const fx = await computeFxList();
    const pairs = fx?.pairs || [];
    const m = new Date().getUTCMonth();   // mois courant (le bias se régénère chaque semaine)
    const score = {}, cnt = {};
    SB_CURRENCIES.forEach(c => { score[c] = 0; cnt[c] = 0; });
    pairs.forEach(p => {
      const s = p.seasonal;
      if (!Array.isArray(s) || s.length < 12) return;
      const mRet = s[m] - (m > 0 ? s[m - 1] : 0);   // rendement saisonnier moyen du mois courant
      if (!Number.isFinite(mRet)) return;
      if (SB_CURRENCIES.includes(p.base))  { score[p.base]  += mRet; cnt[p.base]++; }
      if (SB_CURRENCIES.includes(p.quote)) { score[p.quote] -= mRet; cnt[p.quote]++; }
    });
    SB_CURRENCIES.forEach(c => {
      const avg = cnt[c] ? score[c] / cnt[c] : 0;   // tendance saisonnière nette de la devise (%)
      out[c] = avg > 0.25 ? 'Bullish' : avg < -0.25 ? 'Bearish' : 'Neutral';
    });
  } catch { SB_CURRENCIES.forEach(c => out[c] = 'Neutral'); }
  return out;
}

// ── Narratif Smart Bias data-driven (réplique du repli client) FIGÉ dans le snapshot → ne change plus en cours de semaine ──
const _SB_QUAL_S  = { 'Very Bullish':'nettement favorable','Bullish':'favorable','Weak Bullish':'légèrement favorable','Neutral':'neutre','Range':'neutre','N/A':'neutre','Weak Bearish':'légèrement défavorable','Bearish':'défavorable','Very Bearish':'nettement défavorable','Uptrend':'favorable','Downtrend':'défavorable' };
const _SB_TREND_S = { 'Uptrend':'haussière','Downtrend':'baissière','Range':'sans direction nette','Neutral':'sans direction nette','N/A':'sans direction nette' };
const _SB_SCORE_S = { 'Very Bullish':2,'Bullish':1,'Weak Bullish':1,'Uptrend':1,'Neutral':0,'Range':0,'Weak Bearish':-1,'Bearish':-1,'Downtrend':-1,'Very Bearish':-2 };
function _sbDataNarrative(curr, rows, conclusion) {
  rows = rows || [];
  const val = k => { const r = rows.find(x => x.key === k); return r ? (r.values[curr] || 'N/A') : 'N/A'; };
  const q  = v => _SB_QUAL_S[v]  || 'neutre';
  const qt = v => _SB_TREND_S[v] || 'sans direction nette';
  const has = v => v && v !== 'N/A';
  const overall = (conclusion && conclusion[curr]) || 'Neutral';
  const fund=val('fundamental'),mon=val('monetary'),hf=val('hedgeFund'),ret=val('retail'),bank=val('bankOverview'),tr=val('trend'),seas=val('seasonality');
  const bulls = rows.filter(r => (_SB_SCORE_S[r.values[curr]]||0) > 0).map(r => r.label);
  const bears = rows.filter(r => (_SB_SCORE_S[r.values[curr]]||0) < 0).map(r => r.label);
  const OVR = { 'Very Bullish':'nettement haussier','Bullish':'haussier','Weak Bullish':'légèrement haussier','Neutral':'neutre','Range':'neutre','N/A':'neutre','Weak Bearish':'légèrement baissier','Bearish':'baissier','Very Bearish':'nettement baissier' };
  const ov = OVR[overall] || 'neutre';
  const P = [`Cette semaine, le biais sur ${curr} ressort ${ov}.`];
  // Macro : on relie fondamentaux et politique monétaire en une lecture
  if (has(fund) && has(mon)) {
    const coherent = q(fund) === q(mon);
    P.push(`Sur le plan macro, le contexte fondamental est ${q(fund)} et la politique monétaire ${q(mon)} — ${coherent ? 'des signaux qui vont dans le même sens' : 'des signaux à nuancer l’un par l’autre'}.`);
  } else if (has(fund)) P.push(`Côté macro, le contexte fondamental ressort ${q(fund)}.`);
  else if (has(mon))   P.push(`Côté macro, la politique monétaire ressort ${q(mon)}.`);
  // Positionnement : COT / retail / banques en récit
  const pos = [];
  if (has(hf))   pos.push(`les fonds (COT) sont ${q(hf)}`);
  if (has(ret))  pos.push(`le sentiment retail ${q(ret)}`);
  if (has(bank)) pos.push(`le consensus bancaire ${q(bank)}`);
  if (pos.length) P.push(`Au niveau du positionnement, ${pos.join(', ')}.`);
  // Technique
  const tech = [];
  if (has(tr))   tech.push(`la tendance est ${qt(tr)}`);
  if (has(seas)) tech.push(`la saisonnalité ${q(seas)}`);
  if (tech.length) P.push(`Techniquement, ${tech.join(' et ')}.`);
  // Conclusion : soutiens vs pressions, formulée en bilan
  if (bulls.length && bears.length) P.push(`Au total, les soutiens (${bulls.join(', ')}) et les pressions (${bears.join(', ')}) se compensent en partie — d'où un biais ${ov} sans conviction tranchée.`);
  else if (bulls.length) P.push(`Les principaux soutiens viennent de ${bulls.join(', ')}, sans réelle force opposée.`);
  else if (bears.length) P.push(`Les principales pressions viennent de ${bears.join(', ')}, sans réel soutien en face.`);
  else P.push('Aucun facteur ne domine nettement : un biais sans direction marquée.');
  return P.join(' ');
}
// Un narratif est « réel » (IA) s'il est substantiel ET n'est PAS la synthèse data-driven de secours
// (cette dernière commence TOUJOURS par « Le biais hebdomadaire global ressort … » en français).
function _sbIsRealNarrative(t) {
  t = (t == null ? '' : String(t)).trim();
  if (t.length <= 80) return false;
  if (/^(Cette semaine, le biais sur|Le biais hebdomadaire (global )?ressort)/i.test(t)) return false;   // mon repli data-driven (pas le vrai narratif IA)
  if (!/[.!?»"”]$/.test(t)) return false;   // TRONQUÉ (coupé en plein mot/phrase, ex. "…de la polit") → à régénérer
  return true;
}
// Dernier narratif IA RÉEL connu pour une devise dans l'HISTORIQUE hebdo (semaines archivées).
// → quand l'IA est à quota et que le texte de la semaine manque, on sert le DERNIER rapport IA
//   généré (semaine précédente) plutôt que le template data-driven : toujours un vrai texte.
function _sbHistNarrative(c) {
  try {
    for (const s of _smartBiasHistory || []) {
      if (s && s.narrative && _sbIsRealNarrative(s.narrative[c])) return s.narrative[c];
    }
  } catch {}
  return null;
}
// Résout le narratif pour l'AFFICHAGE SANS muter le cache : IA réel si présent, sinon dernier texte
// IA de l'HISTORIQUE, sinon synthèse data-driven. Le cache interne (_smartBias.narrative) ne contient
// JAMAIS de repli, donc le retry IA sait toujours quoi régénérer.
function _sbFillNarrative(bias) {
  if (!bias || !Array.isArray(bias.rows) || !bias.rows.length) return bias;
  const src = bias.narrative || {};
  const narrative = {};
  (bias.currencies || SB_CURRENCIES).forEach(c => {
    narrative[c] = _sbIsRealNarrative(src[c]) ? src[c] : (_sbHistNarrative(c) || _sbDataNarrative(c, bias.rows, bias.conclusion));
  });
  return Object.assign({}, bias, { narrative });   // COPIE → ne mute pas bias.narrative (qui reste IA-seul)
}
async function generateSmartBias(force = false, weekly = false) {
  // weekly=true : run HEBDO planifié (samedi 02h00) → réécrit AUSSI les 8 narratifs IA.
  // weekly=false (régén en semaine : redéploiement, version, self-heal) → narratifs du samedi CONSERVÉS.
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  if (!force && _smartBias && Date.now() - (_smartBias.generatedAt || 0) < WEEK) return _smartBias;

  const cutoff = Date.now() - WEEK;
  const heads  = allNews.filter(i => i.timestamp > cutoff).slice(0, 150).map(i => `[${i.category || ''}] ${i.headline}`).join('\n');

  // ── ANCRAGE sur les VRAIES sources DTP (anti faux-bias / hors-sujet) ─────────
  // hedgeFund ← COT réel ; bankOverview ← rapports de banque réels ; + régime de risque.
  let cotLine = '';
  try {
    const cot = await fetchCOTData('noncomm');   // CFTC non-commercial = grandes spéculatives (≈ hedge funds)
    if (Array.isArray(cot) && cot.length) cotLine = cot.map(r => `${r.key}: net ${r.net > 0 ? '+' : ''}${r.net} (${r.sentiment}, ${r.longPct}%L/${r.shortPct}%S)`).join('; ');
  } catch (e) { console.warn('[SmartBias] COT indispo:', e.message); }
  let bankLine = '';
  try {
    const rec = (_brCache || []).filter(i => (i.timestamp || 0) > cutoff).map(i => i.headline || i.title).filter(Boolean).slice(0, 14);
    if (rec.length) bankLine = rec.join(' | ');
  } catch {}
  let riskLine = '';
  try { if (_riskData && _riskData.label) riskLine = `${_riskData.label}${typeof _riskData.score === 'number' ? ` (score ${_riskData.score})` : ''}`; } catch {}
  // retail ← sentiment crowd RÉEL (myfxbook), par paire ; l'IA mappe symbole→devise (contrarian).
  let retailLine = '';
  try {
    const out = await fetchCommunityOutlook('H1');
    const MAJ = /^(EURUSD|GBPUSD|USDJPY|USDCHF|USDCAD|AUDUSD|NZDUSD|EURGBP|EURJPY|GBPJPY|AUDJPY|EURCHF|EURAUD|CADJPY)$/;
    const rows = (Array.isArray(out) ? out : []).filter(s => MAJ.test(s.symbol)).map(s => `${s.symbol}: ${s.longPct}%L/${s.shortPct}%S (retail ${s.trend})`);
    if (rows.length) retailLine = rows.join('; ');
  } catch (e) { console.warn('[SmartBias] retail indispo:', e.message); }
  // fundamental/monetary ← CALENDRIER de la SEMAINE ÉCOULÉE (N-1) : events High/Medium PUBLIÉS (actual vs
  // forecast = surprises de données + décisions CB). SOURCE = _buildTVCalendar() (TradingView, fenêtre 21 j
  // PASSÉS → 10 j futurs, avec actuals natifs ; live + caché 4 min, indépendant de Supabase) ; repli allCalendar.
  // ⚠️ allCalendar seul = calendrier ForexFactory PROSPECTIF (semaine en cours, sans actual un lundi) → il
  //    ne portait JAMAIS de surprises pour le bias (Fundamental/Monetary restaient Neutral). On lit donc le TV.
  let calLine = '';
  try {
    let calSrc = [];
    try { calSrc = await _buildTVCalendar(); } catch {}
    if (!calSrc || !calSrc.length) calSrc = allCalendar || [];          // repli si TV indisponible
    const _calCut = Date.now() - 8 * 86400000;                          // ~8 derniers jours = la semaine écoulée (+ marge)
    const evs = calSrc
      .filter(e => e && (e.impact === 'High' || e.impact === 'Medium') && e.actual && e.forecast && SB_CURRENCIES.includes(e.currency) && (e.timestamp || 0) >= _calCut)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, 40)
      .map(e => `${e.currency} ${e.title}: actual ${e.actual} vs exp ${e.forecast}`);
    if (evs.length) calLine = evs.join('; ');
  } catch (e) { console.warn('[SmartBias] calendrier indispo:', e.message); }

  // weeklyRecap ← les 2 RAPPORTS HEBDO DTP : Weekly Market Recap (rétrospectif : ce qui s'est passé,
  // biais par paire BUY/SELL/NEUTRAL + analyse par devise) + Global Economic Weekly (prospectif).
  // = notre PROPRE synthèse de la semaine écoulée → signal directionnel fort pour le bias.
  let recapLine = '';
  try {
    const recaps = (allNews || [])
      .filter(i => i && (i._reportType === 'Weekly Market Recap' || i._reportType === 'Global Economic Weekly') && i._weekly)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const seenT = new Set(), parts = [];
    for (const r of recaps) {
      if (seenT.has(r._reportType)) continue; seenT.add(r._reportType);   // le plus récent de CHAQUE type (les 2 recaps)
      const w = r._weekly || {}, seg = [];
      if (w.summary) seg.push(String(w.summary).replace(/\s+/g, ' ').slice(0, 360));
      if (Array.isArray(w.pairs) && w.pairs.length) seg.push('pairs: ' + w.pairs.filter(p => p && p.pair).map(p => `${p.pair} ${p.bias || 'NEUTRAL'}`).join(', '));
      if (w.currencies && Object.keys(w.currencies).length) {
        const cc = SB_CURRENCIES.filter(c => w.currencies[c] && w.currencies[c].analysis).map(c => `${c}: ${String(w.currencies[c].analysis).replace(/\s+/g, ' ').slice(0, 150)}`);
        if (cc.length) seg.push('by currency → ' + cc.join(' | '));
      }
      if (seg.length) parts.push(`[${r._reportType}${w.weekRange ? ' · ' + w.weekRange : ''}] ` + seg.join(' || '));
      if (seenT.size >= 2) break;
    }
    recapLine = parts.join('\n').slice(0, 2400);
  } catch (e) { console.warn('[SmartBias] weekly recap indispo:', e.message); }

  const prompt = `You are a senior FX strategist building a "Smart Bias" matrix for the 8 major currencies: ${SB_CURRENCIES.join(', ')}.
For EACH currency, rate each indicator using EXACTLY one of: "Very Bullish", "Bullish", "Neutral", "Bearish", "Very Bearish".

RATING RULE — be DECISIVE and DIRECTIONAL, grounded ONLY in the data below (never fabricate a signal a source does not support):
- When the data for a currency/indicator carries ANY clear lean — even moderate — COMMIT to "Bullish" or "Bearish". Do NOT default to "Neutral" for a mild but real signal.
- Use "Very Bullish"/"Very Bearish" when the data is strong or one-sided (large COT net, clear data beats/misses, aligned bank stance, extreme retail crowding).
- Use "Neutral" ONLY when the data for that currency/indicator is genuinely ABSENT from the sources, or gives DIRECTLY CONFLICTING signals of similar weight.
This bias must be USEFUL and directional for the week ahead — a wall of "Neutral" is a failure. But rating a direction with NO supporting data in the sources below is also a failure: read the data, then commit.

Map each indicator to its SOURCE (use ONLY that source):
- fundamental: macro/data momentum → from the CALENDAR DATA below (actual vs forecast: beats → Bullish, misses → Bearish) + the PAST-WEEK HEADLINES.
- bankOverview: aggregate sell-side bank stance → from the BANK RESEARCH headlines below ONLY (no bank coverage for a currency → Neutral).
- hedgeFund: large-speculator positioning → from the COT DATA below ONLY (net long → Bullish, net short → Bearish; bigger net = stronger conviction). Currency absent from COT → Neutral.
- retail: retail crowd positioning (CONTRARIAN) → from the RETAIL SENTIMENT below. Retail heavily LONG a currency (via its pairs) → bias it Bearish; heavily SHORT → Bullish. No retail data for a currency → Neutral.
- monetary: central-bank policy stance → from CALENDAR central-bank events (rate decisions) + headlines mentioning central banks / officials.
- weeklyRecap: DTP's OWN weekly stance per currency → from the DTP WEEKLY RECAPS below ONLY (per-pair BUY/SELL bias + per-currency analysis). Translate pairs into per-currency direction (EUR/USD BUY → EUR Bullish, USD slightly Bearish; USD/JPY SELL → USD Bearish, JPY Bullish), corroborated by the per-currency analysis text. No DTP coverage for a currency → Neutral.

== COT DATA (CFTC non-commercial / large specs — the ONLY source for hedgeFund) ==
${cotLine || 'n/a'}
== RECENT BANK RESEARCH headlines (the ONLY source for bankOverview) ==
${bankLine || 'n/a'}
== GLOBAL RISK REGIME (context) ==
${riskLine || 'n/a'}
== RETAIL SENTIMENT (myfxbook crowd — CONTRARIAN, the ONLY source for retail) ==
${retailLine || 'n/a'}
== CALENDAR — high/medium-impact releases, actual vs forecast (source for fundamental & monetary) ==
${calLine || 'n/a'}
== PAST-WEEK HEADLINES ==
${heads || 'n/a'}
== DTP WEEKLY RECAPS — our OWN synthesis of the elapsed week (the ONLY source for weeklyRecap) ==
${recapLine || 'n/a'}

Return ONLY valid JSON: {"rows":{"fundamental":{"USD":"Bullish","EUR":"...", ...all 8...},"bankOverview":{...},"weeklyRecap":{...},"hedgeFund":{...},"retail":{...},"monetary":{...}}}`;

  let gem = {};
  let aiOk = false;
  try {
    aiNote('bias');
    const t = await ai.generateText(prompt, 2400);
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('No JSON');
    gem = JSON.parse(m[0]).rows || {};
    aiOk = Object.keys(gem).length > 0;
  } catch (e) {
    console.error('[SmartBias]', e.message);
  }
  // IA indisponible (quota / JSON KO) → on NE bloque PLUS la mise à jour (sinon le seed périmé
  // reste servi avec une vieille date et SANS narratif). On réutilise les dernières valeurs IA
  // connues (matrice précédente ou seed) pour les 5 lignes IA, MAIS on rafraîchit quand même
  // Trend + Seasonality (réels) + generatedAt → la date reste à jour et la saisonnalité exacte.
  if (!aiOk) {
    console.warn('[SmartBias] IA indispo → on conserve les lignes IA précédentes et on rafraîchit Trend/Seasonality/date');
    const prevRows = (_smartBias && Array.isArray(_smartBias.rows)) ? _smartBias.rows : [];
    ['fundamental', 'bankOverview', 'weeklyRecap', 'hedgeFund', 'retail', 'monetary'].forEach(k => {
      const r = prevRows.find(x => x.key === k);
      gem[k] = (r && r.values) ? r.values : {};
    });
  }

  const trend = await _sbTrendRow();
  const seasonality = await _sbSeasonalityRow();   // RÉELLE (saisonnalité 5 ans, cf. _sbSeasonalityRow) — plus de devinette IA
  const technical = await _sbTechnicalRow();       // force devise 1 jour (court terme)
  const sentiment = _sbSentimentRow();             // régime de risque mappé par devise
  // Conclusion = calcul DÉTERMINISTE pur (lib/bias-calc.js) → testable, zéro dérive, seuils alignés DTP.
  // Elle agrège TOUTES les lignes (dont Technical + Sentiment) → le Overall reflète exactement la matrice.
  // IMPORTANT : Technical (force 1j) et Sentiment (régime de risque) sont VOLATILS (intra-journée).
  // On les AFFICHE comme lignes (épuré) mais on NE les inclut PAS dans le Overall, sinon le
  // Overall dériverait en continu et contredirait le narratif (généré périodiquement). Le Overall
  // reste donc calé sur les indicateurs STABLES (hebdo/mensuels) → cohérence narratif ↔ matrice garantie.
  const conclusion = {};
  SB_CURRENCIES.forEach(c => {
    const vals = SB_GEM_ROWS.map(r => (gem[r.key] ? gem[r.key][c] : null));
    vals.push(trend[c]);
    vals.push(seasonality[c]);
    conclusion[c] = concludeBias(vals);
  });

  // Ordre d'affichage (aligné pro) : Fundamental, Bank Overview, Technical, Sentiment,
  // Hedge Fund, Retail, Monetary, Trend, Seasonality.
  const rows = [];
  const _pushGem = k => { const def = SB_GEM_ROWS.find(r => r.key === k); rows.push({ key: k, label: def.label, values: gem[k] || {} }); };
  _pushGem('fundamental');
  _pushGem('bankOverview');
  _pushGem('weeklyRecap');   // synthèse DTP de la semaine écoulée (Weekly Market Recap + Global Economic Weekly)
  rows.push({ key: 'technical', label: 'Technical', values: technical });
  rows.push({ key: 'sentiment', label: 'Sentiment', values: sentiment });
  _pushGem('hedgeFund');
  _pushGem('retail');
  _pushGem('monetary');
  rows.push({ key: 'trend', label: 'Trend', values: trend });
  rows.push({ key: 'seasonality', label: 'Seasonality', values: seasonality });

  // Narratif IA hebdo par devise — RÈGLE UTILISATEUR : le texte généré le SAMEDI reste FIXE
  // jusqu'au samedi suivant. On GARDE donc TOUS les narratifs IA réels existants (même si le
  // Overall recalculé a bougé en semaine — plus aucun rejet/régénération en cours de semaine).
  // Seul le run HEBDO du samedi (weekly=true) réécrit les 8 textes.
  let narrative = (_smartBias && _smartBias.narrative) || null;
  const _prevBias = (_smartBias && _smartBias.narrativeBias) || {};
  if (narrative) {
    const _clean = {};
    for (const _c of SB_CURRENCIES) if (_sbIsRealNarrative(narrative[_c])) _clean[_c] = narrative[_c];
    narrative = Object.keys(_clean).length ? _clean : null;
  }
  // Tag de biais : le Overall que chaque narratif reflète (conservé tel quel pour les textes gardés).
  const narrativeBias = {};
  for (const _c of SB_CURRENCIES) if (narrative && narrative[_c]) narrativeBias[_c] = (_prevBias[_c] != null ? _prevBias[_c] : conclusion[_c]);
  if (aiOk) {
    try {
      // weekly (samedi) → on régénère TOUT ; sinon on ne génère QUE les devises sans vrai narratif.
      const _todo = weekly ? null : SB_CURRENCIES.filter(c => !_sbIsRealNarrative((narrative || {})[c]));
      if (weekly || (_todo && _todo.length)) {
        const n = await _sbGenerateNarratives(rows, conclusion, [cotLine, bankLine, calLine, retailLine, riskLine, recapLine], _todo);
        if (n) { narrative = Object.assign({}, narrative || {}, n); for (const _c of Object.keys(n)) narrativeBias[_c] = conclusion[_c]; }
      }
    } catch {}
  }
  // Biais par BANQUE (toutes les banques d'Institution) — recalculé si l'IA est dispo, sinon on
  // conserve le précédent (le front retombe sur les positions si rien). 0 invention.
  // On liste TOUJOURS toutes les banques d'Institution (même IA coupée → Neutral, biais réels à la reprise).
  let bankStances = {};
  try { bankStances = await _sbBankStances(); } catch {}
  if (!Object.keys(bankStances).length && _smartBias && _smartBias.bankStances) bankStances = _smartBias.bankStances;
  // Versioning : on archive la semaine sortante (max 5 semaines distinctes) quand on bascule sur une NOUVELLE semaine.
  try {
    if (_smartBias && _smartBias.generatedAt && Array.isArray(_smartBias.rows) && _smartBias.rows.length
        && _sbWeekKey(_smartBias.generatedAt) !== _sbWeekKey(Date.now())) {
      const k = _sbWeekKey(_smartBias.generatedAt);
      _smartBiasHistory = [_smartBias, ..._smartBiasHistory.filter(s => s && s.generatedAt && _sbWeekKey(s.generatedAt) !== k)].slice(0, 5);
      try { fs.writeFileSync(SMART_BIAS_HIST_FILE, JSON.stringify(_smartBiasHistory)); } catch {}
      auth.aiCacheSet('smartbias:history', _smartBiasHistory).catch(() => {});
    }
  } catch {}
  _smartBias = { generatedAt: Date.now(), v: BIAS_VER, currencies: SB_CURRENCIES, rows, conclusion, narrative, narrativeBias, bankStances, ctxLines: [cotLine, bankLine, calLine, retailLine, riskLine, recapLine].filter(Boolean) };
  // Régénération complète → les overrides admin (correctifs ponctuels d'aberrations IA) expirent :
  // la nouvelle matrice repart sur les données fraîches, l'admin ne corrige que si besoin à nouveau.
  try { if (Object.keys(_sbOverrides || {}).length) { _sbOverrides = {}; auth.aiCacheSet('sb:overrides', {}).catch(() => {}); } } catch {}
  // NB : on NE remplit PLUS le repli dans _smartBias.narrative (il reste IA-seul). Le repli data-driven est
  // ajouté UNIQUEMENT à l'affichage par _sbFillNarrative → le retry IA (_sbEnsureNarrative) régénère ce qui manque.
  try { fs.writeFileSync(SMART_BIAS_FILE, JSON.stringify(_smartBias)); } catch {}
  auth.aiCacheSet('smartbias:matrix', _smartBias).catch(() => {});   // DURABLE (Supabase) → survit aux redéploys, pas de régén/quota gaspille
  // Observabilité : sources REELLEMENT recues + conclusion par devise → permet de verifier l'absence de faux bias.
  console.log(`[SmartBias] ${aiOk ? 'OK' : 'IA-DOWN (rows précédentes + Trend/Seasonality réels)'} — sources: COT=${cotLine ? 'oui' : 'NON'} retail=${retailLine ? 'oui' : 'NON'} banques=${bankLine ? 'oui' : 'NON'} calendrier=${calLine ? 'oui' : 'NON'} | conclusion: ${SB_CURRENCIES.map(c => c + '=' + (conclusion[c] || '?')).join(' ')}`);
  try { broadcast({ type: 'smartbias_update', bias: _smartBias }); } catch {}
  return _smartBias;
}

// Narratif hebdo par devise : UN appel aiSmart('bias') PAR devise (prompt court → AUCUNE troncature
// JSON ; un échec n'impacte qu'UNE devise, les autres restent IA). Passe par le quota standard, en
// mode {scheduled} (cycle hebdo planifié — jamais à l'arrivée d'un utilisateur). Repli null si rien
// n'aboutit → _sbFillNarrative compose alors une synthèse data-driven (0 token). Cache porté par _smartBias.
async function _sbGenerateNarratives(rows, conclusion, ctxLines, only) {
  const ctx = (ctxLines || []).filter(Boolean).join('\n').slice(0, 2400);
  const CB_OF = { USD: 'la Fed', EUR: 'la BCE', GBP: 'la BoE', JPY: 'la BoJ', CHF: 'la BNS', CAD: 'la BoC', AUD: 'la RBA', NZD: 'la RBNZ' };
  const list = (Array.isArray(only) && only.length) ? only.filter(c => SB_CURRENCIES.includes(c)) : SB_CURRENCIES;
  const narr = {};
  for (const c of list) {
    try {
      const ind  = rows.map(r => `${r.label}=${r.values[c] || 'Neutral'}`).join(', ');
      const bias = conclusion[c] || 'Neutral';
      const prompt = `Tu es un stratège FX institutionnel de tout premier plan. Rédige EN FRANÇAIS le rapport hebdomadaire de marché pour ${c} UNIQUEMENT — ~350-450 mots, ton froid, analytique, technique, vocabulaire institutionnel dense (demande de valeurs refuges, repricing hawkish, marché sans tendance, rendements de la partie courte, "higher-for-longer"). Chaque phrase doit porter un fait macro, un chiffre, une décision de banque centrale ou un flux précis — AUCUN remplissage. Ne CONTREDIS JAMAIS le biais Overall calculé de ${c} (${bias}). Appuie TOUT strictement sur les données RÉELLES ci-dessous ; n'invente aucun chiffre. Écris avec TES PROPRES mots — ne recopie jamais une source externe.

Structure en prose fluide (PAS de markdown, PAS de titres, PAS de puces) :
- Chronologie de la semaine ("En début de semaine" / "En milieu de semaine" / "Jeudi-vendredi") reliant ${c} aux thèmes de la semaine et à l'appétit pour le risque mondial.
- Politique monétaire : ${CB_OF[c] || 'la banque centrale'} — cite les officiels mentionnés dans le contexte et explique leur posture.
- Données macro : les publications de la semaine avec les chiffres EXACTS réalisé vs consensus tirés du contexte.
- Taux & obligations : comportement des emprunts d'État et adjudications (bid-to-cover) tirés du contexte.
- Perspectives : "À court terme :" le biais explicite (aligné sur ${bias}) + les catalyseurs qui l'invalideraient ; puis "À plus long terme :" l'équilibre macro structurel.

Indicateurs ${c} : ${ind}

CONTEXTE RÉEL (cette semaine — COT, recherche bancaire, calendrier économique réalisé vs prévu, régime de risque, actualités) :
${ctx}

Renvoie UNIQUEMENT le texte du rapport ${c} — aucun préambule, aucune étiquette, aucun guillemet, aucun JSON, aucune balise de code. Commence DIRECTEMENT par la chronologie de la semaine (ne commence JAMAIS par "Le biais hebdomadaire global ressort").`;
      const out = await aiSmart('bias', prompt, 1500, { scheduled: true });   // assez de tokens pour ~350-450 mots COMPLETS
      let txt = (out || '').replace(/```[a-z]*|```/gi, '').trim();
      // Plafond GÉNÉREUX (le rapport fait ~2800-3200 car.). Si jamais on dépasse, on coupe à la
      // DERNIÈRE phrase complète → plus jamais de mot tronqué ("…de la polit").
      if (txt.length > 4000) {
        const m = txt.slice(0, 4000).match(/^[\s\S]*[.!?»][»"”]?/);
        txt = (m ? m[0] : txt.slice(0, 4000)).trim();
      }
      if (txt && txt.length > 80) narr[c] = txt;
    } catch (e) { console.warn(`[SmartBias] narratif ${c} échec:`, e.message); }
  }
  return Object.keys(narr).length ? narr : null;
}

// ── SELF-HEAL : réessai EN TÂCHE DE FOND (throttlé + verrouillé → AUCUN doublon de requête) ──
// Corrige la cause racine : si la génération hebdo tombe sur un quota épuisé, l'ancienne matrice
// (potentiellement périmée d'une saison) reste servie indéfiniment. Ici, à chaque ouverture de
// l'onglet Bias on relance discrètement la régén SI c'est périmé, OU on remplit juste le narratif
// s'il manque. Une fois généré, c'est caché jusqu'au samedi suivant → zéro régénération inutile.
function _sbBiasStale() {
  return !_smartBias || _smartBias.v !== BIAS_VER || !_smartBias.generatedAt
    || (Date.now() - _smartBias.generatedAt > 7 * 24 * 60 * 60 * 1000);
}
let _sbNarrBusy = false, _sbNarrLastTry = 0;
async function _sbEnsureNarrative() {
  if (ai.backoffActive && ai.backoffActive()) return;   // panne IA totale en cours → on s'espace (backoff exponentiel) au lieu de marteler
  if (!_smartBias || !Array.isArray(_smartBias.rows) || !_smartBias.rows.length) return;
  const have = _smartBias.narrative || {};
  const concl = _smartBias.conclusion || {};
  // À régénérer : UNIQUEMENT narratif absent / repli / TRONQUÉ. RÈGLE UTILISATEUR : un texte IA
  // généré le samedi reste FIXE jusqu'au samedi suivant — on ne le réécrit PLUS si le Overall bouge.
  const missing = SB_CURRENCIES.filter(c => !_sbIsRealNarrative(have[c]));
  // Re-tente tant qu'AU MOINS UNE banque n'a pas encore de biais (st vide OU banque éligible absente).
  // (Avant : ne retentait QUE si AUCUNE banque n'en avait → dès que 3-4 banques passaient, les 15 autres
  //  restaient « — » à vie. Désormais on complète jusqu'à ce que TOUTES les banques éligibles aient un biais.)
  const _bsv = Object.values(_smartBias.bankStances || {});
  const _bsHave = _bsv.filter(st => st && Object.keys(st).length).length;
  const _bsEligible = new Set((_brCache || []).filter(a => a && a.institution && (a.timestamp || 0) >= Date.now() - 35 * 24 * 60 * 60 * 1000).map(a => String(a.institution).replace(/\s+Research$/i, '').trim())).size;
  const needBank = !_bsv.length || _bsv.some(st => !st || !Object.keys(st).length) || _bsHave < _bsEligible;
  if (!missing.length && !needBank) return;                                       // tout réel/cohérent ET banques OK → rien à faire
  if (_sbNarrBusy) return;
  if (Date.now() - _sbNarrLastTry < 10 * 60 * 1000) return;                       // 1 tentative / 10 min max
  _sbNarrBusy = true; _sbNarrLastTry = Date.now();
  try {
    let changed = false, doneN = 0;
    const _quiet = typeof _aiQuietHours === 'function' && _aiQuietHours();   // narratifs (lourds) = pas en heures creuses ; biais BANQUES (léger) = on complète même la nuit
    if (missing.length && !_quiet) {
      const narr = await _sbGenerateNarratives(_smartBias.rows, _smartBias.conclusion, _smartBias.ctxLines || [], missing);
      if (narr && Object.keys(narr).length) {
        _smartBias.narrative = Object.assign({}, _smartBias.narrative || {}, narr); // merge : garde l'existant réel, ajoute les régénérés
        _smartBias.narrativeBias = Object.assign({}, _smartBias.narrativeBias || {});
        for (const c of Object.keys(narr)) _smartBias.narrativeBias[c] = concl[c];   // tag = Overall reflété par le nouveau texte
        doneN = Object.keys(narr).length; changed = true;
      }
    }
    if (needBank) {   // remplit le biais par banque (toutes les banques d'Institution) dès que l'IA est dispo
      const bs = await _sbBankStances();
      if (bs && Object.keys(bs).length) { _smartBias.bankStances = bs; changed = true; }
    }
    if (changed) {
      try { fs.writeFileSync(SMART_BIAS_FILE, JSON.stringify(_smartBias)); } catch {}
      auth.aiCacheSet('smartbias:matrix', _smartBias).catch(() => {});            // DURABLE → survit aux restarts
      try { broadcast({ type: 'smartbias_update', bias: _sbFillNarrative(_smartBias) }); } catch {} // MAJ live
      const done = SB_CURRENCIES.filter(c => _sbIsRealNarrative((_smartBias.narrative || {})[c])).length;
      console.log(`[SmartBias] retry IA : narratifs ${doneN} régénéré(s) (${done}/${SB_CURRENCIES.length} réels), banques ${Object.keys(_smartBias.bankStances || {}).length} → cache + broadcast`);
    }
  } catch (e) { console.warn('[SmartBias] retry IA échec:', e.message); }
  finally { _sbNarrBusy = false; }
}
let _sbFreshBusy = false, _sbFreshLastTry = 0;
async function _sbEnsureFresh() {
  if (_sbBiasStale()) {                          // 1) matrice périmée (vieille version / >7j / absente) → régén complète
    if (_sbFreshBusy) return;
    if (Date.now() - _sbFreshLastTry < 10 * 60 * 1000) return;
    _sbFreshBusy = true; _sbFreshLastTry = Date.now();
    try { await generateSmartBias(true); } catch {} finally { _sbFreshBusy = false; }
    return;
  }
  await _sbEnsureNarrative();                    // 2) matrice fraîche mais narratif manquant → retry ciblé
}

// ── OVERRIDE ADMIN du Smart Bias (filet humain, façon « research team » PMT) ──────────────
// Si l'IA sort une aberration, l'admin corrige une cellule (ligne × devise) ou l'Overall sans
// attendre la régénération. Durable (KV Supabase), appliqué à la VOLÉE à l'affichage (la matrice
// IA sous-jacente n'est pas mutée), et AUTO-EXPIRÉ à la prochaine régénération complète.
// Usage (admin) : POST /api/admin/bias-override {ccy:"GBP", row:"fundamental"|"conclusion", value:"Bearish"|null}
let _sbOverrides = {};   // { CCY: { rowKey|conclusion: 'Very Bullish'|'Bullish'|'Neutral'|'Bearish'|'Very Bearish' } }
auth.aiCacheGet('sb:overrides').then(v => { if (v && typeof v === 'object') _sbOverrides = v; }).catch(() => {});
function _sbApplyOverrides(b) {
  if (!b || !Object.keys(_sbOverrides).length) return b;
  const out = Object.assign({}, b, {
    rows: (b.rows || []).map(r => {
      let values = r.values;
      for (const [ccy, o] of Object.entries(_sbOverrides)) if (o && o[r.key]) { if (values === r.values) values = Object.assign({}, r.values); values[ccy] = o[r.key]; }
      return values === r.values ? r : Object.assign({}, r, { values });
    }),
    conclusion: Object.assign({}, b.conclusion),
    overrides: _sbOverrides,   // exposé → le front/admin peut signaler les cellules corrigées à la main
  });
  for (const [ccy, o] of Object.entries(_sbOverrides)) if (o && o.conclusion) out.conclusion[ccy] = o.conclusion;
  return out;
}
const _SB_OK_VALUES = ['Very Bullish', 'Bullish', 'Neutral', 'Bearish', 'Very Bearish'];
app.post('/api/admin/bias-override', requireAdmin, async (req, res) => {
  const { ccy, row, value } = req.body || {};
  if (!SB_CURRENCIES.includes(ccy)) return res.status(400).json({ error: 'ccy invalide (' + SB_CURRENCIES.join('/') + ')' });
  const rowKeys = [...new Set([...(_smartBias && _smartBias.rows ? _smartBias.rows.map(r => r.key) : []), 'conclusion'])];
  if (!rowKeys.includes(row)) return res.status(400).json({ error: 'row invalide (' + rowKeys.join(', ') + ')' });
  if (value != null && value !== '' && !_SB_OK_VALUES.includes(value)) return res.status(400).json({ error: 'value invalide (' + _SB_OK_VALUES.join(' / ') + ' ou null pour effacer)' });
  if (value == null || value === '') { if (_sbOverrides[ccy]) { delete _sbOverrides[ccy][row]; if (!Object.keys(_sbOverrides[ccy]).length) delete _sbOverrides[ccy]; } }
  else (_sbOverrides[ccy] = _sbOverrides[ccy] || {})[row] = value;
  auth.aiCacheSet('sb:overrides', _sbOverrides).catch(() => {});
  try { if (_smartBias) broadcast({ type: 'smartbias_update', bias: _sbApplyOverrides(_sbFillNarrative(_smartBias)) }); } catch {}   // MAJ live des desks ouverts
  res.json({ ok: true, overrides: _sbOverrides });
});

app.get('/api/smart-bias', async (req, res) => {
  // Versioning : renvoyer le snapshot d'une semaine archivée (?at=<generatedAt>).
  if (req.query.at) {
    const ts = Number(req.query.at);
    const snap = [_smartBias, ..._smartBiasHistory].find(s => s && Number(s.generatedAt) === ts);
    return res.json((snap && _sbFillNarrative(snap)) || { currencies: SB_CURRENCIES, rows: [], conclusion: {} });
  }
  if ((req.query.force === '1' && req.session?.user?.role === 'admin') || !_smartBias) { try { await generateSmartBias(true); } catch {} }   // force=1 réservé ADMIN ; !_smartBias = amorçage à froid uniquement
  // Liste des semaines disponibles (courante + historique), dédupliquées par semaine, 5 max.
  const _seen = new Set();
  const history = [_smartBias, ..._smartBiasHistory]
    .filter(s => s && s.generatedAt)
    .filter(s => { const k = _sbWeekKey(s.generatedAt); if (_seen.has(k)) return false; _seen.add(k); return true; })
    .slice(0, 5)
    .map(s => ({ generatedAt: s.generatedAt }));
  // Narratif RÉSOLU pour l'affichage (IA réel si dispo, sinon synthèse data-driven) — SANS muter le cache interne.
  // + overrides admin appliqués à la volée (correctifs humains, auto-expirés à la prochaine régén complète).
  const _resolved = _smartBias ? _sbApplyOverrides(_sbFillNarrative(_smartBias)) : { currencies: SB_CURRENCIES, rows: [], conclusion: {} };
  res.json(Object.assign({}, _resolved, { history }));
  // AUCUN appel IA déclenché par l'arrivée d'un utilisateur : la (re)génération du bias est UNIQUEMENT planifiée (samedi) + timers de fond (démarrage / horaire). Le narratif est figé (rempli data-driven s'il manque).
});

// ═══════════════════ WEEK AHEAD — aperçu hebdomadaire (1×/semaine, même logique batch que le bias) ═══════════════════
const WEEK_AHEAD_FILE = path.join(_CACHE_DIR, 'cache_week_ahead.json');
const WA_VER = 'v15-percur-robuste';   // v15 : éditorial jour-par-jour + anti cache-partiel-bloqué + repli déterministe enrichi → force la régén
let _weekAhead = null;
try { _weekAhead = JSON.parse(fs.readFileSync(WEEK_AHEAD_FILE, 'utf8')); } catch {}
try { auth.aiCacheGet('weekahead:data').then(d => { if (d && Array.isArray(d.days) && d.days.length && d.generatedAt && (!(_weekAhead && _weekAhead.generatedAt) || d.generatedAt > _weekAhead.generatedAt)) _weekAhead = d; }).catch(() => {}); } catch {}

async function generateWeekAhead(force = false, genEditorial = false) {
  const FRESH = 40 * 60 * 1000;   // contenu rafraîchi ~40 min → prévisions/actuals quasi temps réel (la semaine affichée reste la semaine en cours)
  if (!force && _weekAhead && _weekAhead.v === WA_VER && Date.now() - (_weekAhead.generatedAt || 0) < FRESH) return _weekAhead;
  const now = Date.now();
  // « Semaine en cours » : fenêtre ancrée au LUNDI de la semaine (Lun→Dim). Le week-end → semaine à venir.
  const _d = new Date(now), _dow = _d.getUTCDay();                 // 0=dim … 6=sam
  const _toMon = (_dow === 0) ? 1 : (_dow === 6) ? 2 : (1 - _dow); // jours jusqu'au lundi cible
  const monday = Date.UTC(_d.getUTCFullYear(), _d.getUTCMonth(), _d.getUTCDate() + _toMon, 0, 0, 0);
  const weekEnd = monday + 7 * 24 * 60 * 60 * 1000;
  // Données calendrier FIABLES : MÊME source que l'onglet Calendar — TradingView (noms + prévisions + actuals natifs, temps réel). Repli ForexFactory si indispo.
  let cal = [];
  try { cal = await _buildTVCalendar(); } catch {}
  if (!Array.isArray(cal) || !cal.length) cal = allCalendar || [];
  const up = cal.filter(e => e && e.timestamp >= monday && e.timestamp < weekEnd && (e.impact === 'High' || e.impact === 'Medium'));
  const byDay = {};
  up.forEach(e => { const k = new Date(e.timestamp).toISOString().slice(0, 10); (byDay[k] = byDay[k] || []).push(e); });
  const keys = Object.keys(byDay).sort().slice(0, 7);
  if (!keys.length) { console.warn('[WeekAhead] calendrier vide → on garde l\'existant'); return _weekAhead; }
  // ── 100% DATA-DRIVEN (calendrier du terminal, AUCUN appel IA) → fiable + zéro consommation ──
  const _theme = t => { t = (t || '').toLowerCase();
    if (/\bcpi\b|inflation|hicp|\bppi\b|\bpce\b|price index/.test(t)) return 'Inflation';
    if (/payroll|\bnfp\b|employ|jobless|unemploy|labou?r|\bjobs\b/.test(t)) return 'Labour Market';
    if (/\bgdp\b|growth/.test(t)) return 'Growth';
    if (/\bpmi\b|\bism\b|manufacturing|services|industrial/.test(t)) return 'Activity (PMI)';
    if (/rate decision|monetary policy|central bank|fomc|\becb\b|\bboe\b|\bboj\b|\brba\b|\bsnb\b|\bboc\b|interest rate|rate statement/.test(t)) return 'Central Banks';
    if (/retail|sales|consumer|spending|confidence/.test(t)) return 'Consumer';
    if (/trade|export|import|current account/.test(t)) return 'Trade';
    return null; };
  // Accroche éditoriale FR (épuré) — déterministe, 0 IA.
  const THEME_FR = { 'Inflation': "l'inflation", 'Labour Market': "l'emploi", 'Growth': 'la croissance', 'Activity (PMI)': "l'activité (PMI)", 'Central Banks': 'les banques centrales', 'Consumer': 'la consommation', 'Trade': 'le commerce extérieur' };
  const DAY_FR = { Monday: 'lundi', Tuesday: 'mardi', Wednesday: 'mercredi', Thursday: 'jeudi', Friday: 'vendredi', Saturday: 'samedi', Sunday: 'dimanche' };
  const _cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const days = keys.map(k => {
    const evs = byDay[k].slice().sort((a, b) => (b.impact === 'High' ? 1 : 0) - (a.impact === 'High' ? 1 : 0));
    const d = new Date(k + 'T12:00:00Z');
    const hiEvs = evs.filter(e => e.impact === 'High');
    const risk = Math.max(15, Math.min(100, Math.round(evs.reduce((s, e) => s + (e.impact === 'High' ? 3 : 1), 0) * 9)));
    const ccys = [...new Set([...hiEvs, ...evs].map(e => e.currency).filter(Boolean))].slice(0, 4);
    const themes = [...new Set(evs.map(e => _theme(e.title || '')).filter(Boolean))].slice(0, 2);
    const dowEn = d.toLocaleDateString('en-US', { weekday: 'long' });
    // Repli déterministe RICHE en ANGLAIS (façon note de desk) — affiché tant que l'éditorial IA n'a pas généré. L'IA, quand dispo, l'écrase via day.headline/day.summary.
    const THEME_EN_H = { 'Inflation': 'Inflation', 'Labour Market': 'Labour Data', 'Growth': 'Growth Data', 'Activity (PMI)': 'PMI Surveys', 'Central Banks': 'Central Banks', 'Consumer': 'Consumer Data', 'Trade': 'Trade Data' };
    const enThemes = themes.map(t => THEME_EN_H[t]).filter(Boolean);
    let title;
    if (enThemes.length >= 2)       title = `${enThemes[0]} and ${enThemes[1]} Drive ${dowEn}'s Trading`;
    else if (enThemes.length === 1) title = `${enThemes[0]} Takes Center Stage on ${dowEn}`;
    else                            title = hiEvs.length ? `Key Risk Events on ${dowEn}` : `A Quieter ${dowEn} Session`;
    const base = (hiEvs.length ? hiEvs : evs).slice(0, 10);
    const _top = base.slice(0, 4).map(e => `${e.currency || ''} ${e.title}${e.forecast ? ` (fcst ${e.forecast})` : ''}`.trim()).filter(Boolean);
    const _cb = base.find(e => /rate decision|interest rate|monetary policy|rate statement|deposit facility|refinancing/i.test(e.title || ''));
    const _ccysEn = [...new Set(base.map(e => e.currency).filter(Boolean))].slice(0, 5);
    const _themeTxt = enThemes.length ? enThemes.join(' and ').toLowerCase() : (hiEvs.length ? 'high-impact data' : 'a lighter macro slate');
    const _dp = [];
    _dp.push(hiEvs.length
      ? `${dowEn} delivers a data-heavy session built around ${_themeTxt}, with several market-moving prints capable of resetting near-term direction.`
      : `${dowEn} brings a calmer calendar, leaving ${_ccysEn[0] || 'major FX'} more driven by broader macro themes, central-bank expectations and risk sentiment than by scheduled data.`);
    if (_top.length) _dp.push(`The docket features ${_top.join(', ')}${base.length > 4 ? ', alongside other second-tier releases' : ''} — each a read on ${(enThemes[0] || 'the macro pulse').toLowerCase()} that can shift rate-path expectations.`);
    if (_cb) _dp.push(`The ${_cb.currency} ${String(_cb.title).replace(/\s*\(.*?\)\s*/g, '').trim()} is the focal point: the decision and accompanying guidance will steer ${_cb.currency} and front-end yields, with any surprise rippling across rates and equities.`);
    if (_ccysEn.length) _dp.push(`${_ccysEn.join(', ')} sit in the crosshairs — watch the knee-jerk in FX, sovereign yields and risk assets as the actuals land versus consensus.`);
    _dp.push(hiEvs.length
      ? `Beats or misses on the high-impact prints are the clearest catalysts for a directional move into the close.`
      : `With little on the tape, positioning, central-bank speakers and headline risk are likely to set the tone.`);
    const description = _dp.join(' ') || 'Economic data on the day.';
    // Liste DÉTAILLÉE d'événements (façon DTP) : triée par heure → heure Paris · devise · intitulé · prév./préc. · impact.
    const events = base.slice().sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)).map(e => ({
      time: e.timestamp ? new Date(e.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }) : '',
      ccy: e.currency || '', title: (e.title || '').slice(0, 90),
      forecast: e.forecast || '', previous: e.previous || '',
      impact: e.impact === 'High' ? 'HIGH' : 'MED',
    }));
    return {
      dow: dowEn, date: String(d.getUTCDate()), month: MON[d.getUTCMonth()],
      title: title.slice(0, 170), description: description.slice(0, 920), events, ccys, impact: hiEvs.length ? 'HIGH' : 'MEDIUM', risk,
    };
  });
  if (!days.length) return _weekAhead;
  const weekKey = keys[0];                       // lundi de la semaine = clé éditorial (1 génération IA / semaine, cachée)
  try { await _waApplyEditorial(days, weekKey, genEditorial); } catch {}   // genEditorial=false → applique le cache (0 IA) ; true → génère (planifié)
  const first = new Date(keys[0] + 'T12:00:00Z'), last = new Date(keys[keys.length - 1] + 'T12:00:00Z');
  const week = `${first.getUTCDate()}-${last.getUTCDate()} ${last.toLocaleDateString('en-US', { month: 'long' })}`;
  _weekAhead = { generatedAt: Date.now(), v: WA_VER, week, days, editorialAI: days.filter(d => d.headline && d.summary).length };   // editorialAI = nb de jours rédigés par l'IA (diagnostic)
  try { fs.writeFileSync(WEEK_AHEAD_FILE, JSON.stringify(_weekAhead)); } catch {}
  auth.aiCacheSet('weekahead:data', _weekAhead).catch(() => {});
  console.log(`[WeekAhead] OK — ${days.length} jours | risk: ${days.map(d => (d.dow || '').slice(0, 3) + '=' + d.risk).join(' ')}`);
  try { _waPublishNews(weekKey); } catch (e) { console.warn('[WeekAhead news]', e.message); }   // publie/màj la news Week Ahead dans le feed
  return _weekAhead;
}
// ── NEWS « Week Ahead » : publiée dans le feed dès que le Week Ahead se met à jour (1×/semaine,
//    re-mise à jour si l'éditorial s'étoffe). Façon PMT : titre « Week in Focus … : Highlights … »
//    + calendrier par jour + éditorial. Clé par semaine → jamais de doublon (les MAJ 40 min n'en créent pas).
let _waNewsKey = null, _waNewsEdAI = -1;
const _WA_ABBR = { Monday: 'MON', Tuesday: 'TUE', Wednesday: 'WED', Thursday: 'THU', Friday: 'FRI', Saturday: 'SAT', Sunday: 'SUN' };
const _WA_CCY_ADJ = { USD: 'US', EUR: 'EZ', GBP: 'UK', JPY: 'Japan', AUD: 'Australia', NZD: 'NZ', CAD: 'Canada', CHF: 'Swiss', CNY: 'China', CNH: 'China' };
// Réduit un titre d'événement à un THÈME court (façon PMT) → [libellé, estBanqueCentrale]. null = pas un thème clé.
function _waTheme(title) {
  const t = ' ' + String(title || '').toLowerCase() + ' ';
  if (/\bfed\b|fomc|federal funds|federal reserve/.test(t)) return ['Fed', true];
  if (/\bboj\b|bank of japan/.test(t)) return ['BoJ', true];
  if (/\brbnz\b|reserve bank of new zealand/.test(t)) return ['RBNZ', true];
  if (/\brba\b|reserve bank of australia/.test(t)) return ['RBA', true];
  if (/\bboe\b|bank of england/.test(t)) return ['BoE', true];
  if (/\bsnb\b|swiss national bank/.test(t)) return ['SNB', true];
  if (/\becb\b|european central bank/.test(t)) return ['ECB', true];
  if (/\bboc\b|bank of canada/.test(t)) return ['BoC', true];
  if (/\bpboc\b|people'?s bank of china/.test(t)) return ['PBoC', true];
  if (/inflation|\bcpi\b|\bhicp\b/.test(t)) return ['Inflation', false];
  if (/\bppi\b|producer price/.test(t)) return ['PPI', false];
  if (/payroll|nonfarm|\bnfp\b/.test(t)) return ['Payrolls', false];
  if (/unemployment|jobless|\bjobs\b|employment change|labou?r market/.test(t)) return ['Jobs', false];
  if (/retail sales/.test(t)) return ['Retail Sales', false];
  if (/\bgdp\b|gross domestic/.test(t)) return ['GDP', false];
  if (/\bpmi\b|purchasing managers/.test(t)) return ['PMI', false];
  if (/interest rate decision|rate decision|monetary policy|policy announcement/.test(t)) return ['Rate Decision', false];
  return null;
}
function _waPublishNews(weekKey) {
  if (!weekKey || !_weekAhead || !Array.isArray(_weekAhead.days) || !_weekAhead.days.length) return;
  const days = _weekAhead.days, edAI = _weekAhead.editorialAI || 0, id = 'wa-news-' + weekKey;
  const idx = allNews.findIndex(i => i.id === id), existing = idx >= 0 ? allNews[idx] : null;
  const nbEv = days.reduce((n, d) => n + (d.events || []).length, 0);
  if (!existing && nbEv < 3) return;                                           // pas assez de calendrier pour une news utile
  if (existing && _waNewsKey === weekKey && edAI <= _waNewsEdAI) return;       // déjà publié cette semaine ; on ne republie QUE si l'éditorial IA s'étoffe
  // Highlights = THÈMES distincts des événements HIGH (façon PMT) : banques centrales d'abord
  // (Fed, BoJ…), puis données géo-qualifiées (US Inflation, UK Jobs…). Repli : titres HIGH nettoyés.
  const banks = [], data = [], hiAny = [], seen = new Set();
  for (const d of days) for (const e of (d.events || [])) {
    if (e.impact !== 'HIGH' || !e.title) continue;
    const clean = e.title.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
    if (clean && !hiAny.some(x => x.toLowerCase() === clean.toLowerCase())) hiAny.push(clean);
    const th = _waTheme(e.title); if (!th) continue;
    const [name, isBank] = th;
    const adj = _WA_CCY_ADJ[String(e.ccy || '').toUpperCase()];
    const label = isBank ? name : ((adj ? adj + ' ' : '') + name);
    const k = label.toLowerCase(); if (seen.has(k)) continue; seen.add(k);
    (isBank ? banks : data).push(label);
  }
  let top = banks.concat(data).slice(0, 10);
  if (!top.length) top = hiAny.slice(0, 8);                                    // aucun thème détecté → titres HIGH bruts nettoyés
  const highlights = top.length > 1 ? top.slice(0, -1).join(', ') + ' and ' + top[top.length - 1]
    : (top[0] || "the week's key macro events");
  const year = weekKey.slice(0, 4);
  const headline = `DTP Week Ahead — Week in Focus ${_weekAhead.week || ''} ${year}: Highlights include ${highlights}`.replace(/\s+/g, ' ').slice(0, 230);
  // Description = calendrier par jour + section WEEK AHEAD (éditorial par jour).
  // Format « JOUR: contenu » → le client style l'étiquette du jour (puce « section ») façon PMT.
  const cal = days.map(d => {
    const ab = _WA_ABBR[d.dow] || String(d.dow || '').slice(0, 3).toUpperCase();
    const evs = (d.events || []).slice(0, 14).map(e => e.title).filter(Boolean).join(' · ');
    return ab + ': ' + (evs || 'Données économiques.');
  });
  const ed = days.filter(d => d.headline || d.summary).map(d => {
    const ab = _WA_ABBR[d.dow] || String(d.dow || '').slice(0, 3).toUpperCase();
    const head = d.headline ? d.headline.replace(/\s*[.:;]\s*$/, '') + '. ' : '';
    return ab + ': ' + head + (d.summary || '');
  });
  const description = (cal.join('\n') + (ed.length ? '\n\nWEEK AHEAD\n' + ed.join('\n\n') : '')).slice(0, 9000);
  // Tags : Week Ahead + régions/thèmes détectés.
  const ccy = new Set(); days.forEach(d => (d.ccys || []).forEach(c => ccy.add(c)));
  const tags = ['Week Ahead'];
  if (ccy.has('USD')) tags.push('US');
  if (['JPY', 'AUD', 'NZD', 'CNY'].some(c => ccy.has(c))) tags.push('Asia');
  if (['EUR', 'GBP', 'CHF'].some(c => ccy.has(c))) tags.push('Europe');
  if (/inflation|cpi/i.test(description)) tags.push('Inflation');
  const ts = existing ? existing.timestamp : (_weekAhead.generatedAt || Date.now());
  const item = {
    id, headline, description, category: 'Market Analysis', source: 'DTP',
    time: new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }),
    timestamp: ts, priority: 'normal', tags: tags.slice(0, 6),
  };
  const isNew = !existing;
  if (isNew) allNews = [item, ...allNews].slice(0, 2000); else allNews[idx] = item;
  _waNewsKey = weekKey; _waNewsEdAI = edAI;
  try { saveHistory(); } catch {}
  try { broadcast({ type: 'news_update', items: [{ ...item, _new: isNew }], total: allNews.length }); } catch {}
  console.log(`[WeekAhead] news ${isNew ? 'publiée' : 'mise à jour'} (${weekKey}) — ${highlights.slice(0, 70)}`);
}

// Éditorial IA du Week Ahead (titre + résumé par jour, épuré) : 1 génération / SEMAINE, EN CACHE. Repli : titres/déscriptions déterministes déjà présents.
let _waEditorial = { weekKey: null, items: [], at: 0 };
async function _waApplyEditorial(days, weekKey, gen = false) {
  // Appariement par INDEX (ordre des jours) → robuste. Applique titre + résumé indépendamment.
  const apply = items => { if (!Array.isArray(items)) return; days.forEach((d, i) => { const e = items[i]; if (e) { if (e.headline) d.headline = e.headline; if (e.summary) d.summary = e.summary; } }); };
  // 1) Charge l'éditorial déjà connu pour CETTE semaine (mémoire puis cache durable) et l'applique aussitôt.
  let cachedItems = (_waEditorial.weekKey === weekKey && Array.isArray(_waEditorial.items)) ? _waEditorial.items : null;
  if (!cachedItems) { try { const c = await auth.aiCacheGet('weekahead:editorial6').catch(() => null); if (c && c.weekKey === weekKey && Array.isArray(c.items)) { _waEditorial = c; cachedItems = c.items; } } catch {} }
  if (cachedItems) apply(cachedItems);
  const _complete = cachedItems && cachedItems.length >= days.length && days.every((_, i) => cachedItems[i] && cachedItems[i].summary);
  if (_complete || !gen) return;   // déjà complet → fini ; sinon, hors génération planifiée → repli déterministe pour les jours manquants
  // Génération JOUR PAR JOUR (prompt court → AUCUNE troncature JSON ; un échec n'affecte qu'UN jour)
  // → résumés riches et explicites. Petits appels via le flux quota standard (aiSmart, {scheduled}).
  const focusWk = [...new Set(days.flatMap(d => d.ccys || []))].slice(0, 6).join(', ');
  const items = [];
  for (let i = 0; i < days.length; i++) {
    if (cachedItems && cachedItems[i] && cachedItems[i].summary) { items.push(cachedItems[i]); continue; }   // jour déjà rédigé → on garde (anti cache-partiel-bloqué)
    const d = days[i];
    const evs = (d.events || []).slice(0, 9).map(e => `${e.ccy || ''} ${e.title || ''}${e.forecast ? ' (fcst ' + e.forecast + ')' : ''}${e.previous ? ' (prev ' + e.previous + ')' : ''}`.trim()).filter(Boolean).join(' ; ');
    const prompt = `You are a senior macro strategist writing the "week ahead" preview for an institutional trading terminal. Write, in ENGLISH, the preview for ONE trading day: ${d.dow} ${d.date} ${d.month}.

Scheduled releases / events that day (currency, title, forecast, previous):
${evs || 'No major scheduled data — a quieter session.'}

Currencies in focus across the week: ${focusWk || 'major FX'}.

Produce:
(1) HEADLINE — a catchy news-style headline, 6 to 12 words, no quotes, no trailing period.
(2) SUMMARY — a DETAILED, EXPLICIT 4 to 6 sentence desk note. OPEN by framing the day's overarching theme; then explain the KEY releases and central-bank events WITH their stakes and the expected direction/magnitude where relevant; spell out the CROSS-ASSET implications (FX, rates, equities, commodities) and WHY they matter; close with exactly what investors will watch most closely for direction. Concrete and analytical — NEVER a flat list. Write entirely in your own words; never copy any source.

Reply ONLY as compact JSON: {"headline":"...","summary":"..."} — nothing else.`;
    let txt = null;
    try { txt = await aiSmart('weekahead', prompt, 750, { scheduled: true }); }
    catch (e) { items.push(null); continue; }
    let obj = null;
    try { const m = String(txt).match(/\{[\s\S]*\}/); if (m) obj = JSON.parse(m[0]); } catch {}
    if (obj && (obj.headline || obj.summary)) {
      items.push({ headline: String(obj.headline || '').replace(/^["']|["']$/g, '').slice(0, 120), summary: String(obj.summary || '').slice(0, 950) });
    } else if (txt && String(txt).replace(/\s+/g, ' ').trim().length > 60) {
      items.push({ headline: '', summary: String(txt).replace(/```[a-z]*|```/gi, '').trim().slice(0, 950) });
    } else { items.push(null); }
  }
  if (items.some(it => it && (it.headline || it.summary))) {
    const merged = days.map((_, i) => items[i] || (cachedItems && cachedItems[i]) || null);
    _waEditorial = { weekKey, items: merged, at: Date.now() };
    await auth.aiCacheSet('weekahead:editorial6', _waEditorial).catch(() => {});
    apply(merged);
    console.log('[WeekAhead IA] éditorial jour-par-jour (' + merged.filter(it => it && it.summary).length + '/' + days.length + ' jours) → cache hebdo');
  }
}
let _waGenerating = false;
app.get('/api/week-ahead', async (req, res) => {
  if (req.query.force === '1' && req.session?.user?.role === 'admin') { try { await generateWeekAhead(true, true); } catch {} return res.json(_weekAhead || { week: '', days: [], generating: true }); }   // force=1 VRAIMENT réservé admin (la route est dans _PUBLIC_PATHS : sans ce contrôle, un anonyme déclenchait des générations IA)
  // NE BLOQUE JAMAIS : si pas encore généré, on lance la génération EN ARRIÈRE-PLAN et on répond tout de suite.
  const _waStale = !_weekAhead || _weekAhead.v !== WA_VER || (Date.now() - (_weekAhead.generatedAt || 0) > 40 * 60 * 1000);
  if (_waStale && !_waGenerating) {   // absent / version périmée / >40 min → régén self-heal en fond (données fraîches)
    _waGenerating = true;
    generateWeekAhead(true).catch(() => {}).finally(() => { _waGenerating = false; });
  }
  res.json(_weekAhead || { week: '', days: [], generating: true });   // sert l'existant (upgradé en fond si périmé) ; generating:true → front re-poll
});

// Planification : tous les samedis à 02h00 (Paris) + génération au démarrage si vide
// ── Robustesse génération hebdo : RATTRAPAGE des samedis manqués ──────────────────────────────
// Le run hebdo est un setTimeout(samedi 02h00) ré-armé à CHAQUE redémarrage. Or le conteneur
// redémarre à chaque déploiement → si un redémarrage tombe APRÈS le samedi 02h00, la génération de
// la semaine est SAUTÉE (cause du trou 1-7/06). _sbBiasStale ne le voit pas (<7j). On détecte donc
// la dernière échéance samedi 02h00 révolue : si le bias est antérieur, on rattrape (weekly=true).
function _biasLastSatGenMs() {
  const now = new Date();
  const paris = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const t = new Date(paris);
  t.setDate(paris.getDate() - ((paris.getDay() - 6 + 7) % 7));   // recule jusqu'au samedi
  t.setHours(2, 0, 0, 0);
  if (t > paris) t.setDate(t.getDate() - 7);                     // samedi 02h00 pas encore atteint cette semaine → samedi précédent
  return now.getTime() - (paris.getTime() - t.getTime());        // delta wall-clock → epoch réelle
}
function _biasMissedWeekly() {   // vrai si la génération hebdo planifiée n'a pas eu lieu (semaine manquée)
  return !_smartBias || !_smartBias.generatedAt || _smartBias.generatedAt < _biasLastSatGenMs() - 3 * 60 * 1000;
}
(function scheduleWeeklyBias() {
  function msToNextWeekday(dow, h, m) {   // dow : 0=dim … 6=sam (heure de Paris)
    const now    = new Date();
    const paris  = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const target = new Date(paris);
    const delta  = (dow - paris.getDay() + 7) % 7;
    target.setDate(paris.getDate() + delta);
    target.setHours(h, m, 0, 0);
    if (target <= paris) target.setDate(target.getDate() + 7);
    return target.getTime() - paris.getTime();
  }
  const delay = msToNextWeekday(6, 2, 0);   // SAMEDI 02h00 Paris — même créneau que GEW + Weekly Recap (tout le contenu hebdo à jour ensemble samedi 02h)
  console.log(`[Bias] Génération hebdo (samedi 02h00 Paris) dans ${Math.round(delay / 60000)} min`);
  // Groupe hebdo généré ENSEMBLE le samedi 02h00, dans un ordre logique : les 2 biais (Smart puis
  // Weekly), puis Week Ahead, puis Rates. (Les appels partent en parallèle et sont lissés par le
  // limiteur RPM Gemini ; l'ordre = priorité de mise en file.)
  const runAll = () => {
    generateSmartBias(true, true).catch(e => console.error('[SmartBias] failed:', e.message));   // weekly=true : seul run qui RÉÉCRIT les narratifs
    generateWeeklyBias(true).catch(e => console.error('[Bias] failed:', e.message));             // biais hebdo 12 actifs
    generateWeekAhead(true, true).catch(e => console.error('[WeekAhead] failed:', e.message));   // Week Ahead : data + ÉDITORIAL IA (1×/semaine)
    _aiRefreshRatesBias().catch(e => console.error('[RatesBias IA] failed:', e.message));  // biais TAUX : refresh IA hebdo (caché)
  };
  setTimeout(function run() {
    runAll();
    setInterval(runAll, 7 * 24 * 60 * 60 * 1000);
  }, delay);
  // Régénère au démarrage si vide / seed (non daté) / version périmée / >1 semaine → bias toujours frais + ancré.
  // IMPORTANT : on ATTEND que le calendrier éco soit chargé (events High/Medium avec actual vs forecast =
  // la source de Fundamental/Monetary) avant de générer — sinon ces lignes partent sans données et la
  // matrice retombe en Neutral (bug vécu : EUR/GBP nets short au COT mais Neutral faute de calendrier).
  // On sonde toutes les 20 s (plafond ~5 min) ; au-delà on génère quand même (mieux vaut frais que rien).
  function _biasBootRegen(tries) {
    if (!(_biasMissedWeekly() || _sbBiasStale())) return;          // rien à régénérer
    // Le bias lit le calendrier TradingView (_buildTVCalendar → _tvCalCache, fenêtre 21 j passés avec actuals).
    // On attend donc que CE cache porte des publications récentes (8 derniers j) — pas allCalendar (FF prospectif).
    const calReady = (_tvCalCache.items || []).some(e => e && (e.impact === 'High' || e.impact === 'Medium') && e.actual && e.forecast && (Date.now() - (e.timestamp || 0) < 8 * 86400000));
    if (calReady || tries >= 12) {
      const missed = _biasMissedWeekly();
      const verChanged = !_smartBias || _smartBias.v !== BIAS_VER;   // version bumpée / prompt changé → régénère AUSSI les narratifs
      generateSmartBias(true, missed || verChanged).catch(() => {});
    } else {
      setTimeout(() => _biasBootRegen(tries + 1), 20 * 1000);      // calendrier pas encore prêt → re-sonde
    }
  }
  setTimeout(() => _biasBootRegen(0), 75 * 1000);   // 75s initial (après le préchauffage des rapports → moins de contention RPM), puis on attend le calendrier
  // Week Ahead : régénère au démarrage si vide / version périmée / >1 semaine (décalé après le bias).
  setTimeout(() => {
    const stale = !_weekAhead || _weekAhead.v !== WA_VER || !_weekAhead.generatedAt || (Date.now() - _weekAhead.generatedAt > 7 * 24 * 60 * 60 * 1000) || (_weekAhead.editorialAI || 0) < (_weekAhead.days || []).length;
    if (stale) generateWeekAhead(true, true).catch(() => {});   // démarrage : data + éditorial IA si manquant
  }, 90 * 1000);   // 90s : encore après le bias
  // Rafraîchissement TEMPS RÉEL du Week Ahead : régénère toutes les ~40 min (calendrier TradingView frais : prévisions/actuals).
  setInterval(() => { if (ai.backoffActive && ai.backoffActive()) return; if (!_waGenerating) { _waGenerating = true; generateWeekAhead(true).catch(() => {}).finally(() => { _waGenerating = false; }); } }, 40 * 60 * 1000);
  // AUTO-RÉPARATION horaire : si le bias OU le Week Ahead n'a pas pu se générer (quota Gemini épuisé / Claude
  // sans crédit au démarrage), on réessaie chaque heure → dès que le quota se libère, ça passe et se persiste (Supabase).
  // ⚠️ backoffActive : pendant une panne IA TOTALE, ces retries s'espacent (10 min → 6 h) au lieu
  // de ré-attaquer à fréquence fixe — c'est ce martelage qui a contribué à vider les crédits.
  setInterval(() => {
    if (ai.backoffActive && ai.backoffActive()) return;
    const _missed = _biasMissedWeekly();                           // samedi sauté → rattrapage horaire AVEC narratifs
    const _verChanged = !_smartBias || _smartBias.v !== BIAS_VER;   // version bumpée → régén complète (narratifs inclus)
    if (_missed || _sbBiasStale()) generateSmartBias(true, _missed || _verChanged).catch(() => {});   // récupération de fond (semaine manquée / version / âge>7j / absent) — jamais sur le chemin utilisateur
    else _sbEnsureNarrative().catch(() => {});                     // matrice fraîche mais narratif IA manquant/repli → retry ciblé (USD & co)
    if (!_weekAhead  || _weekAhead.v  !== WA_VER   || !_weekAhead.generatedAt || (_weekAhead.editorialAI || 0) < (_weekAhead.days || []).length) setTimeout(() => generateWeekAhead(true, true).catch(() => {}), 9000);   // réessai horaire tant que TOUS les jours n'ont pas l'éditorial IA
  }, 60 * 60 * 1000);
  // Narratif Smart Bias — AUTO-RÉPARATION rapide & récurrente (correctif du bug : le repli data-driven « gelait »
  // le narratif et l'IA ne le réécrivait jamais). On régénère le narratif IA manquant ~130 s après le démarrage
  // puis toutes les 12 min — throttlé en interne (10 min), hors heures creuses, ne régénère QUE les devises
  // sans vrai narratif IA, et s'arrête dès que les 8 devises en ont un. Quota mini, jamais sur le chemin utilisateur.
  setTimeout(() => { _sbEnsureNarrative().catch(() => {}); }, 130 * 1000);
  setInterval(() => { _sbEnsureNarrative().catch(() => {}); }, 12 * 60 * 1000);
})();

// ═══════════════════ ONGLET BANK — positions de trading des banques ═══════════════════
// Seed (issu des captures DTP) + éditions admin + extraction Gemini des flux recherche.
// Le statut (Active / TP touché / SL touché) et le prix se mettent à jour en TEMPS RÉEL (Yahoo).
const BANK_FILE = path.join(_CACHE_DIR, 'cache_bank_positions.json');
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
let _bankFromFile  = false;
try { _bankPositions = JSON.parse(fs.readFileSync(BANK_FILE, 'utf8')); _bankFromFile = Array.isArray(_bankPositions) && _bankPositions.length > 0; } catch {}
if (!Array.isArray(_bankPositions) || !_bankPositions.length) _bankPositions = BANK_SEED.slice();
function _saveBank() {
  try { fs.writeFileSync(BANK_FILE, JSON.stringify(_bankPositions)); } catch {}
  auth.aiCacheSet('bank:positions', _bankPositions).catch(() => {});   // durable (Supabase) — survit aux rebuilds
}
// Disque ÉPHÉMÈRE : au démarrage sans fichier (rebuild Docker), on restaure les positions durables
// depuis Supabase — sinon éditions admin + extractions IA seraient perdues (retour aux seeds).
(async () => {
  try {
    if (_bankFromFile) { _saveBank(); return; }   // fichier présent → pousse l'état courant vers le KV
    const kv = await auth.aiCacheGet('bank:positions', 8640000000000);
    if (Array.isArray(kv) && kv.length) { _bankPositions = kv; _saveBank(); console.log(`[Bank] ${kv.length} positions restaurées depuis Supabase`); }
  } catch {}
})();

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

// ═══════════════════════════════════════════════════════════════════════════════
// DTP EUROPEAN MARKET WRAP — news QUOTIDIENNE façon PMT « European Market Wrap » (16:00 Paris).
// Rubriques PMT : EQUITIES · FX · FIXED · COMMODITIES (niveaux RÉELS Yahoo, % du jour) +
// EUROPEAN DATA · NOTABLE HEADLINES · TRADE/TARIFFS · CENTRAL BANKS · GEOPOLITICS ·
// NORTH AMERICAN DATA (synthèse IA des news du jour). Publiée dans le flux (catégorie
// « Global News », région « Europe », pastille Info). Rendu via le chemin PRIMER (rubriques
// en MAJUSCULES → titres orange). Idempotente par jour ; repli déterministe si l'IA échoue
// (jamais de rapport vide). 1 appel IA/jour (éco quota).
// ═══════════════════════════════════════════════════════════════════════════════
const EU_WRAP_SYMS = {
  equities: [
    { sym: '^STOXX',     label: 'Stoxx 600' },
    { sym: '^STOXX50E',  label: 'Euro Stoxx 50' },
    { sym: '^GDAXI',     label: 'DAX' },
    { sym: '^FCHI',      label: 'CAC 40' },
    { sym: '^FTSE',      label: 'FTSE 100' },
    { sym: 'FTSEMIB.MI', label: 'FTSE MIB' },
    { sym: '^IBEX',      label: 'IBEX 35' },
    { sym: '^GSPC',      label: 'S&P 500' },
    { sym: '^IXIC',      label: 'Nasdaq' },
    { sym: '^DJI',       label: 'Dow Jones' },
  ],
  fx: [
    { sym: 'EURUSD=X', label: 'EUR/USD' },
    { sym: 'GBPUSD=X', label: 'GBP/USD' },
    { sym: 'USDJPY=X', label: 'USD/JPY' },
    { sym: 'EURGBP=X', label: 'EUR/GBP' },
    { sym: 'DX-Y.NYB', label: 'DXY' },
  ],
  fixed: [
    { sym: '^TNX', label: 'US 10y', yield: true },
    { sym: '^TYX', label: 'US 30y', yield: true },
  ],
  commodities: [
    { sym: 'BZ=F', label: 'Brent' },
    { sym: 'CL=F', label: 'WTI' },
    { sym: 'GC=F', label: 'Gold' },
    { sym: 'SI=F', label: 'Silver' },
    { sym: 'HG=F', label: 'Copper' },
    { sym: 'NG=F', label: 'Nat Gas' },
  ],
};
function _wrapFmtPrice(p, label) {
  if (p == null || !isFinite(p)) return '—';
  if (/JPY/.test(label)) return p.toFixed(2);
  if (Math.abs(p) >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (Math.abs(p) >= 10)   return p.toFixed(2);
  return p.toFixed(4);
}
// Niveaux réels du jour (Yahoo) groupés EQUITIES/FX/FIXED/COMMODITIES. Tout symbole qui échoue
// est simplement omis (jamais de crash) → le wrap reste robuste même si Yahoo est partiel.
async function _wrapLevels() {
  try { await getYFSession(); } catch {}
  const grp = async (arr) => {
    const out = await Promise.all((arr || []).map(async a => {
      try {
        const raw   = await yfFetch(a.sym, '5m', '1d');
        const meta  = raw?.chart?.result?.[0]?.meta;
        const price = meta?.regularMarketPrice, prev = meta?.chartPreviousClose;
        if (price == null || prev == null) return null;
        if (a.yield) {
          const bp = (price - prev) * 100;
          return `- ${a.label}: ${price.toFixed(2)}% (${bp >= 0 ? '+' : ''}${bp.toFixed(1)}bp)`;
        }
        const pct = (price / prev - 1) * 100;
        return `- ${a.label}: ${_wrapFmtPrice(price, a.label)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
      } catch { return null; }
    }));
    return out.filter(Boolean);
  };
  const [eq, fx, fixed, cmd] = await Promise.all([
    grp(EU_WRAP_SYMS.equities), grp(EU_WRAP_SYMS.fx), grp(EU_WRAP_SYMS.fixed), grp(EU_WRAP_SYMS.commodities),
  ]);
  return { eq, fx, fixed, cmd };
}

const EU_WRAP_SECTIONS = ['EQUITIES','FX','FIXED','COMMODITIES','EUROPEAN DATA','NOTABLE HEADLINES','TRADE/TARIFFS','CENTRAL BANKS','GEOPOLITICS','NORTH AMERICAN DATA'];

// Parse la sortie IA en rubriques connues. Les en-têtes (« EQUITIES », « FX », « TRADE/TARIFFS »…)
// sont reconnus quelle que soit la ponctuation/casse ; les lignes avant la 1re rubrique (préambule)
// sont ignorées. Robuste aux markdown/numérotations/puces parasites.
function _euWrapParse(aiText) {
  const norm = s => String(s || '').replace(/[^a-z]/gi, '').toLowerCase();
  const headMap = new Map(EU_WRAP_SECTIONS.map(h => [norm(h), h]));
  const buckets = {};
  let cur = null;
  String(aiText || '').split(/\r?\n/).forEach(raw => {
    let line = raw.replace(/<[^>]+>/g, '').replace(/\*+/g, '').trim();
    if (!line) return;
    line = line.replace(/^[-•*·]\s*/, '').replace(/^\d+[.)]\s*/, '').trim();
    const m = line.match(/^([A-Za-z][A-Za-z /&-]{1,26}?)\s*:\s*(.*)$/);   // « HEADER » ou « HEADER: contenu »
    const headKey = m ? norm(m[1]) : norm(line);
    if (headMap.has(headKey) && (!m || (m[2] || '').length < 200)) {
      cur = headMap.get(headKey);
      buckets[cur] = buckets[cur] || [];
      if (m && m[2]) buckets[cur].push(m[2].trim());
      return;
    }
    if (cur) buckets[cur].push(line);
  });
  return buckets;
}

// Lead façon PMT (1re ligne, rendue en gras) construit depuis les VRAIS niveaux : « European close — Stoxx 600 …; EUR/USD …; Brent … ».
function _euWrapLead(levels) {
  const pick = (arr, lbl) => { const l = (arr || []).find(x => x.includes(lbl)); return l ? l.replace(/^- /, '') : null; };
  const parts = [
    pick(levels.eq, 'Stoxx 600') || pick(levels.eq, 'Euro Stoxx 50') || pick(levels.eq, 'DAX'),
    pick(levels.eq, 'S&P 500'),
    pick(levels.fx, 'EUR/USD'),
    pick(levels.cmd, 'Brent') || pick(levels.cmd, 'Gold'),
    pick(levels.fixed, 'US 10y'),
  ].filter(Boolean);
  return parts.length ? `European close — ${parts.join('; ')}.` : null;
}

function _euWrapBuild(buckets, lead) {
  const out = [];
  if (lead) out.push(lead);   // bullet[0] → rendu comme lead (gras) par le chemin PRIMER
  for (const h of EU_WRAP_SECTIONS) {
    const items = (buckets[h] || []).map(s => s.replace(/^[-•*·]\s*/, '').trim()).filter(s => s.length > 1);
    if (!items.length) continue;
    out.push(h);                                  // en-tête NU, MAJUSCULES → _isSectionHead → titre orange
    items.slice(0, 6).forEach(it => out.push('- ' + it));
  }
  return out.join('\n');
}

// Repli déterministe (IA indisponible / vide) : rubriques marché depuis les niveaux réels + top headlines.
function _euWrapFallback(levels, s) {
  const b = {};
  const strip = arr => (arr || []).map(l => l.replace(/^- /, ''));
  if (levels.eq.length)    b['EQUITIES']    = strip(levels.eq);
  if (levels.fx.length)    b['FX']          = strip(levels.fx);
  if (levels.fixed.length) b['FIXED']       = strip(levels.fixed);
  if (levels.cmd.length)   b['COMMODITIES'] = strip(levels.cmd);
  const top = (arr, n) => (arr || []).slice(0, n).map(i => i.headline).filter(Boolean);
  if (s.hdata.length || s.data.length) b['EUROPEAN DATA']     = top(s.hdata.length ? s.hdata : s.data, 4);
  if (s.all.length)                    b['NOTABLE HEADLINES'] = top(s.all, 5);
  if (s.trade.length)                  b['TRADE/TARIFFS']     = top(s.trade, 3);
  if (s.cb.length)                     b['CENTRAL BANKS']     = top(s.cb, 4);
  if (s.geo.length)                    b['GEOPOLITICS']       = top(s.geo, 4);
  return b;
}

async function generateEuropeanMarketWrap(force = false) {
  const idPrefix = 'dtp-eu-wrap-';
  const dateKey  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' })).toISOString().slice(0, 10);
  const prefix   = idPrefix + dateKey;
  if (!force && allNews.some(i => (i.id || '').startsWith(prefix))) {
    return allNews.find(i => (i.id || '').startsWith(prefix)) || null;
  }
  if (force) allNews = allNews.filter(i => !(i.id || '').startsWith(prefix));

  // Date façon PMT : « 15th June 2026 » (heure de Paris).
  const _ord = n => { const x = ['th','st','nd','rd'], v = n % 100; return n + (x[(v - 20) % 10] || x[v] || x[0]); };
  const pNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const _MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dateStr = `${_ord(pNow.getDate())} ${_MONTHS[pNow.getMonth()]} ${pNow.getFullYear()}`;
  const timeStr = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

  // News du jour (≈13h glissantes), hors briefings, catégorisées comme les autres rapports DTP.
  const now = Date.now(), cutoff = now - 13 * 60 * 60 * 1000;
  const recent = allNews.filter(i => i.timestamp > cutoff && i.timestamp <= now && !i._briefing && !i._marketWrap);
  const CB_CATS   = new Set(['Fed','ECB','BoJ','BoE','BoC','RBA','SNB','RBNZ','PBOC']);
  const DATA_CATS = new Set(['Economic Commentary','EU Data','US Data','UK Data','Swiss Data','Japanese Data','Canadian Data','Australian Data','Chinese Data','New Zealand Data']);
  const s = {
    cb:    recent.filter(i => CB_CATS.has(i.category)),
    data:  recent.filter(i => DATA_CATS.has(i.category)),
    hdata: recent.filter(i => DATA_CATS.has(i.category) && (i.priority === 'high' || i.priority === 'urgent')),
    geo:   recent.filter(i => i.category === 'Geopolitical'),
    trade: recent.filter(i => i.category === 'Trade'),
    all:   recent,
  };

  let levels = { eq: [], fx: [], fixed: [], cmd: [] };
  try { levels = await _wrapLevels(); } catch (e) { console.error('[EUWrap] niveaux KO:', e.message); }

  const summarise = (arr, n = 5) => (arr && arr.length) ? arr.slice(0, n).map(i => `• ${i.headline}`).join('\n') : '(none)';
  const lv = g => (g && g.length) ? g.join('\n') : '(unavailable)';
  const prompt = `You are a senior markets reporter at a prime brokerage writing the daily EUROPEAN MARKET WRAP at 16:00 (European cash close), in the concise, factual style of Newsquawk / Prime Market Terminal. Date: ${dateStr}.

REAL MARKET LEVELS TODAY (use these EXACT numbers; moves are vs previous close):
EQUITIES:\n${lv(levels.eq)}
FX:\n${lv(levels.fx)}
FIXED (govt bond yields, bp change):\n${lv(levels.fixed)}
COMMODITIES:\n${lv(levels.cmd)}

TODAY'S NEWSFLOW (for the narrative sections):
CENTRAL BANKS:\n${summarise(s.cb)}
DATA:\n${summarise(s.hdata.length ? s.hdata : s.data)}
GEOPOLITICAL:\n${summarise(s.geo)}
TRADE / TARIFFS:\n${summarise(s.trade)}
OTHER HEADLINES:\n${summarise(s.all, 8)}

Write the wrap with EXACTLY these section headers, each on its OWN line in ALL CAPS, with NO colon, in THIS order. Under each header put 1–4 short factual lines (one fact per line), each starting with "- ". Skip a section ONLY if there is genuinely nothing to say.

EQUITIES
FX
FIXED
COMMODITIES
EUROPEAN DATA
NOTABLE HEADLINES
TRADE/TARIFFS
CENTRAL BANKS
GEOPOLITICS
NORTH AMERICAN DATA

Rules: For EQUITIES/FX/FIXED/COMMODITIES, lead with the real levels above (name the index/pair, the level and the % or bp move). For the narrative sections, summarise the newsflow factually — name banks, data prints (actual vs expected/previous), tickers, levels. Be terse and specific. No preamble, no markdown, no bold, no closing remarks. Output ONLY the section headers and their bullet lines.`;

  let buckets = {};
  try {
    const text = (await ai.generateText(prompt, 1600)).trim();
    buckets = _euWrapParse(text);
  } catch (e) {
    console.error('[EUWrap] IA KO → repli déterministe:', e.message);
  }
  // Backfill : TOUTE rubrique vide (IA partielle OU totalement KO/cooldown) est complétée depuis
  // le repli déterministe (niveaux réels marché + top headlines). Garantit un wrap riche même
  // sans IA — fini le « 4 rubriques » quand toutes les clés Claude/Gemini sont en cooldown.
  const fb = _euWrapFallback(levels, s);
  for (const h of EU_WRAP_SECTIONS) {
    if ((!buckets[h] || !buckets[h].length) && fb[h] && fb[h].length) buckets[h] = fb[h];
  }

  const description = _euWrapBuild(buckets, _euWrapLead(levels));
  const sectionCount = EU_WRAP_SECTIONS.filter(h => (buckets[h] || []).length).length;
  if (!description || sectionCount < 2) {   // ne JAMAIS publier un rapport vide (cold start sans données) → retry plus tard
    console.warn(`[EUWrap] contenu insuffisant (${sectionCount} rubrique(s)) → non publié, retry ultérieur.`);
    return null;
  }

  // ITEM VISIBLE dans le flux news (≠ briefing PRIMER, masqué lui par demande utilisateur) :
  // pas de _briefing, pas de préfixe « PRIMER », source ≠ « DTP » exact → _isPrimerNews=false →
  // diffusé en temps réel + non purgé. Le rendu structuré (rubriques orange) passe par le flag
  // dédié _marketWrap côté client (et non par le chemin PRIMER, réservé à l'onglet Analyst).
  const item = {
    id:          prefix + '-' + now,
    headline:    `DTP European Market Wrap - ${dateStr}`,
    description,
    category:    'Global News',
    source:      'DTP Markets',
    region:      'Europe',
    time:        timeStr,
    timestamp:   now,
    priority:    'normal',
    tags:        ['Europe', 'Market Wrap', 'Equities', 'FX'],
    _marketWrap: true,
    _reportType: 'European Market Wrap',
  };
  allNews = [item, ...allNews].slice(0, 2000);
  saveHistory();
  broadcast({ type: 'news_update', items: [{ ...item, _new: true }], total: allNews.length });
  console.log(`[EUWrap] Publié « ${item.headline} » — ${sectionCount} rubriques (${recent.length} news, ${levels.eq.length} niveaux actions)`);
  return item;
}

// Auto à 16:00 Paris chaque jour + rattrapage au démarrage (Render dort/redémarre) si on a déjà
// dépassé 16:00 sans rapport du jour.
(function scheduleEuropeanMarketWrap() {
  function msToNext1600Paris() {
    const now    = new Date();
    const paris  = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const target = new Date(paris);
    target.setHours(16, 0, 0, 0);
    if (paris >= target) target.setDate(target.getDate() + 1);
    return target.getTime() - paris.getTime();
  }
  const delay = msToNext1600Paris();
  console.log(`[EUWrap] Auto-génération programmée dans ${Math.round(delay / 60000)} min (16:00 Paris)`);
  setTimeout(function run() {
    generateEuropeanMarketWrap().catch(e => console.error('[EUWrap] auto KO:', e.message));
    setInterval(() => generateEuropeanMarketWrap().catch(e => console.error('[EUWrap] auto KO:', e.message)), 24 * 60 * 60 * 1000);
  }, delay);
  setTimeout(() => {   // rattrapage démarrage : ≥16:00 Paris et pas de rapport du jour → générer
    try {
      const paris = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
      if (paris.getHours() >= 16) generateEuropeanMarketWrap().catch(() => {});
    } catch {}
  }, 90 * 1000);
})();

// Déclencheur manuel (admin/debug)
app.get('/api/eu-wrap/generate', async (_req, res) => {
  try { const it = await generateEuropeanMarketWrap(true); res.json({ ok: !!it, headline: it && it.headline }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Ticker public (landing datatradingpro.com) — prix réels Yahoo, CORS ouvert ───
const TICKER_SYMS = [
  { sym: 'EURUSD=X', label: 'EUR/USD', dec: 4 },
  { sym: 'USDJPY=X', label: 'USD/JPY', dec: 2 },
  { sym: 'GBPUSD=X', label: 'GBP/USD', dec: 4 },
  { sym: 'GC=F',     label: 'XAU/USD', dec: 2 },
  { sym: '^GSPC',    label: 'S&P 500', dec: 2 },
  { sym: '^IXIC',    label: 'NASDAQ',  dec: 0 },
  { sym: 'DX-Y.NYB', label: 'DXY',     dec: 2 },
  { sym: 'CL=F',     label: 'WTI',     dec: 2 },
  { sym: 'BTC-USD',  label: 'BTC/USD', dec: 0 },
  { sym: '^TNX',     label: 'US 10Y',  dec: 2, yield: true },
];
let _tickerCache = { ts: 0, data: null };
app.get('/api/ticker', async (_req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cache-Control', 'public, max-age=60');
  if (_tickerCache.data && Date.now() - _tickerCache.ts < 60 * 1000) return res.json(_tickerCache.data);
  try {
    await getYFSession();
    const items = [];
    await Promise.all(TICKER_SYMS.map(async (a, i) => {
      try {
        const raw  = await yfFetch(a.sym, '5m', '1d');
        const meta = raw?.chart?.result?.[0]?.meta;
        const price = meta?.regularMarketPrice;
        const prev  = meta?.chartPreviousClose;
        if (price == null || !prev) return;
        const chg = a.yield ? +(price - prev).toFixed(2) : +((price / prev - 1) * 100).toFixed(2);
        items[i] = { label: a.label, price: +price.toFixed(a.dec), dec: a.dec, chg, yield: !!a.yield };
      } catch {}
    }));
    const data = { updatedAt: Date.now(), items: items.filter(Boolean) };
    if (data.items.length) _tickerCache = { ts: Date.now(), data };
    res.json(data);
  } catch (e) { res.json({ items: [], updatedAt: Date.now() }); }
});

// ─── Pricing public (landing) — prix réels depuis la config serveur (PRICE_MONTHLY / PRICE_ANNUAL) ───
app.get('/api/pricing', (_req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cache-Control', 'public, max-age=3600');
  const monthly = PRICE_MONTHLY, annual = PRICE_ANNUAL;
  const monthlyPerYear = +(monthly * 12).toFixed(2);
  const annualPerMonth = +(annual / 12).toFixed(2);
  const savePct = monthlyPerYear > 0 ? Math.round((1 - annual / monthlyPerYear) * 100) : 0;
  res.json({ currency: '€', monthly, annual, annualPerMonth, monthlyPerYear, savePct,
    url: process.env.WHOP_RENEW_URL || 'https://whop.com/joined/justonetrader/products/jot-dtp/' });
});

// ─── TAUX — probabilités de taux directeurs (estimation MAISON, façon "Interest Rate Probability") ───
// On déduit nous-mêmes : prochaine réunion (calendrier 2026 factuel), prochain mouvement, probabilités
// Maintien/Hausse/Baisse, Δ implicite (bps) et base case — sans flux marché. Se met à jour quand les dates passent.
// Calendriers OFFICIELS de réunions 2026-2027 (sources vérifiées : Fed, BCE, BoE, BoJ, SNB, BoC, RBA, RBNZ).
// Année complète : les réunions PASSÉES alimentent le moteur d'actualisation ; le tableau n'affiche que les futures.
const CB_MEETINGS = {
  USD: ['2026-01-28','2026-03-18','2026-04-29','2026-06-17','2026-07-29','2026-09-16','2026-10-28','2026-12-09','2027-01-27','2027-03-17','2027-04-28','2027-06-09','2027-07-28','2027-09-15','2027-10-27','2027-12-08'],
  EUR: ['2026-02-05','2026-03-19','2026-04-30','2026-06-11','2026-07-23','2026-09-10','2026-10-29','2026-12-17','2027-02-04','2027-03-18','2027-04-29','2027-06-10','2027-07-22','2027-09-09','2027-10-28','2027-12-16'],
  GBP: ['2026-02-05','2026-03-19','2026-04-30','2026-06-18','2026-07-30','2026-09-17','2026-11-05','2026-12-17','2027-02-04','2027-03-18','2027-04-29','2027-06-17','2027-07-29','2027-09-16','2027-11-04','2027-12-16'],
  JPY: ['2026-01-23','2026-03-19','2026-04-28','2026-06-16','2026-07-31','2026-09-18','2026-10-30','2026-12-18','2027-01-22','2027-03-18','2027-04-27','2027-06-15','2027-07-30','2027-09-17','2027-10-29','2027-12-17'],
  CHF: ['2026-03-19','2026-06-18','2026-09-24','2026-12-10','2027-03-18','2027-06-24','2027-09-23','2027-12-16'],
  CAD: ['2026-01-28','2026-03-18','2026-04-29','2026-06-10','2026-07-15','2026-09-02','2026-10-28','2026-12-09','2027-01-27','2027-03-17','2027-04-28','2027-06-09','2027-07-14','2027-09-01','2027-10-27','2027-12-08'],
  AUD: ['2026-02-03','2026-03-17','2026-05-05','2026-06-16','2026-08-11','2026-09-29','2026-11-03','2026-12-08','2027-02-09','2027-03-23','2027-05-04','2027-06-22','2027-08-10','2027-09-21','2027-11-02','2027-12-14'],
  NZD: ['2026-02-18','2026-04-08','2026-05-27','2026-07-08','2026-09-02','2026-10-28','2026-12-09','2027-02-10','2027-03-17','2027-05-05','2027-06-16','2027-08-04','2027-09-15','2027-10-27','2027-12-08'],
};
// JPY & CAD : dates 2027 ESTIMÉES (calendrier officiel pas encore publié) — alignées sur le jour de semaine du cycle 2026,
// cohérentes avec la nature « modèle maison » de l'onglet. À remplacer par les dates officielles dès publication.
// Config maison par banque : taux actuel + biais directionnel + conviction + pas (bps).
// rate = taux d'ANCRAGE initial ; bias/conv/lean = lecture maison ; floor/ceil = taux terminal (anti-emballement).
// Taux directeurs ANCRES sur les vraies décisions (vérifiés juin 2026 : Fed 3.75, BCE 2.00, BoE 3.75,
// BoJ 0.75, SNB 0.00, BoC 2.25, RBA 4.35, RBNZ 2.25). Biais = direction réelle constatée. Ces ancres
// sont ensuite re-vérifiées en continu par _aiVerifyRates (calendrier réel + news) → fiabilité durable.
const CB = [
  { code:'USD', cc:'us', bank:'Fed',  full:'Réserve fédérale (US)',           rate:3.75, bias:'hold', lean:'cut', conv:0.70, step:25, floor:2.50, ceil:4.75 },
  { code:'EUR', cc:'eu', bank:'BCE',  full:'Banque centrale européenne',      rate:2.00, bias:'hike',             conv:0.55, step:25, floor:1.50, ceil:3.25 },
  { code:'GBP', cc:'gb', bank:'BoE',  full:'Banque d\'Angleterre',            rate:3.75, bias:'hold', lean:'cut', conv:0.55, step:25, floor:2.50, ceil:4.75 },
  { code:'JPY', cc:'jp', bank:'BoJ',  full:'Banque du Japon',                 rate:0.75, bias:'hike',             conv:0.60, step:25, floor:0.10, ceil:1.75 },
  { code:'CHF', cc:'ch', bank:'SNB',  full:'Banque nationale suisse',         rate:0.00, bias:'hold',             conv:0.65, step:25, floor:-0.25, ceil:1.50 },
  { code:'CAD', cc:'ca', bank:'BoC',  full:'Banque du Canada',                rate:2.25, bias:'hold', lean:'cut', conv:0.60, step:25, floor:1.50, ceil:3.50 },
  { code:'AUD', cc:'au', bank:'RBA',  full:'Banque de réserve d\'Australie',  rate:4.35, bias:'hike',             conv:0.52, step:25, floor:3.35, ceil:4.85 },
  { code:'NZD', cc:'nz', bank:'RBNZ', full:'Banque de réserve de N.-Zélande', rate:2.25, bias:'hold', lean:'cut', conv:0.60, step:25, floor:1.75, ceil:3.50 },
];
// Modèle maison : scénario d'une réunion (idx 0 = prochaine ; la conviction du biais croît avec l'horizon).
function _rateScenario(b, idx) {
  let hold, hike, cut;
  if (b.bias === 'hold') {
    hold = Math.max(0.35, Math.min(0.95, b.conv - idx * 0.09));
    const rest = 1 - hold, leanCut = b.lean !== 'hike', share = Math.min(0.88, 0.62 + idx * 0.05);
    cut  = leanCut ? rest * share : rest * (1 - share);
    hike = rest - cut;
  } else if (b.bias === 'cut') {
    cut  = Math.max(0.30, Math.min(0.97, b.conv + idx * 0.11));
    const rest = 1 - cut; hold = rest * 0.82; hike = rest - hold;
  } else { // hike
    hike = Math.max(0.30, Math.min(0.97, b.conv + idx * 0.11));
    const rest = 1 - hike; hold = rest * 0.82; cut = rest - hold;
  }
  const s = hold + hike + cut || 1; hold /= s; hike /= s; cut /= s;
  const impliedBps = (hike - cut) * b.step;
  const baseCase = (hold >= hike && hold >= cut) ? 'HOLD' : (hike >= cut ? 'HIKE' : 'CUT');
  return { hold, hike, cut, impliedBps, baseCase };
}
// ─── Moteur d'ACTUALISATION des taux ───────────────────────────────────────────
// État persistant : taux courant + dernière réunion traitée, par banque. Le taux ÉVOLUE
// automatiquement à chaque réunion PASSÉE (selon le base case maison), borné par floor/ceil.
const RATES_STATE_FILE = path.join(_CACHE_DIR, 'cache_rates_state.json');
const RATES_VER = 'v2-2026-06-verified';   // bump → RÉ-ANCRE tous les taux sur la config vérifiée (efface toute dérive persistée Supabase/disque)
let _ratesState = null;
function _initRatesState() {
  if (!_ratesState || !_ratesState.banks) _ratesState = { banks: {}, updatedAt: Date.now() };
  const now = Date.now();
  const reanchor = _ratesState.ver !== RATES_VER;   // nouvelle version → réinitialisation sur les VRAIS taux vérifiés
  CB.forEach(b => {
    if (reanchor || !_ratesState.banks[b.code]) {
      // Ancre : `rate` reflète déjà les réunions passées → on ne traitera QUE les réunions futures (pas de double comptage).
      const past = (CB_MEETINGS[b.code] || []).filter(d => Date.parse(d + 'T00:00:00Z') < now).sort();
      _ratesState.banks[b.code] = { rate: b.rate, lastMeeting: past.length ? past[past.length - 1] : null };
    }
  });
  if (reanchor) { _ratesState.ver = RATES_VER; _ratesState.updatedAt = now; try { _saveRatesState(); } catch {} }
}
try { _ratesState = JSON.parse(fs.readFileSync(RATES_STATE_FILE, 'utf8')); } catch {}
_initRatesState();
try { auth.aiCacheGet('rates:state').then(s => { if (s && s.banks) { _ratesState = s; _initRatesState(); } }).catch(() => {}); } catch {}
function _saveRatesState() {
  try { fs.writeFileSync(RATES_STATE_FILE, JSON.stringify(_ratesState)); } catch {}
  auth.aiCacheSet('rates:state', _ratesState).catch(() => {});   // DURABLE (Supabase) → survit aux redéploys
}
// Biais EFFECTIF : on bascule sur Maintien dès que le taux terminal (plancher/plafond) est atteint.
function _effBias(b, rate) {
  if (b.bias === 'cut'  && rate <= b.floor + 1e-9) return 'hold';
  if (b.bias === 'hike' && rate >= b.ceil  - 1e-9) return 'hold';
  return b.bias;
}
// Biais IA optionnel (cache hebdo) : écrase le biais/conviction config par banque si disponible. Repli config sinon.
let _aiRatesBias = {};
function _cbResolved(b) {
  const a = _aiRatesBias[b.code];
  return (a && a.bias) ? { ...b, bias: a.bias, conv: (a.conv != null ? a.conv : b.conv) } : b;
}
// Actualisation : applique le mouvement maison à chaque réunion passée non encore traitée.
function _refreshRates() {
  const now = Date.now();
  let changed = false;
  CB.forEach(b => {
    const st = _ratesState.banks[b.code];
    (CB_MEETINGS[b.code] || []).slice().sort().forEach(d => {
      if (Date.parse(d + 'T00:00:00Z') >= now) return;             // réunion future
      if (st.lastMeeting && d <= st.lastMeeting) return;           // déjà traitée
      const rb = _cbResolved(b);
      const sc = _rateScenario({ ...rb, bias: _effBias(rb, st.rate) }, 0);
      if (sc.baseCase === 'HIKE')      st.rate = Math.min(b.ceil,  +(st.rate + b.step / 100).toFixed(2));
      else if (sc.baseCase === 'CUT')  st.rate = Math.max(b.floor, +(st.rate - b.step / 100).toFixed(2));
      st.lastMeeting = d;
      changed = true;
    });
  });
  if (changed) {
    _ratesState.updatedAt = now; _saveRatesState();
    // Un taux a RÉELLEMENT bougé (décision tombée) → ré-estimation IA des biais/probabilités immédiate (pas d'attente de l'hebdo).
    try { _aiRefreshRatesBias(true).catch(() => {}); } catch {}
    try { _aiVerifyRates(true).catch(() => {}); } catch {}   // + re-vérifie le taux sur les données réelles (corrige une projection maison erronée)
  }
  return changed;
}
setInterval(() => { try { _refreshRates(); } catch {} }, 6 * 3600 * 1000);   // quotidien (4×/jour)
setTimeout(() => { try { _refreshRates(); } catch {} }, 8000);              // au démarrage

// ── FedWatch : probabilités IMPLICITES DU MARCHÉ (futures Fed Funds ZQ) pour le prochain FOMC ──
// Méthode CME : contrat du MOIS DE RÉUNION (moyenne mensuelle = split avant/après la décision) +
// contrat du MOIS SUIVANT = taux EFFECTIF post-réunion. Les deux étant des taux effectifs implicites,
// l'écart "effectif vs cible" s'ANNULE → la proba est propre. Fed uniquement (seul flux gratuit fiable).
const FF_MONTH_CODE = ['F','G','H','J','K','M','N','Q','U','V','X','Z'];   // Jan..Déc
let _fedWatch = null;
async function _ffImplied(sym) {
  try {
    const r = await axios.get(yfUrl(sym, '1d', '1mo'), { headers: yfHeaders(), timeout: 10000, validateStatus: () => true });
    if (r.status !== 200) return null;
    const p = r.data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return (typeof p === 'number' && p > 50 && p < 101) ? 100 - p : null;   // taux implicite = 100 − prix
  } catch { return null; }
}
async function _computeFedWatch() {
  try {
    await getYFSession();
    const now = Date.now();
    const next = (CB_MEETINGS.USD || []).find(d => Date.parse(d + 'T18:00:00Z') > now - 6 * 3600000);
    if (!next) return;
    const dt = new Date(next + 'T00:00:00Z');
    const Y = dt.getUTCFullYear(), mo = dt.getUTCMonth(), day = dt.getUTCDate();
    const N = new Date(Date.UTC(Y, mo + 1, 0)).getUTCDate();               // jours dans le mois de réunion
    const meetSym = 'ZQ' + FF_MONTH_CODE[mo] + String(Y).slice(2) + '.CBT';
    const nMo = (mo + 1) % 12, nY = mo === 11 ? Y + 1 : Y;
    const nextSym = 'ZQ' + FF_MONTH_CODE[nMo] + String(nY).slice(2) + '.CBT';
    const [Rmeet, rAfter] = await Promise.all([_ffImplied(meetSym), _ffImplied(nextSym)]);
    if (Rmeet == null || rAfter == null) return;
    const preDays = day, postDays = N - day;                               // décision jour `day` → nouveau taux dès `day+1`
    if (preDays <= 0 || postDays <= 0) return;
    const rBefore = (Rmeet * N - rAfter * postDays) / preDays;             // taux effectif AVANT la réunion (déduit)
    if (!isFinite(rBefore) || rBefore < -1 || rBefore > 12) return;        // garde-fou anti-aberration
    const change = rAfter - rBefore, step = 0.25;
    const pMove = Math.max(0, Math.min(1, Math.abs(change) / step));
    _fedWatch = {
      meeting: next,
      cut:  Math.round((change < -0.001 ? pMove : 0) * 100),
      hold: Math.round((1 - pMove) * 100),
      hike: Math.round((change >  0.001 ? pMove : 0) * 100),
      impliedRate: +rAfter.toFixed(3),        // taux directeur attendu par le marché APRÈS la réunion
      changeBps:  +(change * 100).toFixed(1), // variation attendue (bps)
      src: 'CME Fed Funds futures (ZQ)', at: now,
    };
    auth.aiCacheSet('rates:fedwatch', _fedWatch).catch(() => {});
  } catch (e) { console.error('[FedWatch]', e.message); }
}
auth.aiCacheGet('rates:fedwatch').then(v => { if (v && v.at) _fedWatch = v; }).catch(() => {});
setTimeout(_computeFedWatch, 9000);
setInterval(_computeFedWatch, 45 * 60 * 1000);   // rafraîchi ~45 min (données futures = quasi temps réel)

// ─── SOURCE RÉELLE : rateprobability.com — probabilités implicites de MARCHÉ par banque centrale ───
// API JSON publique par banque (taux implicites OIS/futures, par réunion). Fed/BCE/BoE/BoJ/BoC/RBA = gratuits ;
// SNB (CHF) & RBNZ (NZD) = "Pro" → repli automatique sur le modèle maison. Données mises en cache (mémoire +
// Supabase durable) et rafraîchies EN TÂCHE DE FOND (jamais à l'ouverture client) — anti-OOM : timeout + cap taille.
// Accesseur de taux tolérant : les clés varient d'une banque à l'autre → on tente plusieurs noms,
// sinon premier champ numérique « *rate*/*target* » trouvé. Si l'API renvoie un paywall (pas de
// today.rows), _rpFetchBank renvoie null AVANT d'arriver ici → repli maison propre (aucun risque).
function _rpRate(t, ...keys) {
  for (const k of keys) { const v = +t[k]; if (isFinite(v)) return v; }
  for (const k of Object.keys(t || {})) { if (/rate|target|midpoint|ocr/i.test(k)) { const v = +t[k]; if (isFinite(v)) return v; } }
  return NaN;
}
const RP_MAP = {
  USD: { slug: 'fed',  rate: t => _rpRate(t, 'midpoint') },
  EUR: { slug: 'ecb',  rate: t => _rpRate(t, 'ecb_deposit_facility', 'deposit_facility') },
  GBP: { slug: 'boe',  rate: t => _rpRate(t, 'current_target', 'bank_rate') },
  JPY: { slug: 'boj',  rate: t => _rpRate(t, 'current_target', 'policy_rate') },
  CAD: { slug: 'boc',  rate: t => _rpRate(t, 'Overnight Rate Target', 'overnight_rate_target', 'policy_rate') },
  AUD: { slug: 'rba',  rate: t => _rpRate(t, 'cash_rate_target', 'cash_rate') },
  CHF: { slug: 'snb',  rate: t => _rpRate(t, 'policy_rate', 'snb_policy_rate', 'current_target') },
  NZD: { slug: 'rbnz', rate: t => _rpRate(t, 'official_cash_rate', 'ocr', 'cash_rate_target', 'current_target') },
};
const RP_TTL = 15 * 60 * 1000;   // refetch rateprobability au max toutes les 15 min (leur donnée se met à jour ~horaire) — le front interroge /api/rates en continu
let _rpCache = { at: 0, banks: {} };
let _rpRefreshing = false;
const RP_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36', 'Accept': 'application/json', 'Referer': 'https://rateprobability.com/' };
try { auth.aiCacheGet('rates:rateprob').then(c => { if (c && c.banks && c.at) _rpCache = c; }).catch(() => {}); } catch {}
async function _rpFetchBank(slug) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch('https://rateprobability.com/api/' + slug + '/latest', { headers: RP_HEADERS, signal: ctrl.signal });
    if (!r.ok) return null;
    const txt = await r.text();
    if (txt.length > 250000) return null;                                       // garde-fou mémoire
    const j = JSON.parse(txt);
    if (!j || j.error || !j.today || !Array.isArray(j.today.rows)) return null;  // paywall "Pro" / format inattendu
    return j;
  } catch { return null; } finally { clearTimeout(to); }
}
function _rpTransform(code, j, now) {
  const map = RP_MAP[code]; if (!map) return null;
  let rate = +map.rate(j.today); if (!isFinite(rate)) return null; rate = +rate.toFixed(2);
  const rows = (j.today.rows || []).filter(x => x && x.meeting_iso && Date.parse(x.meeting_iso + 'T00:00:00Z') >= now - 2 * 86400000).slice(0, 10);   // 10 réunions (le front scrolle, ~3 visibles)
  if (!rows.length) return null;
  let prev = rate;
  const meetings = rows.map(x => {
    const move = Math.max(0, Math.min(100, +(+x.prob_move_pct || 0).toFixed(2)));   // 2 décimales réelles (clone PMT : 79,76 %)
    const isCut = !!x.prob_is_cut;
    const hold = +Math.max(0, 100 - move).toFixed(2), cut = isCut ? move : 0, hike = isCut ? 0 : move;
    const impl = +x.implied_rate_post_meeting;
    const impliedBps = isFinite(impl) ? +(((impl - prev) * 100).toFixed(1)) : 0;
    if (isFinite(impl)) prev = impl;
    const days = Math.max(0, Math.round((Date.parse(x.meeting_iso + 'T00:00:00Z') - now) / 86400000));
    const baseCase = move >= 50 ? (isCut ? 'CUT' : 'HIKE') : 'HOLD';
    return { date: x.meeting_iso, days, hold, hike, cut, impliedBps, baseCase, impliedRate: isFinite(impl) ? +impl.toFixed(3) : null };
  });
  const m0 = meetings[0];
  return { code, rate, next: m0.date, nextDays: m0.days, move: m0.baseCase,
    prob: Math.max(m0.hold, m0.hike, m0.cut), expBps: m0.impliedBps,
    scenario: { hold: m0.hold, hike: m0.hike, cut: m0.cut }, meetings, source: 'market' };
}
async function _refreshRateProb(force = false) {
  if (_rpRefreshing) return;
  if (!force && Date.now() - _rpCache.at < RP_TTL && Object.keys(_rpCache.banks).length) return;
  _rpRefreshing = true;
  try {
    const now = Date.now(), codes = Object.keys(RP_MAP);
    const results = await Promise.allSettled(codes.map(c => _rpFetchBank(RP_MAP[c].slug).then(j => j && _rpTransform(c, j, now))));
    const banks = {};
    results.forEach((res, i) => { if (res.status === 'fulfilled' && res.value) banks[codes[i]] = res.value; });
    if (Object.keys(banks).length) { _rpCache = { at: now, banks }; auth.aiCacheSet('rates:rateprob', _rpCache).catch(() => {}); }
  } catch {} finally { _rpRefreshing = false; }
}
setInterval(() => { _refreshRateProb().catch(() => {}); }, RP_TTL);   // entretien périodique
setTimeout(() => { _refreshRateProb(true).catch(() => {}); }, 9000);  // amorçage au démarrage

app.get('/api/rates', (_req, res) => {
  try { _refreshRates(); } catch {}
  try { _refreshRateProb().catch(() => {}); } catch {}   // rafraîchit en tâche de fond si périmé (NON bloquant)
  const now = Date.now();
  const rpFresh = (_rpCache.at && (now - _rpCache.at) < 12 * 3600 * 1000) ? _rpCache.banks : {};   // tolère 12 h (résilience si l'API tombe)
  const banks = CB.map(b => {
    const rp = rpFresh[b.code];
    if (rp) return { code: b.code, cc: b.cc, bank: b.bank, full: b.full, rate: rp.rate,
      next: rp.next, nextDays: rp.nextDays, move: rp.move, prob: rp.prob, expBps: rp.expBps,
      scenario: rp.scenario, meetings: rp.meetings, source: 'market',
      marketImplied: (b.code === 'USD' && _fedWatch) ? _fedWatch : null };
    const st = (_ratesState.banks && _ratesState.banks[b.code]) || { rate: b.rate };
    const rb = _cbResolved(b);
    const bb = { ...rb, bias: _effBias(rb, st.rate) };             // biais (IA si dispo) + arrêt au taux terminal
    const sched = (CB_MEETINGS[b.code] || []).filter(d => Date.parse(d + 'T00:00:00Z') >= now - 2 * 86400000).slice(0, 8);   // 8 réunions maison (le front scrolle)
    const meetings = sched.map((d, i) => {
      const sc = _rateScenario(bb, i);
      const days = Math.max(0, Math.round((Date.parse(d + 'T00:00:00Z') - now) / 86400000));
      return { date: d, days, hold: Math.round(sc.hold * 10000) / 100, hike: Math.round(sc.hike * 10000) / 100, cut: Math.round(sc.cut * 10000) / 100,
               impliedBps: +sc.impliedBps.toFixed(1), baseCase: sc.baseCase };
    });
    const n = meetings[0], sc0 = _rateScenario(bb, 0);
    return {
      code: b.code, cc: b.cc, bank: b.bank, full: b.full, rate: st.rate,
      next: n ? n.date : null, nextDays: n ? n.days : null,
      move: sc0.baseCase, prob: Math.round(Math.max(sc0.hold, sc0.hike, sc0.cut) * 10000) / 100, expBps: +sc0.impliedBps.toFixed(1),
      scenario: { hold: Math.round(sc0.hold * 10000) / 100, hike: Math.round(sc0.hike * 10000) / 100, cut: Math.round(sc0.cut * 10000) / 100 },
      meetings, source: 'maison',
      marketImplied: (b.code === 'USD' && _fedWatch) ? _fedWatch : null,   // Fed : cross-check proba marché (CME futures)
    };
  });
  res.json({ asOf: now, model: 'rateprobability+maison', provider: 'rateprobability.com', rpAt: _rpCache.at || null, updatedAt: _ratesState.updatedAt, banks });
});

// ── Actualisation IA (optionnelle) des biais TAUX : déclenchée AU CHANGEMENT RÉEL d'un taux (force=true) ou en filet hebdo. EN CACHE, jamais à l'ouverture. ──
async function _aiRefreshRatesBias(force = false) {
  try {
    const cached = await auth.aiCacheGet('rates:aibias').catch(() => null);
    // force=true (un taux vient de bouger) → on ré-estime sans attendre l'expiration du cache.
    if (!force && cached && cached.banks && cached.at && Date.now() - cached.at < 6 * 86400000) { _aiRatesBias = cached.banks; return; }
  } catch {}
  const cbNews = (Array.isArray(allNews) ? allNews : [])
    .filter(n => n && /\b(fed|fomc|powell|ecb|bce|lagarde|boe|bailey|boj|ueda|boc|macklem|rba|snb|rbnz)\b|rate decision|interest rate|inflation|\bcpi\b/i.test((n.headline || '') + ' ' + (n.category || '')))
    .slice(0, 22).map(n => '- ' + (n.headline || '').slice(0, 120));
  const rates = CB.map(b => b.bank + ' ' + (((_ratesState.banks[b.code] || {}).rate) ?? b.rate) + '%').join(', ');
  const prompt = 'Tu es économiste macro. Pour chaque banque centrale, estime le BIAIS de politique monétaire (direction la plus probable de la prochaine variation) et une conviction de 0 à 1.\n\n'
    + 'Taux directeurs actuels : ' + rates + '.\n\nActualité récente :\n' + (cbNews.join('\n') || '(peu de news)')
    + '\n\nRéponds UNIQUEMENT par un JSON strict, sans texte autour : {"USD":{"bias":"hold","conv":0.7},"EUR":{"bias":"cut","conv":0.6},"GBP":{},"JPY":{},"CHF":{},"CAD":{},"AUD":{},"NZD":{}}. bias ∈ {"hike","hold","cut"}.';
  let txt;
  try { txt = await aiSmart('ratesbias', prompt, 600, { scheduled: true }); }
  catch (e) { console.log('[RatesBias IA] indisponible → on garde la config maison:', e.message); return; }
  try {
    const m = String(txt).match(/\{[\s\S]*\}/);
    const obj = JSON.parse(m ? m[0] : String(txt));
    const clean = {};
    CB.forEach(b => { const v = obj[b.code]; if (v && /^(hike|hold|cut)$/.test(v.bias || '')) clean[b.code] = { bias: v.bias, conv: Math.max(0.3, Math.min(0.97, +v.conv || b.conv)) }; });
    if (Object.keys(clean).length >= 4) {
      _aiRatesBias = clean;
      await auth.aiCacheSet('rates:aibias', { at: Date.now(), banks: clean }).catch(() => {});
      console.log('[RatesBias IA] biais actualisés (' + Object.keys(clean).length + ' banques) → cache durable');
    }
  } catch (e) { console.log('[RatesBias IA] parse échec → on garde la config maison'); }
}
setTimeout(() => { _aiRefreshRatesBias().catch(() => {}); }, 20000);   // démarrage : charge le cache (appel IA seulement si périmé)

// ── Vérification IA des TAUX (fiabilité DURABLE) : on ré-ancre les taux courants sur les VRAIES
//    décisions — actuals des décisions de taux du CALENDRIER + news — au lieu de la seule projection
//    maison. Cache 3 j, planifié (jamais à l'ouverture utilisateur). Garde-fou : taux plausible (±3 pts
//    de l'ancre vérifiée) → aucune hallucination ne peut casser l'affichage.
let _aiVerifiedRates = {};
function _applyVerifiedRates() {
  let changed = false;
  CB.forEach(b => {
    const v = _aiVerifiedRates[b.code], st = _ratesState.banks[b.code];
    if (v && st && typeof v.rate === 'number' && Math.abs(st.rate - v.rate) > 1e-9) {
      st.rate = v.rate;   // taux RÉEL (ancré sur le calendrier) → écrase la dérive du modèle maison
      const past = (CB_MEETINGS[b.code] || []).filter(d => Date.parse(d + 'T00:00:00Z') < Date.now()).sort();
      if (past.length) st.lastMeeting = past[past.length - 1];   // la dernière réunion est déjà intégrée → pas de re-projection
      changed = true;
    }
  });
  if (changed) { _ratesState.updatedAt = Date.now(); _saveRatesState(); }
}
async function _aiVerifyRates(force = false) {
  try {
    const cached = await auth.aiCacheGet('rates:aiverified').catch(() => null);
    if (cached && cached.banks) { _aiVerifiedRates = cached.banks; _applyVerifiedRates(); }
    if (!force && cached && cached.at && Date.now() - cached.at < 3 * 86400000) return;   // frais → pas d'appel IA
  } catch {}
  const cutoff = Date.now() - 160 * 86400000;
  const calLines = (Array.isArray(allCalendar) ? allCalendar : [])
    .filter(e => e && e.actual && SB_CURRENCIES.includes(e.currency) && e.timestamp > cutoff
      && /interest rate|rate decision|rate statement|monetary policy|deposit facility|refinanc|cash rate|official cash|bank rate|policy rate|funds rate/i.test(e.title || ''))
    .sort((a, b) => b.timestamp - a.timestamp).slice(0, 45)
    .map(e => `${e.currency} | ${e.title} | actual ${e.actual} | ${new Date(e.timestamp).toISOString().slice(0, 10)}`);
  const newsLines = (Array.isArray(allNews) ? allNews : [])
    .filter(n => n && n.timestamp > cutoff && /\b(fed|fomc|ecb|boe|boj|snb|boc|rba|rbnz)\b/i.test(n.headline || '') && /\b(rate|bps|basis point|hold|hike|cut|raise|lower|unchanged)\b/i.test(n.headline || ''))
    .slice(0, 25).map(n => '- ' + (n.headline || '').slice(0, 140));
  if (calLines.length + newsLines.length < 3) return;   // pas assez de données réelles → on garde l'ancrage config vérifié
  const prompt = `From the REAL data below (economic-calendar central-bank rate decisions WITH actual values, plus news), determine the CURRENT policy interest rate (a number, in %) for each of the 8 central banks. Use ONLY the data provided; if a bank's current rate cannot be determined, return null for it — do NOT guess.
Banks: USD=Federal Reserve (target range upper bound), EUR=ECB deposit facility rate, GBP=Bank of England Bank Rate, JPY=Bank of Japan policy rate, CHF=SNB policy rate, CAD=Bank of Canada overnight rate, AUD=RBA cash rate, NZD=RBNZ OCR.

CALENDAR RATE DECISIONS (currency | title | actual | date), most recent first:
${calLines.join('\n') || '(none)'}

NEWS:
${newsLines.join('\n') || '(none)'}

Return ONLY strict JSON, a number or null per bank: {"USD":3.75,"EUR":2.0,"GBP":3.75,"JPY":0.75,"CHF":0.0,"CAD":2.25,"AUD":4.35,"NZD":2.25}. No text.`;
  let txt;
  try { txt = await aiSmart('ratesbias', prompt, 400, { scheduled: true }); }
  catch (e) { console.log('[RatesVerify IA] indispo:', e.message); return; }
  try {
    const m = String(txt).match(/\{[\s\S]*\}/);
    const obj = JSON.parse(m ? m[0] : String(txt));
    const next = {};
    CB.forEach(b => {
      const v = obj[b.code];
      if (typeof v === 'number' && isFinite(v) && v >= -1.5 && v <= 25 && Math.abs(v - b.rate) <= 3) next[b.code] = { rate: +(+v).toFixed(2), at: Date.now() };
    });
    if (Object.keys(next).length >= 3) {
      _aiVerifiedRates = next;
      await auth.aiCacheSet('rates:aiverified', { at: Date.now(), banks: next }).catch(() => {});
      _applyVerifiedRates();
      console.log('[RatesVerify IA] taux ancrés sur données réelles → ' + Object.keys(next).map(c => c + '=' + next[c].rate).join(' '));
    }
  } catch (e) { console.log('[RatesVerify IA] parse échec'); }
}
setTimeout(() => { _aiVerifyRates().catch(() => {}); }, 60000);                 // démarrage (après chargement calendrier/news)
setInterval(() => { _aiVerifyRates().catch(() => {}); }, 24 * 3600 * 1000);     // quotidien

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
const BANK_EXTRACT_FILE = path.join(_CACHE_DIR, 'cache_bank_extract.json');
const _bankExtracted = _loadJsonMap(BANK_EXTRACT_FILE);   // articleId → true (déjà traité)
const _BANK_FX_TITLE = /\bfx\b|forex|currenc|dollar|euro\b|sterling|\byen\b|aussie|kiwi|loonie|usd|eur|gbp|jpy|aud|nzd|cad|chf|\bg10\b/i;
async function _extractBankPositionsAI(cap = 8) {
  if (!ai || !_brCache) return;
  if (!aiAllowed('bank', { priority: 'background' })) return;   // budget Gemini : extraction réservée au week-end
  // Candidats = recherche FX RÉCENTE de toutes les banques du feed (l'ancienne source 'actionforex'
  // n'existe plus → l'extraction ne trouvait plus jamais rien et la table restait figée sur les seeds).
  const cutRecent = Date.now() - 21 * 86400000;
  const candidates = _brCache.filter(a =>
    a && a.id && !_bankExtracted.has(a.id) && (a.timestamp || 0) > cutRecent &&
    (a._source === 'actionforex' || _BANK_FX_TITLE.test(a.title || ''))
  ).slice(0, cap);
  for (const art of candidates) {
    if (!aiAllowed('bank', { priority: 'background' })) break;
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
      const pr = String(d.pair || '').toUpperCase();
      if (!pr || !/^[A-Z]{3}\/[A-Z]{3}$/.test(pr) || !d.entry) continue;
      // Dédoublonnage : même banque + même paire à <30 j → on garde la position existante
      const bk = String(d.bank || art.institution || 'Bank Research').slice(0, 60);
      const ts = art.timestamp || Date.now();
      const dup = _bankPositions.find(p => p.pair === pr &&
        String(p.bank).toLowerCase().split(' ')[0] === bk.toLowerCase().split(' ')[0] &&
        Math.abs(new Date(p.date + 'T12:00:00Z').getTime() - ts) < 30 * 86400000);
      if (dup) continue;
      _bankPositions.unshift({
        id: 'ai-' + art.id.slice(-10), source: 'ai',
        bank: bk,
        orderType: ['Buy Limit', 'Sell Limit', 'Market Execution'].includes(d.orderType) ? d.orderType : 'Market Execution',
        pair: pr, date: new Date(ts).toISOString().slice(0, 10),
        entry: +d.entry, tp: +d.tp || 0, sl: +d.sl || 0,
        thesis: String(art.title || '').slice(0, 240),
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
// ── MAJ du SAMEDI (hebdomadaire) : purge des positions CLÔTURÉES anciennes (>45 j, TP/SL touché)
// puis passe d'extraction élargie (cap 16) sur la recherche de la semaine → la table reste fraîche.
// Une seule exécution par samedi (verrou KV bank:satrun), peu importe les redémarrages.
setInterval(async () => {
  try {
    const paris = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    if (paris.getDay() !== 6) return;
    const today = paris.toISOString().slice(0, 10);
    const done = await auth.aiCacheGet('bank:satrun', 8640000000000).catch(() => null);
    if (done === today) return;
    await auth.aiCacheSet('bank:satrun', today).catch(() => {});
    let px = {}; try { px = await _bankLivePrices(); } catch {}
    const cut45 = Date.now() - 45 * 86400000;
    const before = _bankPositions.length;
    _bankPositions = _bankPositions.filter(p => {
      const ts = new Date(String(p.date) + 'T12:00:00Z').getTime() || Date.now();
      if (ts >= cut45) return true;                                  // récentes : on garde
      const { status } = _bankStatus(p, px[p.pair] ?? null);
      return status === 'Active';                                    // vieilles ET clôturées (TP/SL) : purgées
    });
    await _extractBankPositionsAI(16);
    _saveBank();
    console.log(`[Bank] MAJ samedi : ${before} → ${_bankPositions.length} positions (purge + extraction hebdo)`);
  } catch (e) { console.warn('[Bank] MAJ samedi échec:', e.message); }
}, 60 * 60 * 1000);

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
    try { await fn(); console.log(`[DTP] ${name} done`); }
    catch (e) { console.error(`[DTP] ${name} failed:`, e.message); }
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
  if (/prime minister|parliament|election|congress|senate|white house/.test(t)) return 'DTP Update';
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

// ── Géopolitique tier-1 : action militaire / attaque / guerre → IMPORTANT (rouge).
//    Les simples propos diplomatiques ("we prefer diplomacy") NE matchent PAS ici.
const GEO_TIER1_RE = /\b(attacks?|assault|invasions?|invade[sd]?|air\s?strikes?|missiles?|drone\s+strikes?|sho(?:t|oting)\s+down|shoots?\s+down|warheads?|nuclear\s+(?:strike|attack|test|weapon)|declares?\s+war|act\s+of\s+war|retaliat\w*|military\s+(?:response|action|strike|operation|retaliation)|respond\s+militarily|escalat\w*|strait\s+of\s+hormuz|oil\s+embargo|emergency\s+(?:meeting|session|summit))\b/i;
function upgradeItemPriority(item) {
  const h = item.headline || '';

  // ── Flag _highImpact : donnée macro tier-1 RÉELLE (avec valeur/actual) ──────
  // Sert au rendu pour colorer en rouge les données High Impact (ex: PMI, CPI, NFP…)
  // Détection robuste : regex tier-1 OU champ impact explicite du flux (FF calendar)
  const impactField  = String(item.impact || item.importance || '').toLowerCase();
  const hasHighImpactField = impactField === 'high' || impactField === 'critical' || impactField === '3';
  const isHighImpactData = HIGH_IMPACT_RE.test(h) || hasHighImpactField;

  // Never touch urgent/breaking — those are source-confirmed (déjà rouges)
  if (item.urgent) return (isHighImpactData || GEO_TIER1_RE.test(h)) ? { ...item, _highImpact: true } : item;

  // ── Smart demote: opinion/support/approval statements → not high priority ──
  if (item.priority === 'high' && OPINION_DEMOTE_RE.test(h)) {
    return { ...item, priority: 'normal', _highImpact: isHighImpactData };
  }

  // ── CB categories: demote if no concrete action language ──────────────────
  const isCB = /^(Fed|ECB|BoJ|BoE|BoC|RBA|SNB|RBNZ)$/.test(item.category || '');
  if (item.priority === 'high' && isCB && !CB_ACTION_RE.test(h) && !HIGH_IMPACT_RE.test(h)) {
    return { ...item, priority: 'normal', _highImpact: isHighImpactData };
  }

  // ── Upgrade: donnée macro tier-1 RÉELLE, OU géopolitique tier-1 (militaire/attaque/guerre) ──
  if (isHighImpactData || GEO_TIER1_RE.test(h)) {
    return { ...item, priority: 'high', _highImpact: true };
  }

  return item;
}

// Purge noise from history on every server start
allNews = allNews.filter(i => {
  if (i._briefing || i.source === 'DTP' || i._marketWrap) return true;          // garder les rapports internes (+ Market Wrap visible)
  if (isNoise(i.headline)) return false;
  if (isGlobalNewsNoise(i.headline)) return false;
  // Global News générique sans pertinence financière → purge
  if (i.category === 'Global News' && !isFinanciallyRelevant(i.headline + ' ' + (i.description || ''))) return false;
  return true;
}).map(upgradeItemPriority);

// ─── Dedup ───────────────────────────────────────────────────────────────────

function norm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 55); }
// Normalisation "forte" : retire les préfixes (Breaking:, Update:…) ET l'attribution de source
// en fin de titre (« … – Scotiabank », « … - BBH ») → deux formulations de la MÊME news matchent.
function _normHl(s) {
  return String(s || '').toLowerCase()
    .replace(/^\s*(breaking|update|alert|flash|just in|developing|exclusive|live)\s*[:\-–—]\s*/i, '')
    .replace(/\s*[–\-—|]\s*[\w .&'/]{2,30}$/,'')           // attribution source en fin (- / | Source)
    .replace(/\s*\(\s*[\w .&'/]{2,30}\)\s*$/,'')           // attribution entre parenthèses en fin "(Mehr News)"
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function _hlTokens(s) { return new Set(_normHl(s).split(' ').filter(w => w.length > 3)); }
// Doublon = titre identique, OU identique après nettoyage préfixe/source, OU ≥80% de tokens
// communs avec une news des 45 dernières minutes (même histoire reformulée par une autre source).
function isDuplicate(item, list) {
  const n  = norm(item.headline);
  const hn = _normHl(item.headline);
  const tk = _hlTokens(item.headline);
  const ts = item.timestamp || Date.now();
  for (const e of list) {
    if (norm(e.headline) === n) return true;                       // exact
    if (Math.abs((e.timestamp || 0) - ts) > 180 * 60 * 1000) continue;   // quasi-dup : fenêtre 3 h (attrape les reprises tardives)
    if (_normHl(e.headline) === hn) return true;                   // identique après nettoyage
    if (tk.size >= 4) {
      const et = _hlTokens(e.headline);
      if (et.size >= 4) {
        let inter = 0; for (const t of tk) if (et.has(t)) inter++;
        const uni = tk.size + et.size - inter;
        if (uni > 0 && inter / uni >= 0.72) return true;          // ~même news reformulée (seuil assoupli)
      }
    }
  }
  return false;
}

// ─── Broadcast ───────────────────────────────────────────────────────────────

function broadcast(data) {
  // Ne JAMAIS diffuser les briefings PRIMER au site (masqués sur demande utilisateur) : on les retire
  // des mises à jour news poussées en temps réel ; si l'envoi ne contenait que ça, on l'abandonne.
  if (data && data.type === 'news_update' && Array.isArray(data.items)) {
    const items = data.items.filter(n => !_isPrimerNews(n));
    if (!items.length) return;
    data = { ...data, items };
  }
  const payload = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(payload); });
}

// ─── Merge helpers ───────────────────────────────────────────────────────────

function mergeItems(incoming) {
  // Curated sources bypass the keyword filter — they're already financial news
  const relevant = incoming.filter(item => {
    // Internal briefings always pass through
    if (item._briefing || item.source === 'DTP') return true;

    const fullText = item.headline + ' ' + (item.description || '');

    // Always drop regional sub-national noise and editorial reports
    if (isNoise(item.headline)) return false;
    // Drop tabloid / gossip / sports / lifestyle — même venant d'une source curated
    if (isGlobalNewsNoise(item.headline)) return false;
    // Drop "PRIMER" prep posts (ex. « PRIMER — London Opening Preparation ») — sans intérêt marché actionnable.
    if (/^\s*\[?\s*primer\b/i.test(item.headline || '')) return false;
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
  // Enrich tags and upgrade priority for all incoming items.
  // Tag PRÉCIS sur titre + description (plus de signal → moins d'erreurs d'affectation).
  const newItems = relevant
    .map(item => item._briefing ? item : { ...item, tags: extractTags(item.category, (item.headline || '') + ' ' + (item.description || '')) })
    .map(upgradeItemPriority)
    .filter(item => !isDuplicate(item, allNews));
  if (newItems.length === 0) return 0;

  // Spam cap: max 8 data items per batch across all data categories
  const DATA_CATS_CAP = new Set(['Economic Commentary', 'EU Data', 'US Data', 'UK Data',
    'Swiss Data', 'Japanese Data', 'Canadian Data', 'Australian Data', 'Chinese Data']);
  // Données TIER-1 (GDP, CPI/inflation, NFP/payrolls, chômage, emploi, ventes au détail,
  // décisions de taux) → JAMAIS plafonnées, quel que soit le libellé : abrégé ("GDP") OU
  // en toutes lettres ("Gross Domestic Product"), FF calendar OU FinancialJuice/FXStreet.
  // Le plafond ne doit étouffer que le BRUIT data secondaire, pas les vraies sorties importantes.
  const TIER1_DATA_RE = /\b(gdp|gross\s+domestic\s+product|cpi|consumer\s+price|core\s+inflation|inflation\s+rate|\bpce\b|hicp|nonfarm|non.?farm\s+payroll|\bpayrolls?\b|unemployment|employment\s+change|retail\s+sales|rate\s+decision|(?:fomc|ecb|boe|boj|snb|rba|rbnz|boc)\b)/i;
  const recentData = allNews.filter(
    i => DATA_CATS_CAP.has(i.category) && Date.now() - i.timestamp < 2 * 60_000
  ).length;
  let dataAllowed = Math.max(0, 8 - recentData);
  const capped = newItems.filter(i => {
    if (!DATA_CATS_CAP.has(i.category)) return true;
    // Tier-1 (priorité haute OU libellé reconnu) → exempté du plafond : jamais perdu.
    if (i.priority === 'high' || TIER1_DATA_RE.test(i.headline || '')) return true;
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

// ─── Tags IA pour les news IMPORTANTES (intelligent, borné, caché) ───────────
// Le tagging mots-clés (extractTags) couvre TOUTES les news de façon précise. Pour les
// news IMPORTANTES uniquement, l'IA affine 0–3 tags depuis un vocabulaire contrôlé — avec
// de fortes limites pour préserver le quota : cap journalier + 1/cycle + cache durable +
// jamais de dépense Claude (claudeOverBudget:false → repli mots-clés si budget épuisé).
const AI_TAG_VOCAB = ['US','EU','UK','Japan','China','Fed','ECB','BoJ','BoE','Rates','Inflation','Data','Oil','Metals','Gold','Geopolitical','Risk','Crypto','Equities','Bonds','FX','Trade'];
const AI_TAG_DAILY_MAX = parseInt(process.env.AI_TAG_DAILY_MAX, 10) || 12;   // abaissé (éco quota) — repli mots-clés couvre le reste
const _aiTagCache = new Map();          // id → tags[] (cache mémoire chaud)
let _aiTagDay = '', _aiTagDayCount = 0; // compteur journalier (cap dur)
let _aiTagBusy = false;

// ─── Analyse PRÉ-CALCULÉE des news (en arrière-plan, bornée, cachée) ──────────
// L'analyse n'est PAS générée au clic : un passage de fond la produit pour les news qui
// la MÉRITENT (importantes + assez de matière), la cache (durable Supabase + disque) et
// l'attache à l'objet news (item.analyse). Le front affiche le tag « Analyse » uniquement
// si item.analyse existe → parfois Info+Analyse, parfois juste Info. Budget strict.
const AI_ANALYSE_DAILY_MAX = parseInt(process.env.AI_ANALYSE_DAILY_MAX, 10) || 10;   // abaissé (éco quota)
let _aiAnaDay = '', _aiAnaDayCount = 0, _aiAnaBusy = false;
function _meritsAnalysis(item) {
  if (!item || item._briefing || item._marketUpdate) return false;
  if (Date.now() - item.timestamp > 6 * 60 * 60 * 1000) return false;            // récentes uniquement
  const desc = String(item.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (desc.length < 120) return false;                                           // pas assez de matière → Info suffit
  return item.priority === 'high' || item.important === true;                    // importantes uniquement
}
function _parseAnalyseBullets(text) {
  return String(text || '').split('\n').map(l => l.trim())
    .filter(l => /^[•\-\*]/.test(l)).map(l => l.replace(/^[•\-\*]\s*/, '').trim())
    .filter(Boolean).slice(0, 3);
}
async function _enrichAnalyses() {
  if (_aiAnaBusy) return;
  const hasAI = (ai.hasAnthropic && ai.hasAnthropic()) || !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  if (!hasAI) return;
  _aiAnaBusy = true;
  try {
    const today = _aiDay();
    if (_aiAnaDay !== today) { _aiAnaDay = today; _aiAnaDayCount = 0; }           // reset journalier
    let perCycle = 1;                                                             // 1 génération IA par passage
    for (const item of allNews) {
      if (!item || (Array.isArray(item.analyse) && item.analyse.length)) continue; // déjà analysée
      if (!_meritsAnalysis(item)) continue;
      const ck = 'ana:' + item.id;
      // 1) cache mémoire chaud
      if (_analyseCache.has(ck)) {
        const b = _analyseCache.get(ck);
        if (Array.isArray(b) && b.length) { item.analyse = b; try { broadcast({ type: 'news_update', items: [item], total: allNews.length }); } catch {} }
        continue;
      }
      // 2) cache durable (Supabase) — aucune requête IA
      let cached = null; try { cached = await auth.aiCacheGet(ck); } catch {}
      if (Array.isArray(cached)) {
        _analyseCache.set(ck, cached);
        if (cached.length) { item.analyse = cached; try { broadcast({ type: 'news_update', items: [item], total: allNews.length }); } catch {} }
        continue;
      }
      // 3) génération IA (bornée par cap journalier + 1/cycle)
      if (perCycle <= 0 || _aiAnaDayCount >= AI_ANALYSE_DAILY_MAX) break;
      perCycle--; _aiAnaDayCount++;
      try {
        const desc = String(item.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 600);
        const out = await aiSmart('news',
`You are a concise professional financial analyst. Analyse this news for a forex/macro trader.

Headline: ${item.headline}
Category: ${item.category || '—'}
Context: ${desc}

Write 2 to 3 SHORT bullets tailored to THIS specific news (not a template). Rules:
- Add ANALYTICAL value: drivers, implications, levels, what it means for the trade — do NOT restate the headline or just repeat the figures.
- Name only the instruments genuinely relevant here (e.g. EUR/USD, Brent, XAU/USD, US10Y) — skip if none.
- Explain the concrete causal mechanism for THIS story, not generic phrasing.
- Max 22 words per bullet. NEVER include source/author attribution.
- NO bold, NO markdown, NO asterisks. Plain text only.
- Start each bullet with • . Reply ONLY with the bullets, no preamble.`,
          320, { important: true, claudeOverBudget: false });
        const bullets = _parseAnalyseBullets(out);
        _analyseCache.set(ck, bullets);                                          // cache même vide → on ne réessaie pas
        if (_analyseCache.size > 2000) _analyseCache.delete(_analyseCache.keys().next().value);
        _saveJsonMap(ANALYSE_CACHE_FILE, _analyseCache);
        auth.aiCacheSet(ck, bullets).catch(() => {});
        if (bullets.length) { item.analyse = bullets; try { broadcast({ type: 'news_update', items: [item], total: allNews.length }); } catch {} }
      } catch { /* budget épuisé / pas de clé → la news reste en Info seul */ }
    }
  } finally { _aiAnaBusy = false; }
}
function _mergeAiTags(item, aiTags) {
  // catégorie d'abord (souvent masquée par le front), puis tags IA nets — au plus 4
  return [...new Set([item.category, ...(aiTags || [])])].slice(0, 4);
}
async function _smartTagNews() {
  if (_aiTagBusy) return;
  const hasAI = (ai.hasAnthropic && ai.hasAnthropic()) || !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  if (!hasAI) return;
  _aiTagBusy = true;
  try {
    const today = _aiDay();
    if (_aiTagDay !== today) { _aiTagDay = today; _aiTagDayCount = 0; }   // reset journalier
    let perCycle = 1;                                                     // 1 génération IA par passage
    for (const item of allNews) {
      if (!item || item._briefing || item._aiTagged) continue;
      if (item.priority !== 'high') continue;                            // IMPORTANTES uniquement
      if (Date.now() - item.timestamp > 6 * 60 * 60 * 1000) continue;    // récentes uniquement
      // 1) cache chaud
      if (_aiTagCache.has(item.id)) { item.tags = _mergeAiTags(item, _aiTagCache.get(item.id)); item._aiTagged = true; continue; }
      // 2) cache durable (Supabase) — pas de requête IA
      let cached = null; try { cached = await auth.aiCacheGet('tag:' + item.id); } catch {}
      if (Array.isArray(cached)) { _aiTagCache.set(item.id, cached); item.tags = _mergeAiTags(item, cached); item._aiTagged = true; continue; }
      // 3) génération IA (bornée par le cap journalier + 1/cycle)
      if (perCycle <= 0 || _aiTagDayCount >= AI_TAG_DAILY_MAX) break;
      perCycle--; _aiTagDayCount++;
      try {
        const out = await aiSmart('news',
          `From this EXACT list only: ${AI_TAG_VOCAB.join(', ')} — pick the 0 to 3 tags that TRULY describe this market news. ` +
          `If none clearly apply, answer NONE. Answer with just the chosen tags comma-separated (or NONE), nothing else.\nNews: ${item.headline}`,
          40, { important: true, claudeOverBudget: false });
        const up = AI_TAG_VOCAB.map(v => v.toUpperCase());
        const picked = /NONE/i.test(String(out)) ? []
          : String(out).split(/[,\n;]/).map(s => s.trim()).filter(Boolean)
              .map(s => AI_TAG_VOCAB[up.indexOf(s.toUpperCase())]).filter(Boolean).slice(0, 3);
        _aiTagCache.set(item.id, picked);
        if (_aiTagCache.size > 3000) _aiTagCache.delete(_aiTagCache.keys().next().value);   // cap mémoire (anti-OOM)
        item.tags = _mergeAiTags(item, picked); item._aiTagged = true;
        auth.aiCacheSet('tag:' + item.id, picked).catch(() => {});
      } catch { /* budget épuisé / pas de clé → on garde les tags mots-clés (déjà précis) */ }
    }
  } finally { _aiTagBusy = false; }
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
  // Actuals : source PRINCIPALE TradingView (HTTP, sans Cloudflare) + complément depuis nos news.
  _refreshTVActuals().catch(() => {});
  try { _backfillActualsFromNews(); } catch {}

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

  // Affinage IA des tags pour les news importantes (arrière-plan, borné, caché).
  _smartTagNews().catch(() => {});
  // Analyse IA PRÉ-CALCULÉE des news importantes (arrière-plan, bornée) → tag « Analyse » prêt dans le feed.
  _enrichAnalyses().catch(() => {});
  // ANTICIPATION calendrier : dès qu'une news de résultat arrive, on remplit l'actual de l'événement
  // correspondant (sans attendre l'ouverture de l'onglet calendrier) → on récupère tout au fil de l'eau.
  try { _backfillActualsFromNews(); } catch {}
}

// ─── WebSocket ───────────────────────────────────────────────────────────────

wss.on('connection', (ws, req) => {
  // Restreint le flux WS aux origines autorisées (prod + ALLOWED_ORIGINS configuré) → anti-leech.
  if (process.env.NODE_ENV === 'production' && ALLOWED_ORIGINS.length) {
    const origin = req?.headers?.origin || '';
    const ok = !origin || ALLOWED_ORIGINS.some(o => origin === o || origin.endsWith(o));
    if (!ok) { try { ws.close(1008, 'origin not allowed'); } catch {} return; }
  }
  console.log(`[WS] Client connected (${wss.clients.size})`);

  // Présence : on associe ce WS à l'utilisateur (cookie de session) → statut "en ligne".
  const _uid = _wsUserIdFromReq(req);
  if (_uid) _onlineUsers.set(_uid, (_onlineUsers.get(_uid) || 0) + 1);

  ws.send(JSON.stringify({ type: 'initial', items: allNews.slice(0, 200), total: allNews.length }));
  // Envoyer aussi les session wraps et bank research au moment de la connexion
  if (_swCache.length > 0) ws.send(JSON.stringify({ type: 'sw_update', items: _swCache }));
  if (_brCache.length > 0) ws.send(JSON.stringify({ type: 'br_update', items: _brCache }));

  ws.on('error', err => console.error('[WS]', err.message));
  ws.on('close', () => {
    if (_uid) { const n = (_onlineUsers.get(_uid) || 1) - 1; if (n <= 0) _onlineUsers.delete(_uid); else _onlineUsers.set(_uid, n); }
    console.log(`[WS] Disconnected (${wss.clients.size} left)`);
  });
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
    const data = await forceFetchOutlook();   // vrai fetch (garde le cache chaud pour un service instantané)
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
  setTimeout(refreshMyfxbook, 2000);          // immediate startup fetch
  setInterval(refreshMyfxbook, 15 * 60 * 1000); // then every 15 min (sentiment retail)
}

// ── KEEP-ALIVE : anti-veille Render (offre gratuite) ─────────────────────────
// Un service Render gratuit s'endort après ~15 min sans trafic ENTRANT et met 30-60 s à se
// réveiller → "chargement trop long". On ping notre PROPRE URL publique toutes les 13 min :
// ça compte comme trafic entrant → le serveur reste éveillé et ses caches restent chauds,
// donc les onglets se chargent instantanément. (Render fournit RENDER_EXTERNAL_URL.)
const _SELF_URL = (process.env.RENDER_EXTERNAL_URL || process.env.APP_URL || '').replace(/\/+$/, '');
if (_SELF_URL) {
  setInterval(() => {
    const _c = new AbortController(); const _t = setTimeout(() => _c.abort(), 8000);
    fetch(_SELF_URL + '/healthz', { signal: _c.signal }).catch(() => {}).finally(() => clearTimeout(_t));
  }, 13 * 60 * 1000);
  console.log(`[KeepAlive] auto-ping ${_SELF_URL}/healthz / 13 min — anti-veille (chargement rapide)`);
}

// ── PRÉCHAUFFAGE des caches au démarrage → onglets instantanés (pas de "Loading…") ──
// On peuple les caches lourds (Currency Strength, DMX/Myfxbook, COT) en arrière-plan dès le
// démarrage, AVANT que l'utilisateur n'ouvre les onglets → données déjà prêtes.
// Préchauffage ÉCHELONNÉ : on évite ~80 requêtes Yahoo simultanées au démarrage
// (chaque période strength = 28 paires). Les onglets sont chauds avant l'usage.
const _warm = (fn, ms, label) => setTimeout(() => { try { fn().catch(() => {}); } catch (e) { console.warn('[Warm]', label, e.message); } }, ms);
_warm(() => getYFSession(),                    2500,  'YF session');    // session/crumb Yahoo prête AVANT les fetchs
_warm(() => computeCurrencyStrength('today'),  6000,  'strength TD');   // STRENGTH gauche
_warm(() => fetchCOTData('lev_money'),         8000,  'COT');           // COT (type par défaut)
_warm(() => computeCurrencyStrength('1d'),     11000, 'strength 1d');   // METER
_warm(() => computeCurrencyStrength('week'),   16000, 'strength TW');   // STRENGTH droite
if (typeof fetchRiskSentiment === 'function') _warm(() => fetchRiskSentiment(), 13000, 'risk');  // RISK
_warm(() => generateGlobalEconomicWeekly(false), 30000, 'GEW');   // Global Economic Weekly préchauffé APRÈS le calendrier (boot+9s) → prêt + non vide
// (Myfxbook/DMX déjà préchauffé par refreshMyfxbook au démarrage)

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

// ── FIN D'ESSAI GRATUIT (1 semaine) ──────────────────────────────────────────
//    1 SEUL email, LE JOUR D'EXPIRATION de la période d'essai → invitation à
//    passer à l'abonnement mensuel. JAMAIS répété : anti-doublon durable
//    (email_log Supabase + fichier sur volume persistant) → clé unique par essai.
//    Le check 6 h ne fait que DÉTECTER l'expiration le jour même ; il n'envoie qu'1×.
async function _checkTrialUpsell() {
  try {
    const users = await auth.getAllUsers();
    const now   = Date.now();
    const DAY   = 24 * 60 * 60 * 1000;
    const low   = now - 1 * DAY;   // a expiré il y a moins d'1 jour…
    const high  = now;             // … et pas dans le futur → "le jour de l'expiration"
    for (const u of users) {
      if (u.role !== 'client' || !u.active || !u.expires_at || !u.created_at) continue;
      const exp = new Date(u.expires_at).getTime();
      const crt = new Date(u.created_at).getTime();
      if (!Number.isFinite(exp) || !Number.isFinite(crt)) continue;
      // Essai = fenêtre d'accès ≈ 1 semaine (≤ 8 j) → distingue des abonnements payants (≥ 1 mois)
      if (exp - crt > 8 * DAY) continue;
      // Fenêtre d'envoi : l'essai a expiré dans les dernières 24 h
      if (exp <= low || exp > high) continue;
      const key = `trial-upsell:${u.id}:${u.expires_at}`;
      if (await auth.emailLogHas(key)) continue;            // déjà envoyé pour cet essai
      const ok = await mailer.sendTrialUpsell({ to: u.email, name: u.name, expiresAt: u.expires_at });
      if (ok) {
        await auth.emailLogAdd(key);
        console.log(`[TrialUpsell] Incitation envoyée → ${u.email} (essai expire ${u.expires_at})`);
      }
    }
  } catch (e) { console.error('[TrialUpsell]', e.message); }
}
// Planification : on VÉRIFIE toutes les 6 h (→ l'expiration est repérée le jour même) + un
// rattrapage 30 s après chaque démarrage du conteneur. ATTENTION : 6 h = fréquence de CHECK,
// PAS d'envoi → grâce à l'anti-doublon durable, le client ne reçoit qu'UN SEUL mail, le jour
// d'expiration de son essai (jamais une relance par heure/par redémarrage).
(function scheduleTrialUpsell() {
  setTimeout(_checkTrialUpsell, 30000);                       // rattrapage au démarrage (redémarrages conteneur)
  setInterval(_checkTrialUpsell, 6 * 60 * 60 * 1000);        // puis re-vérifie toutes les 6 h (1 seul envoi via anti-doublon)
})();

// ── RÉENGAGEMENT : client inactif depuis ≥ 7 jours sur le terminal ───────────
//    On relance UNE FOIS par épisode d'inactivité (ancre = jour de dernière connexion,
//    ou de création si jamais connecté). Anti-doublon durable via email_log → si le client
//    revient puis repart 7 j, il sera relancé à nouveau (nouvelle ancre), mais jamais 2× pour
//    le même épisode. Fenêtre 7–30 j (on ne harcèle pas les comptes froids/abandonnés).
async function _checkReengagement() {
  try {
    const users = await auth.getAllUsers();
    const now   = Date.now();
    const DAY   = 24 * 60 * 60 * 1000;
    let sent = 0;
    for (const u of users) {
      if (!u || u.role !== 'client' || !u.active) continue;
      // Abonnement expiré → c'est le mail de renouvellement qui s'applique, pas celui-ci
      if (u.expires_at && new Date(u.expires_at).getTime() < now) continue;
      const lastTs = u.last_login ? new Date(u.last_login).getTime()
                   : (u.created_at ? new Date(u.created_at).getTime() : 0);
      if (!Number.isFinite(lastTs) || !lastTs) continue;
      const days = Math.floor((now - lastTs) / DAY);
      if (days < 7 || days > 30) continue;                    // inactif 7 à 30 jours
      const anchor = new Date(lastTs).toISOString().slice(0, 10);
      const key = `reengage:${u.id}:${anchor}`;
      if (await auth.emailLogHas(key)) continue;              // déjà relancé pour cet épisode
      const ok = await mailer.sendReengagement({ to: u.email, name: u.name, days });
      if (ok) {
        await auth.emailLogAdd(key);
        sent++;
        console.log(`[Reengage] Relance envoyée → ${u.email} (inactif ${days}j)`);
        if (sent >= 25) break;                               // garde-fou : max 25 envois / passage
      }
    }
  } catch (e) { console.error('[Reengage]', e.message); }
}
// ⛔ RÉENGAGEMENT DÉSACTIVÉ (demande client : 1 SEUL email, le jour de la fin d'essai — pas de
//    relance marketing récurrente). Le sur-envoi de ce mail (anti-doublon perdu à chaque redémarrage
//    du conteneur Docker) a flagué le domaine en spam. On garde la fonction, on coupe la planification.
//    Pour le réactiver un jour : décommenter ci-dessous APRÈS avoir rendu l'anti-doublon durable
//    (table Supabase email_log + volume Docker pour cache_email_log.json — fait dans ce commit).
void _checkReengagement;
// (function scheduleReengagement() {
//   setTimeout(_checkReengagement, 60000);                   // rattrapage 60s après le démarrage
//   setInterval(_checkReengagement, 12 * 60 * 60 * 1000);   // puis toutes les 12 h
// })();

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
  // finance.yahoo.com redirige vers la page de CONSENTEMENT UE (guce.yahoo.com) → boucle de
  // redirections (« Maximum number of redirects exceeded ») → crumb jamais obtenu → l'intraday
  // (today/8h) tombe à 0 paire. Correctif : on NE SUIT PAS les redirections (maxRedirects:0, on lit
  // quand même le set-cookie de la 1re réponse) et on essaie d'abord fc.yahoo.com (pas de consent).
  for (const cookieUrl of ['https://fc.yahoo.com/', 'https://finance.yahoo.com/']) {
    try {
      const r1 = await axios.get(cookieUrl, {
        headers: { 'User-Agent': YF_UA, 'Accept': 'text/html,application/xhtml+xml,*/*', 'Accept-Language': 'en-US,en;q=0.9' },
        timeout: 6000, validateStatus: () => true, maxRedirects: 0,   // ← ne suit PAS la redirection consent
      });
      const rawCookies = r1.headers['set-cookie'] || [];
      const cookie = rawCookies.map(c => c.split(';')[0]).join('; ');
      if (!cookie) continue;
      const r2 = await axios.get('https://query2.finance.yahoo.com/v1/test/getcrumb', {
        headers: { 'User-Agent': YF_UA, 'Cookie': cookie, 'Accept': '*/*', 'Referer': 'https://finance.yahoo.com/' },
        timeout: 5000, validateStatus: () => true, maxRedirects: 0,
      });
      if (r2.status === 200 && typeof r2.data === 'string' && r2.data.length > 0 && !/<(?:html|!doctype)/i.test(r2.data)) {
        _yfSession = { cookie, crumb: r2.data.trim() };
        _yfSessionTs = Date.now();
        console.log('[YF] session crumb acquired via ' + cookieUrl);
        return _yfSession;
      }
    } catch (e) {
      console.warn('[YF] session attempt failed (' + cookieUrl + '):', e.message);
    }
  }
  console.warn('[YF] crumb indisponible → repli sans crumb (les endpoints daily fonctionnent encore)');
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
  today: { interval: '15m', range: '5d',  cutoffMs: null,          cutoffToday: true, clip:  5  },
  // TW = "cette semaine" → ancré au LUNDI 00:00 UTC de la semaine en cours (pas une fenêtre
  // glissante). La courbe démarre toujours lundi et grandit au fil de la semaine.
  week:  { interval: '1h',  range: '5d',  cutoffMs: null,          cutoffWeek: true,  clip: 10  },
  '8h':  { interval: '15m', range: '5d',  cutoffMs:  8 * 3600000,                    clip:  3  },
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

// Calcul LOURD (28 paires Yahoo) — écrit le cache _csCache[period] à la fin. Ne pas appeler
// directement : passer par computeCurrencyStrength() (cache + stale-while-revalidate).
async function _computeStrengthFresh(period) {
  const cfg = CS_PERIOD_CFG[period] || CS_PERIOD_CFG.today;

  const { interval, range, cutoffMs, cutoffToday, cutoffWeek, clip } = cfg;

  // Le FX est FERMÉ le week-end : ancrer « today »/intraday sur le SAMEDI/DIMANCHE donnerait une
  // fenêtre VIDE → « Data unavailable ». On recule donc la référence au dernier jour de séance (vendredi).
  const _wkBack = (() => { const d = new Date().getUTCDay(); return d === 6 ? 1 : d === 0 ? 2 : 0; })();   // sam→ven, dim→ven
  let cutoffSec = null;
  if (cutoffToday) {
    // "today" = ouverture (00:00 UTC) du dernier jour de séance — le « jour FX » professionnel.
    const d = new Date(); d.setUTCDate(d.getUTCDate() - _wkBack); d.setUTCHours(0, 0, 0, 0);
    cutoffSec = Math.floor(d.getTime() / 1000);
  } else if (cutoffWeek) {
    // Lundi 00:00 UTC de la semaine en cours (vraie "this week")
    const monday = new Date();
    const dow    = monday.getUTCDay();              // 0=dim, 1=lun, … 6=sam
    const back   = (dow === 0 ? 6 : dow - 1);       // jours écoulés depuis lundi
    monday.setUTCDate(monday.getUTCDate() - back);
    monday.setUTCHours(0, 0, 0, 0);
    cutoffSec = Math.floor(monday.getTime() / 1000);
  } else if (cutoffMs) {
    // Fenêtre glissante. Pour une fenêtre COURTE (<12h, ex. 8h), le week-end on ancre à la clôture de
    // vendredi (~22:00 UTC) au lieu de « maintenant » (sinon vide). Les fenêtres larges (1d+) incluent
    // déjà la dernière séance → ancre = maintenant.
    const anchor = (_wkBack && cutoffMs < 12 * 3600000)
      ? (() => { const f = new Date(); f.setUTCDate(f.getUTCDate() - _wkBack); f.setUTCHours(22, 0, 0, 0); return f.getTime(); })()
      : Date.now();
    cutoffSec = Math.floor((anchor - cutoffMs) / 1000);
  }

  await getYFSession();

  const loadPairs = (iv, rng) => Promise.all(CS_PAIRS.map(async p => {
    try {
      const raw = await yfFetch(p.sym, iv, rng);
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

  let usedInterval = interval;
  let pairData = (await loadPairs(interval, range)).filter(Boolean);
  // REPLI D'INTERVALLE : l'intraday FIN (5m/15m) est parfois rejeté pour la session serveur (restriction
  // intraday FX) alors que le 30m passe TOUJOURS (cf. périodes 1d/week à 28/28). Si trop peu de paires
  // chargent, on retente en 30m sur une fenêtre large → la courbe ne tombe PLUS JAMAIS en « Data unavailable ».
  if (pairData.length < 7 && interval !== '30m' && interval !== '1h' && interval !== '1d') {
    console.warn(`[CS/${period}] intervalle ${interval} insuffisant (${pairData.length}/28) → repli 30m`);
    usedInterval = '30m';
    pairData = (await loadPairs('30m', '5d')).filter(Boolean);
  }
  const failCount = CS_PAIRS.length - pairData.length;
  if (failCount > 0) console.warn(`[CS/${period}] ${failCount}/${CS_PAIRS.length} pairs failed to load`);
  if (pairData.length < 7) { console.error(`[CS/${period}] only ${pairData.length} pairs — repli sur le cache existant`); return _csCache[period] ? _csCache[period].data : null; }
  console.log(`[CS/${period}] ${pairData.length}/28 pairs loaded (iv=${usedInterval}) — cutoff=${cutoffSec ? new Date(cutoffSec*1000).toISOString() : 'none'} clip=±${clip}%`);

  // Round timestamps to candle interval — aligns all 28 pairs to the same bins
  // (Yahoo Finance returns slightly different timestamps per pair, e.g. 09:30:00 vs 09:30:07)
  const INTERVAL_SEC = { '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '1d': 86400 };
  const binSec = INTERVAL_SEC[usedInterval] || 300;

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

// Wrapper STALE-WHILE-REVALIDATE : sert le cache (même périmé) INSTANTANÉMENT et recalcule en
// arrière-plan. Ne bloque QU'au tout premier calcul (cache vide). Déduplication par période.
const _csInflight = {};
function _csRefresh(period) {
  if (_csInflight[period]) return _csInflight[period];
  _csInflight[period] = _computeStrengthFresh(period)
    .catch(e => { console.warn('[CS]', period, e.message); return null; })
    .finally(() => { delete _csInflight[period]; });
  return _csInflight[period];
}
async function computeCurrencyStrength(period) {
  // Le METER (période '1d') se veut "temps réel" → cache court (60s) ; les autres restent à 2 min.
  // Le SWR sert toujours le cache instantanément et recalcule en arrière-plan (jamais bloquant).
  const ttl = period === '1d' ? 60 * 1000 : 2 * 60 * 1000;
  const c = _csCache[period];
  if (c && Date.now() - c.ts < ttl) return c.data;          // 1) cache frais → instantané
  if (c && c.data) { _csRefresh(period); return c.data; }   // 2) périmé → on sert + recalcul en fond
  return await _csRefresh(period);                           // 3) aucun cache → on attend (1re fois)
}

app.get('/api/currency-strength', async (req, res) => {
  const validPeriods = Object.keys(CS_PERIOD_CFG);
  const period = validPeriods.includes(req.query.period) ? req.query.period : 'today';
  // "force" = recalcul en ARRIÈRE-PLAN (on ne vide PAS le cache → réponse instantanée,
  // le nouveau jeu arrive au prochain rafraîchissement). Évite tout blocage.
  if (req.query.force === '1' && _csCache[period]) _csRefresh(period);
  try {
    const data = await computeCurrencyStrength(period);
    if (!data) return res.status(503).json({ error: 'Data unavailable' });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── FX List Overview ─────────────────────────────────────────────────────────
// Per-pair overview table (FX LIST view). Every column is derived from a single
// Yahoo Finance 5-year daily series per pair (28 calls, same budget as
// currency-strength) — last price, daily change, 1M/3M/12M returns, price/trend
// sparklines, a 12-month seasonal curve, a recent micro-pattern, a DMX donut
// (bullish-days ratio), an auto relative-strength score, and Fund./Research/Bias
// signals derived from strength / 3M / 1M momentum respectively.
let _fxlCache = null, _fxlTs = 0;
const FXL_TTL = 10 * 60 * 1000; // 10 min

function _pctChange(now, then) {
  if (now == null || then == null || then === 0) return null;
  return +((now / then - 1) * 100).toFixed(2);
}
// Downsample an array to at most n points (keeps first & last) — for sparklines
function _downsample(arr, n) {
  if (arr.length <= n) return arr.slice();
  const out = [];
  const step = (arr.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) out.push(arr[Math.round(i * step)]);
  return out;
}
// Bullish/Neutral/Bearish label from a numeric signal + symmetric thresholds
function _signal(v, hi, lo) {
  if (v == null) return 'Neutral';
  if (v >= hi) return 'Bullish';
  if (v <= lo) return 'Bearish';
  return 'Neutral';
}
// 12-point cumulative seasonal curve: average return per calendar month across years
function _seasonal(ts, closes) {
  const monthEnd = new Map();
  for (let i = 0; i < ts.length; i++) {
    const d = new Date(ts[i] * 1000);
    monthEnd.set(`${d.getUTCFullYear()}-${d.getUTCMonth()}`, { m: d.getUTCMonth(), c: closes[i] });
  }
  const seq = [...monthEnd.values()];
  const sum = Array(12).fill(0), cnt = Array(12).fill(0);
  for (let i = 1; i < seq.length; i++) {
    const r = (seq[i].c / seq[i - 1].c - 1) * 100;
    if (Number.isFinite(r)) { sum[seq[i].m] += r; cnt[seq[i].m]++; }
  }
  const avg = sum.map((s, i) => cnt[i] ? s / cnt[i] : 0);
  let acc = 0;
  return avg.map(a => +(acc += a).toFixed(3)); // Jan→Dec cumulative
}

let _fxlBusy = false;
const FXL_CACHE_KEY = 'fxlist_v1';

// Persistance (survit aux redéploiements Render : disque éphémère → Supabase ai_cache)
let _fxlSaveTimer = null;
function _fxlPersist() {
  clearTimeout(_fxlSaveTimer);
  _fxlSaveTimer = setTimeout(() => { if (_fxlCache) auth.aiCacheSet(FXL_CACHE_KEY, _fxlCache).catch(() => {}); }, 1500);
  if (_fxlSaveTimer.unref) _fxlSaveTimer.unref();
}
async function _fxlLoadPersisted() {
  try {
    const c = await auth.aiCacheGet(FXL_CACHE_KEY);
    if (!_fxlCache && c && Array.isArray(c.pairs) && c.pairs.length >= 7) {
      _fxlCache = c; _fxlTs = 0;   // servi IMMÉDIATEMENT au boot ; ts=0 → un refresh se fera en arrière-plan
      console.log(`[FXL] ${c.pairs.length} paires restaurées du cache persistant`);
    }
  } catch {}
}

// Mappe `items` via `fn` avec une concurrence LIMITÉE (évite le rate-limit Yahoo Finance)
async function _poolMap(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  async function worker() { while (idx < items.length) { const i = idx++; out[i] = await fn(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Calcul LOURD (fetch Yahoo) — par lots de 5 (anti-throttle), range 3 ans (assez pour 12M + saisonnalité, + léger que 5y)
async function _computeFxListFresh() {
  await getYFSession();
  const rows = await _poolMap(CS_PAIRS, 5, async p => {
    try {
      const raw = await yfFetch(p.sym, '1d', '3y');
      const res = raw?.chart?.result?.[0];
      if (!res) return null;
      const rawTs = res.timestamp || [];
      const rawClose = res.indicators?.quote?.[0]?.close || [];
      const ts = [], closes = [];
      for (let i = 0; i < rawClose.length; i++) {
        if (rawClose[i] != null && rawTs[i] != null) { ts.push(rawTs[i]); closes.push(rawClose[i]); }
      }
      if (closes.length < 30) return null;

      const n = closes.length;
      const last = closes[n - 1];
      const prev = closes[n - 2];
      const at = d => closes[Math.max(0, n - 1 - d)]; // d trading days ago

      // DMX: share of up-days over the last 14 sessions (0–100) — drives the donut
      const win = closes.slice(-15);
      let up = 0, tot = 0;
      for (let i = 1; i < win.length; i++) { if (win[i] >= win[i - 1]) up++; tot++; }
      const dmx = tot ? Math.round((up / tot) * 100) : 50;

      return {
        symbol: `${p.b}/${p.q}`,
        base: p.b, quote: p.q,
        last,
        changePct: _pctChange(last, prev),
        ret1M:  _pctChange(last, at(21)),
        ret3M:  _pctChange(last, at(63)),
        ret12M: _pctChange(last, at(252)),
        sparkLast: _downsample(closes.slice(-30), 24),
        trend:     _downsample(closes.slice(-252), 48),
        pattern:   _downsample(closes.slice(-10), 10),
        seasonal:  _seasonal(ts, closes),
        dmx,
      };
    } catch { return null; }
  });

  const valid = rows.filter(Boolean);
  if (valid.length < 7) return null;   // fetch trop partiel → on ne remplace pas le cache (stale conservé)

  // ── Auto relative strength: per-currency = avg 1M return across its pairs ────
  const score = {}, cnt = {};
  CS_CURRENCIES.forEach(c => { score[c] = 0; cnt[c] = 0; });
  valid.forEach(r => {
    if (r.ret1M == null) return;
    score[r.base]  += r.ret1M; cnt[r.base]++;
    score[r.quote] -= r.ret1M; cnt[r.quote]++;
  });
  const ccyStr = {};
  CS_CURRENCIES.forEach(c => { ccyStr[c] = cnt[c] ? score[c] / cnt[c] : 0; });

  // Fund. ← strength | Research ← 3M momentum | Bias ← 1M momentum
  valid.forEach(r => {
    r.strength = +((ccyStr[r.base] - ccyStr[r.quote])).toFixed(2);
    r.fund     = _signal(r.strength, 1, -1);
    r.research = _signal(r.ret3M, 2, -2);
    r.bias     = _signal(r.ret1M, 1, -1);
  });

  return { pairs: valid, updatedAt: new Date().toISOString() };
}

// Cache + stale-while-error + persistance. NE renvoie JAMAIS vide si on a déjà eu des données un jour.
async function computeFxList() {
  if (_fxlCache && Date.now() - _fxlTs < FXL_TTL) return _fxlCache;   // frais → direct
  if (_fxlBusy) return _fxlCache;                                     // déjà en calcul → on sert l'actuel (peut être stale)
  _fxlBusy = true;
  try {
    const fresh = await _computeFxListFresh();
    if (fresh) {
      _fxlCache = fresh; _fxlTs = Date.now();
      _fxlPersist();
      console.log(`[FXL] ${fresh.pairs.length}/${CS_PAIRS.length} paires chargées`);
    } else {
      console.warn('[FXL] fetch insuffisant → conservation du dernier cache (stale)');
    }
  } catch (e) {
    console.warn('[FXL] échec calcul:', e.message);
  } finally {
    _fxlBusy = false;
  }
  return _fxlCache;   // frais si OK, sinon dernier bon snapshot ; null seulement si on n'a JAMAIS rien eu
}

app.get('/api/fxlist', async (req, res) => {
  if (req.query.force === '1') _fxlTs = 0;   // force un refresh SANS vider le cache (fallback préservé)
  try {
    const data = await computeFxList();
    if (!data) return res.status(503).json({ error: 'Data unavailable' });
    res.json(data);
  } catch (e) {
    if (_fxlCache) return res.json(_fxlCache);   // stale en dernier recours plutôt qu'une erreur
    res.status(500).json({ error: e.message });
  }
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
// État pour un sentiment de risque STABLE (anti flip-flop) : score lissé (EMA) + hystérésis de bande.
let _riskScoreEMA = null, _riskPrevIdx = null;
const RISK_LABELS = ['STRONG RISK-OFF', 'RISK-OFF', 'WEAK RISK-OFF', 'NEUTRAL', 'WEAK RISK-ON', 'RISK-ON', 'STRONG RISK-ON'];
const RISK_BOUNDS = [-0.80, -0.30, -0.07, 0.07, 0.30, 0.55];   // 6 frontières entre les 7 bandes
const RISK_HYST   = 0.06;                                       // marge d'hystérésis (ne switch pas pour du bruit)
function _riskBand(score, prevIdx) {
  let idx = 0;
  for (let i = 0; i < RISK_BOUNDS.length; i++) if (score > RISK_BOUNDS[i]) idx = i + 1;
  if (prevIdx == null) return idx;
  // On ne QUITTE la bande courante que si le score franchit SA frontière + la marge d'hystérésis.
  if (idx > prevIdx && score < RISK_BOUNDS[prevIdx] + RISK_HYST) return prevIdx;          // veut monter
  if (idx < prevIdx && score > RISK_BOUNDS[prevIdx - 1] - RISK_HYST) return prevIdx;       // veut descendre
  return idx;
}

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

  // ── Sentiment STABLE (anti flip-flop) ───────────────────────────────────────
  // 1) On LISSE le score (EMA) → on absorbe le bruit minute par minute.
  // 2) Hystérésis de bande → on ne bascule risk-on/off que sur un VRAI franchissement,
  //    pas pour une oscillation autour d'une frontière. Résultat : un vrai switch fiable.
  _riskScoreEMA = (_riskScoreEMA == null) ? score : +(_riskScoreEMA * 0.6 + score * 0.4).toFixed(4);
  const idx = _riskBand(_riskScoreEMA, _riskPrevIdx);
  _riskPrevIdx = idx;
  const label = RISK_LABELS[idx];

  const DESCS = {
    'STRONG RISK-ON':  'Fort appétit pour le risque sur l\'ensemble des marchés. Actions, devises risquées et actifs à haut rendement tous achetés. VIX bas.',
    'RISK-ON':         'Appétit pour le risque positif. Les actions et devises risquées sont demandées, les valeurs refuges sous légère pression.',
    'WEAK RISK-ON':    'Léger regain d\'appétit pour le risque : actions et devises risquées favorisées, valeurs refuges en repli.',
    'NEUTRAL':         'Le sentiment de marché est équilibré. Signaux mixtes sur les actifs risqués, pas de tendance directionnelle claire.',
    'WEAK RISK-OFF':   'Légère aversion au risque. Prudence ambiante — obligations et valeurs refuges trouvent un support modéré.',
    'RISK-OFF':        'Aversion au risque en hausse. Les capitaux se déplacent vers les valeurs refuges, les obligations et les devises défensives.',
    'STRONG RISK-OFF': 'Forte aversion au risque. Fuite significative vers la sécurité — obligations, or, JPY et CHF demandés.',
  };

  // Le % d'affichage est CALÉ sur la bande du label (cohérence label ↔ nombre ↔ aiguille) :
  // grâce à l'hystérésis le label peut rester "collé" (ex. NEUTRAL) alors que le score brut a
  // glissé ; sans ce calage on afficherait un NEUTRAL à -9.4% (zone risk-off). On borne donc le
  // score affiché à la plage de SA bande → un NEUTRAL ne montre jamais plus de ±3,5%.
  const _bandLo = idx > 0 ? RISK_BOUNDS[idx - 1] : -1;
  const _bandHi = idx < RISK_BOUNDS.length ? RISK_BOUNDS[idx] : 1;
  const _emaShown = Math.max(_bandLo, Math.min(_bandHi, _riskScoreEMA));
  const pct = Math.max(-100, Math.min(100, +(_emaShown * 50).toFixed(1)));   // une fois pour TOUTES les vues
  _riskData = { label, score: +(_emaShown).toFixed(2), rawScore: +score.toFixed(2), pct, description: DESCS[label], assets: results, updatedAt: new Date().toISOString() };
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
// Seuils RELEVÉS : une "réaction" doit être un VRAI mouvement marqué (pas du bruit de routine).
const MOVE_ASSETS = [
  { sym: 'BZ=F',      label: 'Brent crude',   unit: '$/bbl', decimals: 2, threshold: 1.20,   minPct: 1.40  },
  { sym: 'GC=F',      label: 'Or (XAU/USD)',  unit: '$/oz',  decimals: 1, threshold: 12.0,   minPct: 0.80  },
  { sym: 'DX-Y.NYB', label: 'DXY',            unit: 'pts',   decimals: 3, threshold: 0.45,   minPct: 0.45  },
  { sym: 'EURUSD=X', label: 'EUR/USD',         unit: '',      decimals: 5, threshold: 0.0042, minPct: 0.40  },
  { sym: 'QQQ',       label: 'Nasdaq (QQQ)',   unit: 'USD',   decimals: 2, threshold: 2.60,   minPct: 0.70  },
  { sym: 'SPY',       label: 'S&P 500 (SPY)',  unit: 'USD',   decimals: 2, threshold: 2.40,   minPct: 0.50  },
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
  const windowSec = 8 * 60; // réaction = mouvement RAPIDE dans les ~8 min suivant l'event (pas une dérive lente)

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

// ═══════════════════ RÉSILIENCE / ANTI-DOWN ═══════════════════
// 1) Error-handler Express GLOBAL : une route qui jette ne fait plus planter/bloquer le serveur.
//    (Doit être déclaré APRÈS toutes les routes.) → toujours une réponse propre, jamais de hang.
app.use((err, req, res, next) => {
  console.error('[ERR]', req.method, req.path, '-', err?.message || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Erreur serveur' });
});

// 2) Timeouts serveur : évite l'accumulation de connexions lentes/bloquées (slow-loris, hangs).
server.requestTimeout   = 30 * 1000;   // 30 s max par requête
server.headersTimeout   = 35 * 1000;
server.keepAliveTimeout = 65 * 1000;   // > intervalle keep-alive (anti coupures prématurées)

// 3) Watchdog MÉMOIRE : sur l'hébergement 512 Mo, plusieurs Chromium peuvent provoquer un OOM
//    (→ Render tue le process = down). On surveille la RSS et on ferme les navigateurs non
//    essentiels (Myfxbook + InvestingLive) quand on approche de la limite.
setInterval(() => {
  try {
    const rssMo = process.memoryUsage().rss / (1024 * 1024);
    // Seuil PRÉVENTIF à 400 Mo (avant l'OOM/502 de Render à 512) : on libère les navigateurs.
    if (rssMo > 400) {
      console.warn(`[MEM] RSS ${rssMo.toFixed(0)} Mo — nettoyage anti-OOM (fermeture navigateurs)`);
      try { clearOutlookCache(); } catch {}
      try { require('./scrapers/myfxbook').closeBrowser?.(); } catch {}
      try { require('./scrapers/forexfactory-news').closeBrowser?.(); } catch {}   // le + gros (Chromium FF)
      try { if (typeof _ilBrowser !== 'undefined' && _ilBrowser) { _ilBrowser.close().catch(() => {}); _ilBrowser = null; } } catch {}
      if (global.gc) { try { global.gc(); } catch {} }
    }
  } catch {}
}, 30 * 1000);   // vérification 2× plus fréquente

server.listen(PORT, async () => {
  // Seed admin user on first run
  await auth.seedAdmin();

  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║   DataTradingPro — Terminal       ║`);
  console.log(`║   http://localhost:${PORT}                  ║`);
  console.log(`║   Admin panel : /admin                  ║`);
  console.log(`╚════════════════════════════════════════╝\n`);
  _swLoadFile();
  _brLoadFile();
  // Recharge l'historique persisté (Supabase, ~1 mois) AVANT de scraper → l'onglet Analyst
  // a déjà du contenu même à froid (disque Render éphémère), puis le scrape rafraîchit.
  await _loadPersistedHistories();
  _fetchSessionWraps(true).catch(() => {});
  _fetchBankResearch(true).catch(() => {});
  setTimeout(() => _fetchConveraUpdates().catch(() => {}), 8000);              // [MARKET UPDATE] Convera
  setInterval(() => _fetchConveraUpdates().catch(() => {}), 20 * 60 * 1000);   // rafraîchi toutes les 20 min
  // Rétention "max 1 mois" : purge du cache BDD (historiques + résultats IA) au démarrage puis chaque jour.
  auth.aiCachePrune(HISTORY_KEEP_MS).catch(() => {});
  setInterval(() => auth.aiCachePrune(HISTORY_KEEP_MS).catch(() => {}), 24 * 60 * 60 * 1000);
  // PRÉ-CHARGE les actuals (TradingView) → la colonne Actual est remplie dès la 1re ouverture du calendrier.
  setTimeout(async () => { try { await _calActualsLoad(); await _buildTVCalendar(); await _ensureCalendar(); await _refreshTVActuals(); } catch {} }, 9000);
  setInterval(() => { _buildTVCalendar().catch(() => {}); _refreshTVActuals().catch(() => {}); }, 5 * 60 * 1000);   // calendrier + actuals rafraîchis toutes les 5 min (temps réel)
  // FX LIST : restaure le dernier snapshot persistant (affiché instantanément au boot, même si Yahoo throttle)
  // puis recalcule en arrière-plan ; refresh régulier ensuite → la table n'est JAMAIS vide.
  setTimeout(async () => { try { await _fxlLoadPersisted(); await computeFxList(); } catch {} }, 12000);
  setInterval(() => { _fxlTs = 0; computeFxList().catch(() => {}); }, FXL_TTL);
  // VÉRIFICATION EMAIL : auto-test Gmail au démarrage + toutes les 30 min → on sait TOUJOURS si l'envoi marche (log + /api/admin/ai-status).
  setTimeout(() => { try { mailer.verifyGmail().catch(() => {}); } catch {} }, 8000);
  setInterval(() => { try { mailer.verifyGmail().catch(() => {}); } catch {} }, 30 * 60 * 1000);
  // Rapports Analyst/Institution : pré-segmente en arrière-plan → ouverture instantanée (cache persistant)
  setTimeout(() => { _prewarmWrapSegs().catch(() => {}); }, 25000);
  setInterval(() => { _prewarmWrapSegs().catch(() => {}); }, 20 * 60 * 1000);   // 20 min (éco quota — préchauffage = polissage opportuniste)
  // DailyFX (ING) : structure EN AVANCE les rapports du jour (décalé pour ne pas chevaucher les wraps)
  setTimeout(() => { _prewarmBrSegs().catch(() => {}); }, 45000);
  setInterval(() => { _prewarmBrSegs().catch(() => {}); }, 25 * 60 * 1000);   // 25 min (éco quota — préchauffage = polissage opportuniste)
  // AI Telemetry : échantillonne la santé IA → seaux horaires persistés (dashboard admin + prévision)
  setTimeout(() => { try { _telSample(); } catch {} }, 6000);
  setInterval(() => { try { _telSample(); } catch {} }, 30 * 1000);            // échantillon /30s
  setInterval(() => { _telFlush().catch(() => {}); }, 120 * 1000);            // flush KV /2min
  // Alertes e-mail admin (provider en rouge / quota proche épuisement / panne totale) — /5min, après chauffe
  setInterval(() => { _aiAlertCheck().catch(() => {}); }, 5 * 60 * 1000);
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

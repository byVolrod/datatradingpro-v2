/* ═══════════════════════════════════════════
   Prime Terminal — Frontend Logic
═══════════════════════════════════════════ */

'use strict';

// ═══ Loader universel ══════════════════════
// Renvoie le HTML du loader standard (croissant orange + libellé) pour TOUTE
// fonctionnalité qui charge. Usage : el.innerHTML = dtpLoader('Loading X data…').
// Option { small:true } pour les petites zones (sous-onglets compacts).
function dtpLoader(label, opts) {
  const sm = opts && opts.small ? ' dtp-loader--sm' : '';
  const txt = String(label == null ? 'Chargement…' : label)
    .replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  return `<div class="dtp-loader${sm}"><div class="dtp-loader__spin"></div><div class="dtp-loader__label">${txt}</div></div>`;
}
window.dtpLoader = dtpLoader;

// ═══ Cache localStorage — affichage INSTANTANÉ au revisite / cold-start ═══
// On stocke le dernier état connu (news, wraps, recherche…) côté navigateur, puis on
// rafraîchit en fond. L'utilisateur voit immédiatement du contenu, même serveur endormi.
function lsGet(key, maxAgeMs) {
  try {
    const o = JSON.parse(localStorage.getItem(key) || 'null');
    if (!o || typeof o.ts !== 'number') return null;
    if (maxAgeMs && Date.now() - o.ts > maxAgeMs) return null;
    return o.v;
  } catch { return null; }
}
const _lsSaveTimers = {};
function lsSet(key, v) {
  clearTimeout(_lsSaveTimers[key]);                       // débounce (évite d'écrire à chaque render)
  _lsSaveTimers[key] = setTimeout(() => {
    try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), v })); }
    catch { try { localStorage.removeItem(key); } catch {} }   // quota plein → on purge cette clé
  }, 500);
}
window.lsGet = lsGet; window.lsSet = lsSet;

// Toast léger (messages courts type "bientôt disponible")
function dtpToast(msg) {
  let t = document.getElementById('dtp-toast');
  if (!t) { t = document.createElement('div'); t.id = 'dtp-toast'; t.className = 'dtp-toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._dtpToastT);
  window._dtpToastT = setTimeout(() => t.classList.remove('show'), 2600);
}
function aiComingSoon() { dtpToast('🤖 AI — bientôt disponible'); }
window.dtpToast = dtpToast; window.aiComingSoon = aiComingSoon;

// ════════════════ MACRO AI ASSISTANT — chat IA (volatil, streaming typewriter) ════════════════
let _aiMsgs = [];
let _aiBusy = false;
let _aiTyper = null;
const AI_AVATAR = '/assets/images/macro-ai-logo.png';            // logo officiel sauvegardé en local (autonome)
const AI_CHIP = `<img class="ai-chip-img" src="${AI_AVATAR}" alt="Macro AI" width="22" height="22" loading="lazy">`;
function _aiTime() { try { return new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } }
function _aiEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function _aiMd(s) { return _aiEsc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>'); }
// Markdown TOLÉRANT au streaming : masque une séquence ** non encore fermée (pas d'astérisques affichés ni de crash)
function _aiMdStream(s) {
  let t = String(s || '');
  if (((t.match(/\*\*/g) || []).length) % 2 === 1) t = t.replace(/\*\*(?![\s\S]*\*\*)/, '');
  return _aiMd(t);
}
function _aiWelcomeMsg() { return { role: 'ai', text: "Bonjour ! Je suis votre assistant IA Macro. Posez-moi des questions sur les tendances du marché, les indicateurs économiques ou les perspectives des marchés mondiaux.", time: _aiTime() }; }

function aiOpen() {
  const p = document.getElementById('ai-panel'), b = document.getElementById('ai-backdrop');
  if (!p) return;
  // Exclusion mutuelle : ferme proprement tout autre volet (état + classes) avant d'ouvrir l'AI
  if (typeof _closeOtherPanels === 'function') _closeOtherPanels('ai');
  if (!_aiMsgs.length) _aiMsgs = [_aiWelcomeMsg()];
  aiRender();
  p.classList.add('open'); if (b) b.classList.add('open'); p.setAttribute('aria-hidden', 'false');
  const btn = document.getElementById('ai-btn'); if (btn) btn.classList.add('topbar-icon--active');   // barre verte active
  setTimeout(() => { const i = document.getElementById('ai-input'); if (i) i.focus(); }, 230);
}
function aiClose() {
  const p = document.getElementById('ai-panel'), b = document.getElementById('ai-backdrop');
  if (p) { p.classList.remove('open'); p.setAttribute('aria-hidden', 'true'); }
  if (b) b.classList.remove('open');
  const btn = document.getElementById('ai-btn'); if (btn) btn.classList.remove('topbar-icon--active');
  aiClearCancel();
}
function _aiSourcesHtml(sources, idx) {
  const items = (sources || []).map(s =>
    `<div class="ai-source"><span class="ai-source-dot"></span><div><div class="ai-source-name">${_aiEsc(s.name)}</div><div class="ai-source-date">${_aiEsc(s.date)}</div></div></div>`).join('');
  return `<div class="ai-sources" id="ai-src-${idx}"><span class="ai-sources-head" onclick="aiToggleSources(${idx})"><span class="ai-sources-arrow">›</span> ${(sources || []).length} sources used</span><div class="ai-sources-list">${items}</div></div>`;
}
function aiToggleSources(idx) { const el = document.getElementById('ai-src-' + idx); if (el) el.classList.toggle('open'); }
function aiRender() {
  const box = document.getElementById('ai-messages'); if (!box) return;
  let html = '<div class="ai-day-sep"><span>Today</span></div>';
  _aiMsgs.forEach((m, i) => {
    if (m.role === 'user') {
      html += `<div class="ai-row ai-row--user"><div class="ai-bubble-user">${_aiEsc(m.text)}</div><div class="ai-time">${m.time}</div></div>`;
    } else if (m.thinking) {
      // « L'IA écrit… » : avatar local + 3 points qui rebondissent (avant le 1er chunk de texte)
      html += `<div class="ai-row ai-row--ai"><div class="ai-chip">${AI_CHIP}</div><div class="ai-ai-body"><div class="ai-thinking"><span></span><span></span><span></span></div></div></div>`;
    } else {
      const body = m.streaming ? _aiMdStream(m.text) : _aiMd(m.text);
      // Sources + heure UNIQUEMENT à la fin du streaming (jamais pendant)
      const src = (!m.streaming && m.sources && m.sources.length) ? _aiSourcesHtml(m.sources, i) : '';
      const time = m.streaming ? '' : `<div class="ai-time">${m.time}</div>`;
      html += `<div class="ai-row ai-row--ai"><div class="ai-chip">${AI_CHIP}</div><div class="ai-ai-body"><div class="ai-ai-text">${body}</div>${src}${time}</div></div>`;
    }
  });
  box.innerHTML = html;
  box.scrollTop = box.scrollHeight;
}
// Autoscroll intelligent : suit l'écriture seulement si l'utilisateur est déjà près du bas
function _aiAutoScroll() {
  const box = document.getElementById('ai-messages'); if (!box) return;
  if (box.scrollHeight - box.scrollTop - box.clientHeight < 90) box.scrollTop = box.scrollHeight;
}
// Effet typewriter : révèle le texte par petits chunks (coupe au milieu d'un mot, façon flux SSE)
function _aiStream(msg) {
  const full = msg.full || '';
  msg.text = ''; msg.streaming = true;
  let i = 0;
  const tick = () => {
    i = Math.min(full.length, i + 3);
    msg.text = full.slice(0, i);
    const el = document.querySelector('#ai-messages .ai-row--ai:last-of-type .ai-ai-text');
    if (el) el.innerHTML = _aiMdStream(msg.text);
    _aiAutoScroll();
    if (i < full.length) { _aiTyper = setTimeout(tick, 14); }
    else { msg.streaming = false; msg.text = full; _aiTyper = null; _aiBusy = false; aiRender(); }
  };
  tick();
}
async function aiSend() {
  const inp = document.getElementById('ai-input'); if (!inp) return;
  const q = inp.value.trim(); if (!q || _aiBusy) return;
  inp.value = ''; aiInputGrow(inp);
  if (!_aiMsgs.length) _aiMsgs = [_aiWelcomeMsg()];
  _aiMsgs.push({ role: 'user', text: q, time: _aiTime() });
  _aiMsgs.push({ role: 'ai', thinking: true });
  _aiBusy = true; aiRender();
  try {
    const r = await fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: q }) });
    const d = await r.json().catch(() => ({}));
    if (_aiMsgs.length && _aiMsgs[_aiMsgs.length - 1].thinking) _aiMsgs.pop();   // coupe « thinking » dès réception
    if (r.ok && d.answer) {
      const msg = { role: 'ai', full: d.answer, text: '', sources: d.sources || [], streaming: true, time: _aiTime() };
      _aiMsgs.push(msg); aiRender(); _aiStream(msg);   // démarre le typewriter (les sources sortiront à la fin)
    } else {
      _aiMsgs.push({ role: 'ai', text: "🛠️ This feature is currently under development and will be available very soon. Thank you for your patience!", time: _aiTime() });
      _aiBusy = false; aiRender();
    }
  } catch (e) {
    if (_aiMsgs.length && _aiMsgs[_aiMsgs.length - 1].thinking) _aiMsgs.pop();
    _aiMsgs.push({ role: 'ai', text: "🛠️ This feature is currently under development and will be available very soon. Thank you for your patience!", time: _aiTime() });
    _aiBusy = false; aiRender();
  }
}
// Enter = envoi · Shift+Enter = nouvelle ligne
function aiInputKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiSend(); } }
function aiInputGrow(el) { if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }
function aiClearAsk() { const b = document.getElementById('ai-clear-banner'); if (b) b.classList.add('show'); }
function aiClearCancel() { const b = document.getElementById('ai-clear-banner'); if (b) b.classList.remove('show'); }
function aiClearConfirm() { if (_aiTyper) { clearTimeout(_aiTyper); _aiTyper = null; } _aiBusy = false; _aiMsgs = [_aiWelcomeMsg()]; aiClearCancel(); aiRender(); }
function aiToggle() { const p = document.getElementById('ai-panel'); if (p && p.classList.contains('open')) aiClose(); else aiOpen(); }
window.aiOpen = aiOpen; window.aiClose = aiClose; window.aiToggle = aiToggle; window.aiSend = aiSend; window.aiInputKey = aiInputKey; window.aiInputGrow = aiInputGrow;
window.aiToggleSources = aiToggleSources; window.aiClearAsk = aiClearAsk; window.aiClearCancel = aiClearCancel; window.aiClearConfirm = aiClearConfirm;
// Le bouton AI de la topbar bascule le volet Macro AI Assistant
(function () { var b = document.getElementById('ai-btn'); if (b) b.addEventListener('click', aiToggle); })();

// ── Sélecteur de langue (dropdown custom à vraies images de drapeaux — les emoji-drapeaux ne s'affichent pas sur Windows) ──
function pdLangToggle(e) { if (e) e.stopPropagation(); document.getElementById('pd-lang-menu')?.classList.toggle('open'); }
function pdLangPick(val, name, iso) {
  const inp = document.getElementById('pd-lang'); if (inp) inp.value = val;
  const cur = document.getElementById('pd-lang-current'); if (cur) cur.textContent = name;
  const flag = document.getElementById('pd-lang-cur-flag'); if (flag) flag.src = `https://flagcdn.com/24x18/${iso}.png`;
  document.getElementById('pd-lang-menu')?.classList.remove('open');
}
window.pdLangToggle = pdLangToggle; window.pdLangPick = pdLangPick;
document.addEventListener('click', e => { const dd = document.getElementById('pd-lang-dd'); if (dd && !dd.contains(e.target)) document.getElementById('pd-lang-menu')?.classList.remove('open'); });

// ═══ World clocks ══════════════════════════
const CLOCKS = [
  { city: 'London',   code: 'LON', country: 'UK',  tz: 'Europe/London',    lat: 51.5074, lon: -0.1278  },
  { city: 'New York', code: 'NY',  country: 'US',  tz: 'America/New_York', lat: 40.7128, lon: -74.0060 },
  { city: 'Tokyo',    code: 'TKY', country: 'JP',  tz: 'Asia/Tokyo',       lat: 35.6762, lon: 139.6503 },
  { city: 'Dubai',    code: 'DXB', country: 'UAE', tz: 'Asia/Dubai',       lat: 25.2048, lon: 55.2708  },
  { city: 'Paris',    code: 'PAR', country: 'FR',  tz: 'Europe/Paris',     lat: 48.8566, lon: 2.3522   },
];

// WMO weather code → emoji icon
const WMO_ICON = {
  0: '☀', 1: '🌤', 2: '🌤', 3: '☁',
  45: '🌫', 48: '🌫',
  51: '🌦', 53: '🌦', 55: '🌧',
  61: '🌧', 63: '🌧', 65: '🌧',
  71: '❄', 73: '❄', 75: '❄', 77: '❄',
  80: '🌦', 81: '🌦', 82: '🌦',
  85: '🌨', 86: '🌨',
  95: '⛈', 96: '⛈', 99: '⛈',
};

// Wind degree → arrow
const windArrow = deg => ['↑','↗','→','↘','↓','↙','←','↖'][Math.round(deg / 45) % 8] || '→';

let _weatherCache = {}; // city → { temp, wind, windDir, icon }

async function fetchAllWeather() {
  await Promise.all(CLOCKS.map(async c => {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}`
        + `&current=temperature_2m,weathercode,windspeed_10m,winddirection_10m&timezone=auto&forecast_days=1`;
      const res  = await fetch(url);
      const data = await res.json();
      const cur  = data.current;
      _weatherCache[c.city] = {
        temp:    Math.round(cur.temperature_2m),
        wind:    Math.round(cur.windspeed_10m),
        windDir: cur.winddirection_10m ?? 0,
        icon:    WMO_ICON[cur.weathercode] ?? '🌡',
      };
    } catch {
      if (!_weatherCache[c.city])
        _weatherCache[c.city] = { temp: '--', wind: '--', windDir: 0, icon: '☁' };
    }
  }));
}

// ═══ Filter — only real category names from the server ════════════════════════

const INTERNAL_CATS = [
  'Fed', 'ECB', 'BoJ', 'BoE', 'BoC', 'RBA', 'SNB', 'RBNZ',
  'Geopolitical', 'Economic Commentary', 'FX Flows', 'Market Analysis',
  'Energy & Power', 'Metals', 'Crypto', 'Fixed Income',
  'Global News', 'Asian News', 'Trade', 'PMT Update', 'Ags & Softs',
  'EU Data', 'US Data', 'UK Data', 'Swiss Data', 'Japanese Data',
  'Canadian Data', 'Australian Data', 'Chinese Data',
];

// Settings panel structure: displayed sections with label → category mapping
const SETTINGS_PANEL = {
  'Banques centrales': [
    { label: 'Fed',  cat: 'Fed'  }, { label: 'ECB',  cat: 'ECB'  },
    { label: 'BoJ',  cat: 'BoJ'  }, { label: 'BoE',  cat: 'BoE'  },
    { label: 'BoC',  cat: 'BoC'  }, { label: 'RBA',  cat: 'RBA'  },
    { label: 'SNB',  cat: 'SNB'  }, { label: 'RBNZ', cat: 'RBNZ' },
  ],
  'Macro & Data': [
    { label: 'Economic Commentary', cat: 'Economic Commentary' },
    { label: 'Trade',               cat: 'Trade'               },
    { label: 'PMT Update',          cat: 'PMT Update'          },
  ],
  'Marchés': [
    { label: 'FX Flows',        cat: 'FX Flows'        },
    { label: 'Market Analysis', cat: 'Market Analysis' },
    { label: 'Fixed Income',    cat: 'Fixed Income'    },
  ],
  'Matières premières': [
    { label: 'Energy & Power', cat: 'Energy & Power' },
    { label: 'Metals',         cat: 'Metals'         },
    { label: 'Ags & Softs',    cat: 'Ags & Softs'    },
    { label: 'Crypto',         cat: 'Crypto'         },
  ],
  'Global': [
    { label: 'Geopolitical', cat: 'Geopolitical' },
    { label: 'Global News',  cat: 'Global News'  },
    { label: 'Asian News',   cat: 'Asian News'   },
  ],
  'Données régionales': [
    { label: 'EU Data',         cat: 'EU Data'         },
    { label: 'US Data',         cat: 'US Data'         },
    { label: 'UK Data',         cat: 'UK Data'         },
    { label: 'Swiss Data',      cat: 'Swiss Data'      },
    { label: 'Japanese Data',   cat: 'Japanese Data'   },
    { label: 'Canadian Data',   cat: 'Canadian Data'   },
    { label: 'Australian Data', cat: 'Australian Data' },
    { label: 'Chinese Data',    cat: 'Chinese Data'    },
  ],
};

// ═══ State ════════════════════════════════
let allItems          = [];
let enabledCategories = new Set(INTERNAL_CATS); // all on by default
let searchQuery       = '';
let ws                = null;
let reconnectTimer    = null;
let newCount          = 0;
let displayLimit      = 100;   // items shown at once
let serverTotal       = 0;     // total items available on server
const _openNewsPanels = {};    // id → onglet ouvert PAR L'UTILISATEUR (persiste entre re-renders ; aucune ouverture auto)
let loadingMore       = false;
let _wsInitReceived   = false; // true once server sends its first 'initial' message
const _analysisCache  = new Map(); // item.id → bullets[]
const _infoCache      = new Map(); // item.id → bullets[] (résumé Gemini style PMT, mémoire session)
const _reactCache     = new Map(); // item.id → texte (explication Gemini de la réaction, mémoire session)
let   _snapCache      = null;      // dernier Market Snapshot (prix réels) — partagé entre rapports
// Rend des puces Info/Analyse : texte propre, SANS gras ni balises (on retire HTML <…> et markdown **…**)
function _renderInfoBullets(bullets) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = (bullets || [])
    .map(b => String(b).replace(/<[^>]+>/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim())  // retire balises HTML + markdown
    .filter(Boolean)
    .map(b => `<li>${esc(b)}</li>`).join('');
  return `<ul class="article-points article-points--clean">${html}</ul>`;
}
let _sessionWraps = [];
let _brArticles  = [];
let _fxDaily     = [];     // FX Daily (ING THINK) — rapport dédié dans l'onglet Analyst
let _weeklyReports = [];   // Weekly Market Recap + Global Economic Weekly (servis par /api/weekly-reports)
let _weeklyGenerating = false;
let _weeklyRetryCount = 0;
function _scheduleWeeklyRetry() {
  if (_weeklyRetryCount >= 5) return;   // ~5 tentatives (génération IA peut prendre ~20-40s)
  _weeklyRetryCount++;
  setTimeout(() => {
    fetch('/api/weekly-reports').then(r => r.json()).then(d => {
      if (Array.isArray(d.items)) _weeklyReports = d.items;
      _weeklyGenerating = !!d.generating;
      renderArlibList();
      if (_weeklyGenerating) _scheduleWeeklyRetry();
    }).catch(() => {});
  }, 12000);
}
let _brSearch    = '';
let _brInst      = 'all';
let _brType      = 'all';
const _analysisNoData = new Set(); // item IDs where analysis returned nothing (tag should be hidden)

// ═══ DOM refs ═════════════════════════════
const newsList    = document.getElementById('news-list');
const itemCountEl = document.getElementById('item-count');
const notifBadge  = document.getElementById('notif-badge');
// Affiche le badge de notif avec le compte, ou le CACHE complètement si 0
function _setNotifBadge(n) {
  if (!notifBadge) return;
  // Pastille rouge simple : visible s'il y a des notifs non lues, cachée sinon (pas de chiffre).
  notifBadge.style.display = n > 0 ? '' : 'none';
}
const liveDot     = document.getElementById('live-dot');
const searchInput = document.getElementById('search-input');

// ═══ Init ═════════════════════════════════
function init() {
  loadSettings();
  buildSettingsPanel();
  buildSectionDropdown();
  startClocks();
  drawWorldMap();
  startSessionMarkers();

  // ── Hydratation INSTANTANÉE depuis le cache local (avant toute réponse serveur) ──
  // Affiche le dernier état connu tout de suite ; les données fraîches le remplacent ensuite.
  try {
    const DAY = 24 * 60 * 60 * 1000;
    const cn = lsGet('dtp_news', DAY);
    if (cn && cn.length && allItems.length === 0) { allItems = cn; renderNews(); }
    const cs = lsGet('dtp_sw', DAY); if (cs && cs.length && !_sessionWraps.length) _sessionWraps = cs;
    const cb = lsGet('dtp_br', DAY); if (cb && cb.length && !_brArticles.length)  _brArticles  = cb;
    const cf = lsGet('dtp_fx', DAY); if (cf && cf.length && !_fxDaily.length)      _fxDaily     = cf;
  } catch {}

  // ── HTTP pre-fetch: show cached news immediately, before WS connects ──
  fetch('/api/news')
    .then(r => r.json())
    .then(data => {
      if (data.total) serverTotal = data.total;
      // Données serveur FRAÎCHES → remplacent le cache hydraté (sauf si le serveur renvoie
      // moins que ce qu'on affiche déjà, pour ne pas régresser pendant un cold-start partiel).
      if ((data.items?.length ?? 0) > 0 && data.items.length >= allItems.length) {
        allItems = data.items;
        renderNews();
      }
    })
    .catch(() => {});

  // Fallback: if nothing loaded in 12 seconds, clear the spinner
  setTimeout(() => {
    if (allItems.length === 0) {
      newsList.innerHTML = '<div class="empty-state" style="color:var(--text4);padding:40px 20px;text-align:center;font-size:11px;">Waiting for live feed — items will appear automatically</div>';
    }
  }, 12000);

  connectWS();

  searchInput.addEventListener('input', e => {
    searchQuery = e.target.value.toLowerCase().trim();
    displayLimit = 100;
    renderNews();
  });
}

// ═══ WebSocket ════════════════════════════
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    showStatus('Connected', 'ok');
    if (liveDot) { liveDot.style.background = 'var(--green)'; liveDot.style.boxShadow = '0 0 6px var(--green)'; }
  };

  ws.onmessage = e => {
    try { handleMessage(JSON.parse(e.data)); }
    catch (err) { console.error('[WS] Parse error', err); }
  };

  ws.onerror = () => {
    showStatus('Connection error', 'err');
    if (liveDot) { liveDot.style.background = 'var(--red)'; liveDot.style.boxShadow = 'none'; }
  };

  ws.onclose = () => {
    if (liveDot) { liveDot.style.background = 'var(--red)'; liveDot.style.boxShadow = 'none'; }
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWS, 5000);
  };
}

function handleMessage(msg) {
  if (msg.total) serverTotal = msg.total;

  if (msg.type === 'initial') {
    _wsInitReceived = true;
    if ((msg.items?.length ?? 0) > allItems.length) {
      allItems = (msg.items || []).sort((a, b) => b.timestamp - a.timestamp);
    }
    renderNews(); // always clear the spinner once the server responds
  } else if (msg.type === 'community_outlook_update') {
    if (document.getElementById('rtab-dmx')?.classList.contains('active') &&
        typeof buildDMXChart === 'function') {
      buildDMXChart();
    }
  } else if (msg.type === 'cot_update') {
    if (document.getElementById('rtab-cot')?.classList.contains('active') &&
        typeof buildCOTChart === 'function') {
      buildCOTChart();
    }
  } else if (msg.type === 'news_update') {
    const isFirstUpdate = allItems.length === 0;
    const incoming = (msg.items || []).map(item => isFirstUpdate ? item : { ...item, _new: true });
    const existingIds = new Set(allItems.map(i => i.id));
    const truly_new = incoming.filter(i => !existingIds.has(i.id));
    // News déjà affichées mais ENRICHIES après coup (analyse IA pré-calculée) → on patch en place
    // pour que le tag « Analyse » apparaisse directement dans le feed, sans clic ni rechargement.
    let _patched = false;
    for (const inc of incoming) {
      if (!existingIds.has(inc.id)) continue;
      if (Array.isArray(inc.analyse) && inc.analyse.length) {
        const ex = allItems.find(i => i.id === inc.id);
        if (ex && !(Array.isArray(ex.analyse) && ex.analyse.length)) { ex.analyse = inc.analyse; _patched = true; }
      }
    }
    if (truly_new.length === 0) { if (_patched) renderNews(true); return; }
    allItems = [...truly_new, ...allItems].sort((a, b) => b.timestamp - a.timestamp);
    if (allItems.length > 2000) allItems = allItems.slice(0, 2000);
    if (!isFirstUpdate) {
      const added = npPush(truly_new);   // alimente le panneau ; renvoie le nb RÉELLEMENT ajouté
      newCount += added;                 // badge = exactement ce qui est dans le panneau (pas les rapports/primers)
      _setNotifBadge(newCount);
    }
    renderNews(!isFirstUpdate);
    if (!isFirstUpdate) {
      // Bannière LIVE : on flashe APRÈS le rendu, et UNIQUEMENT si la news importante est
      // RÉELLEMENT AFFICHÉE dans le feed (passe les filtres ET dans les `displayLimit` premières).
      // → la notif est TOUJOURS synchro avec une news visible ; sinon pas de notif. (Anti-désync.)
      const _renderedIds = new Set(getFilteredItems().slice(0, displayLimit).map(i => i.id));
      _flashBreakingNews(truly_new.find(i => _renderedIds.has(i.id) && !(i._briefing || i.source === 'PMT' || isPrimerItem(i)) && _isImportantNews(i)));
    }
    // Refresh analyst library if a new briefing arrived and analyst view is active
    if (truly_new.some(i => i._briefing || i.source === 'PMT')) {
      const analystPanel = document.getElementById('view-analyst');
      if (analystPanel && !analystPanel.classList.contains('hidden')) {
        renderArlibList();
      }
    }

  } else if (msg.type === 'sw_update') {
    // Mise à jour temps réel des session wraps InvestingLive
    if (!Array.isArray(msg.items) || msg.items.length === 0) return;
    const before = _sessionWraps.length;
    _sessionWraps = msg.items.map(i => Object.assign({}, i, { headline: i.headline || i.title }));
    lsSet('dtp_sw', _sessionWraps.slice(0, 80));
    console.log(`[WS] sw_update: ${_sessionWraps.length} wraps (${_sessionWraps.length - before > 0 ? '+' : ''}${_sessionWraps.length - before})`);
    _notifyNewReports(_sessionWraps, 'analyst');   // notif des NOUVEAUX rapports Analyst (nom standardisé)
    // Rafraîchir l'onglet Analyst s'il est visible
    const analystPanel = document.getElementById('view-analyst');
    if (analystPanel && !analystPanel.classList.contains('hidden')) {
      renderArlibList();
    }

  } else if (msg.type === 'br_update') {
    // Mise à jour temps réel des articles Bank Research (ING Think)
    if (!Array.isArray(msg.items) || msg.items.length === 0) return;
    const before = _brArticles ? _brArticles.length : 0;
    _brArticles = msg.items;
    lsSet('dtp_br', _brArticles.slice(0, 60));
    console.log(`[WS] br_update: ${_brArticles.length} articles (${_brArticles.length - before > 0 ? '+' : ''}${_brArticles.length - before})`);
    _notifyNewReports(_brArticles, 'institution');   // notif des NOUVEAUX rapports Institution (nom propre)
    // Rafraîchir l'onglet Institution s'il est visible
    const instPanel = document.getElementById('view-institution');
    if (instPanel && !instPanel.classList.contains('hidden')) {
      renderBrList();
    }
    // Aussi mettre à jour l'onglet Analyst (ING Think y apparaît aussi)
    const analystPanel = document.getElementById('view-analyst');
    if (analystPanel && !analystPanel.classList.contains('hidden')) {
      renderArlibList();
    }
  } else if (msg.type === 'smartbias_update' || msg.type === 'bias_update') {
    // Nouvelle matrice Smart Bias générée → on met à jour l'onglet Bias
    if (msg.type === 'smartbias_update' && msg.bias) {
      _biasData = msg.bias;
      const biasPanel = document.getElementById('view-bias');
      if (biasPanel && !biasPanel.classList.contains('hidden')) renderBiasView(_biasData);
    }
  }
}


// ═══ Breaking news flash ══════════════════
let _breakingTimer = null;

const _BREAKING_RX = /\b(?:attack|airstrike|missile|troops|invasion|war|escalat|breaking|urgent|explosion|blast|shooting|killed|dead|strike)\b/i;

// News "importante" = même critère que la surbrillance rouge du flux :
// priorité haute, urgente (FJ), ou donnée à fort impact.
let _flashedNewsId = null;   // id de la news actuellement annoncée dans le bandeau LIVE (jamais masquée du feed)
function _isImportantNews(item) {
  if (!item) return false;
  const impactStr = String(item.impact || '').toLowerCase();
  // Résultat d'événement du calendrier (valeur "Actual:" publiée) → toujours notifié dans le bandeau
  const isCalResult = item._calendarResult === true || item.isCalendar === true
      || /\bactual\s*:/i.test(item.description || '');
  return item.priority === 'high' || item.urgent === true
      || item._highImpact === true || impactStr === 'high' || impactStr === 'critical'
      || isCalResult;
}

function _flashBreakingNews(item) {
  // On ne fait JAMAIS flasher un rapport DTP/primer dans la bannière LIVE (plus de "PRIMER — …")
  if (!item || item._briefing || item.source === 'PMT' || isPrimerItem(item)) return;
  // Bannière LIVE = UNIQUEMENT les news importantes (pas les news de routine)
  if (!_isImportantNews(item)) return;
  const flash = document.getElementById('breaking-news-flash');
  const input = document.getElementById('topbar-symbol-input');
  if (!flash) return;
  const textEl  = document.getElementById('bnf-text');
  const labelEl = flash.querySelector('.bnf-label');
  if (!textEl) return;

  // Mémorise la news annoncée → les renders FUTURS ne la masqueront jamais (synchro bandeau ↔ flux).
  _flashedNewsId = item.id || null;

  // GARANTIE synchro bandeau ↔ feed : la news annoncée doit apparaître EN HAUT du flux, jamais
  // enterrée par un horodatage source périmé (breaking arrivé "maintenant" mais daté d'avant).
  // → on la remonte au sommet (timestamp = maintenant) et on ré-affiche.
  const _it = allItems.find(i => i.id === item.id);
  const _topTs = allItems.length ? (allItems[0].timestamp || 0) : 0;
  if (_it && (_it.timestamp || 0) < _topTs) {
    _it.timestamp = Date.now();
    _it.time = new Date(_it.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
    allItems.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    renderNews(true);
  }

  // Dynamic label: BREAKING (FJ urgent only) vs LIVE
  const _isFJ = item.source === 'FinancialJuice' || (item.id || '').startsWith('fj-');
  const isBreakingItem = _isFJ && item.urgent === true;
  if (labelEl) {
    labelEl.textContent = isBreakingItem ? 'BREAKING' : 'LIVE';
    labelEl.style.color  = isBreakingItem ? '#ef4444' : '';
  }
  flash.classList.toggle('bnf--breaking', isBreakingItem);

  // Titre COMPLET (pas d'ellipse) + reset du défilement
  textEl.style.transition = 'none';
  textEl.style.transform  = 'translateX(0)';
  textEl.textContent = (item.headline || 'Market Update')
    .replace(/^\s*(?:PRIMER|PREVIEW|RESEARCH|INSIGHT|ANALYSIS|TALKING POINTS?)\s*[-:—]\s*/i, '');

  flash.classList.add('visible');
  if (input) input.style.opacity = '0';
  // Cliquable → on saute à la news dans le flux (fini "la notif sans retrouver la news")
  flash.style.cursor = 'pointer';
  flash.title = 'Cliquer pour voir la news dans le flux';
  flash.onclick = () => _jumpToNews(item.id);

  clearTimeout(_breakingTimer);
  // Marquee adaptatif : si le titre dépasse la barre, on le fait défiler JUSQU'À SA FIN puis on garde
  // le bandeau visible le temps nécessaire (vitesse ~ constante, indépendante de la longueur).
  requestAnimationFrame(() => {
    const clip = textEl.parentElement;
    const overflow = textEl.scrollWidth - (clip ? clip.clientWidth : 0);
    let holdMs = 9000;
    if (overflow > 6) {
      const dur = Math.min(16, Math.max(4, overflow / 45));     // ~45 px/s
      holdMs = Math.round((dur + 1.2) * 1000 + 1800);            // pause initiale + défilement + petite pause finale
      textEl.style.transition = `transform ${dur}s linear 1.2s`;
      requestAnimationFrame(() => { textEl.style.transform = `translateX(${-overflow}px)`; });
    }
    _breakingTimer = setTimeout(() => {
      flash.classList.remove('visible');
      textEl.style.transition = 'none'; textEl.style.transform = 'translateX(0)';
      if (input) input.style.opacity = '';
    }, holdMs);
  });
}

// Saute à une news précise dans le flux (depuis la barre LIVE) : passe en vue News, lève la limite
// d'affichage si besoin, scrolle dessus et la surligne brièvement.
function _jumpToNews(id) {
  if (!id) return;
  const _sel = x => `.news-item[data-id="${(window.CSS && CSS.escape) ? CSS.escape(x) : x}"]`;
  _flashedNewsId = id;                          // force la news à rester visible dans le feed
  const go = () => {
    let row = document.querySelector(_sel(id));
    if (!row) {                                  // pas dans le DOM → on lève la limite + on ré-affiche
      try { displayLimit = Math.max(displayLimit || 100, 600); searchQuery = ''; const sb = document.getElementById('search-input'); if (sb) sb.value = ''; renderNews(); } catch {}
      row = document.querySelector(_sel(id));
    }
    if (!row) {                                  // toujours absente (dédupée) → on saute sur le quasi-duplicat visible (même clé)
      const target = allItems.find(i => i.id === id);
      if (target) {
        const k = _newsKey(target.headline || '');
        const rep = k && getFilteredItems().find(i => _newsKey(i.headline || '') === k);
        if (rep) row = document.querySelector(_sel(rep.id));
      }
    }
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.add('news-item--flash');
      setTimeout(() => row.classList.remove('news-item--flash'), 2400);
    }
  };
  const newsTab = document.querySelector('.nav-item[data-view="news"]');
  if (newsTab && !newsTab.classList.contains('active')) { newsTab.click(); setTimeout(go, 140); }
  else go();
}

// ═══ Filter ═══════════════════════════════

function isCategoryEnabled(cat) {
  return enabledCategories.has(cat);
}

function toggleCategory(cat) {
  if (enabledCategories.has(cat)) {
    enabledCategories.delete(cat);
  } else {
    enabledCategories.add(cat);
  }
  displayLimit = 100;
  saveSettings();
  renderNews();
  syncSettingsUI();
  syncDropdownUI();
}

// Keep both UIs in sync when state changes
function syncSettingsUI() {
  document.querySelectorAll('.toggle-switch[data-cat]').forEach(el => {
    el.dataset.state = enabledCategories.has(el.dataset.cat) ? 'on' : 'off';
  });
}

function syncDropdownUI() {
  document.querySelectorAll('.dropdown-item[data-cat]').forEach(el => {
    el.classList.toggle('active', enabledCategories.has(el.dataset.cat));
  });
}

// ═══ News Rendering ═══════════════════════
// Empreinte d'un titre pour dédoublonner les reposts quasi-identiques (clé courte → + agressif)
function _newsKey(h) {
  // slice 72 (au lieu de 40) : deux events DIFFÉRENTS ("Iran strikes Gaza" vs "Iran strikes Israel")
  // ne collapsent plus sur la même clé → on ne masque plus par erreur une news importante distincte.
  return String(h || '').toLowerCase()
    .replace(/[^a-z0-9 ]/g, '').replace(/\b(the|a|an|of|to|in|on|for|and|as|is|at|by)\b/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, 72);
}
// Bruit / faible valeur marché → masqué
const _NEWS_NOISE = /(is\s+\w+\s+a\s+buy|should you buy|analysis today at|read more at|click here|sign up|subscribe|webinar|giveaway|promo|sponsored|advertisement|\bad\b|top \d+ (stocks|picks)|motley fool|zacks)/i;
// Blocklist EXPLICITE des news inutiles/spam (ex: taux de change quotidiens Banque de Russie). Extensible.
const _NEWS_BLOCK = /bank of russia|центральн|official exchange rates on selected date|set the official|reference exchange rate/i;
function getFilteredItems() {
  const seen = new Set();   // dédoublonnage intelligent des titres quasi-identiques
  return allItems.filter(item => {
    // SYNCHRO bandeau LIVE ↔ feed : la news actuellement annoncée dans le bandeau n'est JAMAIS
    // masquée (ni par la dédup, ni par un filtre) → on la retrouve TOUJOURS dans le flux.
    if (item.id && item.id === _flashedNewsId) { const k = _newsKey(item.headline || ''); if (k) seen.add(k); return true; }
    // Rapports DTP/PMT (briefings, recaps, opening news) : masqués du flux pour l'instant (à revoir plus tard).
    if (item._briefing || item.source === 'PMT') return false;
    if (!isCategoryEnabled(item.category)) return false;
    // Social-media reposts and failed-scrape stubs — no market value
    const _h = item.headline || '';
    if (/^\[No Title\]/i.test(_h)) return false;
    if (/^RT @/i.test(_h))         return false;
    if (/^@[A-Za-z]/i.test(_h))   return false;
    if (_h.replace(/[^a-z0-9]/gi, '').length < 14) return false;   // titres trop courts / sans valeur
    if (_NEWS_NOISE.test(_h)) return false;                        // promo / faible valeur
    if (_NEWS_BLOCK.test(_h)) return false;                        // spam explicitement bloqué (Banque de Russie, taux de change…)

    // ── Filtre intelligent : on masque les reposts au titre quasi-identique ──
    const key = _newsKey(_h);
    if (key && seen.has(key)) return false;
    if (key) seen.add(key);

    if (!searchQuery) return true;
    return (
      item.headline.toLowerCase().includes(searchQuery) ||
      (item.description || '').toLowerCase().includes(searchQuery) ||
      item.category.toLowerCase().includes(searchQuery) ||
      item.source.toLowerCase().includes(searchQuery) ||
      (item.tags || []).some(t => t.toLowerCase().includes(searchQuery))
    );
  });
}

// ── Speaker quote grouping ────────────────────────────────────────────────────
// When 2+ items from the same speaker arrive within 30 min with no opener,
// collapse them into a single card with all quotes inside the Info panel.
function _groupSpeakerQuotes(items) {
  const WINDOW   = 30 * 60 * 1000; // 30-minute window for grouping
  const skipIds  = new Set();
  const groupMap = new Map(); // primaryId → [secondary items]

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (skipIds.has(item.id)) continue;

    // Only process quote items (not openers — those already handle grouping via getSpeakerQuotes)
    const isQuote   = isSpeakerQuote(item);
    const isOpener  = isSpeakerOpener(item);
    if (!isQuote && !isOpener) continue;

    const spKey = getSpeakerKey(item.headline);
    if (!spKey) continue;

    // Already covered by an opener? skip
    const coveredByOpener = items.some(
      other => isSpeakerOpener(other) &&
               getSpeakerKey(other.headline) === spKey &&
               Math.abs(other.timestamp - item.timestamp) <= WINDOW
    );
    if (coveredByOpener && !isOpener) { skipIds.add(item.id); continue; }
    if (isOpener) continue; // let opener handle its own grouping

    // Group consecutive quotes from same speaker
    const grouped = [];
    for (let j = i + 1; j < items.length; j++) {
      const other = items[j];
      if (skipIds.has(other.id)) continue;
      if (Math.abs(other.timestamp - item.timestamp) > WINDOW) continue;
      if (getSpeakerKey(other.headline) !== spKey) continue;
      if (!isSpeakerQuote(other) && !isSpeakerOpener(other)) continue;
      grouped.push(other);
      skipIds.add(other.id);
    }

    if (grouped.length > 0) groupMap.set(item.id, grouped);
  }

  return items
    .filter(i => !skipIds.has(i.id))
    .map(i => {
      const g = groupMap.get(i.id);
      return g ? { ...i, _groupedQuotes: g } : i;
    });
}

function renderNews(hasNew = false) {
  const filtered = getFilteredItems();
  itemCountEl.textContent = `${filtered.length} items`;
  if (allItems.length) lsSet('dtp_news', allItems.slice(0, 150));   // persiste pour un affichage instantané au revisite

  if (filtered.length === 0) {
    if (!_wsInitReceived) return; // keep spinner until server acknowledges
    newsList.innerHTML = '<div class="empty-state" style="padding:40px 20px;text-align:center;color:var(--text4);font-size:11px;">No items — feed is live, updates appear automatically</div>';
    return;
  }

  // Collapse same-speaker quote clusters into single grouped cards
  const visible = _groupSpeakerQuotes(filtered.slice(0, displayLimit));

  // Group by date, sorted most-recent date first, items within each group newest first
  const groups = new Map();
  for (const item of visible) {
    const d = formatDate(item.timestamp);
    if (!groups.has(d)) groups.set(d, { ts: item.timestamp, items: [] });
    groups.get(d).items.push(item);
  }
  const sortedGroups = [...groups.entries()].sort((a, b) => b[1].ts - a[1].ts);

  const fragment = document.createDocumentFragment();
  for (const [date, { items }] of sortedGroups) {
    items.sort((a, b) => b.timestamp - a.timestamp);
    const header = document.createElement('div');
    header.className = 'date-header';
    header.textContent = date;
    fragment.appendChild(header);
    for (const item of items) {
      fragment.appendChild(buildNewsItem(item));
    }
  }

  // "Charger plus" button
  const hasMore = filtered.length > displayLimit || allItems.length < serverTotal;
  if (hasMore) {
    const btn = document.createElement('button');
    btn.className = 'load-more-btn';
    btn.textContent = loadingMore ? 'Chargement…' : 'Charger plus';
    btn.disabled = loadingMore;
    btn.onclick = loadMore;
    fragment.appendChild(btn);
  }

  // Anti-décalage : on mesure AVANT de reconstruire la liste.
  const prevScrollTop    = newsList.scrollTop;
  const prevScrollHeight = newsList.scrollHeight;
  const atTop = prevScrollTop <= 4;                 // l'utilisateur est (quasi) en haut du feed
  newsList.innerHTML = '';
  newsList.appendChild(fragment);
  if (hasNew) {
    // Une news vient d'ARRIVER : si l'utilisateur était en haut, on lui montre la nouvelle (haut du feed) ;
    // s'il lisait plus bas, on ANCRE sa position (pas de saut) en compensant la hauteur ajoutée au-dessus.
    newsList.scrollTop = atTop ? 0 : prevScrollTop + (newsList.scrollHeight - prevScrollHeight);
  } else {
    newsList.scrollTop = prevScrollTop;             // re-rendu (filtre, patch…) → on garde la position exacte
  }
}

async function loadMore() {
  if (loadingMore) return;

  const filtered = getFilteredItems();
  if (filtered.length > displayLimit) {
    // More items already loaded in memory — just reveal them
    displayLimit += 100;
    renderNews();
    return;
  }

  // Need to fetch older items from server
  const oldestTs = allItems.length > 0
    ? Math.min(...allItems.map(i => i.timestamp))
    : Date.now();

  loadingMore = true;
  renderNews();

  try {
    const r    = await fetch(`/api/news/history?before=${oldestTs}&limit=100`);
    const data = await r.json();
    if (data.total) serverTotal = data.total;
    if (data.items?.length > 0) {
      const existingIds = new Set(allItems.map(i => i.id));
      const fresh = data.items.filter(i => !existingIds.has(i.id));
      if (fresh.length > 0) {
        allItems = [...allItems, ...fresh].sort((a, b) => b.timestamp - a.timestamp);
        displayLimit += 100;
      }
    }
  } catch {}

  loadingMore = false;
  renderNews();
}

// ── Extract speaker/subject from headline for unique fallback notes ────────────
function headlineContext(headline) {
  if (!headline) return '';
  // "Daly [Non-Voter] Speaks", "Powell says", "Lagarde warns", "ECB's Lane notes"
  const m = headline.match(
    /\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\s*(\[(?:Non-?Voter|Voter)\])?\s*(?:says?|speaks?|warns?|notes?|comments?|adds?|states?|calls?|highlights?|stresses?|pushes?|reiterates?)/i
  );
  if (m && !['The','That','This','Some','Here','Iran','Gold','Bond','Risk'].includes(m[1]))
    return m[1].trim() + (m[2] ? ' ' + m[2].trim() : '');
  // "Powell: inflation is..." or "Kashkari: ..."
  const m2 = headline.match(/^([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\s*(\[[^\]]+\])?\s*:/);
  if (m2) return m2[1].trim() + (m2[2] ? ' ' + m2[2].trim() : '');
  // First segment before " — " or " - "
  const seg = headline.split(/\s[—–-]\s/)[0].trim();
  return seg.length > 5 && seg.length < 60 ? seg : headline.substring(0, 55).trim();
}

// ── Contextual note generator ─────────────────────────────────────────────────
function generateNote(item) {
  const t  = (item.headline || '').toLowerCase();
  const cat = item.category || '';
  const points = [];

  // Extract percentage figures from headline
  const pcts = (item.headline || '').match(/[\d.]+%/g) || [];

  // ── Economic data releases ──────────────────────
  if (/\bcpi\b|consumer price/.test(t)) {
    if (pcts.length) points.push(`Reading: ${pcts.join(' / ')}`);
    if (/above|beats|surges|accelerates|rises/.test(t))  points.push('Above forecast → Fed stays hawkish longer → USD ↑ · Bonds ↓');
    else if (/below|misses|falls|cools|slows/.test(t))   points.push('Below forecast → opens door for rate cuts → USD ↓ · Gold ↑');
    else if (/as expected|in line/.test(t))               points.push('In line with forecast → neutral for Fed policy path');
  }

  if (/\bpce\b|personal consumption expenditure/.test(t)) {
    if (pcts.length) points.push(`Core PCE: ${pcts.join(' / ')} — Fed's preferred inflation gauge`);
    if (/above|beats|rises/.test(t))  points.push('Hotter than expected → reinforces higher-for-longer narrative → USD ↑');
    else if (/below|falls|cools/.test(t)) points.push('Cooler than expected → supports rate cut case → USD ↓ · Gold ↑');
  }

  if (/\bgdp\b/.test(t)) {
    if (pcts.length) points.push(`GDP: ${pcts.join(' / ')}`);
    if (/above|beats|strong|exceed/.test(t))       points.push('Beat → growth robust → USD ↑ · Equities ↑');
    else if (/below|miss|contraction|shrinks/.test(t)) points.push('Miss → recession fears rise → USD ↓ · Bonds ↑ · Gold ↑');
  }

  if (/\bnfp\b|nonfarm payroll|payroll|unemployment/.test(t)) {
    if (pcts.length) points.push(`Unemployment: ${pcts[0]}`);
    if (/beats|strong|above|surges/.test(t))  points.push('Strong labour market → Fed in no rush to cut → USD ↑');
    else if (/misses|weak|below|falls/.test(t)) points.push('Weak jobs data → increases cut pressure on Fed → USD ↓');
  }

  if (/\bpmi\b/.test(t)) {
    const above50 = pcts.some(p => parseFloat(p) > 50);
    const below50 = pcts.some(p => parseFloat(p) < 50);
    if (pcts.length) points.push(`PMI: ${pcts[0]} (above 50 = expansion, below 50 = contraction)`);
    if (above50)  points.push('Expansion territory → growth momentum → USD ↑ · Equities ↑');
    if (below50)  points.push('Contraction territory → growth concerns → bonds ↑ · safe haven demand');
  }

  // ── Central banks ───────────────────────────────
  if (cat === 'Fed' || /\bfed\b|fomc|powell/.test(t)) {
    if (/hike|hawkish|higher for longer|tighten|persistent|too high|not cut/.test(t))
      points.push('Hawkish stance → rate cuts pushed back → USD ↑ · Bonds ↓ · Gold ↓');
    else if (/cut|dovish|eas|pause|pivot|lower rate/.test(t))
      points.push('Dovish pivot → cut expectations rise → USD ↓ · Gold ↑ · Equities ↑');
    else {
      const ctx = headlineContext(item.headline);
      points.push(`${ctx || 'Fed commentary'} — parse for signals on rate path timing, inflation trajectory, and balance sheet guidance. DXY and US 2Y yields are the real-time read.`);
    }
  }

  if (cat === 'ECB' || /\becb\b|lagarde/.test(t)) {
    if (/hike|hawkish|tighten/.test(t)) points.push('ECB hawkish → EUR ↑ · Bunds ↓');
    else if (/cut|dovish|eas/.test(t))  points.push('ECB dovish → EUR ↓ · Bunds ↑');
    else if (points.length === 0) {
      const ctx = headlineContext(item.headline);
      points.push(`${ctx || 'ECB commentary'} — watch EUR/USD and Bund 10Y yields for the market read on policy direction`);
    }
  }

  if (cat === 'BoE' || /\bboe\b|bank of england|bailey/.test(t)) {
    if (/hike|hawkish/.test(t)) points.push('BoE hawkish → GBP ↑ · Gilts ↓');
    else if (/cut|dovish/.test(t)) points.push('BoE dovish → GBP ↓ · Gilts ↑');
    else if (points.length === 0) {
      const ctx = headlineContext(item.headline);
      points.push(`${ctx || 'BoE commentary'} — watch GBP/USD and Gilt yields for the policy pricing read`);
    }
  }

  if (cat === 'BoJ' || /\bboj\b|bank of japan|ueda/.test(t)) {
    if (/hike|hawkish|tighten/.test(t)) points.push('BoJ tightening → JPY ↑ (carry trade unwind risk)');
    else if (/dovish|maintain|hold/.test(t)) points.push('BoJ stays dovish → JPY ↓ · carry trades supported');
    else if (points.length === 0) {
      const ctx = headlineContext(item.headline);
      points.push(`${ctx || 'BoJ commentary'} — watch USD/JPY and JGB 10Y yields for the policy signal read`);
    }
  }

  // ── Geopolitical ────────────────────────────────
  if (cat === 'Geopolitical' || /iran|russia|ukraine|israel|war|conflict|attack|missile/.test(t)) {
    if (/ceasefire.*fail|escalat|attack|strike|missile|troops/.test(t)) {
      points.push('Escalation → risk-off flows expected');
      points.push('Oil supply risk if Middle East involved → Oil ↑');
      points.push('Safe-haven demand → Gold ↑ · JPY ↑ · USD ↑');
    } else if (/ceasefire|peace|deal|de-escalat/.test(t)) {
      points.push('De-escalation → risk-on · Oil ↓ from conflict premium');
    }
    if (/iran|hormuz/.test(t)) points.push('Strait of Hormuz: ~20% of global oil flows through → critical supply route');
  }

  // ── Energy ──────────────────────────────────────
  if (cat === 'Energy & Power' || /oil|crude|brent|wti|opec/.test(t)) {
    if (/cut|supply|disruption|attack|sanction/.test(t))   points.push('Supply constraint → Oil ↑ · CAD ↑ · Energy stocks ↑');
    else if (/increas|oversupply|build|demand.*fall/.test(t)) points.push('Supply surplus risk → Oil ↓ · CAD ↓');
    if (pcts.length) points.push(`Move: ${pcts.join(' / ')}`);
  }

  // ── Iran / nuclear talks ──────────────────────────────────────────────────
  if (/iran/.test(t)) {
    if (/end.*war|focused.*end|ceasefire|de-escalat|peace|ending.*conflict/.test(t))
      points.push('Iran de-escalation signal — oil geopolitical risk premium may ease');
    if (/nuclear|uranium|enrichment|weapon/.test(t)) {
      if (/deal|agreement|suspend|commit|progress|positive|sign/.test(t))
        points.push('Nuclear deal progress → Hormuz supply risk eases → Oil ↓, Gold ↓');
      else if (/reject|fail|break|collapse|no deal/.test(t))
        points.push('Talks failure → Hormuz closure risk remains → Oil ↑, Gold ↑');
      else
        points.push('Nuclear programme — Iran deal outcome drives oil risk premium');
    }
    if (/sanction|oil.*ban|oil.*export/.test(t))
      points.push('Iran oil ~1.3m bbl/day at risk — sanctions add Brent supply premium');
    if (points.length > 0) points.push('Watch: Brent, WTI, Gold (safe-haven), USD/IRR');
  }

  // ── Trade / tariffs ───────────────────────────────────────────────────────
  if (cat === 'Trade' || /tariff|trade war|trade deal|import duty/.test(t)) {
    if (/china|beijing/.test(t)) {
      if (/increas|escalat|impose|new tariff|raise|hike/.test(t))
        points.push('US-China tariff escalation → USD ↑, CNY ↓, EM FX under pressure, equities ↓');
      else if (/cut|reduce|remov|suspend|deal|resolv|agree/.test(t))
        points.push('Trade de-escalation → risk-on: CNY ↑, equities ↑, USD ↓');
      else if (/not.*discuss|no.*tariff|deny/.test(t))
        points.push('No tariff progress confirmed — trade uncertainty persists');
      else
        points.push('US-China trade signal — watch DXY, CNY, Asian equity indices');
    }
    if (/europe|eu\b|eurozone/.test(t))
      points.push('EU trade friction → EUR/USD sensitive, export-heavy DAX/CAC names at risk');
  }

  // ── China / Asia policy ───────────────────────────────────────────────────
  if ((cat === 'Asian News' || /politburo|pboc|xi jinping|people.*bank.*china/.test(t)) && points.length === 0) {
    if (/yuan|cny|exchange rate|currency.*stable|stable.*currency/.test(t))
      points.push('CNY stability commitment — PBOC expected to defend near 7.30 on USD/CNY');
    if (/property|real estate|housing/.test(t))
      points.push('Property sector support → positive for Chinese banks & materials (CSI 300)');
    if (/fiscal|stimulus|proactive|spending|deficit/.test(t))
      points.push('Fiscal stimulus signal → risk-on China assets, AUD ↑ (commodity link)');
    if (/energy security|energy.*goal/.test(t))
      points.push('Energy security push → China oil/LNG demand theme');
    if (/rate|rrr|lpr|reserve ratio/.test(t))
      points.push('PBOC easing → CNY ↓ risk, liquidity support for A-shares & H-shares');
    if (/demand|consumption|domestic/.test(t))
      points.push('Domestic demand stimulus → consumer discretionary + retail sector positive');
  }

  // ── Political statements ──────────────────────────────────────────────────
  if (/trump|president.*says|white house|prime minister|heads? of state/.test(t) && points.length === 0) {
    if (/china|beijing|xi/.test(t))   points.push('US-China diplomatic signal — watch trade flows, tech sector, Taiwan posture');
    if (/russia|putin|ukraine/.test(t)) points.push('Russia signal — gas/energy supply risk, EUR/USD & Bunds sensitivity');
    if (/iran|nuclear|hormuz/.test(t)) points.push('Iran/nuclear stance drives oil supply risk premium');
    if (/tariff|trade|import|export/.test(t)) points.push('Trade policy signal — watch USD, affected sector ETFs');
    if (/rate|fed|economy|inflation/.test(t)) points.push('Political commentary on Fed/economy — watch USD reaction');
  }

  // ── Generic "says" fallback ───────────────────────────────────────────────
  if (points.length === 0 && /says|said|announces|reports|confirms|warns|states/.test(t)) {
    const ctx = headlineContext(item.headline);
    if (/stable|stability|maintain/.test(t))          points.push(`${ctx}: stability commitment — anchors near-term volatility expectations`);
    if (/concern|warn|risk|threat|caution/.test(t))   points.push(`${ctx}: risk warning — watch safe-haven flows (Gold, JPY, CHF)`);
    if (/growth|expand|recover|strong/.test(t))       points.push(`${ctx}: growth signal — risk assets may find support`);
    if (/cut.*spend|austerity|deficit.*reduc/.test(t)) points.push(`${ctx}: fiscal tightening — growth drag, bonds ↑`);
  }

  // Only return if we have something real — fallback suppressed
  if (points.length === 0 && pcts.length) points.push(`Figure: ${pcts.join(' / ')}`);

  return points;
}

// ── Market reaction detector ──────────────────────────────────────────────────
function detectReaction(headline, description) {
  const t = ((headline || '') + ' ' + (description || '')).toLowerCase();
  const reactions = [];

  // Oil
  if (/iran|hormuz|strait.*clos|opec.*cut|oil.*supply.*disrupt|pipeline.*attack|refinery.*attack|oil.*embargo|oil.*sanction|arab.*embargo/.test(t))
    reactions.push('Oil ↑');
  else if (/opec.*increas|oil.*demand.*fall|oil.*glut|oil.*oversupply|recession.*demand|china.*slowdown.*oil/.test(t))
    reactions.push('Oil ↓');

  // Gold / safe haven
  if (/war\b|conflict\b|ceasefire.*(break|fail|collaps|end)|attack.*infra|nuclear|escalat|risk.?off|safe.?haven|gold.*rallies|gold.*surges/.test(t))
    reactions.push('Gold ↑');
  else if (/de-escalat|peace.deal|ceasefire.agreed|risk.?on/.test(t))
    reactions.push('Gold ↓');

  // USD
  if (/(fed|fomc|powell).{0,40}(hike|hawkish|higher|tighten|not cut)|cpi.*above|cpi.*beats|inflation.*beat|inflation.*surges|nfp.*above|nfp.*beats|payroll.*(strong|beat)|gdp.*above/.test(t))
    reactions.push('USD ↑');
  else if (/(fed|fomc|powell).{0,40}(cut|dovish|eas|paus|pivot)|cpi.*below|inflation.*(cool|fall|miss)|nfp.*(below|miss|weak)|gdp.*(miss|contraction|shrink)/.test(t))
    reactions.push('USD ↓');

  // EUR
  if (/(ecb|lagarde|governing council).{0,40}(hike|hawkish|tighten)/.test(t)) reactions.push('EUR ↑');
  else if (/(ecb|lagarde).{0,40}(cut|dovish|eas)/.test(t)) reactions.push('EUR ↓');

  // GBP
  if (/(boe|bank of england|bailey).{0,40}(hike|hawkish)/.test(t)) reactions.push('GBP ↑');
  else if (/(boe|bank of england|bailey).{0,40}(cut|dovish|eas)/.test(t)) reactions.push('GBP ↓');

  // JPY
  if (/(boj|bank of japan|ueda).{0,40}(hike|hawkish)|japan.*rate.*rise/.test(t)) reactions.push('JPY ↑');
  else if (/(boj|bank of japan|ueda).{0,40}(cut|dovish|eas)/.test(t)) reactions.push('JPY ↓');

  return reactions.slice(0, 2);
}

const REACTION_NOTES = {
  'Oil ↑':  ['Supply disruption / geopolitical risk drives crude higher',
              'Watch: Brent, WTI, CAD, NOK, energy stocks (XLE, CVX)'],
  'Oil ↓':  ['Demand concerns or supply surplus weighs on crude',
              'Watch: Brent, WTI — energy stocks under pressure, CAD ↓'],
  'Gold ↑': ['Risk-off → safe-haven demand flows into gold',
              'Watch: XAU/USD, Silver — USD/JPY likely lower, bond yields ↓'],
  'Gold ↓': ['Risk appetite returns → gold loses safe-haven premium',
              'Watch: XAU/USD — equities may be the beneficiary'],
  'USD ↑':  ['Dollar bid on hawkish / strong data signal',
              'Watch: EUR/USD ↓, GBP/USD ↓, USD/JPY ↑, DXY, Gold ↓'],
  'USD ↓':  ['Dollar offered on dovish / weak data signal',
              'Watch: EUR/USD ↑, GBP/USD ↑, Gold ↑, EM currencies ↑'],
  'EUR ↑':  ['Euro bid on ECB hawkish signal',
              'Watch: EUR/USD ↑, EUR/JPY ↑, EUR/GBP ↑'],
  'EUR ↓':  ['Euro sold on ECB dovish signal',
              'Watch: EUR/USD ↓, EUR/GBP ↓'],
  'GBP ↑':  ['Sterling bid on BoE hawkish signal',
              'Watch: GBP/USD ↑, EUR/GBP ↓'],
  'GBP ↓':  ['Sterling offered on BoE dovish signal',
              'Watch: GBP/USD ↓, EUR/GBP ↑'],
  'JPY ↑':  ['Yen strengthens — BoJ hawkish or carry trade unwind',
              'Watch: USD/JPY ↓, EUR/JPY ↓ — carry trades at risk'],
  'JPY ↓':  ['Yen weakens — BoJ stays dovish, carry trades supported',
              'Watch: USD/JPY ↑, AUD/JPY ↑, EUR/JPY ↑'],
};

// ── Narrative reaction generator ─────────────────────────────────────────────
function generateReactionNarrative(item) {
  const t   = (item.headline || '').toLowerCase();
  const d   = (item.description || '').toLowerCase();
  const all = t + ' ' + d;
  const cat = item.category || '';
  const paras = [];

  // BoJ
  if (cat === 'BoJ' || /\bboj\b|bank of japan|ueda/.test(t)) {
    if (/hawkish|hike|raise|tighten|25bps|50bps|above neutral|upward risk/.test(all)) {
      paras.push('BoJ hawkish signal — carry traders are unwinding long USD/JPY, AUD/JPY and EUR/JPY positions as the rate differential with Japan narrows. Watch for stop clusters below key support in USD/JPY as leveraged positions flush out.');
      paras.push('Key pairs: USD/JPY (bearish near-term), EUR/JPY (downside risk), AUD/JPY (carry unwind). JGB 10Y yields rising — confirmation of the move. Nikkei may sell off on yen strength.');
    } else if (/dovish|hold|maintain|no change|uncertain|cautious|monitor|gradual/.test(all)) {
      paras.push('BoJ remains on hold — JPY weakness bias continues as the rate differential with the US stays wide. USD/JPY bulls retain the upper hand; carry trades intact and supported.');
      paras.push('Watch: USD/JPY (bullish bias), EUR/JPY (supported), AUD/JPY (carry supported). Nikkei likely to find support from the weaker yen. Monitor MoF intervention risk above 155–160 zone.');
    } else {
      const ctx = headlineContext(item.headline);
      paras.push(`${ctx || 'BoJ commentary'} — market is parsing for any guidance shift on the rate path or JGB tapering schedule. USD/JPY is the primary vehicle; JGB 10Y yields are the real-time confirmation signal.`);
    }
  }

  // Fed
  if (cat === 'Fed' || /\bfed\b|fomc|powell|federal reserve/.test(t)) {
    if (/hawkish|higher for longer|not cut|no cut|pause|persistent|resilient|inflation concern/.test(all)) {
      paras.push('Fed hawkish rhetoric — front-end US yields repricing higher as rate cut expectations are pushed back. DXY bid across the board; EUR/USD and GBP/USD face renewed selling pressure.');
      paras.push('Watch: DXY (bullish), USD/JPY (upside), Gold (near-term bearish), US 2Y yields (higher). Monitor CME FedWatch for cut probability shifts — rate-sensitive sectors (tech, utilities) likely under pressure.');
    } else if (/dovish|cut|eas|pivot|slow|cooling|below target|confident|progress/.test(all)) {
      paras.push('Fed dovish signal — USD offered as rate cut expectations gain traction. EUR/USD and GBP/USD catching bid; Gold breaking higher as real yields compress.');
      paras.push('Watch: DXY (bearish), EUR/USD (bullish), Gold (bullish), Nasdaq (risk-on). US 2Y yields dropping — monitor the 2Y/10Y spread. Bitcoin may also benefit from the liquidity easing signal.');
    } else {
      const ctx = headlineContext(item.headline);
      paras.push(`${ctx || 'Fed commentary'} — no clear directional policy signal yet. Parse for language shifts on: (1) rate cut timing, (2) inflation progress assessment, (3) balance sheet trajectory. DXY and US 2Y yields are the live tells.`);
    }
  }

  // ECB
  if (cat === 'ECB' || /\becb\b|lagarde|governing council/.test(t)) {
    if (/hawkish|hike|tighten|above target/.test(all)) {
      paras.push('ECB hawkish turn — EUR bid as rate hike expectations are repriced. EUR/USD pressing higher, EUR/GBP supported. Bund yields moving up.');
      paras.push('Watch: EUR/USD (bullish), EUR/GBP (bullish), EUR/JPY (bullish). German Bund 10Y yields higher. European bank stocks may outperform on margin expansion expectations.');
    } else if (/dovish|cut|eas|slow|below|concern|weak/.test(all)) {
      paras.push('ECB signals further easing — EUR offered as the market prices in more aggressive cuts. EUR/USD faces headwinds; Bund–Treasury spread widening.');
      paras.push('Watch: EUR/USD (bearish), EUR/GBP (bearish). Southern European bond spreads may tighten. European equities mixed — growth positive, FX headwind for exporters.');
    }
  }

  // BoE
  if (cat === 'BoE' || /\bboe\b|bank of england|bailey/.test(t)) {
    if (/hawkish|hike|tighten/.test(all)) {
      paras.push('BoE hawkish — GBP bid as rate expectations are revised higher. GBP/USD upside, EUR/GBP falling. Gilt yields higher.');
      paras.push('Watch: GBP/USD (bullish), EUR/GBP (bearish), GBP/JPY (bullish). FTSE may underperform — higher rates weigh on rate-sensitive sectors and UK housing names.');
    } else if (/dovish|cut|eas/.test(all)) {
      paras.push('BoE signals easing — GBP offered. GBP/USD downside, EUR/GBP higher. Gilts rallying.');
      paras.push('Watch: GBP/USD (bearish), EUR/GBP (bullish). FTSE 100 may find support as rate-cut expectations boost the UK domestic demand outlook.');
    }
  }

  // NFP
  if (/\bnfp\b|nonfarm payroll|non.?farm payroll/.test(t)) {
    if (/above|beat|strong|surge|jump|better/.test(all)) {
      paras.push('NFP beat — strong labour market reinforces the Fed\'s higher-for-longer stance. DXY surging, USD/JPY pressing higher. Gold selling off as rate cut pricing is aggressively unwound.');
      paras.push('Watch: DXY (bullish), USD/JPY (bullish), Gold (bearish near-term), US 2Y yields (spike). CME FedWatch cut probability will drop sharply — monitor EUR/USD support levels for the next leg.');
    } else if (/below|miss|weak|drop|fall|worse/.test(all)) {
      paras.push('NFP miss — weak jobs data revives Fed cut expectations. USD selling off; EUR/USD and GBP/USD catching a strong bid. Gold rallying as the market reprices a more aggressive easing cycle.');
      paras.push('Watch: DXY (bearish), EUR/USD (bullish), Gold (bullish), US 10Y yields (falling). Equities may initially rally on cut optimism before underlying growth concerns take over — watch the tone.');
    }
  }

  // CPI
  if (/\bcpi\b|consumer price index|inflation rate/.test(t)) {
    if (/above|hot|beat|surge|accelerat|rise|higher/.test(all)) {
      paras.push('Hot CPI — inflation staying elevated resets the rate cut timeline. USD front-end bid; 2Y yields spiking. EUR/USD under pressure; Gold facing near-term headwinds from higher real rates.');
      paras.push('Watch: DXY (bullish), USD/JPY (upside), Gold (near-term bearish), US 2Y yields (higher). Monitor the 5Y5Y inflation breakeven and TIPs for the bigger-picture read on real rates.');
    } else if (/below|cool|miss|fall|soft|lower/.test(all)) {
      paras.push('Soft CPI — disinflation narrative intact, opening the door to cuts. USD sold across the board as real yields compress; risk assets catching a bid.');
      paras.push('Watch: DXY (bearish), EUR/USD (bullish), Gold (bullish), Nasdaq (bullish). Rate-sensitive sectors likely to outperform. AUD and NZD may also benefit from the risk-on tone.');
    }
  }

  // GDP
  if (/\bgdp\b/.test(t)) {
    if (/above|beat|strong|exceed|grow|rise/.test(all)) {
      paras.push('GDP beat — robust growth supports the domestic currency and reduces the urgency of rate cuts. Domestic currency bid, equities supported, bonds may face mild selling as recession risk fades.');
    } else if (/below|miss|contraction|shrink|negative|fall/.test(all)) {
      paras.push('GDP miss/contraction — growth fears resurface. Domestic currency under pressure; safe-haven demand increasing. Watch: Gold (bullish), JPY/CHF (safe-haven bid), equities (bearish on growth outlook).');
    }
  }

  // PMI
  if (/\bpmi\b/.test(t)) {
    const nums = (item.headline || '').match(/\d+\.?\d*/g) || [];
    const pmiVal = nums.find(n => { const v = parseFloat(n); return v >= 40 && v <= 65; });
    if (pmiVal) {
      const v = parseFloat(pmiVal);
      paras.push(v > 50
        ? `PMI ${pmiVal} — expansion territory (above 50.0 threshold). Growth momentum positive; the domestic currency may find support. Risk-on tone if this is a major economy reading.`
        : `PMI ${pmiVal} — contraction territory (below the critical 50.0 level). Growth concerns weigh on the domestic currency; markets may start pricing in additional central bank easing.`
      );
    }
  }

  // Geopolitical
  if (cat === 'Geopolitical' || /attack|strike|missile|escalat/.test(t)) {
    if (/iran|hormuz|middle east|gulf/.test(t)) {
      paras.push('Middle East escalation — watch XBRUSD and XTIUSD for immediate spike (Hormuz supply risk). XAUUSD bid as geopolitical safe haven; USDJPY and USDCHF dropping on JPY/CHF flows. USDCAD may fall as CAD is oil-linked.');
      paras.push('Key pair moves: XAUUSD ↑ (spike), USDJPY ↓, USDCHF ↓, XBRUSD ↑, USDCAD ↓, AUDUSD ↓, NZDUSD ↓. VIX spike + XAUUSD velocity = scale gauge for the risk-off move.');
    } else if (/russia|ukraine/.test(t)) {
      paras.push('Russia/Ukraine escalation — EURUSD under pressure from European energy/growth risk. XAUUSD bullish (geopolitical bid); USDJPY and USDCHF dropping as safe-haven flows accelerate. Natural Gas spiking.');
      paras.push('Key pair moves: EURUSD ↓, XAUUSD ↑, USDJPY ↓, USDCHF ↓, NATGAS ↑. DAX and CAC selling off. Wheat futures may spike on supply disruption risk — watch agricultural commodities.');
    } else {
      paras.push('Geopolitical shock — immediate safe-haven rotation: XAUUSD spiking, USDJPY and USDCHF dropping as JPY/CHF attract flows. AUDUSD and NZDUSD lower on risk-off. DXY bid vs. commodity currencies.');
      paras.push('Key pair moves: XAUUSD ↑, USDJPY ↓, USDCHF ↓, AUDUSD ↓, NZDUSD ↓. VIX spike + XAUUSD velocity = scale gauge. S&P 500 futures direction confirms broader market tone.');
    }
  }

  // Trade / Tariffs
  if (cat === 'Trade' || /tariff|trade war|trade deal/.test(t)) {
    if (/escalat|increas|impose|raise|hike/.test(all)) {
      paras.push('Trade escalation — tariff risk weighing on global growth outlook. USD may initially benefit as a safe-haven but ultimately undermines growth. CNY/EM FX under pressure, Asian equities selling off.');
      paras.push('Watch: USD/CNY (CNY weaker), AUD (commodity/China-linked bearish), emerging market FX (broadly weaker). S&P 500 and Nasdaq face headwinds from supply chain and margin concerns.');
    } else if (/deal|resolv|cut|reduce|suspend/.test(all)) {
      paras.push('Trade de-escalation — risk-on move. CNY bid, EM FX recovering, equities rallying. The commodity-linked currencies (AUD, CAD, NZD) are likely to outperform in the risk-on regime.');
    }
  }

  return paras;
}

// ── Smart contextual tags ──────────────────────────────────────────────────
const TAG_CLASS = {
  'Data':        'tag--neutral',
  'Inflation':   'tag--neutral',
  'Rates':       'tag--neutral',

  'Equities':    'tag--neutral',
  'Bonds':       'tag--purple',
  'Tariffs':     'tag--neutral',

  'Sanctions':   'tag--red',
  'Geopolitical':'tag--neutral',
  'Yuan':        'tag--neutral',
  'Asia':        'tag--neutral',
  'Energy':      'tag--neutral',
  'US':          'tag--neutral',
  'UK':          'tag--neutral',
  'EU':          'tag--neutral',
};

function getSmartTags(item) {
  const hl  = item.headline || '';
  const t   = hl.toLowerCase();
  const cat = item.category || '';
  const tags = [];




  // ── TARIFFS: explicit trade policy measures ───────────────────────────────
  if (/\btariff|\btrade war\b|\btrade deal\b|\bimport (?:duty|tax|tariff|levy)\b/.test(t))
    tags.push('Tariffs');

  // ── SANCTIONS: sanction-related headlines ────────────────────────────────
  if (/\bsanction/.test(t)) tags.push('Sanctions');

  // ── GEOPOLITICAL: headline is primarily about a conflict/military event ───
  // Requires named actor + concrete military/diplomatic action — avoids false fires
  if (cat === 'Geopolitical' ||
      (/\b(?:iran|russia|ukraine|israel|hamas|hezbollah|nato|north korea)\b/.test(t) &&
       /\b(?:war|attack|strike|invasion|troops|missile|bomb|ceasefire|deal|nuclear|military|airstrike|sanctions?)\b/.test(t)) ||
      /\b(?:airstrike|ground offensive|drone strike|military escalat)\b/.test(t))
    tags.push('Geopolitical');

  // ── ENERGY: headline is about energy market prices, supply or OPEC ────────
  // Does NOT fire just because "oil" appears in a geopolitical article
  if (cat === 'Energy & Power' ||
      /\b(?:crude oil|brent crude|wti crude|opec\+?)\b/.test(t) ||
      (/\b(?:oil|natural gas|lng)\b/.test(t) &&
       /\b(?:price|prices|supply|demand|output|production|market|chokepoint|embargo|refiner|pipeline)\b/.test(t)))
    tags.push('Energy');

  // ── YUAN: CNY/PBOC with a directional or policy context ──────────────────
  if (/\b(?:yuan|cny|renminbi|pboc)\b/.test(t) &&
      /\b(?:weak|strong|fall|rise|drop|depreciat|appreciat|midpoint|fix|devaluat|intervention|band|target|rate)\b/.test(t))
    tags.push('Yuan');

  // ── EQUITIES: named index with a directional move ─────────────────────────
  if (/\b(?:s&p 500|s&p500|nasdaq|dow jones|nikkei|dax|cac 40|ftse 100|hang seng)\b/.test(t) &&
      /\b(?:rises?|falls?|drops?|gains?|rallies?|surges?|tumbles?|slumps?|rebounds?|extends?)\b/.test(t))
    tags.push('Equities');

  // ── BONDS: named yield with a directional context ─────────────────────────
  if (/\b(?:treasury|bond|gilt|bund)\s+yields?\b/.test(t) &&
      /\b(?:rises?|falls?|hits?|above|below|surges?|drops?|climbs?|ticks?|inverts?|steepens?)\b/.test(t))
    tags.push('Bonds');

  // ── INFLATION: CPI/PCE/PPI/HICP/Inflation Rate data releases ────────────
  // Covers "CPI YoY", "German Inflation Rate YoY Prel", "Italy Consumer Price Index" etc.
  const _inflationResult = /\b(?:actual|flash|prelim|final|yoy|mom|y\/y|m\/m|rose|fell|came in|above|below|meets?|surged|eased|increased|decreased|vs\.?\s*exp|vs\.?\s*forecast)\b/;
  if ((/\b(?:cpi|pce|ppi|hicp|core\s+cpi|core\s+pce|core\s+ppi)\b/.test(t) && _inflationResult.test(t)) ||
      (/\b(?:consumer prices?|consumer price index|producer prices?|producer price index|harmonized\s+index\s+of\s+consumer\s+prices?|hicp)\b/.test(t) && _inflationResult.test(t)) ||
      // "Inflation Rate YoY Prel" / "Inflation Rate MoM" — common FJ format
      (/\binflation rate\b.{0,60}\b(?:yoy|mom|y\/y|m\/m|prel|prelim|final|actual|above|below|vs\.)\b/.test(t)) ||
      // "X Inflation Rate Prel" with a value (has digits like "2.6%")
      (/\binflation rate\b.{0,80}\d[\d.,]+\s*%/.test(t)))
    tags.push('Inflation');

  // ── RATES: rate decisions/hikes/cuts + inflation data (affects CB rates) ──
  if (/\b(?:rate decision|rate hike|rate cut|rate hold|rate increase|rate pause)\b/.test(t) ||
      /\b(?:hike|cut|raise|lower)\s+(?:rates?|interest rates?|benchmark rate|policy rate)\b/.test(t) ||
      /\b\d+\s*bps?\s+(?:hike|cut|increase|move)\b/.test(t) ||
      /\b(?:fomc|ecb|boj|boe|rba|rbnz|snb|boc)\s+(?:rate|decision|hike|cut|vote|hold)\b/.test(t) ||
      /\b(?:fomc|ecb|boj)\s+minutes\b/.test(t) ||
      // Inflation releases imply rate context
      (tags.includes('Inflation') && _inflationResult.test(t)))
    tags.push('Rates');

  // ── DATA: key macro statistical releases — not if Inflation/Rates already ─
  if (!tags.includes('Inflation') && !tags.includes('Rates')) {
    const dataRelease =
      // GDP with result qualifier
      (/\b(?:gdp|gross domestic product)\b.{0,50}\b(?:flash|prelim|final|estimate|actual|yoy|qoq|grew|fell|rose|expanded|contracted|q[1-4])\b/.test(t)) ||
      // Non-farm payrolls
      (/\b(?:nonfarm payrolls?|non.?farm payrolls?|\bnfp\b)\b/.test(t)) ||
      // Unemployment with a numerical/directional result
      (/\b(?:unemployment rate|jobless rate|jobless claims)\b.{0,30}\b(?:rose|fell|actual|above|below|came in|increased|decreased)\b/.test(t)) ||
      // PMI with actual number or release qualifier
      (/\b(?:pmi|purchasing managers)\b.{0,30}(?:\d{2}\.\d|\bactual\b|flash|prelim|came in|above|below)\b/.test(t)) ||
      // Other data releases with a result marker
      (/\b(?:retail sales|industrial production|durable goods|housing starts|trade balance|current account|factory orders|payrolls?|import prices?|export prices?|gdp)\b.{0,40}\b(?:actual|yoy|mom|rose|fell|above|below|came in|vs\.?\s*(?:exp|forecast))\b/.test(t)) ||
      // "vs. Exp." / "vs. Forecast" format — always a real data release result
      (/\bvs\.?\s*(?:exp(?:ected|ectations?)?|forecast)\b/i.test(t) && /\b(?:actual|\d[\d.,]+\s*%|\d[\d.,]+[kmbtn]?\b)/.test(t)) ||
      // Statistical report titles: key term + month/quarter + year
      (/\b(?:employment|unemployment|gdp|industrial production|retail (?:sales|trade)|consumer prices?|producer prices?|trade balance|current account)\b/.test(t) &&
       /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|q[1-4])\b.{0,8}\b20\d\d\b/.test(t));
    if (dataRelease) tags.push('Data');
  }
  // Also add Data for any item with EU/US/UK Data category that has an actual value
  if (!tags.includes('Data') && /\b(?:eu|us|uk|swiss|japanese|canadian|australian|chinese|new zealand)\s+data\b/i.test(cat) && /\d[\d.,]+\s*%/.test(hl)) {
    tags.push('Data');
  }

  // ── US: Fed/FOMC speakers or US-prefixed macro data releases ─────────────
  // Does NOT fire for every article that mentions "US" or "dollar"
  const usFed =
    /\b(?:federal reserve|fomc)\b/.test(t) ||
    /\bfed(?:'s|s)?\s+\w+:/i.test(hl) ||           // "Fed's Kashkari:", "Fed's Williams:"
    /\b(?:powell|yellen)\b.{0,25}\b(?:says?|said|warns?|signals?|notes?|sees?)\b/.test(t);
  const usData =
    /\b(?:u\.s\.|us)\s+(?:gdp|cpi|pce|nfp|payrolls?|unemployment|retail sales|durable goods|housing starts|trade balance|industrial production|consumer confidence|personal income|personal spending)\b/.test(t);
  if (usFed || usData) tags.push('US');

  // ── EU: ECB named speakers or eurozone/EU-member state data releases ──────
  // Does NOT fire for articles that just mention "EU" or "euro" in passing
  const euCB =
    /\b(?:ecb|european central bank)\b/.test(t) ||
    /\b(?:lagarde|simkus|nagel|schnabel|lane|de guindos|wunsch|knot|villeroy|centeno|rehn|holzmann)\b/.test(t);
  const euData =
    /\b(?:eurozone|euro area|euro.?zone)\s+(?:gdp|cpi|pmi|inflation|employment|retail|production|deficit|surplus|trade)\b/.test(t) ||
    // EU-member state data releases (headline starts with country name)
    /^(?:france|germany|italy|spain|netherlands|portugal|greece|austria|belgium|finland|ireland)\b.{0,60}\b(?:gdp|cpi|pmi|inflation|employment|payroll|industrial|retail|consumer prices?|trade balance|current account|import prices?|household consumption)\b/.test(t) ||
    /\b(?:german|french|italian|spanish|dutch|austrian|portuguese|greek)\s+(?:gdp|cpi|pmi|inflation|import prices?|export prices?|industrial|retail|employment|trade)\b/.test(t);
  if (euCB || euData) tags.push('EU');

  // ── ASIA: BoJ/Japanese govt FX statements or Asian macro data releases ────
  // Does NOT fire just because "Japan" or "JPY" is mentioned in an FX article
  const asiaBoJ = /\b(?:boj|bank of japan)\b/.test(t);
  const asiaGovt =
    /\b(?:japan|japanese)\b.{0,40}\b(?:yen|jpy|intervention|fx|monetary policy|finance minist|finmin|cabinet|central bank)\b/.test(t) &&
    /\b(?:concern|warn|intervene|speculative|action|monitor|volatility|decisive)\b/.test(t);
  const asiaData =
    /\b(?:japan|japanese)\s+(?:gdp|cpi|pmi|inflation|industrial|retail|trade|tankan|employment)\b/.test(t) ||
    /\btokyo\s+(?:cpi|core cpi|inflation|prices?)\b/.test(t) ||
    /\b(?:china|chinese)\s+(?:gdp|cpi|pmi|inflation|industrial|retail|trade)\b/.test(t) ||
    (/\bpboc\b/.test(t) && /\b(?:rate|fix|midpoint|cut|hike|inject|liquidity)\b/.test(t));
  if (asiaBoJ || asiaGovt || asiaData) tags.push('Asia');

  return tags;
}

// ── Economic Commentary burst grouping ────────────────────────────────────────
function collapseEconGroups(items) {
  const WINDOW_MS = 3 * 60 * 1000;
  const MIN_GROUP = 3;

  // Collect indices of all EC items (items are newest-first)
  const econIdxs = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].category === 'Economic Commentary') econIdxs.push(i);
  }

  // Group EC items by time window, skipping non-EC items in between
  const inGroup  = new Set();
  const usedEcon = new Set();
  const clusters = [];

  for (let ei = 0; ei < econIdxs.length; ei++) {
    const startIdx = econIdxs[ei];
    if (usedEcon.has(startIdx)) continue;

    const refTs   = items[startIdx].timestamp;
    const cluster = [startIdx];

    for (let ej = ei + 1; ej < econIdxs.length; ej++) {
      const idx2 = econIdxs[ej];
      if (usedEcon.has(idx2)) continue;
      if (refTs - items[idx2].timestamp <= WINDOW_MS) {
        cluster.push(idx2);
      } else {
        break; // sorted newest-first, further items are even older
      }
    }

    if (cluster.length >= MIN_GROUP) {
      cluster.forEach(idx => { usedEcon.add(idx); inGroup.add(idx); });
      clusters.push({ firstIdx: startIdx, indices: cluster });
    }
  }

  if (clusters.length === 0) return items;

  // Rebuild array: replace each cluster's items with a single group token
  // inserted at the position of the first (newest) EC item in the cluster
  const emitted = new Set();
  const result  = [];

  for (let i = 0; i < items.length; i++) {
    if (!inGroup.has(i)) { result.push(items[i]); continue; }

    const clust = clusters.find(c => c.firstIdx === i);
    if (clust && !emitted.has(clust)) {
      emitted.add(clust);
      const groupItems = clust.indices.map(idx => items[idx]);
      result.push({ _group: true, _items: groupItems, timestamp: groupItems[0].timestamp, time: groupItems[0].time });
    }
    // other items in the group are silently consumed
  }

  return result;
}

function buildEconGroup(group) {
  const { _items: items, time } = group;
  const count   = items.length;
  const sources = [...new Set(items.map(i => i.source).filter(Boolean))];

  const el = document.createElement('div');
  el.className = 'news-item news-item--econ-group';

  const iconCol = document.createElement('div');
  iconCol.className = 'news-icon-col';
  el.appendChild(iconCol);

  const timeEl = document.createElement('div');
  timeEl.className = 'news-time';
  timeEl.textContent = time;
  el.appendChild(timeEl);

  const catText = document.createElement('div');
  catText.className = 'news-category-text';
  catText.textContent = 'Economic Commentary';
  el.appendChild(catText);

  const content = document.createElement('div');
  content.className = 'news-content';

  const header = document.createElement('div');
  header.className = 'econ-group-header';

  const badge = document.createElement('span');
  badge.className = 'econ-group-badge';
  badge.textContent = `${count} Economic Releases`;

  const arrow = document.createElement('span');
  arrow.className = 'econ-group-arrow';
  arrow.textContent = '▾';

  header.appendChild(badge);
  header.appendChild(arrow);
  content.appendChild(header);

  const list = document.createElement('div');
  list.className = 'econ-group-list';

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'econ-group-row';

    const hl = document.createElement('span');
    hl.className = 'econ-group-headline';
    hl.textContent = item.headline;
    row.appendChild(hl);

    if (item.source) {
      const src = document.createElement('span');
      src.className = 'tag tag--source';
      src.textContent = item.source;
      row.appendChild(src);
    }

    list.appendChild(row);
  }

  content.appendChild(list);

  const tagsEl = document.createElement('div');
  tagsEl.className = 'news-tags';
  for (const src of sources) {
    const t = document.createElement('span');
    t.className = 'tag tag--source';
    t.textContent = src;
    tagsEl.appendChild(t);
  }
  content.appendChild(tagsEl);

  el.appendChild(content);

  el.addEventListener('click', () => {
    const open = el.classList.toggle('news-item--expanded');
    arrow.textContent = open ? '▴' : '▾';
  });

  return el;
}

// ═══ Speaker Context System ══════════════════════════════════════════════════

const CB_SPEAKER_RX = /\b(?:fed(?:eral reserve)?|fomc|ecb|boe|boj|boc|rba|snb|rbnz|riksbank|norges\s+bank|bank\s+of\s+(?:england|japan|canada|australia)|swiss\s+national|reserve\s+bank|powell|lagarde|bailey|ueda|macklem|bullock|jordan|mann|dhingra|pill|haskel|breeden|taylor|ramsden|waller|jefferson|cook|kugler|bowman|schmid|daly|kashkari|williams|bostic|barkin|collins|logan|hammack|goolsbee|musalem|harker|villeroy|de\s?guindos|nagel|schnabel|lane|rehn|knot|centeno|simkus|panetta|vasle|kazaks|vujcic|holzmann|stournaras|elderson|cipollone)\b/i;

// "BoE's Mann Speaks" / "Fed's Powell Speaking" / "ECB Lagarde Testimony"
function isSpeakerOpener(item) {
  const h = (item.headline || '').trim();
  return CB_SPEAKER_RX.test(h) &&
    /\b(?:speaks?|speaking|delivers?\s+(?:speech|remarks?|address)|gives?\s+(?:speech|remarks?)|presents?|testif(?:y|ies|ied)|testimony|press\s+(?:conference|briefing)|opening\s+(?:statement|remarks?)|keynote)\s*$/i.test(h);
}

// "BoE's Mann: Inflation sticky" / "Fed's Powell - Data dependent" / "Powell Says..."
function isSpeakerQuote(item) {
  const h = item.headline || '';
  if (!CB_SPEAKER_RX.test(h)) return false;
  // Must have separator or "says/notes" after name (not end with "Speaks")
  return /^.{4,60}\s*(?:[-:—]|says?\s|notes?\s|adds?\s|warns?\s|signals?\s|reiterates?\s|expects?\s|sees?\s|stresses?\s|confirms?\s)\s*\S/i.test(h) &&
    !/\b(?:speaks?|speaking|testimony|press\s+(?:conference|briefing))\s*$/i.test(h);
}

// Extract last name: "BoE's Mann Speaks" → "mann", "Fed's Powell: ..." → "powell"
function getSpeakerKey(headline) {
  const h = headline || '';
  const m1 = h.match(/(?:fed(?:eral\s+reserve)?|fomc|ecb|boe|boj|boc|rba|snb|rbnz|bank\s+of\s+\w+|riksbank)'?s?\s+([A-Z][a-zé\-]+)/i);
  if (m1) return m1[1].toLowerCase();
  const m2 = h.match(/\b(powell|lagarde|bailey|ueda|macklem|bullock|jordan|mann|dhingra|pill|haskel|breeden|taylor|ramsden|waller|jefferson|cook|kugler|bowman|schmid|daly|kashkari|williams|bostic|barkin|collins|logan|hammack|goolsbee|musalem|harker|villeroy|nagel|schnabel|lane|rehn|knot|centeno|simkus|panetta|vasle|kazaks|vujcic|holzmann|stournaras|elderson|cipollone)\b/i);
  return m2 ? m2[1].toLowerCase() : null;
}

// Collect all quote items from same speaker within ±90 min of the opener
function getSpeakerQuotes(speakerKey, refTs) {
  if (!speakerKey) return [];
  const WINDOW = 90 * 60 * 1000;
  return allItems
    .filter(i => Math.abs(i.timestamp - refTs) <= WINDOW && getSpeakerKey(i.headline) === speakerKey && isSpeakerQuote(i))
    .sort((a, b) => a.timestamp - b.timestamp);
}

// Strip CB prefix from quote headline: "BoE's Mann: text" → "text"
function stripSpeakerPrefix(headline) {
  return (headline || '').replace(/^[^:—-]{3,55}\s*[-:—]\s*/, '').trim() || headline;
}

// ─────────────────────────────────────────────────────────────────────────────

// Detect PRIMER / PREVIEW briefing items (Newsquawk-style aggregated reports)
function isPrimerItem(item) {
  if (item._briefing || item.source === 'PMT') return true;   // rapports DTP (rendu structuré conservé)
  const h = item.headline || '';
  return /^\s*(?:PRIMER|PREVIEW|RESEARCH|INSIGHT|ANALYSIS|TALKING POINTS?)\s*[-:—]/i.test(h);
}

// Label du badge (au lieu de "PRIMER") : ANALYST / INSTITUTION / CALENDRIER
function primerBadgeLabel(item) {
  const src = (item._source || '').toLowerCase();
  const cat = (item.category || '');
  // Rapport d'institution / banque
  if (['ing-think', 'actionforex', 'fxstreet', 'bank-research'].includes(src) || /institution|bank research/i.test(cat)) return 'INSTITUTION';
  // Résultat d'événement économique qui vient de sortir (calendrier)
  if (/\bData$/.test(cat) || /Actual:/i.test(item.description || '') || (item.id || '').startsWith('ff-cal') || (item.id || '').startsWith('ffcal')) return 'CALENDRIER';
  // Par défaut : rapport d'analyste / briefing
  return 'ANALYST';
}

function parsePrimerBullets(description) {
  if (!description) return [];
  const clean = description.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  return clean.split(/\n+/)
    .map(l => l.trim())
    .map(l => l.replace(/^[-•·]\s+/, ''))   // strip leading dash/bullet
    .filter(l => l.length > 4);
}

// ── Rapports DTP : détection des rubriques (titres en MAJUSCULES) ──
function _isSectionHead(line) {
  const t = (line || '').trim();
  if (t.length < 2 || t.length > 42) return false;
  if (/\d{1,2}:\d{2}/.test(t)) return false;            // pas une horodatée
  if (/[.;:]$/.test(t)) return false;                   // pas une phrase
  // Lettres en majuscules (autorise espaces, &, /, -, chiffres)
  return /^[A-Z0-9][A-Z0-9 &/\-']+$/.test(t) && t === t.toUpperCase() && /[A-Z]/.test(t);
}
// Met en gras le mot-clé / chiffre de tête de la puce (sujet)
function _reportLead(s) {
  return String(s).replace(
    /^((?:[A-Z][\wÀ-ÿ$%./-]*|\$?\d[\d.,]*%?)(?:\s+[\wÀ-ÿ$%./'-]+){0,3})/,
    '<strong class="rpt-key">$1</strong>'
  );
}
// Remplace la marque PMT par DTP dans les titres de rapport
function _dtpTitle(s) { return String(s || '').replace(/\bPMT\b/g, 'DTP'); }

// Rend la table SNAPSHOT (style DTP : barres bleues, 2 colonnes, vert/rouge)
function _renderSnapshot(data) {
  const groups = (data && data.groups) || [];
  if (!groups.length) return '';
  const cell = r => {
    if (!r) return '<td class="rsnap-lbl"></td><td class="rsnap-val"></td>';
    const cls = r.pct == null ? '' : r.pct > 0 ? 'rsnap-up' : r.pct < 0 ? 'rsnap-dn' : '';
    const val = r.pct == null ? '—' : `${r.pct > 0 ? '+' : ''}${r.pct.toFixed(1)}%`;
    return `<td class="rsnap-lbl">${r.label}</td><td class="rsnap-val ${cls}">${val}</td>`;
  };
  const blocks = groups.map(g => {
    let rows = '';
    for (let i = 0; i < g.rows.length; i += 2) {
      rows += `<tr class="${(i / 2) % 2 ? 'rsnap-alt' : ''}">${cell(g.rows[i])}${cell(g.rows[i + 1])}</tr>`;
    }
    return `<div class="rsnap-head">${g.title}</div><table class="rsnap-table"><tbody>${rows}</tbody></table>`;
  }).join('');
  return `<div class="report-snapshot-inner"><div class="rsnap-title">SNAPSHOT</div>${blocks}</div>`;
}

// ── Throttled background reaction-check queue ─────────────────────────────────
// Checks /api/market-moves for recent items; adds Réaction button only if real
// moves are confirmed (max 3 concurrent requests).
const _reactionQ = [];
let   _reactionRunning = 0;
const REACTION_MAX_CONCURRENT = 3;
const REACTION_AGE_LIMIT = 5 * 24 * 60 * 60 * 1000; // 5 days (YF 1m data limit)

function _queueReactionCheck(asyncFn) {
  _reactionQ.push(asyncFn);
  _drainReactionQ();
}
function _drainReactionQ() {
  while (_reactionRunning < REACTION_MAX_CONCURRENT && _reactionQ.length > 0) {
    _reactionRunning++;
    const fn = _reactionQ.shift();
    Promise.resolve(fn()).finally(() => { _reactionRunning--; _drainReactionQ(); });
  }
}

// ── Transforme une description (array ou gros bloc texte) en puces synthétiques ──
function _toBullets(raw, maxItems = 4) {
  // 1) Si déjà un tableau → nettoyer chaque entrée
  if (Array.isArray(raw)) {
    return raw.map(s => String(s).trim().replace(/^[-•*]\s*/, ''))
              .filter(s => s.length > 4).slice(0, maxItems);
  }
  let text = String(raw || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (!text) return [];

  // 2) Retirer le préambule robotique de source ("From vtmarkets.com | 6 hr ago …", "Report from X:")
  //    On boucle car ces fragments s'enchaînent (domaine, puis "N hr/min ago").
  for (let i = 0; i < 4; i++) {
    text = text
      .replace(/^from\s+[\w.-]+\.(?:com|org|net|io|co)\s*\|?\s*/i, '')                 // From vtmarkets.com |
      .replace(/^[<>]?\s*[<>]?\s*\d+\s*(?:min|mins|minute|minutes|h|hr|hrs|hour|hours)\s*ago\s*/i, '')  // 6 hr ago / 1 min ago
      .replace(/^report\s+from\s+[^:•|]{2,30}:\s*/i, '')
      .replace(/^[|·–—-]\s*/, '')
      .trim();
  }

  let parts;
  // 3) Priorité aux séparateurs explicites : puces • puis barres |
  if (text.includes('•'))      parts = text.split('•');
  else if (text.includes('|')) parts = text.split('|');
  else if (/\n/.test(raw))     parts = String(raw).split(/\n+/);
  else {
    // 4) Sinon découper sur les fins de phrase ". " (max 2-3 phrases clés)
    parts = text.split(/(?<=\.)\s+(?=[A-Z"«])/);
  }

  let bullets = parts
    .map(s => s.trim().replace(/^[-•*]\s*/, ''))
    .filter(s => s.length > 6)                 // ignorer fragments vides/courts
    .filter(s => !/^[^a-z0-9]*$/i.test(s))     // ignorer ponctuation seule
    .filter(s => !/:\s*$/.test(s))             // ignorer labels "Report from X:"
    // Bruit métadonnées (auteur/source) — pas de valeur marché (n'importe où dans la phrase)
    .filter(s => !/^(?:authored by|written by|by\s+[A-Z]|via\s+|source\s*:|courtesy of|published by|republished)/i.test(s))
    .filter(s => !/(?:this article was written by|\bwritten by\s+[\w.\- ]+\s+at\b|\bat\s+(?:investinglive|forexlive|think\.ing|fxstreet|actionforex)\.com|follow .* on (?:twitter|x)\b)/i.test(s))
    .filter(s => !/^[\w .'-]+\bvia\b\s+the\b/i.test(s))
    .slice(0, maxItems);

  // ── Fin PROPRE : chaque puce se termine sur une phrase complète, jamais sur "..." ──
  // 1) on retire un éventuel "…"/"..." de fin de puce.
  bullets = bullets.map(s => s.replace(/\s*(?:…|\.{2,})\s*$/, '').trim()).filter(s => s.length > 6);
  // 2) si la DERNIÈRE puce est une phrase tronquée (pas de ponctuation finale), on l'enlève —
  //    sauf si c'est la seule (on la garde alors telle quelle, sans le "...").
  while (bullets.length > 1 && !/[.!?%»”"'’)\]]$/.test(bullets[bullets.length - 1])) bullets.pop();
  return bullets;
}

// ── Mini-badge actif coloré (▲ SPX / ▼ Gold) en préfixe de puce ──────────────
const _ASSET_RX = /\b(SPX|S&P\s?500|Nasdaq|NDX|Dow|DJI|Russell|RUT|Gold|XAU|Silver|Platinum|Palladium|Copper|Crude|WTI|Brent|Oil|Bitcoin|BTC|Ether|ETH|Nikkei|DAX|FTSE|CAC|Hang\s?Seng|USD|EUR|GBP|JPY|CHF|AUD|NZD|CAD|DXY|Treasuries|T-Notes?|Bunds?|Gilts?|Yields?|VIX)\b/i;
function _assetBadgePrefix(text) {
  const m = text.match(_ASSET_RX);
  if (!m) return '';
  const up = /(\+\d|\bup\b|\bgains?\b|higher|rally|rose|surges?|jump|climb|stronger|firmer|bid\b)/i.test(text);
  const dn = /(-\d|\bdown\b|\bfell\b|lower|drops?|declines?|slid|slump|weaker|softer|offered\b)/i.test(text);
  if (up === dn) return '';                       // ambigu ou neutre → pas de badge
  const cls   = up ? 'rx-asset--up' : 'rx-asset--dn';
  const arrow = up ? '▲' : '▼';
  return `<span class="rx-asset ${cls}">${arrow} ${m[0]}</span>`;
}

// ── Met en gras les chiffres et mots-clés de verdict d'une puce ──────────────
function _emphasize(text) {
  return String(text || '')
    // Nombres (55.1, +0.4%, 250K, 1.2bln…)
    .replace(/(?<![\w>])([+\-]?\d[\d.,]*\s?(?:%|K|M|bln|bn|mln|bps|pts)?)/g, '<strong>$1</strong>')
    // Verdicts clés
    .replace(/\b(beat|beats|miss|misses|above|below|in-line|in line|stronger|weaker|slowdown|acceleration|rebound|contraction|expansion|highest|lowest|record)\b/gi, '<strong>$1</strong>');
}

// ── Génère un résumé contextuel à partir des chiffres d'une donnée macro ─────
// "PMI Final (May) 55.1 vs. Exp. 55.3 (Prev. 54.5)" → puces beat/miss + tendance
function _dataReleaseBullets(item) {
  const h = item.headline || '';

  // Extraire actual / forecast / previous
  const fNum = s => { const m = s && s.match(/-?[\d][\d.,]*/); return m ? parseFloat(m[0].replace(/,/g,'')) : null; };
  const expM  = h.match(/(?:exp\.?|expected|forecast|cons\.?|consensus)[:\s]*(-?[\d.,]+)/i);
  const prevM = h.match(/(?:prev\.?|previous|prior)[:\s]*(-?[\d.,]+)/i);
  // actual = "Actual X" sinon premier nombre avant "vs"/"("
  let actM = h.match(/actual[:\s]*(-?[\d.,]+)/i);
  if (!actM) actM = h.match(/(-?[\d][\d.,]*)\s*(?:vs\.?|\()/i);
  if (!actM) actM = h.match(/\)\s*(-?[\d][\d.,]*)/);  // "(May) 55.1"

  const actual   = actM  ? fNum(actM[1])  : null;
  const forecast = expM  ? fNum(expM[1])  : null;
  const previous = prevM ? fNum(prevM[1]) : null;
  if (actual === null) return [];

  // Nom de l'indicateur (avant les chiffres)
  const nameM = h.match(/^([A-Za-z&.\s/()]+?)(?=\s*-?\d|\s+actual|\s+\()/i);
  const name  = (nameM ? nameM[1] : 'L\'indicateur').replace(/\s+/g,' ').trim();

  const bullets = [];

  // 1) Actual vs Forecast
  if (forecast !== null) {
    const diff = +(actual - forecast).toFixed(2);
    if (diff > 0)      bullets.push(`Sort à <strong>${actual}</strong> vs <strong>${forecast}</strong> attendu — <strong>au-dessus</strong> du consensus (+${diff}).`);
    else if (diff < 0) bullets.push(`Sort à <strong>${actual}</strong> vs <strong>${forecast}</strong> attendu — <strong>sous</strong> le consensus (${diff}).`);
    else               bullets.push(`Sort à <strong>${actual}</strong>, <strong>conforme</strong> aux attentes.`);
  } else {
    bullets.push(`Donnée publiée à <strong>${actual}</strong>.`);
  }

  // 2) Actual vs Previous (tendance)
  if (previous !== null && previous !== actual) {
    const up = actual > previous;
    bullets.push(`${up ? '<strong>Accélération</strong>' : '<strong>Ralentissement</strong>'} vs le précédent (<strong>${previous}</strong>).`);
  }

  // 3) Lecture trader contextuelle
  const isPMI = /\bpmi\b/i.test(h);
  const isCPI = /\bcpi\b|inflation|prices?\b/i.test(h);
  if (forecast !== null) {
    const beat = actual > forecast;
    if (isPMI)      bullets.push(beat ? `Signal d'activité manufacturière <strong>plus robuste</strong> qu'anticipé.` : `Signal d'un <strong>essoufflement</strong> de l'activité.`);
    else if (isCPI) bullets.push(beat ? `Pressions inflationnistes <strong>plus fortes</strong> → biais <strong>hawkish</strong>.` : `Inflation <strong>plus faible</strong> → biais <strong>dovish</strong>.`);
  }

  return bullets.slice(0, 4);
}

function buildNewsItem(item) {
  const el = document.createElement('div');
  const isUrgent   = item.urgent === true || item.isUrgent === true;
  const isPrimer   = isPrimerItem(item);
  const isSpeaker  = isSpeakerOpener(item);
  const hasGrouped = Array.isArray(item._groupedQuotes) && item._groupedQuotes.length > 0;
  const speakerKey = (isSpeaker || hasGrouped) ? getSpeakerKey(item.headline) : null;
  // ── ROUGE VIF : deux cas seulement, sinon fond sombre par défaut ─────────────
  // A) Breaking : news FinancialJuice marquée urgente par FJ (flag brut item.urgent)
  // B) Data macro High Impact : donnée tier-1 réelle (PMI/CPI/NFP…) ou impact='high'
  const isFJ            = item.source === 'FinancialJuice' || (item.id || '').startsWith('fj-');
  const isFJUrgent      = isFJ && item.urgent === true;                          // Option A
  const impactStr       = String(item.impact || item.importance || '').toLowerCase();
  const isHighImpactData = item._highImpact === true || impactStr === 'high' || impactStr === 'critical'; // Option B
  // C) Toute news prioritaire (rond rouge "!") → même fond/hover rouge léger
  const isRed           = isFJUrgent || isHighImpactData || item.priority === 'high';
  // State Highlight : une news urgente (urgent/isUrgent) OU rouge → fond bordeaux ultra-sombre + icône "!"
  const isAlert         = isRed || isUrgent;
  const baseClass       = isRed ? ' news-item--breaking' : '';
  el.className = `news-item${baseClass}${isUrgent ? ' news-item--urgent' : ''}${isPrimer ? ' news-item--primer' : ''}${(isSpeaker || hasGrouped) ? ' news-item--speaker' : ''}${item._new ? ' news-item--new' : ''}${isRead(item.id) ? ' news-item--read' : ''}`;
  el.dataset.id = item.id;

  // ── Icon col ──
  const iconCol = document.createElement('div');
  iconCol.className = 'news-icon-col';
  if (isAlert) {
    const badge = document.createElement('div');
    badge.className = 'news-alert-icon';
    badge.innerHTML = '<svg width="12" height="12" viewBox="0 0 11 11" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.5 3.5V5.5M5.5 7.5H5.505M10.5 5.5C10.5 8.26142 8.26142 10.5 5.5 10.5C2.73858 10.5 0.5 8.26142 0.5 5.5C0.5 2.73858 2.73858 0.5 5.5 0.5C8.26142 0.5 10.5 2.73858 10.5 5.5Z" stroke="#FB0000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    iconCol.appendChild(badge);
  }
  el.appendChild(iconCol);

  // ── Time col ──
  const timeEl = document.createElement('div');
  timeEl.className = 'news-time';
  timeEl.textContent = item.time;
  el.appendChild(timeEl);

  // ── Category col ──
  const catText = document.createElement('div');
  catText.className = 'news-category-text';
  catText.textContent = item.category;
  el.appendChild(catText);

  // ── Content col ──
  const content = document.createElement('div');
  content.className = 'news-content';

  // Pre-compute
  const rawDesc   = (item.description || '').replace(/<[^>]*>/g, '').trim();
  // Tag « Analyse » : affiché UNIQUEMENT si une vraie analyse IA a été PRÉ-CALCULÉE côté serveur
  // et attachée à la news (item.analyse). Sinon → juste Info (système intelligent : pas d'analyse
  // si la news ne le mérite pas / si le budget IA ne l'a pas produite). Plus de clic, plus de
  // « Analyse en cours… », plus de bouton qui disparaît.
  const hasNotes  = !item._marketUpdate && Array.isArray(item.analyse) && item.analyse.length > 0;
  // For speaker openers: only show ⓘ Info if there's actual content (desc bullets OR existing quotes)
  const speakerQuotesAtRender = isSpeaker ? getSpeakerQuotes(speakerKey, item.timestamp) : [];
  // hasArticleUrl: used only inside openPanel to fetch deeper content when description is short
  const hasArticleUrl = !!(item.url && item.url.startsWith('https://'));
  // Résumé auto pour données High Impact sans corps de texte (PMI/CPI/NFP…)
  const autoSummary = isHighImpactData ? _dataReleaseBullets(item) : [];
  // Info tag shown ONLY when we already have real content to display
  const hasInfo   = rawDesc.length > 30
    || hasGrouped
    || autoSummary.length > 0
    || (isSpeaker && (rawDesc.length > 10 || speakerQuotesAtRender.length > 0));

  const headline = document.createElement('div');
  headline.className = 'news-headline';

  if (isPrimer) {
    // On retire UNIQUEMENT le préfixe "PRIMER —" (sans casser "DTP Daily Asia-Pac …")
    const titleText = (item.headline || '')
      .replace(/^\s*(?:PRIMER|PREVIEW|RESEARCH|INSIGHT|ANALYSIS|TALKING POINTS?)\s*[-:—]\s*/i, '')
      .trim();
    // Rapports DTP (briefings) → présentés comme des news, SANS badge PRIMER/ANALYST.
    // Les autres primers (institution/calendrier) gardent leur badge.
    const isReport = item._briefing || item.source === 'PMT';
    if (!isReport) {
      const badge = document.createElement('span');
      badge.className = 'primer-badge';
      badge.textContent = primerBadgeLabel(item);
      headline.appendChild(badge);
    }
    const titleSpan = document.createElement('span');
    titleSpan.textContent = _dtpTitle(titleText);
    headline.appendChild(titleSpan);
  } else {
    headline.textContent = item.headline;
  }
  content.appendChild(headline);

  el.appendChild(content);

  // Shared expand panel
  let expandEl      = null;
  let activeTab     = null;
  let infoTagEl     = null;
  let analysisTagEl = null;
  let reactionTagEl = null;
  let arrowEl       = null;  // chevron ∨ / ^ indicator

  if (hasNotes || hasInfo) {
    expandEl = document.createElement('div');
    expandEl.className = 'news-description';
    content.appendChild(expandEl);
  }

  // Arrow column — sits between category col and content col
  arrowEl = document.createElement('div');
  arrowEl.className = 'news-arrow-col';
  if (expandEl) {
    arrowEl.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    const _togglePanel = e => { e.stopPropagation(); openPanel(hasInfo ? 'info' : hasNotes ? 'analysis' : 'reaction'); };
    arrowEl.onclick = _togglePanel;
    // Clic sur le TITRE de la news → déroule aussi (description / analyse / réaction)
    headline.classList.add('news-headline--clickable');
    headline.onclick = _togglePanel;
  }
  el.insertBefore(arrowEl, content);

  function openPanel(tab) {
    if (!expandEl) return;
    const isOpen    = expandEl.classList.contains('visible');
    const isSameTab = activeTab === tab;

    if (isOpen && isSameTab) {
      expandEl.classList.remove('visible');
      activeTab = null;
      if (item && item.id != null) delete _openNewsPanels[item.id];   // fermé par l'utilisateur → on n'y revient plus
      [infoTagEl, analysisTagEl, reactionTagEl].forEach(t => t && t.classList.remove('tag--active'));
      if (arrowEl) arrowEl.classList.remove('news-arrow-col--open');
      return;
    }

    if (arrowEl) arrowEl.classList.add('news-arrow-col--open');
    activeTab = tab;
    if (item && item.id != null) _openNewsPanels[item.id] = tab;       // ouvert par l'utilisateur → reste ouvert (persiste)
    // État actif des pills (Info/Analyse/Réaction) — un seul actif à la fois
    [infoTagEl, analysisTagEl, reactionTagEl].forEach(t => t && t.classList.remove('tag--active'));
    const _activePill = tab === 'info' ? infoTagEl : tab === 'analysis' ? analysisTagEl : reactionTagEl;
    if (_activePill) _activePill.classList.add('tag--active');
    const nowTime = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    const tabsHtml = [
      hasInfo   && `<button class="expand-tab${tab === 'info'     ? ' expand-tab--active' : ''}" data-tab="info"><span class="tag-icon">ⓘ</span> Info</button>`,
      hasNotes  && `<button class="expand-tab${tab === 'analysis' ? ' expand-tab--active' : ''}" data-tab="analysis"><span class="tag-icon">⊙</span> Analyse</button>`,
    ].filter(Boolean).join('');

    const infoBody = (() => {
      // ── [MARKET UPDATE] (Convera) : rapport COMPLET avec images, affiché directement ──
      if (item._marketUpdate && item.fullContent) {
        return `<div class="market-update-body">${item.fullContent}</div>`;
      }
      // ── PRIMER: structured bullet display ──
      if (isPrimer) {
        const bullets = parsePrimerBullets(item.description);
        const highlight = t => t
          .replace(/\b(Fed'?s?|ECB'?s?|BoJ'?s?|BoE'?s?|BoC'?s?|RBA'?s?|SNB'?s?|RBNZ'?s?)\s+([A-Z][a-z]+)/g,
            '<span class="primer-speaker-src">$1</span> <strong class="primer-speaker-name">$2</strong>')
          .replace(/\((\d{4}\s+voter)\)/g, '<span class="primer-voter">($1)</span>');
        const bulletsHtml = bullets.map((line, idx) => {
          const isSub    = /^↳/.test(line);
          const isHeader = idx === 0;
          const clean    = isSub ? line.replace(/^↳\s*/, '') : line;
          if (isHeader) return `<li class="primer-bullet primer-bullet--header">${highlight(_dtpTitle(clean))}</li>`;
          // Rubrique en MAJUSCULES (LOOKING AHEAD, IRAN CONFLICT, FX, COMMODITIES…) → titre orange
          if (!isSub && _isSectionHead(clean)) return `<li class="rpt-section-head">${clean}</li>`;
          // "Label: content"
          const secMatch = !isSub && clean.match(/^([A-Za-z\s&/]{2,28}):\s+(.+)$/);
          if (isSub)    return `<li class="primer-bullet primer-bullet--sub"><span class="primer-sub-arrow">↳</span> ${highlight(_reportLead(clean))}</li>`;
          if (secMatch) return `<li class="primer-bullet primer-bullet--section"><span class="primer-section-lbl">${secMatch[1]}</span><span class="primer-section-val">${highlight(_reportLead(secMatch[2]))}</span></li>`;
          return `<li class="primer-bullet">${highlight(_reportLead(clean))}</li>`;
        }).join('');
        return `<div class="expand-ts primer-ts">
          <span class="primer-ts-label">DTP</span>
          <span>Source: ${item.source || 'N/A'}</span>
        </div>
        <ul class="primer-bullets">${bulletsHtml}</ul>
        <div class="report-snapshot" id="rsnap-${item.id}"></div>`;
      }

      // ── GROUPED QUOTES: multiple quotes from same speaker collapsed into one card ──
      if (hasGrouped) {
        const allGrouped = [item, ...item._groupedQuotes].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        const quotesHtml = allGrouped.map(q => {
          const text = stripSpeakerPrefix(q.headline);
          return `<li>${text}</li>`;
        }).join('');
        return `<ul class="article-points">${quotesHtml}</ul>`;
      }

      // ── SPEAKER OPENER: live quote aggregation ──
      if (isSpeaker) {
        const quotes = getSpeakerQuotes(speakerKey, item.timestamp);

        // Description bullets
        let descLines = rawDesc.length > 10
          ? rawDesc.split(/\n|\r\n/).map(l => l.trim()).filter(Boolean)
          : [];
        const descHtml = descLines.length
          ? `<ul class="article-points">${descLines.map(l => `<li>${l.replace(/^[-•*]\s/, '')}</li>`).join('')}</ul>`
          : '';

        // Quotes as bullets
        const quotesHtml = quotes.map(q => {
          const text = stripSpeakerPrefix(q.headline);
          return `<li>${text}</li>`;
        }).join('');
        const quotesListHtml = quotes.length ? `<ul class="article-points">${quotesHtml}</ul>` : '';

        return `${descHtml}${quotesListHtml}`;
      }

      // ── Standard info → résumé COURT et propre (sans gras), 2-4 puces selon la longueur ──
      const _max = rawDesc.length > 400 ? 4 : 3;
      let bullets = _toBullets(rawDesc, _max);
      // Fallback : donnée macro High Impact sans corps → résumé contextuel auto
      if (bullets.length === 0 && autoSummary.length > 0) bullets = autoSummary;
      if (bullets.length === 0) return '';
      return _renderInfoBullets(bullets);
    })();

    if (tab === 'reaction') {
      const nowTime = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      expandEl.innerHTML = dtpLoader('Chargement des données de marché…', { small: true });
      expandEl.classList.add('visible');
      if (reactionTagEl) reactionTagEl.classList.add('tag--active');
      if (analysisTagEl) analysisTagEl.classList.remove('tag--active');

      fetch(`/api/market-moves?since=${item.timestamp}`)
        .then(r => r.json())
        .then(data => {
          if (activeTab !== 'reaction') return;
          if (!data.moves || data.moves.length === 0) {
            // No real moves — remove the Réaction tag entirely and fall back to Info
            if (reactionTagEl) { reactionTagEl.remove(); reactionTagEl = null; }
            activeTab = null;
            if (hasInfo) {
              openPanel('info');  // switch to Info panel
            } else {
              expandEl.classList.remove('visible');
              if (arrowEl) arrowEl.classList.remove('news-arrow-col--open');
            }
            return;
          } else {
            // Ticker minimaliste : un chip par actif, ▲/▼ colorés discrets
            const tickerHtml = data.moves.map(m => {
              const up    = m.dir === 'up';
              const cls   = up ? 'rx-up' : 'rx-dn';
              const arrow = up ? '▲' : '▼';
              return `<span class="rx-ticker ${cls}">`
                + `<span class="rx-name">${m.label}</span>`
                + `<span class="rx-arrow">${arrow}</span>`
                + `<span class="rx-val">${m.move}${m.unit ? ' ' + m.unit : ''}</span>`
                + `<span class="rx-pct">${m.movePct}</span>`
                + `<span class="rx-time">${m.minutes}m</span>`
                + `</span>`;
            }).join('');
            expandEl.innerHTML =
              `<div class="rx-block${isRed ? ' rx-block--alert' : ''}">`
              + `<div class="rx-head">Réaction à : ${nowTime}</div>`
              + `<div class="rx-tickers">${tickerHtml}</div>`
              + `<div class="rx-explain" id="rx-explain-${item.id}"></div>`
              + `</div>`;

            // Explication Gemini du mouvement (mise en cache → 0 requête à la réouverture)
            const movesStr = data.moves.map(m => `${m.label} ${m.dir === 'up' ? '+' : '-'}${m.movePct}`).join(', ');
            const _applyExplain = txt => {
              if (!txt) return;
              const el = document.getElementById(`rx-explain-${item.id}`);
              if (el && activeTab === 'reaction') el.textContent = txt;
            };
            if (_reactCache.has(item.id)) {
              _applyExplain(_reactCache.get(item.id));
            } else {
              fetch('/api/reaction-explain', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: item.id, headline: item.headline, moves: movesStr }),
              })
                .then(r => r.json())
                .then(d => { const t = (d && d.text) || ''; _reactCache.set(item.id, t); _applyExplain(t); })
                .catch(() => {});
            }
          }
        })
        .catch(() => {
          if (activeTab !== 'reaction') return;
          // API error → same fallback as "no moves": remove tag, switch to Info
          if (reactionTagEl) { reactionTagEl.remove(); reactionTagEl = null; }
          activeTab = null;
          if (hasInfo) {
            openPanel('info');
          } else {
            expandEl.classList.remove('visible');
            if (arrowEl) arrowEl.classList.remove('news-arrow-col--open');
          }
        });
      return;
    }

    if (tab === 'analysis') {
      // Analyse PRÉ-CALCULÉE côté serveur, attachée à la news → affichage instantané, aucun fetch.
      expandEl.innerHTML = _renderInfoBullets(item.analyse || []);
      expandEl.classList.add('visible');
      if (analysisTagEl) analysisTagEl.classList.add('tag--active');
      if (reactionTagEl) reactionTagEl.classList.remove('tag--active');
      return;
    }

    // Info tab — if no inline description but has a ForexFactory article URL, fetch real content
    if (tab === 'info' && rawDesc.length <= 30 && hasArticleUrl) {
      expandEl.innerHTML = dtpLoader('Chargement de l’article…', { small: true });
      expandEl.classList.add('visible');
      if (analysisTagEl) analysisTagEl.classList.remove('tag--active');
      if (reactionTagEl) reactionTagEl.classList.remove('tag--active');
      fetch(`/api/article?url=${encodeURIComponent(item.url)}&headline=${encodeURIComponent(item.headline || '')}`)
        .then(r => r.json())
        .then(data => {
          if (activeTab !== 'info') return;
          if (data.points && data.points.length > 0) {
            expandEl.innerHTML = `<ul class="article-points">${data.points.map(p => `<li>${p}</li>`).join('')}</ul>`;
          } else {
            // API confirmed no content → remove Info tag entirely
            if (infoTagEl) { infoTagEl.remove(); infoTagEl = null; }
            activeTab = null;
            expandEl.classList.remove('visible');
            if (arrowEl) arrowEl.classList.remove('news-arrow-col--open');
          }
        })
        .catch(() => {
          if (activeTab !== 'info') return;
          // Network error — close panel silently, keep the tag
          activeTab = null;
          expandEl.classList.remove('visible');
          if (arrowEl) arrowEl.classList.remove('news-arrow-col--open');
        });
      return;
    }

    // Affichage immédiat (description brute) — instantané
    expandEl.innerHTML = infoBody;
    expandEl.classList.add('visible');
    if (analysisTagEl) analysisTagEl.classList.remove('tag--active');
    if (reactionTagEl) reactionTagEl.classList.remove('tag--active');

    // Rapports DTP (opening news / snapshot) → on insère la table SNAPSHOT (prix réels)
    if (isPrimer && /opening|snapshot|daily|wrap|recap|prep/i.test(item.headline || '')) {
      const slot = document.getElementById(`rsnap-${item.id}`);
      if (slot) {
        if (_snapCache) { slot.innerHTML = _renderSnapshot(_snapCache); }
        fetch('/api/market-snapshot').then(r => r.json()).then(d => {
          _snapCache = d;
          const s = document.getElementById(`rsnap-${item.id}`);
          if (s && activeTab === 'info') s.innerHTML = _renderSnapshot(d);
        }).catch(() => {});
      }
    }

    // Amélioration Gemini (style PMT), mise en cache → aucune requête aux ouvertures suivantes
    const _improvable = !isPrimer && !hasGrouped && !isSpeaker && rawDesc.length >= 30;
    if (_improvable) {
      if (_infoCache.has(item.id)) {
        const b = _infoCache.get(item.id);
        if (b && b.length) expandEl.innerHTML = _renderInfoBullets(b);
      } else {
        fetch('/api/news-info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id, headline: item.headline, category: item.category, description: item.description, important: !!(isRed || item.priority === 'high' || item.urgent) }),
        })
          .then(r => r.json())
          .then(data => {
            const b = data.bullets || [];
            _infoCache.set(item.id, b);   // on mémorise même un résultat vide (évite de redemander)
            if (b.length && activeTab === 'info' && expandEl.classList.contains('visible')) {
              expandEl.innerHTML = _renderInfoBullets(b);
            }
          })
          .catch(() => {});
      }
    }
  }

  // Tags row
  const tagsEl = document.createElement('div');
  tagsEl.className = 'news-tags';

  const smartTags = getSmartTags(item);
  const _hl = (item.headline || '').toLowerCase();
  const _ratesGuard = /\b(rate decision|rate hike|rate cut|interest rate|policy rate|overnight rate|benchmark rate|basis point|bps|inflation rate|cpi|pce|ppi|hicp)\b/i;
  const shownTags = new Set();
  const _HIDDEN_TAGS = new Set(['China', 'Japan']);   // tags supprimés à l'affichage
  for (const tag of (item.tags || [])) {
    if (tag === 'High' || tag === 'Medium' || tag === item.category) continue;
    if (_HIDDEN_TAGS.has(tag)) continue;
    if (tag === 'Rates' && !_ratesGuard.test(_hl)) continue;
    if (shownTags.has(tag)) continue;
    shownTags.add(tag);
    const t = document.createElement('span');
    t.className = 'tag ' + (TAG_CLASS[tag] || 'tag--default');
    t.dataset.cat = tag;
    t.textContent = tag;
    tagsEl.appendChild(t);
  }
  for (const tag of smartTags) {
    if (shownTags.has(tag)) continue;
    shownTags.add(tag);
    const t = document.createElement('span');
    t.className = 'tag ' + (TAG_CLASS[tag] || 'tag--default');
    t.dataset.cat = tag;
    t.textContent = tag;
    tagsEl.appendChild(t);
  }

  // ── Badge Rumour : info non confirmée / bruit de marché ──────────────────────
  // Détection par texte (Unconfirmed/Rumour/Chatter/Speculation…) ou flag API FJ/FF
  const _isRumour = /\b(unconfirmed|unverified|rumou?r|chatter|speculation|speculative|reportedly|allegedly)\b/i.test(item.headline || '')
    || item.type === 'rumour' || item.isRumour === true || item.has_rumour === true;
  if (_isRumour && !shownTags.has('Rumour')) {
    shownTags.add('Rumour');
    const r = document.createElement('span');
    r.className = 'tag tag--rumour';
    r.textContent = 'Rumour';
    tagsEl.appendChild(r);
  }

  if (hasInfo) {
    infoTagEl = document.createElement('span');
    infoTagEl.className = 'tag tag--info';
    infoTagEl.style.cursor = 'pointer';
    // Grouped speaker cards → "Infos" badge with count; openers → "Info"; others → "Info"
    infoTagEl.innerHTML = '<svg class="tag-svg" width="11" height="11" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5.25" stroke="currentColor" stroke-width="1.5"/><path d="M6 5.5V8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="6" cy="3.5" r="0.75" fill="currentColor"/></svg> Info';
    infoTagEl.onclick = e => { e.stopPropagation(); openPanel('info'); };
    tagsEl.appendChild(infoTagEl);
  }

  if (hasNotes) {
    analysisTagEl = document.createElement('span');
    analysisTagEl.className = 'tag tag--analyse';
    analysisTagEl.style.cursor = 'pointer';
    analysisTagEl.innerHTML = '<svg class="tag-svg" width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M5.75 0.75C6.40661 0.75 7.05679 0.879329 7.66342 1.1306C8.27005 1.38188 8.82124 1.75017 9.28553 2.21447C9.74983 2.67876 10.1181 3.22996 10.3694 3.83659C10.6207 4.44321 10.75 5.09339 10.75 5.75M5.75 0.75V5.75M5.75 0.75C2.98858 0.75 0.75 2.98858 0.75 5.75C0.75 8.51142 2.98858 10.75 5.75 10.75C8.51142 10.75 10.75 8.51143 10.75 5.75M5.75 0.75C8.51142 0.75 10.75 2.98858 10.75 5.75M10.75 5.75L5.75 5.75M10.75 5.75C10.75 6.53906 10.5633 7.3169 10.205 8.01995C9.84681 8.723 9.32728 9.33129 8.68893 9.79508L5.75 5.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Analyse';
    analysisTagEl.onclick = e => { e.stopPropagation(); openPanel('analysis'); };
    tagsEl.appendChild(analysisTagEl);
  }

  // Insert tags BETWEEN headline and expand panel so the order is:
  // headline → tags → [expand panel when open]
  content.insertBefore(tagsEl, expandEl);

  // Plus AUCUNE ouverture automatique : une description ne s'ouvre QUE si l'utilisateur l'a ouverte.
  // On restaure simplement l'onglet qu'il avait ouvert (persiste entre re-renders / arrivées de news).
  if (expandEl && item && _openNewsPanels[item.id]) {
    const _t  = _openNewsPanels[item.id];
    const _ok = (_t === 'info' && hasInfo) || (_t === 'analysis' && hasNotes) || (_t === 'reaction' && reactionTagEl);
    if (_ok) requestAnimationFrame(() => openPanel(_t));
    else delete _openNewsPanels[item.id];                    // l'onglet n'existe plus → on nettoie
  }

  // ── Background reaction check ──
  // Only for items that are:
  //   1. Within the 5-day YF 1m data window
  //   2. Genuinely market-moving categories / high priority
  // This avoids spamming the API with routine data or speaker items.
  const _REACTION_CATS = /^(Geopolitical|Energy & Power|Metals|Trade|Fed|ECB|BoJ|BoE|BoC|RBA|SNB|RBNZ|Fixed Income|FX Flows|Market Analysis)$/;
  const _REACTION_KW   = /iran|opec|oil|ukraine|russia|israel|nato|ceasefire|nuclear|sanction|tariff|rate (decision|hike|cut)|emergency|breaking|war|conflict|attack|strike/i;
  const _isMarketMoving = item.priority === 'high' || item.urgent
    || _REACTION_CATS.test(item.category)
    || _REACTION_KW.test(item.headline);

  if (item.timestamp && Date.now() - item.timestamp < REACTION_AGE_LIMIT && _isMarketMoving) {
    _queueReactionCheck(() =>
      fetch(`/api/market-moves?since=${item.timestamp}`)
        .then(r => r.json())
        .then(data => {
          if (!data.moves || data.moves.length === 0) return;
          if (reactionTagEl) return; // already present
          // Create expandEl dynamically if the item had no info/notes
          if (!expandEl) {
            expandEl = document.createElement('div');
            expandEl.className = 'news-description';
            content.appendChild(expandEl);
            arrowEl.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
            arrowEl.onclick = e => { e.stopPropagation(); openPanel('reaction'); };
          }
          reactionTagEl = document.createElement('span');
          reactionTagEl.className = 'tag tag--reaction';
          reactionTagEl.style.cursor = 'pointer';
          reactionTagEl.innerHTML = '<span class="tag-icon">↗</span> Réaction';
          reactionTagEl.onclick = e => { e.stopPropagation(); openPanel('reaction'); };
          tagsEl.appendChild(reactionTagEl);
        })
        .catch(() => {})
    );
  }

  return el;
}

function formatDate(ts) {
  // timeZone Paris explicite : les en-têtes de jour collent à l'heure de Paris affichée
  // (item.time), même si le navigateur est dans un autre fuseau → plus de décalage de date.
  return new Date(ts).toLocaleDateString('en-GB', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris',
  });
}

// ═══ World Clocks ═════════════════════════
// Petite icône "vent" monochrome (placée devant la vitesse du vent)
const CLOCK_WIND_ICON = '<svg class="clock-wind-ic" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h9a2.5 2.5 0 1 0-2.5-2.5"/><path d="M3 12h13a2.5 2.5 0 1 1-2.5 2.5"/><path d="M3 16h7"/></svg>';
let _weatherLastFetch = 0;
function refreshWeather() {
  _weatherLastFetch = Date.now();
  return fetchAllWeather().then(() => renderClocks());
}
function startClocks() {
  renderClocks();            // affichage immédiat (météo à '--' tant que non chargée)
  refreshWeather();          // 1er fetch
  setInterval(renderClocks, 1000);
  setInterval(refreshWeather, 10 * 60 * 1000);   // météo temps réel : toutes les 10 min
  // Re-fetch dès qu'on revient sur l'onglet (si > 5 min depuis le dernier appel)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - _weatherLastFetch > 5 * 60 * 1000) refreshWeather();
  });
  window.addEventListener('focus', () => {
    if (Date.now() - _weatherLastFetch > 5 * 60 * 1000) refreshWeather();
  });
}

function renderClocks() {
  const bar = document.getElementById('clocks-bar');
  if (!bar) return;
  const now = new Date();

  // Build "My Timezone" entry using the browser's local timezone
  const myTz   = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const myCity = myTz.split('/').pop().replace('_', ' ');
  const allClocks = CLOCKS;

  const html = allClocks.map(c => {
    const timeStr  = now.toLocaleTimeString('en-GB', {
      timeZone: c.tz, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const isOpen   = c._local ? true : isMarketOpen(c.tz, now);
    const offset   = getUTCOffset(c.tz);
    const localNow = new Date(now.toLocaleString('en-US', { timeZone: c.tz }));
    const month    = String(localNow.getMonth() + 1).padStart(2, '0');
    const day      = String(localNow.getDate()).padStart(2, '0');
    const wday     = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][localNow.getDay()];
    const hr       = localNow.getHours();
    const isDay    = hr >= 6 && hr < 20;
    const wx       = _weatherCache[c.city] || { temp: '--', wind: '--', windDir: 0, icon: '☁' };
    const arrow    = wx.wind !== '--' ? windArrow(wx.windDir) : '';
    const dayNightIcon = isDay ? '<span class="clock-sun">☀︎</span>' : '<span class="clock-moon">☾</span>';
    const label    = c._local ? 'My Timezone' : `${c.city} (${c.code})`;
    const tempStr = wx.temp !== '--' ? `${wx.temp}°C` : '--';
    const windStr = wx.wind !== '--' ? `${wx.wind} km/h ${arrow}` : '--';
    return `
      <div class="clock-item${c._local ? ' clock-item--local' : ''}${isOpen ? ' clock-item--open' : ''}">
        <div class="clock-top-row">
          <span class="clock-wday">${wday}</span>
          <span class="clock-date">${month}/${day}</span>
        </div>
        <div class="clock-time">${timeStr}</div>
        <div class="clock-mid-row">
          <span class="clock-gmt">GMT ${offset}</span>
          <span class="clock-city-label clock-city-label--${isOpen ? 'open' : 'closed'}">${label}</span>
        </div>
        <div class="clock-sub-row">
          <span class="clock-country-row">${c.country || ''}</span>
          <span class="clock-wx-row">${wx.icon} ${tempStr}</span>
        </div>
        <div class="clock-sub-row">
          <span class="clock-daynight-lbl">${dayNightIcon} ${isDay ? 'Day' : 'Night'}</span>
          <span class="clock-wind-row">${wx.wind !== '--' ? CLOCK_WIND_ICON + ' ' : ''}${windStr}</span>
        </div>
      </div>`;
  }).join('');
  bar.innerHTML = html;
}

function isMarketOpen(tz, now) {
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const h = local.getHours(), day = local.getDay();
  return day !== 0 && day !== 6 && h >= 8 && h < 18;
}

function getUTCOffset(tz) {
  const local = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
  const utc   = new Date(new Date().toLocaleString('en-US', { timeZone: 'UTC' }));
  const h = Math.round((local - utc) / 3600000);
  return h >= 0 ? `+${String(h).padStart(2,'0')}:00` : `-${String(Math.abs(h)).padStart(2,'0')}:00`;
}

// ═══ World Map (SVG legacy — hidden by CSS, kept for session overlays) ════════
function drawWorldMap() {
  const svg = document.getElementById('world-svg');
  if (!svg) return;
  svg.innerHTML = `<defs><style>.land{fill:#182418;stroke:#263426;stroke-width:0.6}.ocean{fill:#080c08}</style></defs><rect class="ocean" width="900" height="450"/><g id="session-overlays"></g>`;
  drawSessionOverlays();
}

const SESSION_BANDS = [
  { name: 'Sydney',   tz: 'Australia/Sydney',  open: 9,  close: 17, x1: 80, x2: 92, color: '#1a4a1a' },
  { name: 'Tokyo',    tz: 'Asia/Tokyo',        open: 9,  close: 15, x1: 74, x2: 88, color: '#1a3a4a' },
  { name: 'London',   tz: 'Europe/London',     open: 8,  close: 17, x1: 44, x2: 56, color: '#2a3a1a' },
  { name: 'New York', tz: 'America/New_York',  open: 9,  close: 17, x1: 18, x2: 32, color: '#3a2a1a' },
];

function drawSessionOverlays() {
  const g = document.getElementById('session-overlays');
  if (!g) return;
  const now = new Date();
  g.innerHTML = SESSION_BANDS.map(s => {
    const local = new Date(now.toLocaleString('en-US', { timeZone: s.tz }));
    const h = local.getHours() + local.getMinutes() / 60;
    const isOpen = local.getDay() !== 0 && local.getDay() !== 6 && h >= s.open && h < s.close;
    if (!isOpen) return '';
    const x = s.x1 / 100 * 900, w = (s.x2 - s.x1) / 100 * 900;
    return `<rect opacity="0.18" x="${x}" y="0" width="${w}" height="450" fill="${s.color}" rx="2"/>`;
  }).join('');
}

function startSessionMarkers() {
  updateSessionLine();
  updateSessionMarkers();
  drawSessionOverlays();
  setInterval(() => {
    updateSessionLine();
    updateSessionMarkers();
    drawSessionOverlays();
  }, 10000);
}

function updateSessionLine() {
  const line = document.getElementById('session-line');
  if (!line) return;
  const now = new Date();
  line.style.left = `${((now.getUTCHours() + now.getUTCMinutes() / 60) / 24) * 100}%`;
}

function updateSessionMarkers() {
  const container = document.getElementById('session-markers');
  if (!container) return;
  const SESSIONS = [
    { name: 'London',   open: 8,  close: 17, tz: 'Europe/London',    x: 47.5, y: 28 },
    { name: 'New York', open: 9,  close: 17, tz: 'America/New_York', x: 22,   y: 33 },
    { name: 'Tokyo',    open: 9,  close: 15, tz: 'Asia/Tokyo',       x: 78,   y: 30 },
    { name: 'Sydney',   open: 9,  close: 17, tz: 'Australia/Sydney', x: 83,   y: 72 },
  ];
  const now = new Date();
  container.innerHTML = SESSIONS.map(s => {
    const local = new Date(now.toLocaleString('en-US', { timeZone: s.tz }));
    const h = local.getHours() + local.getMinutes() / 60;
    const isOpen = local.getDay() !== 0 && local.getDay() !== 6 && h >= s.open && h < s.close;
    const timeStr = local.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `<div class="session-marker${isOpen ? ' session-marker--active' : ''}" style="left:${s.x}%;top:${s.y}%;">${timeStr}<br><small>${s.name}</small></div>`;
  }).join('');
}

// ═══ Settings Panel ═══════════════════════
function buildSettingsPanel() {
  const body = document.getElementById('settings-body');
  if (!body) return;
  body.innerHTML = '';

  for (const [section, items] of Object.entries(SETTINGS_PANEL)) {
    const sectionEl = document.createElement('div');
    sectionEl.className = 'settings-section';

    const title = document.createElement('div');
    title.className = 'settings-section-title';
    title.textContent = section;
    sectionEl.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'settings-grid';

    for (const { label, cat } of items) {
      const row = document.createElement('div');
      row.className = 'settings-row';
      row.dataset.key = cat;

      const lbl = document.createElement('div');
      lbl.className = 'settings-row-label';
      lbl.textContent = label;

      const toggle = document.createElement('div');
      toggle.className = 'toggle-switch';
      toggle.dataset.cat   = cat;
      toggle.dataset.state = enabledCategories.has(cat) ? 'on' : 'off';
      toggle.innerHTML = '<div class="toggle-thumb"></div>';
      toggle.addEventListener('click', () => toggleCategory(cat));

      row.appendChild(lbl);
      row.appendChild(toggle);
      grid.appendChild(row);
    }

    sectionEl.appendChild(grid);
    body.appendChild(sectionEl);
  }
}

function toggleMaster(el) {
  const allOn = el.dataset.state === 'on';
  el.dataset.state = allOn ? 'off' : 'on';
  if (allOn) {
    enabledCategories.clear();
  } else {
    INTERNAL_CATS.forEach(c => enabledCategories.add(c));
  }
  syncSettingsUI();
  syncDropdownUI();
  saveSettings();
  renderNews();
}

function filterSettings(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('.settings-row').forEach(row => {
    const label = row.querySelector('.settings-row-label')?.textContent.toLowerCase() ?? '';
    row.style.display = !q || label.includes(q) ? '' : 'none';
  });
  document.querySelectorAll('.settings-section-title').forEach(title => {
    const section = title.nextElementSibling;
    const hasVisible = section && [...section.querySelectorAll('.settings-row')].some(r => r.style.display !== 'none');
    title.style.display = hasVisible ? '' : 'none';
  });
}

function saveSettings() {
  localStorage.setItem('pt_enabled', JSON.stringify([...enabledCategories]));
}

function loadSettings() {
  try {
    const saved = localStorage.getItem('pt_enabled');
    if (saved) {
      const parsed = JSON.parse(saved);
      const parsedSet = new Set(parsed);
      const valid = parsed.filter(c => INTERNAL_CATS.includes(c));
      // If no regional data categories are in saved settings, they're newly added → default ON
      const regionalCats = INTERNAL_CATS.filter(c => c.endsWith(' Data'));
      if (!regionalCats.some(c => parsedSet.has(c))) {
        regionalCats.forEach(c => valid.push(c));
      }
      enabledCategories = valid.length > 0 ? new Set(valid) : new Set(INTERNAL_CATS);
    }
  } catch {
    enabledCategories = new Set(INTERNAL_CATS);
  }
}

// ═══ Section Dropdown ═════════════════════
function buildSectionDropdown() {
  const container = document.getElementById('section-checkboxes');
  if (!container) return;
  container.innerHTML = INTERNAL_CATS.map(cat => `
    <div class="dropdown-item${enabledCategories.has(cat) ? ' active' : ''}" data-cat="${cat}" onclick="toggleDropdownItem(this)">
      <span class="dropdown-item-label">${cat}</span>
      <span class="dropdown-check">✓</span>
    </div>`).join('');
}

function toggleDropdownItem(el) {
  const cat = el.dataset.cat;
  el.classList.toggle('active');
  if (enabledCategories.has(cat)) {
    enabledCategories.delete(cat);
  } else {
    enabledCategories.add(cat);
  }
  saveSettings();
  renderNews();
  syncSettingsUI();
}

function toggleSectionDropdown() {
  document.getElementById('section-dropdown').classList.toggle('hidden');
}

document.addEventListener('click', e => {
  const dd  = document.getElementById('section-dropdown');
  const btn = document.getElementById('section-filter-btn');
  if (!dd.classList.contains('hidden') && !dd.contains(e.target) && !btn.contains(e.target)) {
    dd.classList.add('hidden');
  }
});

// ═══ Settings overlay ═════════════════════
document.getElementById('settings-btn')?.addEventListener('click', () => {
  document.getElementById('settings-overlay').classList.remove('hidden');
});

function closeSettings(e) {
  if (!e || e.target === document.getElementById('settings-overlay')) {
    document.getElementById('settings-overlay').classList.add('hidden');
  }
}

// ═══ Status toast ═════════════════════════
let statusTimer = null;
function showStatus(msg, type) {
  if (type === 'ok') return;   // plus d'indicateur "Connected" (inutile) — on ne montre que les erreurs
  let el = document.querySelector('.connection-status');
  if (!el) {
    el = document.createElement('div');
    el.className = 'connection-status';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `connection-status visible connection-status--${type}`;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => el.classList.remove('visible'), 3000);
}

// ═══ Notif badge clear ════════════════════
notifBadge.parentElement.addEventListener('click', () => {
  newCount = 0;
  _setNotifBadge(0);
  allItems.forEach(i => delete i._new);
});

// ═══ Risk Sentiment Popup ════════════════
function _sentClass(label) {
  if (/risk-on/i.test(label))  return 'risk-on';
  if (/risk-off/i.test(label)) return 'risk-off';
  return 'neutral';
}

function _renderRiskGauge(data) {
  const score  = data.score || 0;
  const cls    = _sentClass(data.label);
  const LABEL_FR = {
    'STRONG RISK-ON':  'FORT APPÉTIT AU RISQUE',
    'RISK-ON':         'APPÉTIT AU RISQUE',
    'WEAK RISK-ON':    'FAIBLE APPÉTIT AU RISQUE',
    'NEUTRAL':         'NEUTRE',
    'WEAK RISK-OFF':   'LÉGÈRE AVERSION',
    'RISK-OFF':        'AVERSION AU RISQUE',
    'STRONG RISK-OFF': 'FORTE AVERSION AU RISQUE',
  };
  const frLabel = LABEL_FR[data.label] || data.label;

  // Needle: -90° = full risk-off, 0° = neutral, +90° = full risk-on
  const angle   = Math.max(-90, Math.min(90, score * 90));
  // pct = valeur canonique fournie par le serveur (source unique). Repli sur score×50.
  const gv      = (typeof data.pct === 'number') ? data.pct : Math.max(-100, Math.min(100, score * 50));
  const pctAbs  = Math.abs(gv).toFixed(1);
  const pctSign = gv >= 0 ? '' : '-';

  const gaugeWrap = document.getElementById('rp-gauge-wrap');
  if (!gaugeWrap) return;

  const needleEl   = document.getElementById('rp-needle');
  const gaugePctEl = document.getElementById('rp-gauge-pct');
  const gaugeLblEl = document.getElementById('rp-gauge-lbl');

  if (needleEl)   needleEl.setAttribute('transform', `rotate(${angle}, 100, 106)`);
  if (gaugePctEl) gaugePctEl.textContent = `${pctSign}${pctAbs}%`;
  if (gaugeLblEl) { gaugeLblEl.textContent = frLabel; gaugeLblEl.className = `rp-gauge-lbl rp-gauge-lbl--${cls}`; }
  gaugeWrap.className = `rp-gauge-wrap rp-gauge-wrap--${cls}`;
}

function _applyRiskTopbar(data) {
  const cls   = _sentClass(data.label);
  const arrow = cls === 'risk-on' ? '↗' : cls === 'risk-off' ? '↘' : '→';
  const short = cls === 'risk-on' ? 'RISK ON' : cls === 'risk-off' ? 'RISK OFF' : 'NEUTRAL';
  const dotEl = document.getElementById('sentiment-dot-top');
  const lblEl = document.getElementById('sentiment-label-top');
  const btnEl = document.getElementById('sentiment-btn');
  // Look "↘ RISK OFF ⌄" : flèche fine colorée + libellé COURT (pas la forme longue)
  if (dotEl) { dotEl.textContent = arrow; dotEl.className = 'sentiment-dir ' + cls; }
  if (lblEl) lblEl.textContent = short;
  if (btnEl) btnEl.className = 'topbar-sentiment ' + cls;
}

function _renderRiskPopup(data) {
  const cls   = _sentClass(data.label);
  const arrow = cls === 'risk-on' ? '↗' : cls === 'risk-off' ? '↘' : '→';
  const el = id => document.getElementById(id);
  const hdr = el('rp-header');
  if (hdr) hdr.className = 'risk-popup-header ' + cls;
  const lbl = el('rp-label');
  const ta = el('rp-title-arrow');
  if (ta) { ta.textContent = arrow; ta.className = 'rp-title-arrow ' + cls; }
  const ar = el('rp-arrow');
  if (ar) ar.textContent = arrow;
  const ti = el('rp-title');
  const LABEL_FR = {
    'STRONG RISK-ON':  'FORT APPÉTIT AU RISQUE',
    'RISK-ON':         'APPÉTIT AU RISQUE',
    'WEAK RISK-ON':    'FAIBLE APPÉTIT AU RISQUE',
    'NEUTRAL':         'NEUTRE',
    'WEAK RISK-OFF':   'LÉGÈRE AVERSION',
    'RISK-OFF':        'AVERSION AU RISQUE',
    'STRONG RISK-OFF': 'FORTE AVERSION AU RISQUE',
  };
  // En-tête type "Market Sentiment: RISK OFF" (façon dropdown image)
  if (lbl) { lbl.textContent = `Market Sentiment: ${data.label}`; lbl.className = 'rp-label ' + cls; }
  if (ti) ti.textContent = `Market Sentiment: ${data.label}`;
  // Dropdown épuré : pas de jauge ni de bande dans ce popup (la jauge vit dans l'onglet RISK)
  const gw = el('rp-gauge-wrap'); if (gw) gw.style.display = 'none';
  const band = el('rp-band'); if (band) band.style.display = 'none';
  // Description longue (anglais) selon le niveau de risque — exactement comme l'image
  const POPUP_DESC_EN = {
    'STRONG RISK-ON':  'Strong risk appetite dominates. Capital is rotating aggressively into equities and high-beta assets as investors chase returns, with safe havens broadly sold.',
    'RISK-ON':         'Risk appetite is firmly in control. Equities and cyclical assets are bid while defensive positioning unwinds, reflecting confidence in the growth outlook.',
    'WEAK RISK-ON':    'A mild risk-on tone prevails. Constructive sentiment supports risk assets, but conviction is limited and positioning stays cautious.',
    'NEUTRAL':         'Market sentiment is balanced. Signals across asset classes are mixed, with no clear directional bias as participants await fresh catalysts.',
    'WEAK RISK-OFF':   'Caution is creeping in. Flows are mixed, safe havens are quietly supported and volatility is elevated as participants trim risk exposure.',
    'RISK-OFF':        'Market participants are seeking safety amid uncertainty. Defensive positioning is evident across asset classes as investors prioritize capital preservation over returns due to geopolitical tensions, economic concerns, or monetary tightening.',
    'STRONG RISK-OFF': 'Risk aversion dominates. A pronounced flight to safety is underway across havens — bonds, gold, JPY and CHF — as participants slash exposure and volatility spikes.',
  };
  const de = el('rp-desc');
  if (de) { de.style.display = ''; de.textContent = POPUP_DESC_EN[data.label] || data.description || ''; }
  const as = el('rp-assets');
  if (as) {
    as.innerHTML = (data.assets || []).map(a => {
      const ico = a.chg >= 0 ? '↗' : '↘';
      const col = a.chg >= 0 ? 'var(--green)' : 'var(--red)';
      return `<div class="rp-asset-row">
        <span class="rp-asset-arrow" style="color:${col}">${ico}</span>
        <span class="rp-asset-name">${a.label}</span>
        <span class="rp-asset-chg ${a.chg>=0?'pos':'neg'}">${a.chg>=0?'+':''}${a.chg.toFixed(2)}%</span>
      </div>`;
    }).join('');
  }
  const up = el('rp-updated');
  if (up && data.updatedAt) {
    const d = new Date(data.updatedAt);
    up.textContent = `Updated: ${d.toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}`;
  }
}

let _riskPopupData = null;

async function _loadRiskSentiment() {
  try {
    const data = await fetch('/api/risk-sentiment').then(r => r.json());
    if (data.error) return;
    _riskPopupData = data;
    // Snapshot GLOBAL partagé : topbar, popup et jauge METER lisent tous CE même objet
    // (+ event de mise à jour) → fini les divergences -6%/-4% entre vues.
    window._dtpRisk = data;
    window.dispatchEvent(new CustomEvent('dtp-risk', { detail: data }));
    _applyRiskTopbar(data);
    const overlay = document.getElementById('risk-popup-overlay');
    if (overlay && !overlay.classList.contains('hidden')) _renderRiskPopup(data);
  } catch {}
}

document.addEventListener('DOMContentLoaded', () => {
  const sentBtn  = document.getElementById('sentiment-btn');
  const overlay  = document.getElementById('risk-popup-overlay');
  const rpClose  = document.getElementById('rp-close');

  if (sentBtn) {
    sentBtn.addEventListener('click', e => {
      e.stopPropagation();
      const wasHidden = overlay.classList.contains('hidden');
      overlay.classList.toggle('hidden');
      if (wasHidden) {
        if (_riskPopupData) _renderRiskPopup(_riskPopupData);
        // Ancrage : dropdown positionné juste SOUS le bouton RISK (façon image)
        const card = document.getElementById('risk-popup');
        if (card) {
          const r = sentBtn.getBoundingClientRect();
          card.style.position = 'fixed';
          card.style.margin = '0';
          card.style.transform = 'none';     // annule le centrage CSS (translateX)
          card.style.top  = (r.bottom + 8) + 'px';
          card.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 452)) + 'px';
        }
      }
    });
  }
  if (rpClose) rpClose.addEventListener('click', () => overlay?.classList.add('hidden'));
  if (overlay) overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });

  _loadRiskSentiment();
  setInterval(_loadRiskSentiment, 3 * 60 * 1000);
});

// ═══ Institution Tab ══════════════════════

let _instCotType   = 'lev_money';
let _instActiveTab = 'cot';

function initInstitutionTab() {
  // Sub-tabs
  document.querySelectorAll('.inst-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _instActiveTab = btn.dataset.itab;
      document.querySelectorAll('.inst-tab').forEach(b => b.classList.toggle('inst-tab--active', b.dataset.itab === _instActiveTab));
      document.querySelectorAll('.inst-panel').forEach(p => p.classList.toggle('inst-panel--active', p.id === `itab-${_instActiveTab}`));
      if (_instActiveTab === 'cot')    loadInstCOT();
      if (_instActiveTab === 'retail') loadInstRetail();
      if (_instActiveTab === 'flow')   loadInstFlow();
    });
  });

  // COT type buttons
  document.querySelectorAll('.icot-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _instCotType = btn.dataset.icot;
      document.querySelectorAll('.icot-btn').forEach(b => b.classList.toggle('icot-btn--active', b.dataset.icot === _instCotType));
      loadInstCOT();
    });
  });

  document.getElementById('inst-refresh-btn')?.addEventListener('click', () => {
    if (_instActiveTab === 'cot')    loadInstCOT(true);
    if (_instActiveTab === 'retail') loadInstRetail(true);
    if (_instActiveTab === 'flow')   loadInstFlow();
  });
}

const _COT_FLAG = { USD:'🇺🇸', EUR:'🇪🇺', GBP:'🇬🇧', JPY:'🇯🇵', CAD:'🇨🇦', AUD:'🇦🇺', CHF:'🇨🇭', NZD:'🇳🇿' };

async function loadInstCOT(force = false) {
  const grid = document.getElementById('inst-cot-grid');
  const info = document.getElementById('inst-cot-info');
  if (!grid) return;
  grid.innerHTML = dtpLoader('Chargement des données COT…');
  try {
    const data = await fetch(`/api/cot?type=${_instCotType}`).then(r => r.json());
    if (!data.currencies?.length) { grid.innerHTML = '<div class="inst-empty">No COT data available</div>'; return; }

    const updatedEl = document.getElementById('inst-updated');
    const rpt = data.currencies[0]?.reportDate;
    if (updatedEl && rpt) updatedEl.textContent = `COT report: ${rpt}`;
    if (info) info.textContent = rpt ? `Report date: ${rpt} · * = derived (inverse aggregate)` : '';

    grid.innerHTML = data.currencies.map(c => {
      const longPct = c.longPct  ?? 50;
      const shortPct = c.shortPct ?? 50;
      const net     = c.net ?? 0;
      const netFmt  = (net >= 0 ? '+' : '') + net.toLocaleString();
      const chgCls  = net > 0 ? 'inst-cot-up' : net < 0 ? 'inst-cot-dn' : '';
      const longW   = Math.max(4, Math.min(96, longPct));
      return `<div class="inst-cot-row">
        <div class="inst-cot-flag">${_COT_FLAG[c.key] || ''}</div>
        <div class="inst-cot-cur">${c.key}${c.derived ? '*' : ''}</div>
        <div class="inst-cot-bar-wrap">
          <div class="inst-cot-bar-long"  style="width:${longW}%"></div>
          <div class="inst-cot-bar-short" style="width:${100 - longW}%"></div>
        </div>
        <div class="inst-cot-pct-long">${longPct}%</div>
        <div class="inst-cot-pct-short">${shortPct}%</div>
        <div class="inst-cot-net ${chgCls}">${netFmt}</div>
      </div>`;
    }).join('');
  } catch {
    grid.innerHTML = '<div class="inst-empty">COT data unavailable</div>';
  }
}

async function loadInstRetail(force = false) {
  const grid = document.getElementById('inst-retail-grid');
  if (!grid) return;
  grid.innerHTML = dtpLoader('Chargement du sentiment retail…');
  try {
    const url = `/api/community-outlook?period=H1${force ? '&force=1' : ''}`;
    const resp = await fetch(url).then(r => r.json());
    const raw  = resp.symbols || resp; // Support both wrapped {symbols:[]} and direct array
    if (!raw?.length) { grid.innerHTML = '<div class="inst-empty">No data available</div>'; return; }

    // Filter to forex major pairs only
    const MAJORS = new Set(['EUR','GBP','USD','JPY','CAD','AUD','CHF','NZD']);
    const data = raw.filter(s => {
      if (!s.symbol || s.symbol.length < 6) return false;
      const b = s.symbol.slice(0,3), q = s.symbol.slice(3,6);
      return MAJORS.has(b) && MAJORS.has(q);
    }).sort((a,b) => a.symbol.localeCompare(b.symbol));

    grid.innerHTML = data.map(s => {
      const lg  = +(s.longPct  ?? 50);
      const sh  = +(s.shortPct ?? (100 - lg));
      const lgW = Math.max(4, Math.min(96, lg));
      const bias = lg > 60 ? 'Long' : lg < 40 ? 'Short' : 'Neutral';
      const biasCol = lg > 60 ? 'var(--green)' : lg < 40 ? 'var(--red)' : 'var(--text3)';
      const sym = `${s.symbol.slice(0,3)}/${s.symbol.slice(3)}`;
      return `<div class="inst-retail-row">
        <div class="inst-ret-sym">${sym}</div>
        <div class="inst-ret-bar-wrap">
          <div class="inst-ret-long"  style="width:${lgW}%"><span>${Math.round(lg)}%</span></div>
          <div class="inst-ret-short" style="width:${100-lgW}%"><span>${Math.round(sh)}%</span></div>
        </div>
        <div class="inst-ret-bias" style="color:${biasCol}">${bias}</div>
        <div class="inst-ret-long-pct">${lg.toFixed(1)}%</div>
        <div class="inst-ret-short-pct">${sh.toFixed(1)}%</div>
      </div>`;
    }).join('');
  } catch {
    grid.innerHTML = '<div class="inst-empty">Sentiment data unavailable</div>';
  }
}

async function loadInstFlow() {
  const grid = document.getElementById('inst-flow-grid');
  if (!grid) return;
  // Combine COT + Retail data into a divergence/flow view
  grid.innerHTML = dtpLoader('Computing net flows…');
  try {
    const [cotData, retailData] = await Promise.all([
      fetch(`/api/cot?type=lev_money`).then(r => r.json()),
      fetch(`/api/community-outlook?period=H1`).then(r => r.json()),
    ]);

    const cot    = cotData.currencies || [];
    const retailRaw = retailData.symbols || retailData;
    const retail = Array.isArray(retailRaw) ? retailRaw : [];

    if (!cot.length) { grid.innerHTML = '<div class="inst-empty">Insufficient data for flow analysis</div>'; return; }

    // Build retail map: currency → average long% (from pair data)
    const retailMap = {};
    retail.forEach(s => {
      const sym = (s.symbol || '').replace('/', '').toUpperCase();
      if (sym.length !== 6) return;
      const b = sym.slice(0, 3), q = sym.slice(3, 6);
      const lg = +(s.longPct ?? 50);
      if (!retailMap[b]) retailMap[b] = { sum: 0, n: 0 };
      if (!retailMap[q]) retailMap[q] = { sum: 0, n: 0 };
      retailMap[b].sum += lg;       retailMap[b].n++;
      retailMap[q].sum += (100-lg); retailMap[q].n++;
    });

    grid.innerHTML = `<div class="inst-flow-header">
      <span>Currency</span>
      <span>Institutions (COT)</span>
      <span>Retail Sent.</span>
      <span>Divergence</span>
      <span>Signal</span>
    </div>` + cot.map(c => {
      const cur     = c.key;
      if (!cur) return '';
      const cotLong = c.longPct ?? 50;
      const retEntry = retailMap[cur];
      const retLong  = retEntry ? retEntry.sum / retEntry.n : null;
      const div      = retLong !== null ? cotLong - retLong : null;
      let sig = '—', sigCls = '';
      if (div !== null) {
        if (div > 15)   { sig = '▲ BULLISH'; sigCls = 'inst-sig-bull'; }
        else if (div < -15) { sig = '▼ BEARISH'; sigCls = 'inst-sig-bear'; }
        else            { sig = '→ NEUTRAL';  sigCls = 'inst-sig-neut'; }
      }
      const cotW  = Math.max(4, Math.min(96, cotLong));
      const retW  = retLong !== null ? Math.max(4, Math.min(96, retLong)) : null;
      const cotBar = `<div class="inst-flow-mini-bar"><div class="inst-flow-mini-long" style="width:${cotW}%"></div></div><span>${cotLong.toFixed(0)}%</span>`;
      const retBar = retW !== null
        ? `<div class="inst-flow-mini-bar"><div class="inst-flow-mini-long inst-flow-mini-ret" style="width:${retW}%"></div></div>`
        : '<span style="color:var(--text4);font-size:10px">N/A</span>';
      const divText = div !== null ? `${div > 0 ? '+' : ''}${div.toFixed(0)}%` : '—';
      return `<div class="inst-flow-row">
        <span class="inst-flow-cur">${_COT_FLAG[cur] || ''} ${cur}${c.derived ? '*' : ''}</span>
        <div class="inst-flow-cot">${cotBar}</div>
        <div class="inst-flow-ret">${retBar}</div>
        <span class="inst-flow-div">${divText}</span>
        <span class="inst-flow-sig ${sigCls}">${sig}</span>
      </div>`;
    }).filter(Boolean).join('');
  } catch {
    grid.innerHTML = '<div class="inst-empty">Flow data unavailable</div>';
  }
}

// ═══ Analyst Tab ══════════════════════════

const PAIR_CONTEXTS = {
  'EUR/USD': { cb: 'ECB/Fed', keywords: ['eurusd','eur/usd','euro','ecb','eurozone','lagarde','dollar','fed','fomc'] },
  'GBP/USD': { cb: 'BoE/Fed', keywords: ['gbpusd','gbp/usd','sterling','pound','boe','bank of england','bailey','dollar','fed'] },
  'USD/JPY': { cb: 'Fed/BoJ', keywords: ['usdjpy','usd/jpy','yen','jpy','boj','bank of japan','ueda','dollar','fed','carry'] },
  'USD/CHF': { cb: 'Fed/SNB', keywords: ['usdchf','usd/chf','franc','chf','snb','swiss national'] },
  'AUD/USD': { cb: 'RBA/Fed', keywords: ['audusd','aud/usd','aussie','aud','rba','reserve bank of australia','china'] },
  'XAU/USD': { cb: 'Macro',  keywords: ['gold','xauusd','xau/usd','safe haven','yields','dollar','inflation','geopolit'] },
  'WTI':     { cb: 'Energy', keywords: ['wti','brent','crude oil','opec','energy','oil supply','petroleum','hormuz'] },
};

let _analystPair    = 'EUR/USD';
let _analystCache   = {};
let _analystLoading = false;
let _arlibSearch    = '';
let _arlibType      = 'all';

// ── Read-state tracking (persists via localStorage) ───────────────────────────
// Always use String keys so numeric IDs (from FJ) and string IDs stay consistent
const _readIds = new Set(
  (JSON.parse(localStorage.getItem('dtp_read_ids') || '[]')).map(String)
);
function markRead(id) {
  if (id == null) return;
  const sid = String(id);
  if (!sid || _readIds.has(sid)) return;
  _readIds.add(sid);
  try { localStorage.setItem('dtp_read_ids', JSON.stringify([..._readIds].slice(-500))); } catch {}
}
function isRead(id) {
  if (id == null) return false;
  return _readIds.has(String(id));
}
// Clé de lecture STABLE pour les rapports. Le Weekly a un id serveur qui change à chaque
// régénération (…-<timestamp>) → on ne s'y fie pas : on clé par SEMAINE (stable), pour que
// l'état "lu" persiste même après régénération v1→v2.
function _reportReadKey(item) {
  if (!item) return '';
  if (item._reportType === 'Weekly Market Recap' || item._reportType === 'Global Economic Weekly') {
    const wk = (item._weekly && item._weekly.weekEnding)
      ? item._weekly.weekEnding
      : new Date(item.timestamp || Date.now()).toISOString().slice(0, 10);
    return 'wk:' + item._reportType + ':' + wk;
  }
  return String(item.id);
}
let _arlibCat       = 'all';
let _currentArlibItem = null;

function initAnalystTab() {
  const search = document.getElementById('arlib-search');
  const typeEl = document.getElementById('arlib-type');
  const catEl  = document.getElementById('arlib-cat');
  if (search) search.addEventListener('input',  e => { _arlibSearch = e.target.value.toLowerCase(); renderArlibList(); });
  if (typeEl) typeEl.addEventListener('change', e => { _arlibType   = e.target.value; renderArlibList(); });
  if (catEl)  catEl.addEventListener('change',  e => { _arlibCat    = e.target.value; renderArlibList(); });

  const backBtn = document.getElementById('arlib-back-btn');
  if (backBtn) backBtn.addEventListener('click', arlibShowList);

  const prevBtn = document.getElementById('arlib-rtags-prev');
  const nextBtn = document.getElementById('arlib-rtags-next');
  const tagsScroll = document.getElementById('arlib-rtags-scroll');
  if (prevBtn && tagsScroll) prevBtn.addEventListener('click', () => { tagsScroll.scrollLeft -= 120; });
  if (nextBtn && tagsScroll) nextBtn.addEventListener('click', () => { tagsScroll.scrollLeft += 120; });

  // ── Insights button → /api/analyst-outlook (Claude Haiku) ──
  const insightsBtn = document.getElementById('arlib-insights-btn');
  if (insightsBtn) {
    insightsBtn.addEventListener('click', async () => {
      const item = _currentArlibItem;
      if (!item) return;

      const content = document.getElementById('arlib-rcontent');
      if (!content) return;

      // Extract pair from tags / headline
      const CURRENCY_RX = /\b(EUR|GBP|USD|JPY|CAD|AUD|NZD|CHF)\b/g;
      const combined = (item.headline + ' ' + (item.description || '') + ' ' + (item.tags || []).join(' ')).toUpperCase();
      const found = [...new Set(combined.match(CURRENCY_RX) || [])];
      const pair  = found.length >= 2 ? `${found[0]}/${found[1]}` : found.length === 1 ? `${found[0]}/USD` : 'EUR/USD';
      const cb    = item.category || '';

      // Collect last 24h related headlines
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const related = allItems
        .filter(i => i.timestamp > cutoff && i.id !== item.id)
        .filter(i => found.some(c => (i.headline || '').toUpperCase().includes(c)))
        .slice(0, 12)
        .map(i => `- ${i.headline}`)
        .join('\n');

      // Loading state
      insightsBtn.classList.add('insights-loading');
      insightsBtn.style.pointerEvents = 'none';
      const prevScroll = content.scrollTop;
      const insightsWrap = document.createElement('div');
      insightsWrap.id = 'arlib-insights-panel';
      insightsWrap.className = 'arlib-insights-panel';
      insightsWrap.innerHTML = (window.dtpLoader ? window.dtpLoader('Analyse en cours…', { small: true }) : '<div class="arlib-insights-loading">Analyse en cours…</div>');

      // Remove existing insights panel if any
      document.getElementById('arlib-insights-panel')?.remove();
      content.prepend(insightsWrap);
      content.scrollTop = 0;

      try {
        const res  = await fetch('/api/analyst-outlook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pair, cb, headlines: related }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const biasColor = data.bias === 'bullish' ? '#22c55e' : data.bias === 'bearish' ? '#ef4444' : '#888';
        const bulletsHtml = (data.bullets || []).map(b => `<div class="arlib-rbullet"><span class="arlib-rbullet-dot"></span><span>${b}</span></div>`).join('');
        const levelsHtml  = (data.levels || []).map(l =>
          `<div class="arlib-ilevel arlib-ilevel--${l.type}">
             <span class="arlib-ilevel-type">${l.type}</span>
             <span class="arlib-ilevel-price">${l.price}</span>
             <span class="arlib-ilevel-note">${l.note}</span>
           </div>`).join('');

        insightsWrap.innerHTML = `
          <div class="arlib-insights-header">
            <span class="arlib-insights-pair">${pair}</span>
            <span class="arlib-insights-bias" style="color:${biasColor}">${(data.bias || '').toUpperCase()}</span>
            <span class="arlib-insights-conf">${data.confidence || '—'}% confidence</span>
            <span class="arlib-insights-close" id="arlib-insights-close">×</span>
          </div>
          <div class="arlib-insights-summary">${data.summary || ''}</div>
          ${bulletsHtml}
          ${levelsHtml ? `<div class="arlib-rsection">Key Levels</div>${levelsHtml}` : ''}
        `;
        document.getElementById('arlib-insights-close')?.addEventListener('click', () => {
          insightsWrap.remove();
        });
      } catch (e) {
        insightsWrap.innerHTML = `<div class="arlib-insights-err">Analyse indisponible : ${e.message}</div>`;
      } finally {
        insightsBtn.classList.remove('insights-loading');
        insightsBtn.style.pointerEvents = '';
      }
    });
  }
}

function loadAnalystView() {
  // Charger les session wraps InvestingLive ET les articles ING Think en parallèle
  Promise.allSettled([
    fetch('/api/session-wraps').then(r => r.json()),
    fetch('/api/bank-research').then(r => r.json()),
    fetch('/api/weekly-reports').then(r => r.json()),
    fetch('/api/fx-daily').then(r => r.json()),
  ]).then(([swResult, brResult, wkResult, fxResult]) => {
    // On ne remplace QUE si le serveur renvoie des données NON VIDES → jamais d'écrasement
    // du cache hydraté par une réponse vide (cold-start). + persistance localStorage.
    if (swResult.status === 'fulfilled' && Array.isArray(swResult.value) && swResult.value.length) {
      _sessionWraps = swResult.value.map(i => Object.assign({}, i, { headline: i.headline || i.title }));
      lsSet('dtp_sw', _sessionWraps.slice(0, 80));
    }
    if (brResult.status === 'fulfilled' && Array.isArray(brResult.value) && brResult.value.length) {
      _brArticles = brResult.value;
      lsSet('dtp_br', _brArticles.slice(0, 60));
    }
    if (fxResult.status === 'fulfilled' && Array.isArray(fxResult.value) && fxResult.value.length) {
      _fxDaily = fxResult.value.map(i => Object.assign({}, i, { headline: i.headline || i.title }));
      lsSet('dtp_fx', _fxDaily.slice(0, 40));
    }
    if (wkResult.status === 'fulfilled') {
      if (Array.isArray(wkResult.value?.items)) _weeklyReports = wkResult.value.items;
      _weeklyGenerating = !!wkResult.value?.generating;
      // Si le serveur génère le recap en tâche de fond, on re-vérifie quelques fois
      if (_weeklyGenerating) _scheduleWeeklyRetry();
    }
  }).finally(() => renderArlibList());
}

// ═══════════════════ ONGLET BIAS — Smart Bias Tracker (matrice) ═══════════════════
let _biasData    = null;
let _sbClockTimer = null;
const SB_CLOCKS = [
  { city: 'London',   code: 'LON',  tz: 'Europe/London' },
  { city: 'New York', code: 'NY',   tz: 'America/New_York' },
  { city: 'Tokyo',    code: 'TKYO', tz: 'Asia/Tokyo' },
  { city: 'Dubai',    code: 'DXB',  tz: 'Asia/Dubai' },
  { city: 'Paris',    code: 'PAR',  tz: 'Europe/Paris' },
];

function loadBiasView() {
  const host = document.getElementById('bias-content');
  if (!host) return;
  if (_biasData) { renderBiasView(_biasData); return; }
  host.innerHTML = dtpLoader('Chargement du Smart Bias Tracker…');
  fetch('/api/smart-bias')
    .then(r => r.json())
    .then(d => { _biasData = d; renderBiasView(d); })
    .catch(() => { host.innerHTML = '<div class="bias-loading">Smart Bias indisponible pour le moment.</div>'; });
}
window.loadBiasView = loadBiasView;

function _sbCls(v) {
  switch (v) {
    case 'Very Bullish': return 'sb-vbull';
    case 'Bullish':
    case 'Uptrend':      return 'sb-bull';
    case 'Weak Bullish': return 'sb-wbull';
    case 'Bearish':
    case 'Downtrend':    return 'sb-bear';
    case 'Very Bearish': return 'sb-vbear';
    case 'Weak Bearish': return 'sb-wbear';
    default:             return 'sb-neutral';   // Neutral, Range
  }
}

function renderBiasView(d) {
  const host = document.getElementById('bias-content');
  if (!host) return;
  const cur  = (d && d.currencies) || [];
  const rows = (d && d.rows) || [];
  const badge = document.getElementById('bias-update-badge');
  if (badge) badge.textContent = d && d.generatedAt
    ? 'MAJ ' + new Date(d.generatedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
    : '';

  if (!rows.length) {
    host.innerHTML = '<div class="bias-loading">La matrice Smart Bias sera générée dimanche (force : /api/smart-bias?force=1).</div>';
    return;
  }

  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const head = `<tr><th class="sb-ind">Indicators</th>${cur.map(c => `<th class="sb-cur">${c}</th>`).join('')}</tr>`;
  const body = rows.map(r =>
    `<tr><td class="sb-ind"><span class="sb-ind-arrow">›</span> ${esc(r.label)}</td>${
      cur.map(c => { const v = r.values[c] || 'Neutral'; return `<td class="sb-cell ${_sbCls(v)}">${esc(v)}</td>`; }).join('')
    }</tr>`).join('');
  const concl = `<tr class="sb-conclusion"><td class="sb-ind">Overall Conclusion</td>${
    cur.map(c => { const v = (d.conclusion || {})[c] || 'Neutral'; return `<td class="sb-cell ${_sbCls(v)}">${esc(v)}</td>`; }).join('')
  }</tr>`;

  host.innerHTML = `
    <div class="sb-title-row"><span class="sb-title">Smart Bias Tracker</span></div>
    <div class="sb-grid-wrap">
      <table class="sb-grid"><thead>${head}</thead><tbody>${body}${concl}</tbody></table>
    </div>`;
}

function _sbStartClocks() {
  const tick = () => {
    const c = document.getElementById('sb-clocks');
    if (!c) { if (_sbClockTimer) { clearInterval(_sbClockTimer); _sbClockTimer = null; } return; }
    c.innerHTML = SB_CLOCKS.map(k => {
      const now  = new Date();
      const time = now.toLocaleTimeString('en-GB', { timeZone: k.tz, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const date = now.toLocaleDateString('en-GB', { timeZone: k.tz, day: '2-digit', month: '2-digit' });
      const day  = now.toLocaleDateString('en-US', { timeZone: k.tz, weekday: 'short' });
      return `<div class="sb-clock">
        <div class="sb-clock-top"><span class="sb-clock-day">${day}</span><span class="sb-clock-date">${date}</span></div>
        <div class="sb-clock-time">${time}</div>
        <div class="sb-clock-city">${k.city} (${k.code})</div>
      </div>`;
    }).join('');
  };
  tick();
  if (_sbClockTimer) clearInterval(_sbClockTimer);
  _sbClockTimer = setInterval(tick, 1000);
}

// ═══════════════════ ONGLET BANK — transactions bancaires ═══════════════════
let _bankPositions = [];
let _bankActiveId  = null;
let _bankChartRoot = null;
let _bankTimer     = null;

function loadBankView() {
  _fetchBankPositions();
  // Rafraîchissement temps réel du prix/statut toutes les 60 s tant que l'onglet est ouvert
  if (_bankTimer) clearInterval(_bankTimer);
  _bankTimer = setInterval(() => {
    const panel = document.getElementById('view-bank');
    if (!panel || panel.classList.contains('hidden')) { clearInterval(_bankTimer); _bankTimer = null; return; }
    _fetchBankPositions(true);
  }, 60 * 1000);
}
window.loadBankView = loadBankView;

function _fetchBankPositions(silent) {
  fetch('/api/bank-positions')
    .then(r => r.json())
    .then(d => {
      _bankPositions = d.positions || [];
      const u = document.getElementById('bank-update');
      if (u && d.updatedAt) u.textContent = 'MAJ ' + new Date(d.updatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      renderBankTable();
      if (_bankPositions.length) {
        const cur = _bankActiveId && _bankPositions.find(p => p.id === _bankActiveId);
        if (!cur) selectBankRow(_bankPositions[0].id);
        else { _highlightBankRow(_bankActiveId); _updateBankChartPrice(cur); }
      }
    })
    .catch(() => {
      if (silent) return;
      const tb = document.getElementById('bank-tbody');
      if (tb) tb.innerHTML = '<tr><td colspan="10" class="bank-loading">Positions indisponibles.</td></tr>';
    });
}

function _bankFmt(pair, v) {
  if (v == null || isNaN(v)) return '—';
  const dec = String(pair).includes('JPY') ? 2 : 4;
  return Number(v).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function _bankDate(iso) {
  if (!iso) return '—';
  const p = String(iso).split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
}
function _bankStatusCls(s) {
  if (/SL/i.test(s)) return 'bank-st-sl';
  if (/TP/i.test(s)) return 'bank-st-tp';
  return 'bank-st-active';
}

function renderBankTable() {
  const tb = document.getElementById('bank-tbody');
  if (!tb) return;
  if (!_bankPositions.length) { tb.innerHTML = '<tr><td colspan="10" class="bank-loading">Aucune position.</td></tr>'; return; }
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  tb.innerHTML = _bankPositions.map(p => {
    const active = p.id === _bankActiveId ? ' bank-row--active' : '';
    return `
    <tr class="bank-row${active}" data-id="${p.id}">
      <td class="bank-exp" data-act="exp"><span class="bank-chev">›</span></td>
      <td class="bank-name">${esc(p.bank)}</td>
      <td class="bank-otype">${esc(p.orderType)}</td>
      <td class="bank-pair">${esc(p.pair)}</td>
      <td class="bank-date">${_bankDate(p.date)}</td>
      <td class="bank-num">${_bankFmt(p.pair, p.entry)}</td>
      <td class="bank-num">${_bankFmt(p.pair, p.tp)}</td>
      <td class="bank-num">${_bankFmt(p.pair, p.sl)}</td>
      <td><span class="bank-status ${_bankStatusCls(p.status)}">${esc(p.status || 'Active')}</span></td>
      <td class="bank-chart-cell" data-act="chart" title="Afficher le graphique">
        <svg width="16" height="14" viewBox="0 0 16 14" fill="none"><path d="M1 13V1M1 13h14M4 10l3-4 3 2 4-6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </td>
    </tr>
    <tr class="bank-detail-row hidden" data-detail="${p.id}">
      <td colspan="10">
        <div class="bank-detail">
          <div class="bank-detail-col">
            <div class="bank-detail-line"><span>Paire de devises</span><b>${esc(p.pair)}</b></div>
            <div class="bank-detail-line"><span>Objectif</span><b>${_bankFmt(p.pair, p.tp)}</b></div>
            <div class="bank-detail-line"><span>Stop loss</span><b>${_bankFmt(p.pair, p.sl)}</b></div>
          </div>
          <div class="bank-detail-col">
            <div class="bank-detail-h">Thèse de la dernière transaction</div>
            <div class="bank-detail-txt${p.thesis ? '' : ' bank-detail-muted'}">${p.thesis ? esc(p.thesis) : 'Aucune donnée disponible'}</div>
          </div>
          <div class="bank-detail-col">
            <div class="bank-detail-h">Historique des transactions</div>
            <div class="bank-detail-txt bank-detail-muted">Aucune donnée disponible</div>
          </div>
        </div>
      </td>
    </tr>`;
  }).join('');

  // Délégation des clics
  tb.querySelectorAll('.bank-row').forEach(row => {
    row.addEventListener('click', e => {
      const id = row.dataset.id;
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'exp') { _toggleBankDetail(id, row); return; }
      selectBankRow(id);
    });
  });
}

function _toggleBankDetail(id, row) {
  const det = document.querySelector(`[data-detail="${id}"]`);
  if (!det) return;
  const open = det.classList.toggle('hidden') === false;
  row.querySelector('.bank-chev')?.classList.toggle('bank-chev--open', open);
}

function _highlightBankRow(id) {
  document.querySelectorAll('.bank-row').forEach(r => r.classList.toggle('bank-row--active', r.dataset.id === id));
}
function _updateBankChartPrice(p) {
  const el = document.getElementById('bank-chart-price');
  if (el) el.textContent = p.currentPrice != null ? _bankFmt(p.pair, p.currentPrice) : '';
}

function selectBankRow(id) {
  const p = _bankPositions.find(x => x.id === id);
  if (!p) return;
  _bankActiveId = id;
  _highlightBankRow(id);
  document.getElementById('bank-chart-pair').textContent = p.pair;
  _updateBankChartPrice(p);
  buildBankChart(p);
}

function buildBankChart(p) {
  const el = document.getElementById('bank-chart');
  if (!el || typeof am5 === 'undefined') return;
  if (_bankChartRoot) { try { _bankChartRoot.dispose(); } catch {} _bankChartRoot = null; }
  el.innerHTML = dtpLoader('Chargement du graphique…', { small: true });

  fetch('/api/bank-ohlc?pair=' + encodeURIComponent(p.pair))
    .then(r => r.json())
    .then(d => {
      const candles = (d.candles || []).map(c => ({ Date: c.t, Open: c.o, High: c.h, Low: c.l, Close: c.c }));
      el.innerHTML = '';
      if (!candles.length) { el.innerHTML = '<div class="bank-chart-loading">Graphique indisponible.</div>'; return; }

      const dec = p.pair.includes('JPY') ? 2 : (candles[0].Close < 10 ? 4 : 2);
      const root = am5.Root.new('bank-chart');
      _bankChartRoot = root;
      // Suppression robuste du logo amCharts (le petit rond bleu) : forceHidden ne suffit pas
      if (root._logo) {
        root._logo.set('forceHidden', true);
        root._logo.set('visible', false);
        try { root._logo.children.clear(); } catch {}
        try { root._logo.dispose(); } catch {}
      }
      root.setThemes([am5themes_Animated.new(root)]);

      const chart = root.container.children.push(am5xy.XYChart.new(root, {
        panX: false, panY: false, wheelY: 'zoomX', paddingLeft: 0, paddingRight: 64, paddingBottom: 4,
      }));

      const yAxis = chart.yAxes.push(am5xy.ValueAxis.new(root, {
        renderer: am5xy.AxisRendererY.new(root, { opposite: true }),
        numberFormat: '#,###.' + '0'.repeat(dec),
      }));
      const xAxis = chart.xAxes.push(am5xy.DateAxis.new(root, {
        baseInterval: { timeUnit: 'day', count: 1 },
        renderer: am5xy.AxisRendererX.new(root, { minorGridEnabled: true }),
      }));

      const series = chart.series.push(am5xy.CandlestickSeries.new(root, {
        xAxis, yAxis, valueXField: 'Date',
        openValueYField: 'Open', highValueYField: 'High', lowValueYField: 'Low', valueYField: 'Close',
      }));
      series.columns.template.setAll({ strokeWidth: 1, width: am5.percent(60) });
      const colOf = t => { const di = t.dataItem; return di && di.get('valueY') >= di.get('openValueY') ? am5.color(0x2ecc71) : am5.color(0xe74c3c); };
      series.columns.template.adapters.add('fill', (_f, t) => colOf(t));
      series.columns.template.adapters.add('stroke', (_s, t) => colOf(t));
      series.data.setAll(candles);

      // Lignes Entry / Take Profit / Stop Loss
      const guides = [
        { value: p.entry, label: 'Entry',       color: 0x3b82f6 },
        { value: p.tp,    label: 'Take Profit', color: 0x22c55e },
        { value: p.sl,    label: 'Stop Loss',   color: 0xef4444 },
      ];
      // Ligne de prix actuel (comme la référence) si dispo
      if (p.currentPrice) guides.push({ value: p.currentPrice, label: '', color: 0x10b981, live: true });
      guides.forEach(g => {
        if (!g.value) return;
        const di    = yAxis.makeDataItem({ value: g.value });
        const range = yAxis.createAxisRange(di);
        range.get('grid').setAll({ stroke: am5.color(g.color), strokeOpacity: 0.95, strokeWidth: 1, strokeDasharray: [4, 3] });
        di.get('label')?.setAll({
          text: `${g.label} ${g.value.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`,
          inside: true, centerY: am5.p50, fontSize: 10, fontWeight: '700', fill: am5.color(0xffffff),
          background: am5.RoundedRectangle.new(root, { fill: am5.color(g.color) }),
        });
      });

      series.appear(700);
      chart.appear(700, 80);
    })
    .catch(() => { el.innerHTML = '<div class="bank-chart-loading">Graphique indisponible.</div>'; });
}

function loadInstitutionView() {
  const search = document.getElementById('br-search');
  const instEl = document.getElementById('br-inst');
  const typeEl = document.getElementById('br-type');
  if (search) search.addEventListener('input',  e => { _brSearch = e.target.value.toLowerCase(); renderBrList(); });
  if (instEl) instEl.addEventListener('change', e => { _brInst   = e.target.value; renderBrList(); });
  if (typeEl) typeEl.addEventListener('change', e => { _brType   = e.target.value; renderBrList(); });
  document.getElementById('br-back-btn')?.addEventListener('click', () => {
    document.getElementById('br-list-view')?.classList.remove('hidden');
    document.getElementById('br-reader-view')?.classList.add('hidden');
  });

  // Rendu IMMÉDIAT de ce qu'on a déjà (cache hydraté) → jamais d'écran vide si des données existent.
  if (_brArticles.length) renderBrList();
  _loadBrArticles(0);
}

// Chargement résilient des rapports Institution : ne remplace JAMAIS par une liste vide
// (cold-start serveur), et réessaie quelques fois tant que c'est vide (le scrape se termine).
function _loadBrArticles(attempt = 0) {
  fetch('/api/bank-research')
    .then(r => r.json())
    .then(data => {
      if (Array.isArray(data) && data.length) {
        _brArticles = data;
        lsSet('dtp_br', _brArticles.slice(0, 60));
      }
      renderBrList();
      if (!_brArticles.length && attempt < 6) setTimeout(() => _loadBrArticles(attempt + 1), 2500 + attempt * 2500);
    })
    .catch(() => {
      renderBrList();
      if (attempt < 6) setTimeout(() => _loadBrArticles(attempt + 1), 2500 + attempt * 2500);
    });
}

function _brItemType(item) {
  const url = item.url || '';
  if (url.includes('/opinions/')) return 'opinion';
  return 'article';
}

function _brTags(item) {
  const tags = [...(item.categories || [])];
  const h = ((item.title || '') + ' ' + (item.description || '')).toLowerCase();
  const checks = [
    [/\bfed\b|fomc|federal reserve/i,   'Fed'],
    [/\becb\b|eurozone|lagarde/i,        'ECB'],
    [/\bboe\b|sterling|bank of england/i,'BoE'],
    [/\bboj\b|boj|yen\b|japan/i,         'BoJ'],
    [/\bcpi\b|inflation|pce/i,           'Inflation'],
    [/\bgdp\b|growth/i,                  'GDP'],
    [/oil|crude|brent|opec/i,            'Oil'],
    [/gold|xau/i,                        'Gold'],
    [/dollar|\busd\b|dxy/i,              'USD'],
    [/euro|\beur\b/i,                    'EUR'],
    [/\bgbp\b|sterling/i,                'GBP'],
    [/\bjpy\b|yen/i,                     'JPY'],
    [/china|pboc/i,                      'China'],
    [/yield|treasury|bond/i,             'Bonds'],
    [/trade|tariff/i,                    'Trade'],
    [/iran|russia|ukraine|geopolit/i,    'Geopolitics'],
  ];
  for (const [rx, label] of checks) {
    if (rx.test(h) && !tags.includes(label) && tags.length < 12) tags.push(label);
  }
  return [...new Set(tags)].slice(0, 12);
}

// ── Read tracking pour Bank Research (localStorage) ──────────────────────────
let _brReadIds = new Set(JSON.parse(localStorage.getItem('br_read') || '[]'));
function markBrRead(id) {
  _brReadIds.add(String(id));
  try { localStorage.setItem('br_read', JSON.stringify([..._brReadIds].slice(-500))); } catch {}
}
function isBrRead(id) { return _brReadIds.has(String(id)); }

// Peuple AUTOMATIQUEMENT les 3 filtres Bank Research depuis les données réelles → toujours
// cohérents quand on ajoute/retire une source institution (ING, MUFG, SEB, Scotiabank…).
function _selSync(id, html) {
  const sel = document.getElementById(id); if (!sel) return;
  const cur = sel.value || 'all';
  if (sel.innerHTML !== html) sel.innerHTML = html;
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'all';
}
function _populateBrInstFilter() {
  const arts = _brArticles || [];
  // 1) Institutions présentes
  const LABELS = { ING: 'ING Think', MUFG: 'MUFG', SEB: 'SEB', Scotiabank: 'Scotiabank' };
  const insts = [...new Set(arts.map(i => i && i.institution).filter(Boolean))].sort();
  _selSync('br-inst', '<option value="all">All Institutes</option>' +
    insts.map(i => `<option value="${i}">${LABELS[i] || i}</option>`).join(''));
  // 2) Types présents (Articles / Opinions)
  const types = [...new Set(arts.map(i => _brItemType(i)).filter(Boolean))];
  const TLAB = { article: 'Articles', opinion: 'Opinions' };
  _selSync('br-type', '<option value="all">All Files</option>' +
    types.map(t => `<option value="${t}">${TLAB[t] || t}</option>`).join(''));
}

function renderBrList() {
  const list   = document.getElementById('br-list');
  const footer = document.getElementById('br-footer');
  if (!list) return;
  _populateBrInstFilter();

  let items = _brArticles;
  if (_brInst   !== 'all') items = items.filter(i => i.institution === _brInst);
  if (_brType   !== 'all') items = items.filter(i => _brItemType(i) === _brType);
  if (_brSearch)           items = items.filter(i =>
    (i.title || '').toLowerCase().includes(_brSearch) ||
    (i.description || '').toLowerCase().includes(_brSearch));

  if (items.length === 0) {
    // Si aucun article du tout (pas un filtre trop strict) → on est en chargement : on montre le loader.
    const noneAtAll = _brArticles.length === 0;
    if (noneAtAll) {
      list.innerHTML = (window.dtpLoader ? window.dtpLoader('Chargement des rapports institution…') : '<div class="br-empty">Chargement…</div>');
    } else {
      list.innerHTML = '<div class="br-empty">Aucun rapport ne correspond à ces filtres.</div>';
    }
    if (footer) footer.textContent = '';
    return;
  }

  list.innerHTML = '';
  for (const item of items) {
    const tags    = _brTags(item);
    const shown   = tags.slice(0, 6);
    const extra   = tags.length - shown.length;
    const dateStr = new Date(item.timestamp).toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' });

    const card = document.createElement('div');
    card.className = 'br-card' + (isBrRead(item.id) ? ' br-card--read' : '');
    card.dataset.id = item.id;
    card.innerHTML = `
      <div class="br-card-icon">
        <svg width="14" height="16" viewBox="0 0 14 16" fill="none">
          <rect x="1" y="1" width="10" height="14" rx="1" stroke="currentColor" stroke-width="1.2"/>
          <line x1="3.5" y1="5" x2="8.5" y2="5" stroke="currentColor" stroke-width="1"/>
          <line x1="3.5" y1="8" x2="8.5" y2="8" stroke="currentColor" stroke-width="1"/>
          <line x1="3.5" y1="11" x2="6.5" y2="11" stroke="currentColor" stroke-width="1"/>
          <path d="M9 1v3h3" stroke="currentColor" stroke-width="1"/>
        </svg>
      </div>
      <div class="br-card-body">
        <div class="br-card-title">${item.title}</div>
        <div class="br-card-tags">
          ${shown.map(t => `<span class="br-tag">${t}</span>`).join('')}
          ${extra > 0 ? `<span class="br-tag-extra">+${extra}</span>` : ''}
        </div>
      </div>
      <div class="br-card-right">
        <span class="br-inst-logo-card">${_instLogoHtml(_instBadge(item))}</span>
        <span class="br-card-date">${dateStr}</span>
        <svg class="br-bookmark" width="12" height="14" viewBox="0 0 12 14" fill="none">
          <path d="M1 1h10v12l-5-3-5 3V1z" stroke="currentColor" stroke-width="1.2"/>
        </svg>
      </div>`;

    // Appliquer le read-state au clic
    card.addEventListener('click', () => {
      markBrRead(item.id);
      card.classList.add('br-card--read');
      renderBrReader(item);
    });
    list.appendChild(card);
  }

  if (footer) footer.textContent = `Showing ${items.length} of ${_brArticles.length} research papers`;
}

// Badge institution = la VRAIE banque du rapport. ING→"ING", MUFG→"MUFG", autres banques
// reconnues (notes agrégées ActionForex…) → leur sigle ; sinon (agrégateur sans banque
// identifiable) → "DTP". On ne met JAMAIS "ING" par défaut.
const _INST_BANKS = [
  [/\bmufg\b|mitsubishi ufj/i, 'MUFG'], [/\buob\b/i, 'UOB'], [/\bocbc\b/i, 'OCBC'],
  [/\bdanske\b/i, 'Danske'], [/\bnomura\b/i, 'Nomura'], [/\bgoldman\b/i, 'Goldman'],
  [/\bmorgan stanley\b/i, 'MS'], [/\bjp ?morgan\b/i, 'JPM'], [/\bciti\b/i, 'Citi'],
  [/\bbarclays\b/i, 'Barclays'], [/\bhsbc\b/i, 'HSBC'], [/\brabobank\b/i, 'Rabo'],
  [/\bscotiabank\b|\bscotia\b/i, 'Scotia'], [/\bwestpac\b/i, 'Westpac'], [/\bnab\b/i, 'NAB'],
  [/\bcommerzbank\b/i, 'Commerz'], [/\bsocgen\b|société générale|societe generale/i, 'SocGen'],
  [/\bbnp\b/i, 'BNP'], [/crédit agricole|credit agricole|\bcacib\b/i, 'CACIB'],
  [/standard chartered/i, 'StanChart'], [/\bwells fargo\b/i, 'Wells'],
  [/bank of america|\bbofa\b/i, 'BofA'], [/\bdeutsche\b/i, 'Deutsche'], [/\bnatwest\b/i, 'NatWest'],
  [/\bnatixis\b/i, 'Natixis'], [/\banz\b/i, 'ANZ'], [/\bnordea\b/i, 'Nordea'], [/\bseb\b/i, 'SEB'],
];
function _instBadge(item) {
  const inst = (item && item.institution) || '';
  const hay = inst + ' ' + ((item && item.title) || (item && item.headline) || '');
  if ((item && item._source === 'ing-think') || /\bing\b/i.test(inst)) return 'ING';
  for (const [re, label] of _INST_BANKS) if (re.test(hay)) return label;
  return 'DTP';
}
// Couleur de marque par banque → "logo" wordmark coloré dans l'en-tête du rapport.
const _BANK_BRAND = {
  ING: '#ff6200', MUFG: '#e60012', Natixis: '#5b2d86', CACIB: '#009597', Goldman: '#6f93c0',
  JPM: '#7a2a2a', MS: '#00a3e0', Citi: '#1b5fae', Barclays: '#00aeef', HSBC: '#db0011',
  Deutsche: '#2c7be5', UOB: '#1b5fae', OCBC: '#e2231a', Danske: '#19a6dc', Nomura: '#c0233a',
  SocGen: '#e60028', BNP: '#00915a', StanChart: '#1b8fea', BofA: '#1f5fb0', Wells: '#d71e28',
  NatWest: '#7b3fa0', Rabo: '#fe6e00', Scotia: '#ec111a', Westpac: '#d5002b', Commerz: '#e7b000',
  NAB: '#c20029', ANZ: '#1b8fea', Nordea: '#0000a0', SEB: '#5ca800',
};
function _instBrandColor(label) { return _BANK_BRAND[label] || '#ff7a00'; }
// Domaine officiel par banque → vrai logo via le service Clearbit (repli wordmark si indispo).
const _BANK_DOMAIN = {
  ING: 'ing.com', MUFG: 'mufg.jp', Natixis: 'natixis.com', CACIB: 'ca-cib.com',
  Goldman: 'goldmansachs.com', JPM: 'jpmorgan.com', MS: 'morganstanley.com', Citi: 'citigroup.com',
  Barclays: 'barclays.com', HSBC: 'hsbc.com', Deutsche: 'db.com', UOB: 'uobgroup.com',
  OCBC: 'ocbc.com', Danske: 'danskebank.com', Nomura: 'nomura.com', SocGen: 'societegenerale.com',
  BNP: 'bnpparibas.com', StanChart: 'sc.com', BofA: 'bankofamerica.com', Wells: 'wellsfargo.com',
  NatWest: 'natwest.com', Rabo: 'rabobank.com', Scotia: 'scotiabank.com', Westpac: 'westpac.com.au',
  Commerz: 'commerzbank.com', NAB: 'nab.com.au', ANZ: 'anz.com', Nordea: 'nordea.com', SEB: 'sebgroup.com',
};
// HTML du logo : <img vrai logo> avec repli automatique (onerror) sur le wordmark coloré → jamais cassé.
function _instLogoHtml(label) {
  const color = _instBrandColor(label);
  const wm = `<span class="br-dtp-logo" style="color:${color}">${label}</span>`;
  const dom = _BANK_DOMAIN[label];
  if (!dom || label === 'DTP') return wm;
  const url = `https://logo.clearbit.com/${dom}`;
  return `<span class="br-bank-logo-wrap"><img class="br-bank-logo" src="${url}" alt="${label}" `
    + `onerror="this.style.display='none';this.nextElementSibling.style.display='inline-block';">`
    + `<span class="br-dtp-logo" style="color:${color};display:none">${label}</span></span>`;
}

// Robustesse images : masque toute image cassée / placeholder (jamais de cadre d'image vide).
function _brFixImages(root) {
  if (!root) return;
  root.querySelectorAll('img').forEach(img => {
    img.loading = 'lazy';
    const src = img.getAttribute('src') || '';
    if (!src || /^data:|blank|placeholder|spacer|lazy/i.test(src)) { img.style.display = 'none'; return; }
    img.addEventListener('error', () => {
      img.style.display = 'none';
      const fig = img.closest('figure'); if (fig) fig.style.display = 'none';
    }, { once: true });
  });
}

function renderBrReader(item) {
  // Masquer la liste, afficher le reader en pleine largeur
  document.getElementById('br-list-view')?.classList.add('hidden');
  document.getElementById('br-reader-view')?.classList.remove('hidden');

  const titleEl = document.getElementById('br-rnav-title');
  const tagsEl  = document.getElementById('br-rtags-scroll');
  const content = document.getElementById('br-rcontent');
  const badge   = document.getElementById('br-inst-badge');

  if (titleEl) titleEl.textContent = item.title;
  if (badge)   badge.textContent   = _instBadge(item);
  if (tagsEl)  tagsEl.innerHTML    = _brTags(item).map(t => `<span class="br-rtag">${t}</span>`).join('');
  if (content) content.innerHTML   = dtpLoader('Chargement de l’article…');

  // ── AI Insights (comme l'onglet Analyst) ──
  let brIns = document.getElementById('br-ai-insights');
  if (!brIns && content) {
    brIns = document.createElement('div');
    brIns.id = 'br-ai-insights';
    content.parentNode.insertBefore(brIns, content);
  }
  if (brIns) { brIns.innerHTML = ''; _loadAIInsights(item, brIns); }
  // Bouton Afficher/Masquer Insights
  const brBtn = document.getElementById('br-insights-btn');
  if (brBtn) { brBtn.innerHTML = `${_EYE_OFF} Masquer Insights`; brBtn.onclick = () => aiInsToggle(brBtn, 'br-ai-insights'); }

  const dateStr = item.timestamp
    ? new Date(item.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    : '';

  // Contenu DÉJÀ fourni (ex. SEB via API) → on l'affiche directement, aucun re-fetch.
  if (item.fullContent && content) {
    const _inst = _instBadge(item);
    const _tagline = _inst === 'ING' ? 'THINK economic and financial analysis'
      : _inst === 'DTP' ? 'Institutional research' : _inst + ' Research';
    const headerHtml = `<div class="br-ing-header">${_instLogoHtml(_inst)}<div class="br-ing-tagline">${_tagline}</div></div><div class="br-ing-divider"></div>`;
    content.innerHTML = `<div class="br-document">
        ${headerHtml}
        <div class="br-ing-meta"><span class="br-ing-type">${_inst === 'DTP' ? 'Research' : _inst}</span>${dateStr ? `<span class="br-ing-sep">|</span><span class="br-ing-date">${dateStr}</span>` : ''}</div>
        <div class="br-doc-title">${item.title}</div>
        <div class="br-doc-body">${item.fullContent}</div>
        <div class="br-doc-footer"><a href="${item.url}" target="_blank" rel="noopener" class="br-ext-link">Lire l'original →</a></div>
      </div>`;
    _brFixImages(content);
    content.scrollTop = 0;
    const _full = (content.innerText || '').trim();
    if (brIns && _full.length > 200) _loadAIInsights({ id: item.id, headline: item.title, description: _full }, brIns);
    return;
  }

  fetch('/api/bank-research-content?url=' + encodeURIComponent(item.url))
    .then(r => r.json())
    .then(data => {
      if (!content) return;
      const _inst = _instBadge(item);
      const isIngDoc = _inst === 'ING';
      // En-tête : VRAI logo de la banque (ING, MUFG, Goldman…) avec repli wordmark si indispo.
      const _tagline = _inst === 'ING' ? 'THINK economic and financial analysis'
        : _inst === 'DTP' ? 'Institutional research' : _inst + ' Research';
      const headerHtml = `<div class="br-ing-header">${_instLogoHtml(_inst)}<div class="br-ing-tagline">${_tagline}</div></div><div class="br-ing-divider"></div>`;
      const origLabel = isIngDoc ? 'Lire l\'original sur ING Think →' : 'Lire l\'original →';
      if (data.html && data.html.length > 100) {
        const subtitle    = data.subtitle || item.description || '';
        const date        = data.date || dateStr;
        const country     = data.country || '';
        const articleType = data.articleType || 'Article';

        content.innerHTML = `
          <div class="br-document">
            ${headerHtml}

            <!-- ── Meta bar : type | date | country ── -->
            <div class="br-ing-meta">
              <span class="br-ing-type">${articleType}</span>
              ${date ? `<span class="br-ing-sep">|</span><span class="br-ing-date">${date}</span>` : ''}
              ${country ? `<span class="br-ing-country">${country}</span>` : ''}
            </div>

            <!-- ── Titre ── -->
            <div class="br-doc-title">${item.title}</div>

            <!-- ── Lead / Intro ── -->
            ${subtitle ? `<div class="br-ing-lead">${subtitle}</div>` : ''}

            <!-- ── Corps de l'article ── -->
            <div class="br-doc-body">${data.html}</div>

            <div class="br-doc-footer">
              <a href="${item.url}" target="_blank" rel="noopener" class="br-ext-link">${origLabel}</a>
            </div>
          </div>`;
      } else {
        // Contenu complet indisponible → on affiche TOUJOURS quelque chose d'utile :
        // l'aperçu (description du flux) rendu proprement, + lien source-aware.
        const preview = (item.description || '').trim();
        content.innerHTML = `
          <div class="br-document">
            ${headerHtml}
            <div class="br-ing-meta"><span class="br-ing-type">${item.institution && !isIngDoc ? 'DTP' : 'Research'}</span>${dateStr ? `<span class="br-ing-sep">|</span><span class="br-ing-date">${dateStr}</span>` : ''}</div>
            <div class="br-doc-title">${item.title}</div>
            ${preview ? `<div class="br-doc-body">${preview.split(/\n{2,}/).map(p => `<p>${p}</p>`).join('')}</div>`
                      : `<div class="br-no-content">Aperçu indisponible pour ce rapport.</div>`}
            <div class="br-doc-footer">
              <a href="${item.url}" target="_blank" rel="noopener" class="br-ext-link">${origLabel}</a>
            </div>
          </div>`;
      }
      _brFixImages(content);   // masque toute image cassée
      // Insights basés sur le VRAI contenu de l'article (la description seule est trop courte)
      const _full = (content.innerText || '').trim();
      if (brIns && _full.length > 200) _loadAIInsights({ id: item.id, headline: item.title, description: _full }, brIns);
    })
    .catch(() => {
      if (!content) return;
      const preview = (item.description || '').trim();
      content.innerHTML = `
        <div class="br-document">
          <div class="br-doc-title">${item.title}</div>
          ${dateStr ? `<div class="br-doc-date">${dateStr}</div>` : ''}
          ${preview ? `<div class="br-doc-body">${preview.split(/\n{2,}/).map(p => `<p>${p}</p>`).join('')}</div>` : ''}
          <div class="br-doc-footer"><a href="${item.url}" target="_blank" rel="noopener" class="br-ext-link">Lire l'original →</a></div>
        </div>`;
    });
}

function arlibShowList() {
  document.getElementById('arlib-list-view')?.classList.remove('hidden');
  document.getElementById('arlib-reader-view')?.classList.add('hidden');
}

function arlibShowReader() {
  document.getElementById('arlib-list-view')?.classList.add('hidden');
  document.getElementById('arlib-reader-view')?.classList.remove('hidden');
}

// ── Data helpers ─────────────────────────────────────────────────────────────

// Ordre d'affichage des 7 types de rapports dans l'onglet Analyst
const ARLIB_TYPE_ORDER = {
  'Global Economic Weekly':    0,
  'Weekly Market Recap':       1,
  'FX Daily':                  2,
  'Asia Opening Preparation':  3,
  'London Opening Preparation':4,
  'US Opening Preparation':    5,
  'Daily Event Review':        6,
  'Daily Market Recap':        7,
};

// ── Standardisation éditoriale des titres : "[Préfixe de session fixe]: [Sujet dynamique]" ──
// Catalogue exact (réplique Prime Terminal). Le préfixe dépend du type de rapport OU de la
// session du wrap ; le sujet est extrait du titre (fallback si le préfixe est absent).
const REPORT_PREFIX = {
  'Global Economic Weekly':     'Global Economic Weekly',
  'Weekly Market Recap':        'Weekly Market Recap',
  'FX Daily':                   'FX Daily',
  // Sessions — nomenclature demandée
  'Asia Opening Preparation':   'Daily Asia-Pac Opening News',
  'London Opening Preparation': 'London Opening Preparation',
  'US Opening Preparation':     'New York Opening Preparation',
  'Asia Session Recap':         'Asia-Pac Session Recap',
  'London Session Recap':       'London Session Recap',
  'US Session Recap':           'New York Session Recap',
  'Daily Event Review':         'Daily Event Review',
  'Daily Market Recap':         'Daily Market Recap',
};
// Tous les préfixes connus (valeurs du catalogue + variantes de session) pour détecter/normaliser
// un préfixe déjà présent dans un titre brut. Plus longs d'abord → pas de correspondance partielle.
const _ALL_PREFIXES = [...new Set([
  ...Object.values(REPORT_PREFIX),
  'Asia-Pac Session Recap', 'Asia Session Recap', 'Asia-Pacific Session Recap',
  'New York Session Recap', 'US Session Recap', 'Americas Session Recap',
  'Daily Asia-Pac Opening News', 'Asia Opening Preparation', 'US Opening Preparation',
])].sort((a, b) => b.length - a.length);

// Déduit le préfixe de session pour un SESSION WRAP InvestingLive (Asie/Europe/Amériques).
function _wrapSessionPrefix(item) {
  const s = `${item.session || ''} ${item.headline || item.title || ''}`;
  if (/asia|pacific|asie/i.test(s))                       return 'Asia-Pac Session Recap';
  if (/europe|london|londres/i.test(s))                   return 'London Session Recap';
  if (/americ|new york|north america|\bus\b|wall/i.test(s)) return 'New York Session Recap';
  return 'Session Recap';
}

function _reportPrefixFor(item) {
  if (item._reportType && REPORT_PREFIX[item._reportType]) return REPORT_PREFIX[item._reportType];
  // Articles ING THINK : série "FX Daily" reconnue par son titre
  if (item._source === 'ing-think' && /^\s*FX Daily\b/i.test(item.title || item.headline || '')) return 'FX Daily';
  // Session wraps InvestingLive → préfixe de session déduit
  if (item._source === 'investinglive') return _wrapSessionPrefix(item);
  return null;
}

// Renvoie le titre normalisé "Préfixe: Sujet". Détecte un préfixe déjà présent (même mal
// espacé, ex. "London Session Recap :"), sinon l'injecte ; pour les wraps, retire d'abord
// le préfixe d'origine "… markets wrap :" pour ne garder que le sujet.
function standardizeReportTitle(item) {
  let raw = arlibCleanTitle(item.headline || item.title || '')
    .replace(/\s*[—–-]?\s*Week Ending:\s*[\d.\/-]+\s*$/i, '')   // "Week Ending: …" → ligne dédiée uniquement
    .trim();
  const prefix = _reportPrefixFor(item);
  if (!prefix) return raw;
  // Wraps InvestingLive : on PRÉFÈRE le titre IA (résumé du thème de la séance) s'il est prêt ;
  // sinon on retire le préfixe source "X markets/session wrap :" pour isoler le sujet brut
  // (si le titre n'est QUE "… markets wrap" sans sujet → sujet vide → on garde le préfixe seul).
  if (item._source === 'investinglive') {
    if (item.aiTitle && item.aiTitle.trim().length >= 8) return `${prefix}: ${item.aiTitle.trim()}`;
    // Retire le préfixe source "… wrap" (markets/session/fx news wrap…) jusqu'au 1er "wrap"
    const wrapRe = /^\s*[\w\s.,/&'-]*?\bwraps?\b\s*[:\-—–]?\s*/i;
    if (wrapRe.test(raw)) raw = raw.replace(wrapRe, '').trim();
  }
  const escd = _ALL_PREFIXES.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const m = raw.match(new RegExp('^\\s*(?:' + escd + ')\\s*[:\\-—–]?\\s*', 'i'));
  const subject = (m ? raw.slice(m[0].length) : raw).trim();
  return subject ? `${prefix}: ${subject}` : prefix;
}
const ARLIB_ALLOWED_TYPES = new Set(Object.keys(ARLIB_TYPE_ORDER));

function getArlibItems() {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  // Session wraps InvestingLive…
  const wraps = (_sessionWraps || []).filter(i => i.timestamp > cutoff);
  // …+ UN SEUL Weekly Market Recap (le meilleur) — anti-doublon.
  // On rassemble tous les candidats (store /api/weekly-reports + flux temps réel), puis on n'en
  // garde QU'UN : priorité au format riche v2, puis au plus récent.
  const cand = [
    ...(_weeklyReports || []),
    ...(typeof allItems !== 'undefined' ? allItems : []).filter(i => i._reportType === 'Weekly Market Recap'),
  ].filter(i => i && i._reportType === 'Weekly Market Recap' && i.timestamp > cutoff);
  const best = cand.sort((a, b) => {
    const av = (a._weekly && a._weekly.v >= 2) ? 1 : 0;
    const bv = (b._weekly && b._weekly.v >= 2) ? 1 : 0;
    if (av !== bv) return bv - av;             // v2 d'abord
    return b.timestamp - a.timestamp;          // puis le plus récent
  })[0];
  // …+ les rapports FX Daily (ING THINK).
  const fx = (_fxDaily || []).filter(i => i.timestamp > cutoff);
  const seen = new Set();
  return [...(best ? [best] : []), ...fx, ...wraps]
    .filter(i => { if (seen.has(i.id)) return false; seen.add(i.id); return true; })
    .sort(_arlibReportSort);
}

// Rang de session d'un rapport (flux naturel de la journée de trading) : Asia → London → US.
function _sessionRank(item) {
  const s = ((item.session || '') + ' ' + (item._reportType || '') + ' ' + (item.headline || '')).toLowerCase();
  if (/asia|apac|asia-pacific|tokyo/.test(s))            return 0;   // Asia ouvre en 1er
  if (/london|europe|european|euro session/.test(s))     return 1;   // puis London/Europe
  if (/\bus\b|americas|america|new york|u\.s\./.test(s)) return 2;   // puis US/Americas
  return 3;   // FX Daily / Weekly / autres → après les session wraps du jour
}
// Tri LOGIQUE des rapports : jour le plus récent d'abord, et DANS un même jour, ordre des sessions
// Asia → London → US (au lieu du tri brut par timestamp qui donnait US → London → Asia).
function _arlibReportSort(a, b) {
  const dk = ts => new Date(ts || 0).toISOString().slice(0, 10);
  const da = dk(a.timestamp), db = dk(b.timestamp);
  if (da !== db) return db.localeCompare(da);       // jour le plus récent en haut
  const ra = _sessionRank(a), rb = _sessionRank(b);
  if (ra !== rb) return ra - rb;                    // même jour : Asia → London → US → reste
  return (b.timestamp || 0) - (a.timestamp || 0);   // sinon, le plus récent d'abord
}

function arlibItemType(item) {
  if (item._reportType === 'Weekly Market Recap' || item._reportType === 'Global Economic Weekly') return 'weekly';
  if (item._source === 'ing-think') return 'fxdaily';     // ING Think = FX Daily
  if (item._source === 'investinglive') return 'recap';
  if (item._reportType === 'London Session Recap' || item._reportType === 'US Session Recap') return 'recap';
  if (item._reportType === 'Daily Event Review') return 'briefing';
  if (item.source === 'PMT' || item._briefing) return 'briefing';
  const h = (item.headline || '').toLowerCase();
  if (/recap|review|wrap|summary/i.test(h)) return 'recap';
  if (item.category === 'Market Analysis') return 'fxdaily';
  return 'briefing';
}

// Détection de tags-clés (Fed, Inflation, Oil, Gold, Geopolitics, USD, EUR…) à partir d'un TEXTE.
const _ARLIB_TAG_CHECKS = [
  [/\bfed\b|fomc|powell|federal reserve/,         'Fed'],
  [/\becb\b|lagarde|eurozone/,                     'ECB'],
  [/\bboe\b|bailey|sterling/,                      'BoE'],
  [/\bboj\b|ueda|kuroda|yen\b|japan/,              'BoJ'],
  [/\brba\b|bullock|australia/,                    'RBA'],
  [/\bsnb\b|switzerland|\bchf\b|franc/,            'SNB'],
  [/\bboc\b|canada|\bcad\b|loonie/,                'BoC'],
  [/\bgdp\b|growth rate/,                          'GDP'],
  [/\bcpi\b|inflation|pce|hicp|ppi/,               'Inflation'],
  [/\bpmi\b|manufacturing|services|ism/,           'PMI'],
  [/payroll|\bnfp\b|jobless|unemployment|labou?r market/, 'Jobs'],
  [/trade|tariff/,                                 'Trade'],
  [/oil|crude|brent|opec|\bwti\b|energy|natural gas/, 'Oil'],
  [/gold|\bxau\b|silver|copper|metal/,             'Gold'],
  [/iran|russia|ukraine|israel|ceasefire|geopolit|war\b|missile|conflict/, 'Geopolitics'],
  [/nasdaq|s&p|equity|equities|stocks?\b|dow\b|dax|ftse/, 'Equities'],
  [/yield|treasury|bond|bund|gilt|jgb/,            'Bonds'],
  [/dollar|dxy|\busd\b/,                           'USD'],
  [/euro|\beur\b/,                                 'EUR'],
  [/\bgbp\b|sterling|pound/,                       'GBP'],
  [/\bjpy\b|yen/,                                  'JPY'],
  [/\baud\b|aussie/,                               'AUD'],
  [/bitcoin|\bbtc\b|crypto|ether|\beth\b/,         'Crypto'],
  [/china|pboc|yuan|\bcny\b/,                      'China'],
  [/asia|asian|apac/,                              'Asia'],
  [/hawk|dovish|rate cut|rate hike|rate hold|basis point|\bbps\b/, 'Rates'],
];
function _tagsFromText(text, cap = 12) {
  const h = (text || '').toLowerCase();
  const out = [];
  for (const [rx, label] of _ARLIB_TAG_CHECKS) { if (rx.test(h) && out.length < cap) out.push(label); }
  return out;
}
function arlibItemTags(item) {
  const tags = _tagsFromText(item.headline + ' ' + (item.description || ''));
  for (const t of (item.tags || [])) {
    if (!tags.includes(t) && !['High','Medium','FinancialJuice','PMT'].includes(t) && t !== item.category && tags.length < 12)
      tags.push(t);
  }
  return tags;
}
// Tags du rapport OUVERT (liste complète) + rendu façon PMT : 6 pills max + "+N", puis
// date + badge DTP à droite de la barre.
let _arlibCurrentTags = [];
function _renderArlibTags() {
  const scroll = document.getElementById('arlib-rtags-scroll');
  const tags = _arlibCurrentTags || [];
  if (scroll) {
    // Façon PMT : TOUS les tags dans une rangée scrollable (chevrons ‹ ›), sans troncature "+N".
    scroll.innerHTML = tags.map(t => `<span class="arlib-rtag">${t}</span>`).join('');
    scroll.scrollLeft = 0;
  }
  // Date retirée de cette rangée (façon PMT : ‹ tags › ; le badge DTP reste dans la barre du haut).
  const dateEl = document.getElementById('arlib-rdate');
  if (dateEl) dateEl.innerHTML = '';
  _updateArlibTagArrows();
  requestAnimationFrame(_updateArlibTagArrows);   // re-mesure après layout (scrollWidth fiable)
}
// Défilement horizontal des tags via les chevrons ‹ ›
function _arlibTagScroll(dir) {
  const s = document.getElementById('arlib-rtags-scroll');
  if (s) s.scrollBy({ left: dir * 180, behavior: 'smooth' });
}
// Masque les chevrons s'il n'y a rien à faire défiler ; sinon les affiche (façon PMT)
function _updateArlibTagArrows() {
  const s = document.getElementById('arlib-rtags-scroll');
  const prev = document.getElementById('arlib-rtags-prev');
  const next = document.getElementById('arlib-rtags-next');
  if (!s || !prev || !next) return;
  const overflow = s.scrollWidth > s.clientWidth + 4;
  prev.style.display = overflow ? 'flex' : 'none';
  next.style.display = overflow ? 'flex' : 'none';
}
// Enrichit les tags du rapport OUVERT à partir du CONTENU COMPLET (vue d'ensemble).
function _arlibEnrichTags(fullText) {
  if (!fullText || fullText.length < 80) return;
  const more = _tagsFromText(fullText, 16);
  _arlibCurrentTags = [...new Set([...(_arlibCurrentTags || []), ...more])].slice(0, 16);
  _renderArlibTags();
}

function arlibCleanTitle(headline) {
  return (headline || '')
    .replace(/^\s*(?:PRIMER\s*[—–-]|PREVIEW\s*[—–-]|ANALYSIS\s*[—–-])\s*/i, '')
    .replace(/^\s*investingLive\s*/i, '')
    .trim();
}

// ── Render card list ──────────────────────────────────────────────────────────

function renderArlibList() {
  const list = document.getElementById('arlib-list');
  if (!list) return;

  let items = getArlibItems();
  if (_arlibType   !== 'all') items = items.filter(i => arlibItemType(i) === _arlibType);
  if (_arlibCat    !== 'all') items = items.filter(i => i.category === _arlibCat);
  if (_arlibSearch)           items = items.filter(i =>
    (i.headline || '').toLowerCase().includes(_arlibSearch) ||
    (i.description || '').toLowerCase().includes(_arlibSearch));

  if (items.length === 0) {
    list.innerHTML = '<div class="arlib-empty">No reports found.<br>Generate briefings or wait for the next scheduled run.</div>';
    return;
  }

  list.innerHTML = '';
  for (const item of items) {
    const tags    = arlibItemTags(item);
    const shown   = tags.slice(0, 6);
    const extra   = tags.length - shown.length;
    const dateStr = new Date(item.timestamp).toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric' });
    const title   = standardizeReportTitle(item);

    // Source badge
    const isPMT  = item.source === 'PMT' || item._briefing || isPrimerItem(item);
    const isSW   = item._source === 'investinglive';
    const isING  = item._source === 'ing-think';
    const badgeLabel = isPMT ? 'DTP'
      : isSW  ? (item.session || 'SW').slice(0,3).toUpperCase()
      : isING ? 'FX'           // rapports ING Think dans Analyst = FX Daily → badge "FX"
      : '';
    const badgeClass = 'arlib-ptbadge-small';   // FX/SW/DTP : même style neutre (blanc) que les autres
    const badge = badgeLabel ? `<span class="${badgeClass}">${badgeLabel}</span>` : '';

    const card = document.createElement('div');
    const _isWeekly = item._reportType === 'Weekly Market Recap' || item._reportType === 'Global Economic Weekly';
    card.className = 'arlib-card' + (isRead(_reportReadKey(item)) ? ' arlib-card--read' : '') + (_isWeekly ? ' arlib-card--weekly' : '');
    card.dataset.id = item.id;
    card.innerHTML = `
      <div class="arlib-card-icon">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.2"/>
          <path d="M7 1C7 1 4.5 3.5 4.5 7s2.5 6 2.5 6" stroke="currentColor" stroke-width="1"/>
          <path d="M7 1C7 1 9.5 3.5 9.5 7s-2.5 6-2.5 6" stroke="currentColor" stroke-width="1"/>
          <line x1="1.5" y1="5.5" x2="12.5" y2="5.5" stroke="currentColor" stroke-width="1"/>
          <line x1="1.5" y1="8.5" x2="12.5" y2="8.5" stroke="currentColor" stroke-width="1"/>
        </svg>
      </div>
      <div class="arlib-card-body">
        <div class="arlib-card-top">
          <div class="arlib-card-title">${title}</div>
          <svg class="arlib-bookmark" width="12" height="14" viewBox="0 0 12 14" fill="none">
            <path d="M1 1h10v12l-5-3-5 3V1z" stroke="currentColor" stroke-width="1.2"/>
          </svg>
        </div>
        <div class="arlib-card-meta">
          <div class="arlib-card-tags">
            ${shown.map(t => `<span class="arlib-tag">${t}</span>`).join('')}
            ${extra > 0 ? `<span class="arlib-tag-extra">+${extra}</span>` : ''}
          </div>
          <div class="arlib-card-meta-right">
            ${badge}
            <span class="arlib-card-date">${dateStr}</span>
          </div>
        </div>
      </div>`;

    card.addEventListener('click', () => {
      markRead(_reportReadKey(item));
      card.classList.add('arlib-card--read');
      renderArlibReader(item);
      arlibShowReader();
    });
    list.appendChild(card);
  }
}

// ── Reader ────────────────────────────────────────────────────────────────────

// Charge et affiche les AI Insights (cartes) d'un rapport via Gemini
const _aiInsightsCache = {};      // cache navigateur : pas de requête à la réouverture d'un rapport
const _aiInsightsInflight = {};   // requêtes en vol (ck → Promise) : déduplique les appels simultanés
async function _loadAIInsights(item, el) {
  let text = (item.headline || '') + '\n' + String(item.description || item.content || '').replace(/<[^>]*>/g, ' ');
  // Session wraps / ING : la description est courte → on récupère le VRAI contenu du rapport
  // (sinon pas assez de texte pour générer les insights → panneau vide).
  if (text.replace(/\s+/g, ' ').trim().length < 220 && item.url) {
    try {
      const ep = item._source === 'ing-think' ? '/api/bank-research-content' : '/api/session-wrap-content';
      const c  = await fetch(ep + '?url=' + encodeURIComponent(item.url)).then(r => r.json());
      if (c && c.html && c.html.length > 80) {
        // On extrait les puces/paragraphes comme phrases distinctes (le fallback pourra les découper)
        const tmp = document.createElement('div'); tmp.innerHTML = c.html;
        const lines = [...tmp.querySelectorAll('li, p')].map(e => e.textContent.trim()).filter(s => s.length > 8);
        text = (item.headline || '') + '. ' + (lines.length ? lines.join('. ') : c.html.replace(/<[^>]*>/g, ' '));
      }
    } catch {}
  }
  if (text.replace(/\s+/g, ' ').trim().length < 60) { el.innerHTML = ''; return; }
  const ck = item.id || (item.headline || '').slice(0, 60);
  let d = _aiInsightsCache[ck];
  if (!d) {
    el.innerHTML = '<div class="ai-insights-head"><span class="ai-insights-dot">✦</span> AI Insights <span class="ai-insights-load">· analyse…</span></div>';
    try {
      // Déduplication : si une requête est déjà en vol pour CE rapport (ex. double appel
      // renderArlibReader + branche ING/wrap), on réutilise la même promesse → 1 seule requête.
      const p = _aiInsightsInflight[ck] || (_aiInsightsInflight[ck] = fetch('/api/report-insights', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // `lines` = puces réelles du rapport → secours = plusieurs petites cartes (1 par puce), jamais un gros bloc collé.
        body: JSON.stringify({ id: item.id, text, title: item.headline || item.title || '', lines: Array.isArray(item.lines) ? item.lines : undefined }),
      }).then(r => r.json()).finally(() => { delete _aiInsightsInflight[ck]; }));
      d = await p;
      // On ne met en cache que les VRAIS insights IA (pas le secours extractif) → ils pourront
      // être régénérés correctement une fois le quota revenu / le contenu complet chargé.
      if (d && d.insights && d.insights.length && !d.fallback) _aiInsightsCache[ck] = d;
    } catch { el.innerHTML = ''; return; }
  }
  {
    if (!d || !d.insights || !d.insights.length) { el.innerHTML = ''; return; }
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Cartes : en-tête optionnel (actif + badge signal BUY/SELL/NEUTRAL), comme Prime Terminal.
    const cards = d.insights.map(ins => {
      if (typeof ins === 'string') return `<div class="ai-insights-card"><div class="ai-card-text">${esc(ins)}</div></div>`;
      const asset = ins.asset || '';
      let sig = String(ins.signal || ins.bias || '').toUpperCase();
      if (sig === 'BULLISH') sig = 'BUY'; else if (sig === 'BEARISH') sig = 'SELL';
      if (!['BUY', 'SELL', 'NEUTRAL'].includes(sig)) sig = '';
      const head = asset
        ? `<div class="ai-card-head"><span class="ai-card-asset">${esc(asset)}</span>${sig ? `<span class="ai-bias ai-bias--${sig.toLowerCase()}">${sig}</span>` : ''}</div>`
        : '';
      return `<div class="ai-insights-card">${head}<div class="ai-card-text">${esc(ins.text || '')}</div></div>`;
    }).join('');
    const chip = `<img class="ai-insights-logo" src="/assets/images/macro-ai-logo.png" alt="Macro AI" width="16" height="16">`;
    // Cartes en ligne SCROLLABLE (comme l'onglet Analyst) — défilement manuel via les flèches
    el.innerHTML = `<div class="ai-insights-head">
        <span class="ai-insights-title">${chip} AI Insights</span>
        <span class="ai-insights-nav">
          <button type="button" onclick="aiInsScroll(this,-1)">‹</button>
          <span class="ai-insights-count">${d.insights.length} insights</span>
          <button type="button" onclick="aiInsScroll(this,1)">›</button>
        </span>
      </div>
      <div class="ai-insights-cards">${cards}</div>`;
  }
}

// Défilement des cartes AI Insights via les flèches (scopé au panneau cliqué)
function aiInsScroll(btn, dir) {
  const c = btn?.closest('.ai-insights-head')?.nextElementSibling;
  if (c) c.scrollBy({ left: dir * 290, behavior: 'smooth' });
}

// Icônes œil (propres, style PT)
const _EYE_OFF = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';
const _EYE     = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';

// Afficher / masquer la grille de cartes AI Insights (cible paramétrable : Analyst ou Institution)
function aiInsToggle(btn, hostId) {
  const host = document.getElementById(hostId || 'arlib-ai-insights');
  const c = host ? host.querySelector('.ai-insights-cards') : document.getElementById('ai-insights-cards');
  if (!c) return;
  const willHide = c.style.display !== 'none';
  c.style.display = willHide ? 'none' : '';
  btn.innerHTML = willHide ? `${_EYE} Afficher Insights` : `${_EYE_OFF} Masquer Insights`;
}

// ═══════════ WEEKLY MARKET RECAP — rendu riche (copie Prime Terminal) ═══════════
function _wrEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function _wrInline(t){ return _wrEsc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'); }
function _wrParas(t){
  return String(t||'').split(/\n{2,}|\n/).map(p=>p.trim()).filter(Boolean)
    .map(p=>`<p class="wr-p">${_wrInline(p)}</p>`).join('');
}

const _WR_ORDER = ['USD','EUR','JPY','GBP','CHF','AUD','CAD','NZD'];
const _WR_COLOR = { USD:'#ff7a00', EUR:'#dc2626', JPY:'#06b6d4', GBP:'#22c55e', AUD:'#2563eb', CHF:'#eab308', CAD:'#a855f7', NZD:'#ec4899' };
let _wrStrengthData = null;     // données de force (TW) chargées 1 seule fois pour tout le rapport
let _wrChartObserver = null;

// Rapport complet, lu de haut en bas (PAS de badges) : AI Insights → Résumé → Key Macro Highlights
// → Currency Analysis (chaque devise à la suite : analyse + courbe ISOLÉE + drivers).
function _renderWeeklyRecap(item) {
  const w = item._weekly || {};
  const titleEl    = document.getElementById('arlib-rnav-title');
  const tagsScroll = document.getElementById('arlib-rtags-scroll');
  const content    = document.getElementById('arlib-rcontent');
  const navRight   = document.querySelector('#arlib-reader-view .arlib-rnav-right');
  if (!content) return;
  document.getElementById('arlib-ai-insights')?.remove();

  const _range = w.weekRange || (w.weekEnding ? `Week Ending: ${w.weekEnding}` : '');
  const _wrTitle = standardizeReportTitle({ _reportType: 'Weekly Market Recap', headline: w.title });
  // Barre de navigation : titre seul (le "Week Ending: …" reste sous le titre dans le corps,
  // via .wr-doc-week — l'afficher aussi ici cassait la mise en page).
  if (titleEl) titleEl.textContent = _wrTitle;
  if (navRight) navRight.innerHTML = `<button class="arlib-hide-insights" onclick="aiInsToggle(this)">${_EYE_OFF} Masquer Insights</button><span class="arlib-dtp-badge">DTP</span>`;
  if (tagsScroll) tagsScroll.innerHTML = '';   // pas de badges : rapport lu de haut en bas

  // AI Insights (composant Institution, alimenté par les insights Gemini du recap)
  const chip = `<img class="ai-insights-logo" src="/assets/images/macro-ai-logo.png" alt="Macro AI" width="16" height="16">`;
  // Cartes : insights thématiques (texte) PUIS paires/instruments avec badge de biais (SELL/BUY/NEUTRAL)
  const textCards = (w.insights || []).map(t => `<div class="ai-insights-card">${_wrEsc(typeof t === 'string' ? t : (t.text || ''))}</div>`);
  const pairCards = (w.pairs || []).map(p => {
    const b = String(p.bias || 'NEUTRAL').toUpperCase();
    const cls = b === 'BUY' ? 'buy' : b === 'SELL' ? 'sell' : 'neutral';
    return `<div class="ai-insights-card ai-ins-pair">
      <div class="ai-ins-pair-head"><span class="ai-ins-pair-name">${_wrEsc(p.pair)}</span><span class="ai-ins-bias ai-ins-bias--${cls}">${_wrEsc(b)}</span></div>
      <div class="ai-ins-pair-text">${_wrEsc(p.text || '')}</div>
    </div>`;
  });
  const allCards = [...textCards, ...pairCards];
  const insightsHtml = allCards.length ? `
    <div id="arlib-ai-insights">
      <div class="ai-insights-head">
        <span class="ai-insights-title">${chip} AI Insights</span>
        <span class="ai-insights-nav">
          <button type="button" onclick="aiInsScroll(this,-1)">‹</button>
          <span class="ai-insights-count">${allCards.length} insights</span>
          <button type="button" onclick="aiInsScroll(this,1)">›</button>
        </span>
      </div>
      <div class="ai-insights-cards">${allCards.join('')}</div>
    </div>` : '';

  let body = '';
  // En-tête IDENTIQUE aux autres rapports ouverts (libellé type + titre + date + bordure),
  // pour que le Weekly s'ouvre exactement comme les autres rapports.
  body += `<div class="arlib-doc-header">
      <div class="arlib-doc-type">Weekly Market Recap</div>
      <div class="arlib-doc-title">${_wrEsc(_wrTitle)}</div>
      ${_range ? `<div class="arlib-doc-meta">${_wrEsc(w.weekEnding ? ('Week Ending: ' + w.weekEnding) : _range)}</div>` : ''}
    </div>`;
  if (w.summary) body += `<div class="wr-text wr-summary">${_wrParas(w.summary)}</div>`;
  if (w.macro && w.macro.length) {
    body += `<div class="wr-section-title">Key Macro Highlights</div>`;
    w.macro.forEach(s => {
      body += `<div class="wr-macro-heading">${_wrEsc(s.heading)}</div>`;
      (s.bullets||[]).forEach(b => { body += `<div class="wr-bullet">${_wrInline(b)}</div>`; });
    });
  }
  const ccys = _WR_ORDER.filter(c => w.currencies && w.currencies[c]);
  if (ccys.length) {
    body += `<div class="wr-section-title">Currency Analysis</div>`;
    ccys.forEach(c => {
      const cd = w.currencies[c];
      const analysis = (cd && typeof cd === 'object') ? (cd.analysis || '') : (cd || '');
      const drivers  = (cd && typeof cd === 'object' && Array.isArray(cd.drivers)) ? cd.drivers : [];
      body += `<div class="wr-ccy-block">`;
      body += `<div class="wr-ccy-title" style="color:${_WR_COLOR[c]||'#fff'}">${c}</div>`;
      body += `<div class="wr-text">${_wrParas(analysis)}</div>`;
      body += `<div class="wr-chart" data-wr-chart="${c}">${window.dtpLoader ? window.dtpLoader('Force ' + c + '…', { small: true }) : '<div class="wr-chart-loading">Chargement…</div>'}</div>`;
      drivers.forEach(d => {
        body += `<div class="wr-macro-heading">${_wrEsc(d.heading)}</div>`;
        if (d.detail) body += `<div class="wr-bullet">${_wrInline(d.detail)}</div>`;
      });
      body += `</div>`;
    });
  }

  content.innerHTML = `<div class="wr">${insightsHtml}<div class="wr-body">${body}</div></div>`;
  content.scrollTop = 0;

  // Une seule requête de force pour tout le rapport, puis chaque courbe isolée se construit
  // au défilement (lazy) → pas 8 graphiques d'un coup.
  _wrStrengthData = null;
  fetch('/api/currency-strength?period=week').then(r=>r.json()).then(d => {
    _wrStrengthData = (d && d.currencies) ? d : null;
    _wrLazyCharts(content);
  }).catch(() => {
    content.querySelectorAll('[data-wr-chart]').forEach(el => el.innerHTML = '<div class="wr-chart-loading">Force des devises indisponible.</div>');
  });
}

function _wrLazyCharts(content) {
  if (!_wrStrengthData || typeof buildStrengthChart !== 'function') return;
  if (_wrChartObserver) { try { _wrChartObserver.disconnect(); } catch {} }
  const charts = [...content.querySelectorAll('[data-wr-chart]')];
  charts.forEach((el, i) => { if (!el.id) el.id = 'wr-chart-' + el.dataset.wrChart + '-' + i; });
  _wrChartObserver = new IntersectionObserver((entries, obs) => {
    entries.forEach(e => {
      if (e.isIntersecting && !e.target.dataset.built) {
        e.target.dataset.built = '1';
        e.target.innerHTML = '';
        try { buildStrengthChart(e.target.id, _wrStrengthData, { focusCurrency: e.target.dataset.wrChart, isolated: true }); } catch {}
        obs.unobserve(e.target);
      }
    });
  }, { root: content, rootMargin: '300px 0px' });
  charts.forEach(el => _wrChartObserver.observe(el));
}

function renderArlibReader(item) {
  _currentArlibItem = item;   // keep ref for insights button
  if (item && item._weekly) { _renderWeeklyRecap(item); return; }   // ← rendu riche Weekly Recap
  document.getElementById('arlib-insights-panel')?.remove(); // reset any previous insights
  const titleEl    = document.getElementById('arlib-rnav-title');
  const tagsScroll = document.getElementById('arlib-rtags-scroll');
  const content    = document.getElementById('arlib-rcontent');
  if (!content) return;

  // ── AI Insights : cartes générées par IA, placées AU-DESSUS du contenu ──
  let insightsEl = document.getElementById('arlib-ai-insights');
  if (!insightsEl) {
    insightsEl = document.createElement('div');
    insightsEl.id = 'arlib-ai-insights';
    content.parentNode.insertBefore(insightsEl, content);
  }
  insightsEl.innerHTML = '';
  // Les sources à contenu ASYNCHRONE (session wraps InvestingLive, ING Think) rechargent les
  // insights APRÈS le chargement du contenu (avec le vrai texte complet). On NE les charge PAS
  // ici — sinon double requête + le panneau se VIDE pendant le chargement = les AI Insights
  // "disparaissent". On laisse un placeholder « analyse… » jusqu'à ce que le contenu soit prêt.
  const _asyncSrc = item && (item._source === 'investinglive' || item._source === 'ing-think');
  if (_asyncSrc) {
    insightsEl.innerHTML = `<div class="ai-insights-head"><span class="ai-insights-title"><img class="ai-insights-logo" src="/assets/images/macro-ai-logo.png" alt="Macro AI" width="16" height="16"> AI Insights</span> <span class="ai-insights-load">· analyse…</span></div>`;
  } else {
    _loadAIInsights(item, insightsEl);
  }

  // Bouton Masquer/Afficher Insights en haut du rapport (comme PT)
  const navRight = document.querySelector('#arlib-reader-view .arlib-rnav-right');
  if (navRight) navRight.innerHTML = `<button class="arlib-hide-insights" onclick="aiInsToggle(this)">${_EYE_OFF} Masquer Insights</button><span class="arlib-dtp-badge">DTP</span>`;

  // Titre IDENTIQUE au nom du rapport dans la liste Analyst (préfixe + sujet/titre IA)
  const title = standardizeReportTitle(item);
  const tags  = arlibItemTags(item);

  if (titleEl) titleEl.textContent = title;
  _arlibCurrentTags = tags;
  _renderArlibTags();   // pills façon PMT (6 max + "+N") + date & badge DTP à droite

  // ── Build content HTML ──
  let html = '';

  // Récupère les PUCES réellement rendues du rapport (texte propre, sans la pastille) → servent
  // de base aux AI Insights : 1 carte par puce = plusieurs petites cases, jamais un gros bloc.
  function _collectReportLines(root) {
    if (!root) return [];
    const out = [];
    root.querySelectorAll('.arlib-rbullet > span:not(.arlib-rbullet-dot), .arlib-rbullet-sub > span:not(.arlib-rbullet-dot)').forEach(s => {
      const t = (s.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length > 8) out.push(t);
    });
    return out.slice(0, 40);
  }

  // ── Fonction de parsing HTML commune (InvestingLive + ING Think) ─────────────
  function _parseHtmlToArlib(rawHtml, metaBar) {
    const tmp = document.createElement('div');
    tmp.innerHTML = rawHtml;
    tmp.querySelectorAll('img,figure,script,style,nav,iframe,.social-share,[class*="related"],[class*="subscribe"],[class*="sidebar"],[class*="sharedaddy"]').forEach(e => e.remove());

    let html = metaBar;
    let bulletCount = 0;
    const sources = []; // liens collectés → section SOURCES

    const fixLinks = s => (s || '').replace(/<a /g, '<a target="_blank" rel="noopener" style="color:#f7941d;text-decoration:none;" ');
    // Lignes d'attribution de source à masquer ("This article was written by X at investinglive.com", etc.)
    const _isSrcLine = t => /this article was written by|written by\s+[\w.\- ]+\s+at\b|\bat\s+(?:investinglive|think\.ing|fxstreet|actionforex|forexlive)\.com|follow .* on (?:twitter|x)\b|©\s*\d{4}/i.test(t || '');

    // ── Bloc AUTEURS (ING & autres) : JAMAIS affiché. On saute l'en-tête "Authors", les noms
    //    d'auteurs (en-têtes) et leurs bios, jusqu'au vrai contenu. Borné (anti-faux positif).
    let _authorMode = false, _authorSkipped = 0;
    const _sectionWord = /\b(outlook|market|markets|rates?|fx|today|tomorrow|summary|overview|forecast|view|analysis|economy|economic|inflation|policy|data|week|day|trade|risk|dollar|euro|pound|yen|currenc|bond|bonds|equit|commodit|oil|gold|gas|yield|cpi|gdp|pmi|session|recap|preview|highlights?|takeaways?)\b/i;
    const _isPersonName = t => {
      t = (t || '').trim(); const w = t.split(/\s+/);
      return w.length >= 2 && w.length <= 4 && t.length <= 42 && !/[:.]$/.test(t) && !_sectionWord.test(t)
        && w.every(x => /^[\p{Lu}][\p{L}'.\-]*$/u.test(x) || x === '&');
    };
    const _isAuthorBio = t => /\b(global head|regional head|head of (?:markets|research|fx|rates|strategy|economics)|chief economist|senior economist|fx strategist|fi strategist|rates strategist|strategist (?:covering|and|for|of|based)|economist (?:covering|at|for|and|based)|joined (?:the bank|ing|the firm)|provides? (?:short|medium)|short[- ]and medium[- ]term|medium[- ]term (?:fx )?recommendations|began (?:his|her) career|main focus is on)\b/i.test(t || '');
    // Renvoie true si la ligne appartient au bloc auteurs (→ ne pas rendre)
    const _skipAuthor = (text, isHeader) => {
      const t = (text || '').trim();
      if (/^authors?$/i.test(t)) { _authorMode = true; _authorSkipped = 0; return true; }   // en-tête "Authors"
      if (!_authorMode) return false;
      if (_authorSkipped >= 12) { _authorMode = false; return false; }                        // garde-fou : bloc borné
      if ((isHeader && _isPersonName(t)) || _isAuthorBio(t) || _isPersonName(t)) { _authorSkipped++; return true; }
      _authorMode = false;                                                                     // vrai contenu → fin du bloc
      return false;
    };

    const walk = (el) => {
      // Ignore les nœuds COMMENTAIRE (8) et INSTRUCTION (7) : une déclaration <?xml …?>
      // injectée via innerHTML devient un commentaire dont le texte "?xml version…" fuyait
      // en tant que puce. On ne traite que les vrais nœuds ÉLÉMENT (1) et TEXTE (3).
      if (el.nodeType === 8 || el.nodeType === 7) return;
      const tag = (el.tagName || '').toLowerCase();
      if (!tag) {
        if (el.nodeType !== 3) return;                       // pas un vrai nœud texte → on ignore
        const t = (el.textContent || '').trim();
        if (/^<?\s*\??\s*xml\b/i.test(t)) return;            // garde-fou : déclaration XML résiduelle
        if (_skipAuthor(t, false)) return;                   // bloc auteurs → jamais affiché
        if (t.length > 15 && !_isSrcLine(t)) { html += `<div class="arlib-rbullet"><span class="arlib-rbullet-dot"></span><span>${t}</span></div>`; bulletCount++; }
        return;
      }
      if (/^h[1-6]$/.test(tag)) {
        const t = el.textContent.trim();
        if (_skipAuthor(t, true)) return;                    // en-tête "Authors" / nom d'auteur → ignoré
        if (t) { html += `<hr class="arlib-rdivider"><div class="arlib-rsection">${t.toUpperCase()}</div>`; }
      } else if (tag === 'p') {
        const text = el.textContent.trim();
        if (!text || _isSrcLine(text)) return;
        // Paragraphe court terminant par ":" → section header
        const _isColonHead = /^[\w\s&/':()#–-]{1,45}:$/.test(text) && text.length <= 46;
        if (_skipAuthor(text, _isColonHead)) return;         // bio / nom d'auteur → ignoré
        if (_isColonHead) {
          html += `<hr class="arlib-rdivider"><div class="arlib-rsection">${text.slice(0,-1).toUpperCase()}</div>`;
          return;
        }
        const t = fixLinks(el.innerHTML.trim());
        if (text.length > 5) { html += `<div class="arlib-rbullet"><span class="arlib-rbullet-dot"></span><span>${t}</span></div>`; bulletCount++; }
      } else if (tag === 'li') {
        const a = el.querySelector('a[href]');
        const text = el.textContent.trim();
        if (!text || _isSrcLine(text)) return;
        if (_skipAuthor(text, false)) return;                // bio d'auteur en liste → ignoré
        if (a) {
          const href = a.getAttribute('href') || '';
          const lnk = fixLinks(el.innerHTML.trim());
          html += `<div class="arlib-rbullet"><span class="arlib-rbullet-dot"></span><span>${lnk}</span></div>`;
          if (href.includes('://') && text.length > 12) sources.push({ href, text });
        } else {
          html += `<div class="arlib-rbullet"><span class="arlib-rbullet-dot"></span><span>${_emphasize(text)}</span></div>`;   // plus de badge ▼/▲ inline (jugé moche)
        }
        bulletCount++;
      } else if (tag === 'blockquote') {
        const t = el.textContent.trim();
        if (t) html += `<div class="arlib-rbullet-sub"><span class="arlib-rbullet-dot"></span><span>${t}</span></div>`;
      } else if (tag === 'hr') {
        html += `<hr class="arlib-rdivider">`;
      } else if ((tag === 'strong' || tag === 'b') && !el.closest('p, li')) {
        const t = el.textContent.trim();
        if (_skipAuthor(t, true)) return;                    // en-tête "Authors" / nom d'auteur en gras → ignoré
        if (t.length > 3) html += `<hr class="arlib-rdivider"><div class="arlib-rsection">${t.toUpperCase()}</div>`;
        else Array.from(el.childNodes).forEach(walk);
      } else {
        Array.from(el.childNodes).forEach(walk);
      }
    };

    Array.from(tmp.childNodes).forEach(walk);

    // Fallback si rien n'a été produit
    if (bulletCount === 0) {
      html = metaBar;
      _authorMode = false; _authorSkipped = 0;
      tmp.querySelectorAll('p, li').forEach(el => {
        const raw = el.textContent.trim();
        if (raw.length > 5 && !_isSrcLine(raw) && !_skipAuthor(raw, false) && !_isAuthorBio(raw)) {
          const t = fixLinks(el.innerHTML).trim();
          html += `<div class="arlib-rbullet"><span class="arlib-rbullet-dot"></span><span>${t}</span></div>`;
        }
      });
    }

    // (Section SOURCES retirée — prenait trop de place)

    return html;
  }

  // ── InvestingLive session wraps ────────────────────────────────────────────────
  if (item._source === 'investinglive') {
    // Structure PMT UNIFIÉE pour TOUS les session wraps : type (orange) → titre (orange)
    // → sous-titre (orange) → date → corps. Identique quel que soit le contenu disponible.
    // Nomenclature VILLE (London / New York / Asia-Pac) — identique au titre (standardizeReportTitle)
    // → label, titre et sous-titre cohérents (fini "London" vs "European").
    const SESSION_LABEL = { 'Americas': 'New York Session Recap', 'European': 'London Session Recap', 'Asia-Pacific': 'Asia-Pac Session Recap' }[item.session] || 'Session Recap';
    const SUBTITLE = { 'Americas': 'Wrap-up of the New York trading session', 'European': 'Wrap-up of the London trading session', 'Asia-Pacific': 'Wrap-up of the Asia-Pacific trading session' }[item.session] || 'Daily market session wrap-up';
    const dateStr = new Date(item.timestamp).toLocaleDateString('fr-FR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
    const _header = '';   // en-tête retiré → on entame DIRECT le rapport (le titre reste dans la barre de navigation du lecteur)
    content.innerHTML = dtpLoader('Chargement du résumé de session…');

    fetch('/api/session-wrap-content?url=' + encodeURIComponent(item.url))
      .then(r => r.json())
      .then(data => {
        if (!content) return;
        if (data.html && data.html.length > 80) {
          content.innerHTML = _parseHtmlToArlib(data.html, _header);
        } else {
          const desc = item.description || '';
          content.innerHTML = desc.length > 20
            ? `${_header}<div class="arlib-rbullet"><span class="arlib-rbullet-dot"></span><span>${desc}</span></div>`
            : `${_header}<div class="arlib-rno-content">Contenu indisponible pour le moment.</div>`;
        }
        content.scrollTop = 0;
        // Insights basés sur le VRAI contenu rendu (la description seule est trop courte)
        const _full = (content.innerText || '').trim();
        _arlibEnrichTags(_full);   // + de tags-clés en en-tête (vue d'ensemble du rapport)
        const _lines = _collectReportLines(content);   // puces réelles → secours = plusieurs petites cartes
        if (_full.length > 200) _loadAIInsights({ id: item.id, headline: item.headline, description: _full, lines: _lines }, insightsEl);
      })
      .catch(() => {
        if (!content) return;
        const desc = item.description || '';
        content.innerHTML = _header
          + (desc ? `<div class="arlib-rbullet"><span class="arlib-rbullet-dot"></span><span>${desc}</span></div>` : `<div class="arlib-rno-content">Contenu indisponible pour le moment.</div>`);
      });
    return;
  }

  // ── ING Think research articles ───────────────────────────────────────────────
  if (item._source === 'ing-think') {
    const dateStr = new Date(item.timestamp).toLocaleDateString('fr-FR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
    content.innerHTML = dtpLoader('Chargement du rapport…');

    fetch('/api/bank-research-content?url=' + encodeURIComponent(item.url))
      .then(r => r.json())
      .then(data => {
        if (!content) return;
        const metaBar = `
          <div class="arlib-doc-header">
            <div class="arlib-doc-title">${standardizeReportTitle(item)}</div>
            <div class="arlib-doc-meta">${dateStr}</div>
            ${item.description ? `<div class="arlib-doc-desc">${item.description}</div>` : ''}
          </div>`;
        if (data.html && data.html.length > 100) {
          content.innerHTML = _parseHtmlToArlib(data.html, metaBar);
        } else {
          content.innerHTML = `${metaBar}<div class="arlib-rno-content">Contenu indisponible pour le moment.</div>`;
        }
        content.scrollTop = 0;
        const _full = (content.innerText || '').trim();
        _arlibEnrichTags(_full);   // + de tags-clés en en-tête (vue d'ensemble du rapport)
        const _lines = _collectReportLines(content);
        if (_full.length > 200) _loadAIInsights({ id: item.id, headline: item.headline, description: _full, lines: _lines }, insightsEl);
      })
      .catch(() => {
        if (!content) return;
        content.innerHTML = `<div class="arlib-rno-content">Contenu indisponible pour le moment.</div>`;
      });
    return;
  }

  if (item._briefing || item.source === 'PMT') {
    const bullets = parsePrimerBullets(item.description);
    if (!bullets.length) {
      html = `<div class="arlib-rno-content">No content — regenerate via /api/briefings/generate-all?force=1</div>`;
    } else {
      const dateStr = new Date(item.timestamp).toLocaleDateString('fr-FR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
      // Premier bullet = ligne méta (date/heure du rapport)
      html += `
        <div class="arlib-doc-header">
          <div class="arlib-doc-title">${standardizeReportTitle(item)}</div>
          <div class="arlib-doc-meta">${dateStr} · ${bullets[0]}</div>
        </div>`;
      let inSection = false;
      for (let i = 1; i < bullets.length; i++) {
        const line  = bullets[i];
        const isSub = /^↳/.test(line);
        const clean = isSub ? line.replace(/^↳\s*/, '') : line;
        const sec   = !isSub && clean.match(/^([A-Za-z\s&/]+):\s+(.+)$/);

        if (sec) {
          // Section header + first bullet on same line
          if (inSection) html += `<hr class="arlib-rdivider">`;
          html += `<div class="arlib-rsection">${sec[1].trim()}</div>`;
          html += `<div class="arlib-rbullet"><span class="arlib-rbullet-dot"></span><span>${sec[2]}</span></div>`;
          inSection = true;
        } else if (isSub) {
          html += `<div class="arlib-rbullet-sub"><span class="arlib-rbullet-dot"></span><span>${clean}</span></div>`;
        } else {
          html += `<div class="arlib-rbullet"><span class="arlib-rbullet-dot"></span><span>${clean}</span></div>`;
        }
      }
    }
  } else {
    const raw   = (item.description || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
    const lines = raw.split(/\n+/).map(l => l.trim()).filter(Boolean);
    if (lines.length) {
      lines.forEach(l => { html += `<div class="arlib-rbullet"><span class="arlib-rbullet-dot"></span><span>${l}</span></div>`; });
    } else {
      html = `<div class="arlib-rno-content">No extended content available.</div>`;
    }
  }

  content.innerHTML = html;
  content.scrollTop = 0;
}

// ═══ London Open Preparation ═════════════

const SECTION_COLORS = {
  geopolitical: '#e74c3c',
  centralbanks: '#5fa8d3',
  apac:         '#a78bfa',
  fx:           '#2ecc71',
  fixedincome:  '#1abc9c',
  commodities:  '#f7941d',
  data:         '#17c2c2',
  notable:      '#5fa8d3',
};

let _prepLoaded = false;

function renderLondonPrep(report) {
  const sub   = document.getElementById('prep-subtitle');
  const cnt   = document.getElementById('prep-news-count');
  const hl    = document.getElementById('prep-headline-banner');
  const hlTxt = document.getElementById('prep-headline-text');
  const body  = document.getElementById('prep-body');
  if (!body) return;

  if (sub) sub.textContent = report.generatedAt ? `Generated at ${report.generatedAt}` : '';
  if (cnt && report.newsCount) cnt.textContent = `${report.newsCount} headlines analysed`;

  if (report.headline && hl && hlTxt) {
    hlTxt.textContent = report.headline;
    hl.style.display = 'flex';
  }

  // Watchlist row
  let watchHtml = '';
  if (report.watchlist?.length) {
    const badges = report.watchlist.map(w => {
      const cls = w.bias === 'bullish' ? 'prep-watch--bull' : w.bias === 'bearish' ? 'prep-watch--bear' : 'prep-watch--neutral';
      const arrow = w.bias === 'bullish' ? '↑' : w.bias === 'bearish' ? '↓' : '→';
      return `<div class="prep-watch-badge ${cls}">
        <span class="prep-watch-pair">${w.pair}</span>
        <span class="prep-watch-arrow">${arrow}</span>
        <span class="prep-watch-reason">${w.reason}</span>
      </div>`;
    }).join('');
    watchHtml = `<div class="prep-watchlist"><div class="prep-watchlist-title">WATCHLIST</div><div class="prep-watchlist-row">${badges}</div></div>`;
  }

  // Key risks
  let risksHtml = '';
  if (report.keyRisks?.length) {
    const items = report.keyRisks.map(r => `<li>${r}</li>`).join('');
    risksHtml = `<div class="prep-risks"><div class="prep-risks-title">⚠ KEY RISKS FOR LONDON SESSION</div><ul class="prep-risks-list">${items}</ul></div>`;
  }

  // Sections
  const sectionsHtml = (report.sections || []).map(sec => {
    const col = SECTION_COLORS[sec.id] || '#17c2c2';
    const itemsHtml = (sec.items || []).map(item => {
      const timeMatch = item.match(/^(\d{1,2}:\d{2})\s*[—-]\s*/);
      if (timeMatch) {
        const time = timeMatch[1];
        const text = item.slice(timeMatch[0].length);
        return `<li class="prep-item"><span class="prep-item-time">${time}</span><span class="prep-item-text">${text}</span></li>`;
      }
      return `<li class="prep-item"><span class="prep-item-text">${item}</span></li>`;
    }).join('');
    const contentHtml = sec.content ? `<p class="prep-section-summary">${sec.content}</p>` : '';
    return `<div class="prep-section" data-sec="${sec.id}">
      <div class="prep-section-header" style="border-left-color:${col}">
        <span class="prep-section-icon">${sec.icon || '▸'}</span>
        <span class="prep-section-title">${sec.title}</span>
        <span class="prep-section-count">${(sec.items||[]).length}</span>
      </div>
      <div class="prep-section-body">
        ${contentHtml}
        <ul class="prep-items">${itemsHtml}</ul>
      </div>
    </div>`;
  }).join('');

  body.innerHTML = `<div class="prep-grid">${watchHtml}${risksHtml}${sectionsHtml}</div>`;
}

async function loadLondonPrep(force = false) {
  const body = document.getElementById('prep-body');
  if (body) body.innerHTML = dtpLoader('Generating London Open report…');
  try {
    const url = '/api/london-prep' + (force ? '?force=1' : '');
    const data = await fetch(url).then(r => r.json());
    if (data.error) throw new Error(data.error);
    renderLondonPrep(data);
  } catch (e) {
    if (body) body.innerHTML = `<div class="prep-loading"><span>⚠ Could not load report: ${e.message}</span></div>`;
  }
}

// Check if London prep should auto-notify (8:45–9:00 Paris time)
function checkLondonPrepWindow() {
  const paris = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const h = paris.getHours(), m = paris.getMinutes();
  const navEl = document.getElementById('london-prep-nav');
  const isWindow = (h === 8 && m >= 45) || (h === 8 && m <= 59);
  if (navEl && isWindow) navEl.classList.add('nav-item--prep-live');
  return isWindow;
}

document.addEventListener('DOMContentLoaded', () => {
  const refreshBtn = document.getElementById('prep-refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => loadLondonPrep(true));
  checkLondonPrepWindow();
  setInterval(checkLondonPrepWindow, 60 * 1000);
});

// ═══ Start ════════════════════════════════
document.addEventListener('DOMContentLoaded', init);

// ═══════════════════════════════════════════════════════════════
// NOTIFICATION PANEL  (np-)
// ═══════════════════════════════════════════════════════════════

// ── State ────────────────────────────────────────────────────
const _npItems    = [];          // all notification items (max 200)
const _npReadIds  = new Set();   // IDs already seen
let   _npEnabled  = JSON.parse(localStorage.getItem('np_enabled') ?? 'true');
let   _npVolume   = localStorage.getItem('np_volume')   || 'fort';   // mute | doux | fort
let   _npChime    = localStorage.getItem('np_chime')    || 'chime';
let   _npPush     = JSON.parse(localStorage.getItem('np_push')    ?? 'true');
let   _npFilter   = 'all';
let   _npOpen     = false;
let   _npAudioCtx = null;

// ── Filtres par catégorie (panneau "Filtre") ─────────────────
const NP_CATS = [
  { key: 'bias',     label: 'Smart Bias' },
  { key: 'research', label: 'Fichiers de recherche' },
  { key: 'posts',    label: 'Posts' },
  { key: 'analyst',  label: 'Analyst Report' },
  { key: 'admin',    label: 'Admin' },
  { key: 'risk',     label: 'Risk Sentiment' },
  { key: 'ticker',   label: 'News Ticker' },
  { key: 'calendar', label: 'Event Calendar' },
];
let _npCatFilters = {};
try { _npCatFilters = JSON.parse(localStorage.getItem('np_cat_filters') || '{}'); } catch {}
function _npCatOn(key) { return _npCatFilters[key] !== false; }
function _npItemCat(item) {
  if (item._reportNotif === 'analyst' || item._source === 'investinglive') return 'analyst';
  if (item._briefing || item.source === 'PMT') return 'analyst';
  const c = (item.category || '').toLowerCase();
  if (item._reportNotif === 'institution' || item._source === 'ing-think' || /research|institution/.test(c)) return 'research';
  if (/geopolit|risk|energy|sanction|war/.test(c)) return 'risk';
  if (/data|calendar|cpi|pmi|nfp|gdp|inflation|economic/.test(c)) return 'calendar';
  return 'ticker';
}

// Origine d'une notif (badge) : Squawk / Calendrier / Analyse / News
function _npOrigin(item) {
  if (item._reportNotif === 'institution' || item._source === 'ing-think') return { label: 'Institution', cls: 'analyst' };
  if (item._reportNotif === 'analyst' || item._source === 'investinglive') return { label: 'Analyst', cls: 'analyst' };
  if (item.source === 'FinancialJuice' || (item.id || '').startsWith('fj-')) return { label: 'Squawk', cls: 'squawk' };
  if (item._briefing || item.source === 'PMT') return { label: 'Analyse', cls: 'analyst' };
  const c = (item.category || '').toLowerCase();
  if (/data|calendar|cpi|pmi|nfp|gdp|inflation|economic/.test(c)) return { label: 'Calendrier', cls: 'cal' };
  if (/geopolit|risk|energy|sanction|war/.test(c)) return { label: 'Risque', cls: 'risk' };
  return { label: 'News', cls: 'news' };
}
// Retire toute attribution de source résiduelle de la description
function _npStripSrc(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')                                  // tags HTML éventuels
    .replace(/\b(?:written|reported|posted)\s+by\s+[^.]*?(?:at\s+[\w.]+)?\.?/gi, '')
    .replace(/\s*(?:source|via)\s*:\s*[^|.\n]+/gi, '')
    .replace(/\s{2,}/g, ' ').trim();
}

// ── DOM refs (deferred — DOM might not be ready yet) ──────────
function _npEl(id) { return document.getElementById(id); }

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  _npSyncUI();
  // Tabs
  document.querySelectorAll('.np-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.np-tab').forEach(b => b.classList.remove('np-tab--active'));
      btn.classList.add('np-tab--active');
      _npFilter = btn.dataset.nf;
      _npRenderList();
    });
  });
  // Tab arrows
  const scroll = _npEl('np-tabs-scroll');
  _npEl('np-tab-prev')?.addEventListener('click', () => { if(scroll) scroll.scrollLeft -= 120; });
  _npEl('np-tab-next')?.addEventListener('click', () => { if(scroll) scroll.scrollLeft += 120; });
  // Chime select
  _npEl('np-chime-select')?.addEventListener('change', e => {
    _npChime = e.target.value;
    localStorage.setItem('np_chime', _npChime);
    if (_npChime !== 'none') _npPlaySound(0.3);   // preview
    else _npStopVoice();                           // "Aucun son" → coupe aussi la voix en cours
  });
  // On open, pre-fill with recent important items from allItems
  // (done in npOpen)
});

// ── Toggle panel ─────────────────────────────────────────────
function npToggle() {
  _npOpen ? npClose() : npOpen();
}

function npOpen() {
  _closeOtherPanels('notif');
  _npOpen = true;
  // Repartir sur la liste (pas le panneau de filtres)
  _npEl('np-filter-panel')?.classList.add('hidden');
  const _l = _npEl('np-list'); if (_l) _l.style.display = '';
  // Pre-fill from allItems if panel is empty
  if (_npItems.length === 0 && allItems.length > 0) {
    const recent = allItems
      .filter(i => !(i._briefing || i.source === 'PMT' || isPrimerItem(i)))   // pas de primers/rapports
      .filter(i => i.priority === 'high' || i.urgent || i.category === 'Geopolitical')
      .slice(0, 40);
    recent.forEach(i => { if (!_npReadIds.has(i.id)) _npItems.push(i); });
    // If still empty, just take last 20
    if (_npItems.length === 0) allItems.slice(0, 20).forEach(i => _npItems.push(i));
  }
  _npRenderList();
  _npEl('np-panel')?.classList.add('open');
  _npEl('np-overlay')?.classList.add('open');
  _npEl('np-bell-btn')?.classList.add('np-bell--active');
  // Reset badge : on EFFACE le numéro (badge caché) à l'ouverture des notifs
  newCount = 0;
  _setNotifBadge(0);
}

function npClose() {
  _npOpen = false;
  _npEl('np-panel')?.classList.remove('open');
  _npEl('np-overlay')?.classList.remove('open');
  _npEl('np-bell-btn')?.classList.remove('np-bell--active');
}

// ── Enable/Disable ────────────────────────────────────────────
function npToggleEnabled() {
  _npEnabled = !_npEnabled;
  localStorage.setItem('np_enabled', JSON.stringify(_npEnabled));
  if (!_npEnabled) _npStopVoice();   // OFF = silence immédiat (coupe aussi la voix du squawk)
  _npSyncUI();
}

// ── Volume cycle: fort → doux → mute → fort ──────────────────
function npCycleVolume() {
  const cycle = { fort: 'doux', doux: 'mute', mute: 'fort' };
  _npVolume = cycle[_npVolume] || 'fort';
  localStorage.setItem('np_volume', _npVolume);
  _npSyncUI();
  if (_npVolume === 'mute') _npStopVoice();          // Muet = silence total immédiat (carillon + voix)
  else _npPlaySound(_npVolumeLevel());
}
function _npVolumeLevel() {
  return _npVolume === 'fort' ? 0.55 : _npVolume === 'doux' ? 0.2 : 0;
}
// Silence GLOBAL : "Muet" ou notifications OFF → AUCUN son dans l'app (carillon + voix squawk).
// Le réglage SON des notifications est le MAÎTRE de TOUT le son (carillon + voix squawk) :
// OFF, "Muet", OU carillon "Aucun" → silence TOTAL, y compris la voix qui lit les news.
function _npGlobalMute() { return !_npEnabled || _npVolume === 'mute' || _npChime === 'none'; }
// Coupe immédiatement TOUT son en cours : voix squawk (TTS) + carillon (suspend l'AudioContext).
function _npStopVoice() {
  try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch {}
  try { if (_npAudioCtx && _npAudioCtx.state === 'running') _npAudioCtx.suspend(); } catch {}
}

// ── Push toggle (Web Notifications API) ──────────────────────
function npTogglePush() {
  if (!_npPush) {
    // Request permission
    if ('Notification' in window) {
      Notification.requestPermission().then(p => {
        _npPush = p === 'granted';
        localStorage.setItem('np_push', JSON.stringify(_npPush));
        _npSyncUI();
      });
    }
  } else {
    _npPush = false;
    localStorage.setItem('np_push', JSON.stringify(_npPush));
    _npSyncUI();
  }
}
function npToggleFilter() {
  const fp = _npEl('np-filter-panel');
  const list = _npEl('np-list');
  if (!fp) return;
  const show = fp.classList.contains('hidden');
  fp.classList.toggle('hidden', !show);
  if (list) list.style.display = show ? 'none' : '';
  if (show) _npRenderFilters();
}
function _npRenderFilters() {
  const grid = _npEl('np-filter-grid');
  if (!grid) return;
  grid.innerHTML = NP_CATS.map(c => `
    <div class="np-filter-row" data-cat="${c.key}">
      <span class="np-filter-lbl">${c.label}</span>
      <span class="np-filter-toggle ${_npCatOn(c.key) ? 'on' : 'off'}">${_npCatOn(c.key) ? 'ON' : 'OFF'}</span>
    </div>`).join('');
  grid.querySelectorAll('.np-filter-row').forEach(row => {
    row.addEventListener('click', () => {
      const k = row.dataset.cat;
      _npCatFilters[k] = !_npCatOn(k);
      try { localStorage.setItem('np_cat_filters', JSON.stringify(_npCatFilters)); } catch {}
      const t = row.querySelector('.np-filter-toggle');
      t.classList.toggle('on', _npCatOn(k));
      t.classList.toggle('off', !_npCatOn(k));
      t.textContent = _npCatOn(k) ? 'ON' : 'OFF';
      _npRenderList();
    });
  });
}

// ── Push new items ────────────────────────────────────────────
function npPush(items) {
  if (!items?.length) return 0;
  let newOnes = 0;
  items.forEach(item => {
    if (item._briefing || item.source === 'PMT' || isPrimerItem(item)) return;   // pas de primers en notif
    if (_npReadIds.has(item.id)) return;
    _npReadIds.add(item.id);
    _npItems.unshift(item);
    newOnes++;
  });
  if (_npItems.length > 200) _npItems.length = 200;
  if (!newOnes) return 0;

  if (_npOpen) _npRenderList();

  if (!_npEnabled) return newOnes;

  // Sound
  if (_npVolume !== 'mute' && _npChime !== 'none') {
    _npPlaySound(_npVolumeLevel());
  }

  // Web Push notification (only for high priority items) — JAMAIS de son OS : on force silent:true
  // (le carillon interne est la SEULE source de son), et on ne crée RIEN si le son est coupé.
  const muted = (typeof _npGlobalMute === 'function' && _npGlobalMute());
  if (_npPush && !muted && 'Notification' in window && Notification.permission === 'granted') {
    const hi = items.find(i => i.priority === 'high' || i.urgent);
    if (hi) {
      new Notification('DataTradingPro', {
        body:   hi.headline,
        icon:   '/favicon.png',
        tag:    'dtp-' + hi.id,
        silent: true,   // pas de son OS — seul le carillon interne (respectant Muet) sonne
      });
    }
  }
  return newOnes;
}

// ── Notifications de NOUVEAUX RAPPORTS (Analyst = session wraps ; Institution = recherche) ──
// Nom STANDARDISÉ (nomenclature de session) + garde anti-spam : au 1er chargement on
// enregistre les IDs existants SANS notifier ; ensuite seul un rapport réellement nouveau
// (et récent < 36 h) déclenche une notification.
const _reportNotifSeen = { analyst: new Set(), institution: new Set() };
const _reportNotifInit = { analyst: false, institution: false };
function _notifyNewReports(items, kind) {
  if (!Array.isArray(items) || !items.length) return;
  const seen = _reportNotifSeen[kind];
  if (!_reportNotifInit[kind]) {                       // 1er passage : on mémorise, on ne notifie pas
    items.forEach(i => { if (i && i.id) seen.add(i.id); });
    _reportNotifInit[kind] = true;
    return;
  }
  const fresh = items.filter(i => i && i.id && !seen.has(i.id)
    && i.timestamp && (Date.now() - i.timestamp) < 36 * 3600 * 1000);
  if (!fresh.length) return;
  fresh.forEach(i => seen.add(i.id));
  const notifs = fresh.slice(0, 6).map(i => ({
    ...i,
    headline: standardizeReportTitle({ ...i, headline: i.headline || i.title }),
    _reportNotif: kind,
  }));
  npPush(notifs);
}

// ── Render list ───────────────────────────────────────────────
function _npRenderList() {
  const list  = _npEl('np-list');
  const empty = _npEl('np-empty');
  if (!list) return;

  const filtered = _npItems.filter(item => {
    if (!_npCatOn(_npItemCat(item))) return false;   // filtre par catégorie (panneau Filtre)
    if (_npFilter === 'analyst')  return item._briefing || item.source === 'PMT' || !!item._reportNotif || item._source === 'investinglive' || item._source === 'ing-think';
    if (_npFilter === 'risk')     return /geopolit|risk|energy|sanction/i.test(item.category || '');
    if (_npFilter === 'breaking') return item.priority === 'high' || item.urgent;
    return true; // 'all'
  });

  // Remove previous items (keep empty placeholder)
  list.querySelectorAll('.np-item').forEach(el => el.remove());

  if (filtered.length === 0) {
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  const frag = document.createDocumentFragment();
  filtered.slice(0, 80).forEach(item => {
    const el = document.createElement('div');
    el.className = 'np-item' + (item._new ? ' np-item--unread' : '');

    const iconClass = item.urgent ? 'np-icon--breaking' : item.priority === 'high' ? 'np-icon--high' : '';
    const iconSymbol = item.urgent ? '!' : 'i';
    const ago = _npTimeAgo(item.timestamp);
    const desc = _npStripSrc(item.description).slice(0, 140);
    const org = _npOrigin(item);

    el.innerHTML = `
      <div class="np-icon ${iconClass}">${iconSymbol}</div>
      <div class="np-item-body">
        <div class="np-item-headline">${item.headline || ''}</div>
        ${desc ? `<div class="np-item-desc">${desc}</div>` : ''}
        <div class="np-item-meta">
          <span class="np-origin np-origin--${org.cls}">${org.label}</span>
          <span class="np-item-time">${ago}</span>
        </div>
      </div>`;

    el.onclick = () => {
      npClose();
      // Scroll to item in main list if possible
      const mainEl = document.querySelector(`[data-id="${item.id}"]`);
      if (mainEl) mainEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    frag.appendChild(el);
  });
  list.appendChild(frag);
}

function _npTimeAgo(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60)  return diff + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

// ── Sync UI state ─────────────────────────────────────────────
function _npSyncUI() {
  // Main toggle
  const tog = _npEl('np-main-toggle');
  const lbl = _npEl('np-main-lbl');
  if (tog) tog.classList.toggle('off', !_npEnabled);
  if (lbl) lbl.textContent = _npEnabled ? 'ON' : 'OFF';

  // Volume button
  const volLbl = _npEl('np-vol-lbl');
  const volBtn = _npEl('np-vol-btn');
  const volMap = { fort: 'Fort', doux: 'Doux', mute: 'Muet' };
  if (volLbl) volLbl.textContent = volMap[_npVolume] || 'Fort';
  if (volBtn) volBtn.style.opacity = _npVolume === 'mute' ? '0.4' : '1';

  // Push toggle
  const pt   = _npEl('np-push-toggle');
  const ps   = _npEl('np-push-state');
  if (pt) pt.classList.toggle('off', !_npPush);
  if (ps) ps.textContent = _npPush ? 'ON' : 'OFF';

  // Chime select
  const sel = _npEl('np-chime-select');
  if (sel) {
    sel.value = _npChime;
    // En SILENCE (Muet OU notifications OFF) : type de son verrouillé + grisé (non modifiable).
    // NB : "Aucun son" est un choix valide, donc il ne grise PAS le select.
    const silenced = !_npEnabled || _npVolume === 'mute';
    sel.disabled = silenced;
    sel.classList.toggle('np-select--locked', silenced);
  }
}

// ── Sound engine (Web Audio API — no audio files needed) ──────
function _npPlaySound(volume) {
  // Garde dure : aucun son si OFF / Muet / carillon désactivé, quel que soit l'appelant
  if (typeof _npGlobalMute === 'function' && _npGlobalMute()) return;
  if (volume <= 0) return;
  try {
    if (!_npAudioCtx) _npAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _npAudioCtx;
    if (ctx.state === 'suspended') ctx.resume();

    if (_npChime === 'none') return;

    const presets = {
      chime: [{ f: 523.25, t: 0 }, { f: 659.25, t: 0.14 }, { f: 783.99, t: 0.28 }], // C5 E5 G5
      ding:  [{ f: 880, t: 0 }, { f: 659.25, t: 0.18 }],
      alert: [{ f: 440, t: 0 }, { f: 440, t: 0.1 }, { f: 550, t: 0.2 }],
    };
    const notes = presets[_npChime] || presets.chime;

    notes.forEach(({ f, t }) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = f;
      const start = ctx.currentTime + t;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9);
      osc.start(start);
      osc.stop(start + 0.92);
    });
  } catch (e) {
    // AudioContext might be blocked before user interaction — silent fail
  }
}

// ═══════════════════════════════════════════════════════════════
// LIVE SQUAWK  (sqwk-) — flux de commentaire de marché mot-par-mot
// ═══════════════════════════════════════════════════════════════
const _sqwkMessages = [];           // { id, ts, text }
let   _sqwkAuto       = false;
let   _sqwkAutoTimer  = null;       // tick toutes les 10s
let   _sqwkStreamTimer = null;      // sous-intervalle mot-par-mot (150ms)

const _sqwkProcessed = new Set();   // IDs de news déjà diffusées (anti-doublon)
let   _sqwkLive       = false;       // Squawk LIVE = audio/voix (bouton play) — indépendant du texte auto
let   _sqwkStarted    = false;       // flux déjà amorcé (évite de re-marquer l'existant à chaque toggle)

function _sqwkTime() { return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function _sqwkEsc(s)  { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Une VRAIE news exploitable pour le squawk (pas de rapport/primer/bruit)
function _sqwkUsable(it) {
  if (!it || !it.headline) return false;
  if (it._briefing || it.source === 'PMT' || (typeof isPrimerItem === 'function' && isPrimerItem(it))) return false;
  const h = it.headline;
  if (/^\[No Title\]|^RT @|^@[A-Za-z]/.test(h)) return false;
  return h.replace(/[^a-z0-9]/gi, '').length >= 14;
}

function _sqwkRender() {
  const list = document.getElementById('sqwk-list');
  if (!list) return;
  if (!_sqwkMessages.length) { list.innerHTML = '<div class="sqwk-empty">Activez la connexion automatique pour diffuser les news en direct.</div>'; return; }
  list.innerHTML = _sqwkMessages.map(m =>
    `<div class="sqwk-row"><span class="sqwk-time">${m.ts}</span><span class="sqwk-text" id="sqwk-txt-${m.id}">${_sqwkEsc(m.text)}</span></div>`
  ).join('');
}

// Voix "salle de marché" (Web Speech API, gratuite) — synchronisée avec l'écriture
function _sqwkSpeak(text) {
  if (!_sqwkLive || !('speechSynthesis' in window)) return;
  if (typeof _npGlobalMute === 'function' && _npGlobalMute()) return;   // "Muet"/OFF des notifs = silence global (pas de voix)
  try {
    window.speechSynthesis.cancel();   // coupe la phrase précédente (pas d'empilement)
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.pitch = 0.9; u.rate = 1.0; u.volume = 1;
    const v = (window.speechSynthesis.getVoices() || []).find(x => /en[-_]US/i.test(x.lang));
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
  } catch {}
}

// Diffuse une VRAIE news : ligne en haut + écriture mot-par-mot + voix synchrone
function _sqwkStreamNews(item) {
  const text  = String(item.headline).replace(/\s+/g, ' ').trim();
  const words = text.split(' ');
  const msg   = { id: 'sq-' + item.id, ts: _sqwkTime(), text: '' };
  _sqwkMessages.unshift(msg);
  if (_sqwkMessages.length > 80) _sqwkMessages.length = 80;
  _sqwkRender();
  _sqwkSpeak(text);                                    // l'audio démarre PILE quand l'écriture commence
  let i = 0;
  clearInterval(_sqwkStreamTimer);
  _sqwkStreamTimer = setInterval(() => {
    if (i >= words.length) { clearInterval(_sqwkStreamTimer); return; }
    msg.text += (msg.text ? ' ' : '') + words[i++];
    const el = document.getElementById('sqwk-txt-' + msg.id);
    if (el) el.textContent = msg.text;
  }, 150);
}

// Poll des vraies news (allItems alimenté en direct par le WebSocket) → la plus récente non diffusée
const _sqwkIsFJ = it => it.source === 'FinancialJuice' || (it.id || '').startsWith('fj-');
function _sqwkPollReal() {
  if (!_sqwkAuto && !_sqwkLive) return;   // flux actif si texte-auto OU squawk-live
  const src = (typeof allItems !== 'undefined' ? allItems : []);
  const fresh = src.filter(it => _sqwkUsable(it) && !_sqwkProcessed.has(it.id));
  if (!fresh.length) return;
  // Squawk FinancialJuice : on PRIORISE les flashes FJ ; à défaut, autre news réelle.
  const fjFresh = fresh.filter(_sqwkIsFJ);
  const item = (fjFresh.length ? fjFresh : fresh)[0];  // allItems trié récent → ancien
  fresh.forEach(it => _sqwkProcessed.add(it.id));      // on marque tout le batch (évite l'inondation)
  _sqwkStreamNews(item);
}

// Démarre/arrête le flux + met à jour l'UI selon les 2 états INDÉPENDANTS :
//   _sqwkAuto = flux texte (toggle "Connexion automatique")  |  _sqwkLive = audio/voix (bouton play)
function _sqwkRefresh() {
  const active = _sqwkAuto || _sqwkLive;   // le flux tourne si l'un OU l'autre est actif
  // Icône topbar : verte si le squawk est actif, ROUGE s'il est désactivé (off)
  document.getElementById('sqwk-btn')?.classList.toggle('sqwk-on', active);
  const st = document.getElementById('sqwk-toggle-state');
  const tg = document.getElementById('sqwk-toggle');
  const status = document.getElementById('sqwk-status');
  const play = document.getElementById('sqwk-play');
  if (st) st.textContent = _sqwkAuto ? 'ON' : 'OFF';
  if (tg) tg.classList.toggle('on', _sqwkAuto);
  // Bouton play = Squawk LIVE (audio) : carré rouge si live, triangle vert sinon
  if (play) { play.textContent = _sqwkLive ? '■' : '▶'; play.classList.toggle('sqwk-play--live', _sqwkLive); play.title = _sqwkLive ? 'Couper le squawk audio' : 'Activer le squawk audio (voix)'; }
  if (status) status.innerHTML = active
    ? '<span class="sqwk-dot sqwk-dot--live"></span> Connected'
    : '<span class="sqwk-dot"></span> Disconnected';
  document.getElementById('sqwk-live-note')?.classList.toggle('hidden', !active);

  clearInterval(_sqwkAutoTimer);
  if (active) {
    if (!_sqwkStarted) {   // au (re)démarrage : ne diffuser que les nouvelles news (l'existant = déjà vu, sauf la dernière)
      const usable = (typeof allItems !== 'undefined' ? allItems : []).filter(_sqwkUsable);
      usable.slice(1).forEach(it => _sqwkProcessed.add(it.id));
      _sqwkStarted = true;
      _sqwkPollReal();
    }
    _sqwkAutoTimer = setInterval(_sqwkPollReal, 15000);
  } else {
    _sqwkStarted = false;
    clearInterval(_sqwkStreamTimer);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }
}

// Toggle "Connexion automatique" = flux TEXTE (sans audio)
function sqwkToggleAuto() { _sqwkAuto = !_sqwkAuto; _sqwkRefresh(); }
// Bouton play = Squawk LIVE = AUDIO/voix (indépendant du texte auto)
function sqwkToggleLive() {
  _sqwkLive = !_sqwkLive;
  if (!_sqwkLive && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  _sqwkRefresh();
}

function sqwkOpen() {
  _closeOtherPanels('sqwk');
  document.getElementById('sqwk-panel')?.classList.add('open');
  document.getElementById('sqwk-overlay')?.classList.add('open');
  document.getElementById('sqwk-btn')?.classList.add('topbar-icon--active');
  _sqwkRender();
}
function sqwkClose() {
  document.getElementById('sqwk-panel')?.classList.remove('open');
  document.getElementById('sqwk-overlay')?.classList.remove('open');
  document.getElementById('sqwk-btn')?.classList.remove('topbar-icon--active');
  // On NE coupe PAS la voix si le squawk live est actif : il continue en arrière-plan (comme FinancialJuice).
  if (!_sqwkLive && 'speechSynthesis' in window) window.speechSynthesis.cancel();
}
function sqwkToggle() {
  document.getElementById('sqwk-panel')?.classList.contains('open') ? sqwkClose() : sqwkOpen();
}

// ═══════════════════════════════════════════════════════════════
// CHAT SUPPORT  (chat-) — conversation persistante avec le support
// ═══════════════════════════════════════════════════════════════
let _chatPollTimer = null;
let _chatLiveTimer = null;    // rafraîchissement live tant que le panneau est ouvert
let _chatSig = '';            // signature du dernier rendu (évite les re-rendus/scrolls inutiles)
let _chatThreadUser = null;   // (mode support) userId du thread ouvert
let _chatThreadName = '';
let _chatInboxCache = null;   // cache de la boîte de réception (rendu instantané)
const _chatMsgCache = {};     // cache des messages par thread (clé = userId ou 'client')
function _sigMsgs(m){
  const a = m||[]; let s = a.length + '|' + (a.length ? (a[a.length-1].id||a[a.length-1].text||'') : '');
  // inclut un résumé des réactions → détecte les changements (synchro des 2 côtés)
  s += '|' + a.map(x => x.reactions ? Object.keys(x.reactions).map(k=>k+(x.reactions[k]||[]).length).join('') : '').join(',');
  return s;
}
function _sigThreads(t){ return (t||[]).map(x=>x.user_id+':'+(x.unread||0)+':'+(x.lastAt||'')).join(','); }
function _chatEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Identité support affichée au client (modifiable) ──
const CHAT_SUPPORT_NAME  = 'Équipe de support';
const CHAT_SUPPORT_SUB   = 'Répond généralement en quelques minutes';
const CHAT_SUPPORT_AV    = 'DTP';                      // initiales (repli si la photo ne charge pas)
// Photo support (portrait pro/institutionnel). Modifiable : remplace l'URL par la tienne.
const CHAT_SUPPORT_PHOTO = 'https://images.unsplash.com/photo-1568602471122-7832951cc4c5?w=240&h=240&fit=crop&crop=faces&auto=format&q=88';
// Avatar support en HTML : photo + repli automatique sur les initiales si le chargement échoue.
function _chatSupportAvatarHtml(){
  if (!CHAT_SUPPORT_PHOTO) return _chatEsc(CHAT_SUPPORT_AV);
  return `<img src="${CHAT_SUPPORT_PHOTO}" alt="Support" referrerpolicy="no-referrer" `
       + `onerror="this.parentNode&&this.parentNode.classList.remove('has-photo');this.outerHTML='${CHAT_SUPPORT_AV}';">`;
}

// En-tête côté CLIENT (nom + sous-titre)
function _chatClientHead(){
  const n=document.getElementById('chat-head-name'); if(n) n.textContent=CHAT_SUPPORT_NAME;
  const s=document.getElementById('chat-head-sub');  if(s) s.innerHTML='<span class="chat-presence"></span>'+_chatEsc(CHAT_SUPPORT_SUB);
  const av=document.getElementById('chat-head-av');  if(av){ av.classList.add('has-photo'); av.innerHTML=_chatSupportAvatarHtml(); }
  document.getElementById('chat-back')?.classList.add('hidden');
  document.querySelector('.chat-input-bar')?.classList.remove('hidden');
  document.querySelector('.chat-hint')?.classList.remove('hidden');
}

// L'utilisateur courant est-il le support (admin) ? -> géré depuis son propre compte (ex. JustOneTrader)
function _chatCurUser(){ try { return window._pdUser || (typeof _pdUser !== 'undefined' ? _pdUser : null); } catch { return null; } }
function _chatIsSupport(){ const u = _chatCurUser(); return !!(u && (u.role === 'admin' || u.role === 'support')); }

// Panneaux topbar mutuellement exclusifs : ouvrir l'un ferme les autres
function _closeOtherPanels(except){
  try {
    if (except!=='ai'    && document.getElementById('ai-panel')?.classList.contains('open') && typeof aiClose==='function') aiClose();
    if (except!=='chat'  && document.getElementById('chat-panel')?.classList.contains('open')) chatClose();
    if (except!=='notif' && typeof _npOpen!=='undefined' && _npOpen) npClose();
    if (except!=='sqwk'  && document.getElementById('sqwk-panel')?.classList.contains('open')) sqwkClose();
    if (except!=='profile' && document.getElementById('pd-drawer')?.classList.contains('pd-open') && typeof pdClose==='function') pdClose();
  } catch {}
}

function chatToggle(){ document.getElementById('chat-panel')?.classList.contains('open') ? chatClose() : chatOpen(); }
function chatOpen(){
  _closeOtherPanels('chat');
  document.getElementById('chat-panel')?.classList.add('open');
  document.getElementById('chat-overlay')?.classList.add('open');
  document.getElementById('chat-btn')?.classList.add('topbar-icon--active');
  _chatSig = '';
  if (_chatIsSupport()) { _chatInbox(); }              // côté support : boîte de réception des conversations
  else { _chatClientHead(); _chatLoad(); }             // côté client : en-tête support + sa conversation
  _chatStartLive();                     // mise à jour en direct tant que le panneau reste ouvert
}
function chatClose(){
  document.getElementById('chat-panel')?.classList.remove('open');
  document.getElementById('chat-overlay')?.classList.remove('open');
  document.getElementById('chat-btn')?.classList.remove('topbar-icon--active');
  _chatStopLive();
  _chatThreadUser = null;               // au prochain ouverture, le support repart sur la boîte de réception
}

// ── Rafraîchissement live (panneau ouvert) ────────────────────
// Affiche / masque la ligne « <nom> est en train d'écrire… » en bas de la liste
function _chatSetTyping(on, name){
  const list = document.getElementById('chat-list'); if (!list) return;
  let el = list.querySelector('.chat-typing');
  if (!on){ if (el) el.remove(); return; }
  if (!el){
    el = document.createElement('div');
    el.className = 'chat-typing';
    list.appendChild(el);
  }
  // Subtil : pas de photo, juste un texte discret + petits points animés
  el.innerHTML = `<span class="chat-typing-text">${_chatEsc(name||'')} est en train d'écrire</span>`
    + `<span class="chat-typing-dots"><i></i><i></i><i></i></span>`;
  list.scrollTop = list.scrollHeight;
}
// Signale (throttlé) au serveur que l'on est en train d'écrire
let _chatTypingTs = 0;
function _chatSendTyping(){
  const now = Date.now();
  if (now - _chatTypingTs < 2500) return;   // au max une fois toutes les 2,5 s
  _chatTypingTs = now;
  const url = (_chatIsSupport() && _chatThreadUser)
    ? '/api/admin/chat/'+encodeURIComponent(_chatThreadUser)+'/typing'
    : '/api/chat/typing';
  fetch(url, { method:'POST' }).catch(()=>{});
}
function _chatStartLive(){ clearInterval(_chatLiveTimer); _chatLiveTimer = setInterval(_chatLiveTick, 4000); }
function _chatStopLive(){ clearInterval(_chatLiveTimer); _chatLiveTimer = null; }
async function _chatLiveTick(){
  if (!document.getElementById('chat-panel')?.classList.contains('open')) return;
  try {
    if (_chatIsSupport()){
      if (_chatThreadUser){
        const d = await (await fetch('/api/admin/chat/'+encodeURIComponent(_chatThreadUser))).json();
        const msgs = d.messages||[]; _chatMsgCache[_chatThreadUser] = msgs;
        const sig = _sigMsgs(msgs);
        if (sig !== _chatSig){ _chatSig = sig; _chatRender(msgs); }
        _chatSetTyping(d.typing, _chatThreadName);   // le client tape ?
        _chatPollUnread();   // garde le badge à jour (autres conversations non lues)
      } else {
        // Inbox : on rafraîchit conversations + liste utilisateurs (statut en ligne) en parallèle.
        const [threads, users] = await Promise.all([
          (await fetch('/api/admin/chat')).json().then(d => Array.isArray(d.threads) ? d.threads : null).catch(()=>null),
          (await fetch('/api/support/users')).json().then(d => Array.isArray(d.users) ? d.users : null).catch(()=>null),
        ]);
        if (threads !== null || users !== null) {        // refresh TOLÉRANT : jamais d'écrasement par du vide
          _chatInboxData = {
            threads: threads !== null ? threads : (_chatInboxData.threads || []),
            users:   users   !== null ? users   : (_chatInboxData.users   || []),
          };
          _chatInboxCache = _chatInboxData;
          _chatSetBadge((_chatInboxData.threads||[]).filter(t=>(t.unread||0)>0).length);
          _chatRenderInbox();
        }
      }
    } else {
      const d = await (await fetch('/api/chat')).json();
      const msgs = d.messages||[]; _chatMsgCache.client = msgs;
      const sig = _sigMsgs(msgs);
      if (sig !== _chatSig){ _chatSig = sig; _chatRender(msgs); _chatSetBadge(0); }
      _chatSetTyping(d.typing, 'Support DataTradingPro');   // le support tape ?
    }
  } catch {}
}

// ── MODE SUPPORT (admin) ──────────────────────────────────────
function _chatHead(name, sub, showBack, showInput){
  const n = document.getElementById('chat-head-name'); if (n) n.textContent = name;
  const s = document.getElementById('chat-head-sub');  if (s) s.textContent = sub;
  const av = document.getElementById('chat-head-av');  if (av) av.textContent = (name||'?').charAt(0).toUpperCase();
  document.getElementById('chat-back')?.classList.toggle('hidden', !showBack);
  document.querySelector('.chat-input-bar')?.classList.toggle('hidden', !showInput);
  document.querySelector('.chat-hint')?.classList.toggle('hidden', !showInput);
}
function _chatBackToInbox(){ _chatThreadUser = null; _chatInbox(); }

let _chatInboxData  = { threads: [], users: [] };
let _chatInboxQuery = '';
function _chatInbox(){
  _chatThreadUser = null;
  _chatHead('Boîte de réception', 'Conversations clients · Support', false, false);
  const sb = document.getElementById('chat-search-bar'); if (sb) sb.style.display = 'flex';   // recherche visible
  const list = document.getElementById('chat-list');
  if (_chatInboxCache){ _chatInboxData = _chatInboxCache; _chatRenderInbox(); }
  else if (list) list.innerHTML = (window.dtpLoader ? window.dtpLoader('Chargement…') : '<div class="chat-empty">Chargement…</div>');
  // Chargement TOLÉRANT aux pannes : on ne remplace JAMAIS la liste par du vide sur une erreur
  // réseau / 500 / auth (cold-start Render, latence Supabase…). On garde la dernière liste connue.
  // → fini le faux bug « Aucun utilisateur » dû à un simple hoquet de chargement.
  Promise.all([
    fetch('/api/admin/chat').then(r => r.ok ? r.json() : Promise.reject(r.status)).then(d => Array.isArray(d.threads) ? d.threads : null).catch(() => null),
    fetch('/api/support/users').then(r => r.ok ? r.json() : Promise.reject(r.status)).then(d => Array.isArray(d.users) ? d.users : null).catch(() => null),
  ]).then(([threads, users])=>{
    if (threads === null && users === null) {            // les DEUX ont échoué → on NE blanchit pas
      if (!_chatInboxCache && list) list.innerHTML = `<div class="chat-empty">Chargement impossible — <button type="button" class="chat-retry-btn" onclick="_chatInbox()">réessayer</button></div>`;
      return;
    }
    _chatInboxData = {
      threads: threads !== null ? threads : (_chatInboxData.threads || []),   // garde l'ancien si échec partiel
      users:   users   !== null ? users   : (_chatInboxData.users   || []),
    };
    _chatInboxCache = _chatInboxData;
    _chatSetBadge((_chatInboxData.threads || []).filter(t => (t.unread || 0) > 0).length);
    _chatRenderInbox();
  });
}
// Recherche d'un utilisateur (par nom/email) — filtre le rendu sans perdre la saisie.
function _chatSearchUsers(q){ _chatInboxQuery = (q || '').toLowerCase().trim(); _chatRenderInbox(); }

function _chatRenderInbox(){
  const list = document.getElementById('chat-list'); if (!list) return;
  if (_chatThreadUser) return;   // on n'écrase pas une conversation ouverte
  const threads = (_chatInboxData && _chatInboxData.threads) || [];
  const users   = (_chatInboxData && _chatInboxData.users)   || [];
  // Compteur "en ligne" épuré à droite de la barre de recherche
  const onlineN = users.filter(u => u.online).length;
  const ocEl = document.getElementById('chat-online-n'); if (ocEl) ocEl.textContent = onlineN;
  const ocWrap = document.getElementById('chat-online-count'); if (ocWrap) ocWrap.style.display = 'inline-flex';
  const userById = new Map(users.map(u => [String(u.id), u]));
  const threadIds = new Set(threads.map(t => String(t.user_id)));
  // 1) Conversations existantes, puis 2) TOUS les autres utilisateurs (pour pouvoir les contacter).
  const entries = [];
  threads.forEach(t => entries.push({
    id: String(t.user_id), name: t.name || t.email || t.user_id, email: t.email || '',
    role: (userById.get(String(t.user_id)) || {}).role || 'user',
    last: t.last || '', lastAt: t.lastAt || 0, unread: t.unread || 0,
    online: !!(userById.get(String(t.user_id)) || {}).online, hasThread: true,
  }));
  users.forEach(u => { if (!threadIds.has(String(u.id))) entries.push({
    id: String(u.id), name: u.name || u.email || u.id, email: u.email || '',
    role: u.role || 'user', last: '', lastAt: 0, unread: 0, online: !!u.online, hasThread: false,
  }); });
  const q = _chatInboxQuery;
  const filtered = q ? entries.filter(e => (e.name + ' ' + e.email).toLowerCase().includes(q)) : entries;
  if (!filtered.length){ list.innerHTML = `<div class="chat-empty">${q ? 'Aucun utilisateur trouvé.' : 'Aucun client pour le moment.'}</div>`; return; }
  let html = '';
  filtered.forEach(e => {
    let last = e.last;
    if (/^data:image\//.test(last)) last = '📷 Image';
    else if (/^data:/.test(last))   last = '📎 Pièce jointe';
    const sub = e.hasThread ? _chatEsc(last.slice(0, 60)) : '<span class="chat-thread-start">Démarrer une conversation</span>';
    const when = e.lastAt ? new Date(e.lastAt).toLocaleString('fr-FR',{ day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
    const unread = e.unread>0 ? `<span class="chat-thread-badge">${e.unread>9?'9+':e.unread}</span>` : '';
    const roleTag = (e.role === 'admin' || e.role === 'support') ? `<span class="chat-role-tag">${_chatEsc(e.role)}</span>` : '';
    html += `<div class="chat-thread${e.unread>0?' chat-thread--unread':''}" onclick="_chatOpenThread('${_chatEsc(e.id)}','${_chatEsc(e.name).replace(/'/g,"\\'")}')">`
      + `<div class="chat-thread-av${e.online?' is-online':''}">${_chatEsc(e.name.charAt(0).toUpperCase())}<span class="chat-presence-dot" title="${e.online?'En ligne':'Hors ligne'}"></span></div>`
      + `<div class="chat-thread-body"><div class="chat-thread-top"><span class="chat-thread-name">${_chatEsc(e.name)}</span>${roleTag}${unread}</div>`
      + `<div class="chat-thread-last">${sub}</div></div>`
      + `<div class="chat-thread-when">${when}</div></div>`;
  });
  list.innerHTML = html;
}

function _chatOpenThread(userId, name){
  _chatThreadUser = userId; _chatThreadName = name;
  const sb = document.getElementById('chat-search-bar'); if (sb) sb.style.display = 'none';   // pas de recherche dans une conv
  _chatHead(name, 'Vous répondez en tant que support', true, true);
  const list = document.getElementById('chat-list');
  const cached = _chatMsgCache[userId];
  if (cached){ _chatSig = _sigMsgs(cached); _chatRender(cached); }   // instantané
  else { _chatSig=''; if (list) list.innerHTML = (window.dtpLoader ? window.dtpLoader('Chargement…') : '<div class="chat-empty">Chargement…</div>'); }
  fetch('/api/admin/chat/'+encodeURIComponent(userId)).then(r=>r.json()).then(d=>{
    const msgs = d.messages||[];
    _chatMsgCache[userId] = msgs;
    const sig = _sigMsgs(msgs);
    if (sig !== _chatSig){ _chatSig = sig; _chatRender(msgs); }   // côté support : 'support'=droite, 'user'=gauche
    _chatPollUnread();             // la conversation vient d'être lue → MAJ immédiate du badge
  }).catch(()=>{ /* échec transitoire : on garde le loader ; le live tick (4s) réessaie tout seul */ });
}

function _chatRender(messages){
  const list = document.getElementById('chat-list'); if(!list) return;
  if(!messages || !messages.length){
    list.innerHTML = '<div class="chat-empty">Vous êtes connecté au support DataTradingPro.<br>Nos spécialistes sont prêts — comment pouvons-nous vous aider ?</div>';
    return;
  }
  const support = _chatIsSupport();
  const myId = String((_chatCurUser() || {}).id || '');
  const avThemIsPhoto = !support;   // côté CLIENT, l'interlocuteur = support → photo
  const avThem = support ? _chatEsc((_chatThreadName||'?').charAt(0).toUpperCase()) : _chatSupportAvatarHtml();
  let html=''; let lastDate='';
  messages.forEach(m=>{
    const d = new Date(m.created_at);
    const dateLabel = d.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    if(dateLabel!==lastDate){ html+=`<div class="chat-date"><span>${dateLabel}</span></div>`; lastDate=dateLabel; }
    const time = d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    // support : mes bulles = 'support' ; client : mes bulles = 'user'
    const mine = support ? (m.sender==='support') : (m.sender==='user');
    const t = m.text || '';
    const isImg = /^data:image\//.test(t);
    let inner;
    if (isImg)                  inner = `<img class="chat-img" src="${t}" alt="image jointe" onclick="_chatLightbox(this.src)">`;
    else if (/^data:/.test(t))  inner = `<a class="chat-file" href="${t}" download>📎 Fichier joint</a>`;
    else                        inner = `<div class="chat-text">${_chatEsc(t)}</div>`;
    const mid = _chatEsc(String(m.id || ''));
    const isTxt = !/^data:/.test(t);
    // Menu ⋯ (modifier / supprimer) — SÉPARÉ des réactions, côté support uniquement
    const menu = support
      ? `<div class="chat-msg-menu"><button class="chat-menu-btn" type="button" title="Options" onclick="_chatToggleMenu(this)">⋯</button></div>`
      : '';
    html += `<div class="chat-row ${mine?'chat-row--me':'chat-row--them'}" data-mid="${mid}">`
      + (mine?'':`<div class="chat-av${avThemIsPhoto?' has-photo':''}">${avThem}</div>`)
      + `<div class="chat-bubble-wrap">`
      + `<div class="chat-bubble-row">`
      + `<div class="chat-bubble${isImg?' chat-bubble--img':''}">${inner}${_chatPickerHtml(mid)}</div>`
      + menu
      + `</div>`
      + _chatReactionsHtml(m, myId, mid)
      + `<div class="chat-meta">${time}${mine?' · '+(m.read?'Lu':'Envoyé'):''}</div>`
      + `</div></div>`;
  });
  list.innerHTML = html;
  list.scrollTop = list.scrollHeight;
}

// Icônes de réaction façon LinkedIn : badges ronds plats à glyphe blanc (pas d'emoji OS
// → rendu pro et identique sur tous les OS ; fini les emojis « façon Insta » de Windows).
const _REACT_ICONS = {
  '👍': '<span class="react-ic react-ic--like"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 21h4V9H2v12zm20-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L13.17 1 6.59 7.59C6.22 7.95 6 8.45 6 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg></span>',
  '❤️': '<span class="react-ic react-ic--love"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg></span>',
};
function _reactIcon(em){ return _REACT_ICONS[em] || em; }
// Sélecteur de réaction : petite barre flottante au survol de la bulle (icônes LinkedIn).
function _chatPickerHtml(mid){
  return `<div class="chat-react-picker">`
    + `<button type="button" title="J'aime" onclick="_chatReact('${mid}','👍')">${_reactIcon('👍')}</button>`
    + `<button type="button" title="Cœur" onclick="_chatReact('${mid}','❤️')">${_reactIcon('❤️')}</button></div>`;
}
// Pastilles des réactions POSÉES (façon LinkedIn) — sous la bulle ; surlignées si J'AI réagi.
function _chatReactionsHtml(m, myId, mid){
  const r = (m && m.reactions && typeof m.reactions === 'object') ? m.reactions : {};
  let pills = '';
  ['👍','❤️'].forEach(em=>{
    const arr = Array.isArray(r[em]) ? r[em] : [];
    if (!arr.length) return;
    const mine = arr.map(String).includes(myId);
    pills += `<button class="chat-reaction-pill${mine?' mine':''}" type="button" onclick="_chatReact('${mid}','${em}')">${_reactIcon(em)}<span class="n">${arr.length}</span></button>`;
  });
  return `<div class="chat-reactions">${pills}</div>`;   // toujours présent (cible de MAJ chirurgicale)
}

// Clé de cache des messages selon le contexte (support→thread user, client→'client')
function _chatCacheKey(){ return (_chatIsSupport() && _chatThreadUser) ? _chatThreadUser : 'client'; }

// MAJ chirurgicale des pastilles d'UN message (pas de re-render complet → pas de saut de scroll)
function _chatUpdateReactions(id){
  const myId = String((_chatCurUser() || {}).id || '');
  const arr = _chatMsgCache[_chatCacheKey()];
  const msg = Array.isArray(arr) ? arr.find(x=>String(x.id)===String(id)) : null;
  if (!msg) return;
  const sel = (window.CSS && CSS.escape) ? CSS.escape(String(id)) : String(id);
  const el = document.querySelector(`.chat-row[data-mid="${sel}"] .chat-reactions`);
  if (el) el.outerHTML = _chatReactionsHtml(msg, myId, _chatEsc(String(id)));
}

// Réagir à un message (toggle) — INSTANTANÉ (optimiste, MAJ ciblée) puis persistance serveur.
// UNE seule réaction par personne. Ne fait JAMAIS disparaître la réaction sur une réponse vide/erreur.
function _chatReact(id, emoji){
  if (!id) return;
  const myId = String((_chatCurUser() || {}).id || '');
  const arr = _chatMsgCache[_chatCacheKey()];
  const msg = Array.isArray(arr) ? arr.find(x=>String(x.id)===String(id)) : null;
  if (msg){
    const src = (msg.reactions && typeof msg.reactions === 'object') ? msg.reactions : {};
    const had = Array.isArray(src[emoji]) && src[emoji].map(String).includes(myId);
    const r = {};
    ['👍','❤️'].forEach(k=>{ const a2 = Array.isArray(src[k]) ? src[k].map(String).filter(x=>x!==myId) : []; if (a2.length) r[k]=a2; });
    if (!had){ (r[emoji] = r[emoji] || []).push(myId); }
    msg.reactions = r;
    _chatSig = _sigMsgs(arr);
    _chatUpdateReactions(id);
  }
  fetch('/api/chat/react', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ id, emoji }) })
    .then(r=>r.json()).then(d=>{
      if (!d || d.reactions == null) return;   // 401/erreur/vide → on GARDE l'état optimiste (plus de disparition)
      const a2 = _chatMsgCache[_chatCacheKey()];
      const m2 = Array.isArray(a2) ? a2.find(x=>String(x.id)===String(id)) : null;
      if (m2){ m2.reactions = d.reactions; _chatSig = _sigMsgs(a2); _chatUpdateReactions(id); }
    }).catch(()=>{});
}

// Menu ⋯ d'un message → menu INLINE sous le message (jamais coupé par l'overflow, 100% responsive)
function _chatToggleMenu(btn){
  const wrap = btn.closest('.chat-bubble-wrap'); if (!wrap) return;
  const open = wrap.querySelector('.chat-menu-inline');
  document.querySelectorAll('.chat-menu-inline').forEach(el => { if (el !== open) el.remove(); });
  if (open){ open.remove(); return; }
  const row = wrap.closest('.chat-row');
  const mid = row ? row.dataset.mid : '';
  const isTxt = !!wrap.querySelector('.chat-text');
  const m = document.createElement('div');
  m.className = 'chat-menu-inline';
  m.innerHTML = (isTxt ? `<button type="button" class="chat-menu-i-edit">✎ Modifier</button>` : '')
    + `<button type="button" class="chat-menu-i-del">🗑 Supprimer</button>`;
  wrap.appendChild(m);
  if (isTxt) m.querySelector('.chat-menu-i-edit').onclick = () => { m.remove(); _chatEditMsg(mid); };
  m.querySelector('.chat-menu-i-del').onclick = () => { m.remove(); _chatDeleteMsg(mid); };
}
document.addEventListener('click', e => {   // clic ailleurs → ferme les menus inline
  if (!e.target.closest || (!e.target.closest('.chat-msg-menu') && !e.target.closest('.chat-menu-inline')))
    document.querySelectorAll('.chat-menu-inline').forEach(el => el.remove());
});

// Admin : supprimer un message — confirmation INLINE dans le message (plus de fenêtre native)
function _chatDeleteMsg(id){
  if (!id) return;
  const sel = (window.CSS && CSS.escape) ? CSS.escape(String(id)) : String(id);
  const row = document.querySelector(`.chat-row[data-mid="${sel}"]`);
  const wrap = row && row.querySelector('.chat-bubble-wrap');
  if (!wrap) { _chatDoDelete(id); return; }
  if (wrap.querySelector('.chat-del-confirm')) return;             // déjà affichée
  const c = document.createElement('div');
  c.className = 'chat-del-confirm';
  c.innerHTML = `<button type="button" class="chat-del-yes">Supprimer</button>`
    + `<button type="button" class="chat-del-no">Annuler</button>`;
  wrap.appendChild(c);
  c.querySelector('.chat-del-no').onclick = () => c.remove();
  c.querySelector('.chat-del-yes').onclick = () => _chatDoDelete(id);
}
function _chatDoDelete(id){
  // Suppression SILENCIEUSE : on retire la bulle du DOM + du cache immédiatement, sans recharger la discussion.
  const sel = (window.CSS && CSS.escape) ? CSS.escape(String(id)) : String(id);
  const row = document.querySelector(`.chat-row[data-mid="${sel}"]`);
  if (row) row.remove();
  const key = _chatCacheKey();
  const arr = _chatMsgCache[key];
  if (Array.isArray(arr)) { _chatMsgCache[key] = arr.filter(m => String(m.id) !== String(id)); _chatSig = _sigMsgs(_chatMsgCache[key]); }
  fetch('/api/admin/chat/message/'+encodeURIComponent(id), { method:'DELETE' }).catch(()=>{});   // serveur en arrière-plan
}
// Admin : modifier le texte d'un message — édition INLINE dans la bulle (plus de fenêtre native)
function _chatEditMsg(id){
  if (!id) return;
  const sel = (window.CSS && CSS.escape) ? CSS.escape(String(id)) : String(id);
  const row = document.querySelector(`.chat-row[data-mid="${sel}"]`);
  const bubble = row && row.querySelector('.chat-bubble');
  const textEl = bubble && bubble.querySelector('.chat-text');
  if (!textEl) return;                                  // pas de texte (image/fichier) → pas d'édition
  if (bubble.querySelector('.chat-edit-box')) return;   // déjà en édition
  const box = document.createElement('div');
  box.className = 'chat-edit-box';
  box.innerHTML = `<textarea class="chat-edit-input"></textarea>`
    + `<div class="chat-edit-btns"><button type="button" class="chat-edit-save">Enregistrer</button>`
    + `<button type="button" class="chat-edit-cancel">Annuler</button></div>`;
  const ta = box.querySelector('.chat-edit-input'); ta.value = textEl.textContent;
  textEl.style.display = 'none';
  bubble.insertBefore(box, textEl.nextSibling);
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  const close = () => { box.remove(); textEl.style.display = ''; };
  box.querySelector('.chat-edit-cancel').onclick = close;
  box.querySelector('.chat-edit-save').onclick = () => {
    const next = ta.value.trim(); if (!next) return;
    fetch('/api/admin/chat/message/'+encodeURIComponent(id), { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ text: next }) })
      .then(r=>r.json()).then(()=>{ if (_chatThreadUser){ _chatMsgCache[_chatThreadUser]=null; _chatSig=''; _chatOpenThread(_chatThreadUser, _chatThreadName); } }).catch(()=>{});
  };
}

// Lightbox image (dans le panneau chat) — clic sur le fond pour revenir au chat
function _chatLightbox(src){
  if (!src) return;
  const host = document.getElementById('chat-panel') || document.body;
  let ov = document.getElementById('chat-lightbox');
  if (!ov){
    ov = document.createElement('div'); ov.id='chat-lightbox'; ov.className='chat-lightbox';
    ov.addEventListener('click', e=>{ if (e.target === ov) ov.classList.remove('visible'); });
    host.appendChild(ov);
  }
  ov.innerHTML = `<img src="${src}" alt="image">`;
  ov.classList.add('visible');
}

function _chatLoad(){
  const list = document.getElementById('chat-list');
  if (_chatMsgCache.client){ _chatSig = _sigMsgs(_chatMsgCache.client); _chatRender(_chatMsgCache.client); }   // instantané
  else if (list){ list.innerHTML = (window.dtpLoader ? window.dtpLoader('Connexion au support…') : '<div class="chat-empty">Connexion au support…</div>'); }   // loader éclipse au 1er chargement
  fetch('/api/chat').then(r=>r.json()).then(d=>{
    const msgs = d.messages||[];
    _chatMsgCache.client = msgs;
    const sig = _sigMsgs(msgs);
    if (sig !== _chatSig){ _chatSig = sig; _chatRender(msgs); }
    _chatSetBadge(0);   // ouvert → réponses lues
  }).catch(()=>{ /* échec transitoire : on garde le loader ; le rafraîchissement live (4s) réessaie tout seul */ });
}

// Envoi générique (texte OU data URL d'une pièce jointe) vers le bon endpoint
function _chatPost(text){
  if (!text) return;
  if (_chatIsSupport() && _chatThreadUser){
    return fetch('/api/admin/chat/'+encodeURIComponent(_chatThreadUser),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})})
      .then(r=>r.json()).then(()=>_chatOpenThread(_chatThreadUser,_chatThreadName)).catch(()=>{});
  }
  return fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})})
    .then(r=>r.json()).then(()=>_chatLoad()).catch(()=>{});
}
function chatSend(){
  const inp = document.getElementById('chat-input');
  const text = (inp?.value||'').trim();
  // Entrée = envoyer : s'il y a des images en attente, on les envoie (pas besoin de cliquer "Envoyer").
  if (_chatPendingImgs && _chatPendingImgs.length) _chatSendPending();
  if(!text){ if(inp){ inp.style.height='auto'; } return; }
  inp.value=''; inp.style.height='auto';
  _chatPost(text);
}
// Compresse/redimensionne une image (File/Blob) → data URL JPEG (max 1600px, qualité ~0.82).
// Garantit qu'un screenshot collé/joint passe TOUJOURS sous la limite (plus de rejet "trop volumineux").
function _chatCompressImage(file, cb){
  const reader = new FileReader();
  reader.onload = () => {
    const src = String(reader.result);
    const img = new Image();
    img.onload = () => {
      try {
        const MAX = 1600;
        let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        if (w > MAX || h > MAX){ const r = Math.min(MAX/w, MAX/h); w = Math.round(w*r); h = Math.round(h*r); }
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);   // fond blanc (sinon transparence PNG → noir)
        ctx.drawImage(img, 0, 0, w, h);
        let out = cv.toDataURL('image/jpeg', 0.82);
        if (out.length > 1.4*1024*1024) out = cv.toDataURL('image/jpeg', 0.6);   // encore trop gros → +compression
        cb(out);
      } catch { cb(src); }   // fallback : data URL d'origine
    };
    img.onerror = () => cb(src);
    img.src = src;
  };
  reader.onerror = () => alert("Impossible de lire l'image.");
  reader.readAsDataURL(file);
}

// ── Aperçu d'images AVANT envoi (jusqu'à 5) : ajouter / retirer (croix) / Envoyer / Annuler ──
const CHAT_MAX_IMGS = 5;
let _chatPendingImgs = [];
function _chatAddPending(dataUrl){
  if (!dataUrl) return;
  if (_chatPendingImgs.length >= CHAT_MAX_IMGS) { _chatRenderPending(); return; }   // max 5 atteint
  _chatPendingImgs.push(dataUrl);
  _chatRenderPending();
}
function _chatRenderPending(){
  const bar = document.getElementById('chat-pending'); if (!bar) return;
  const n = _chatPendingImgs.length;
  if (!n){ bar.classList.remove('visible'); bar.innerHTML = ''; return; }
  const thumbs = _chatPendingImgs.map((u, i) =>
    `<div class="chat-pending-item"><img src="${u}" alt="aperçu">`
    + `<button type="button" class="chat-pending-x" title="Retirer" onclick="_chatRemovePending(${i})">×</button></div>`
  ).join('');
  // Juste les vignettes (chacune avec sa croix) — envoi avec Entrée, annulation via la croix.
  bar.innerHTML = `<div class="chat-pending-thumbs">${thumbs}</div>`;
  bar.classList.add('visible');
}
function _chatRemovePending(i){ _chatPendingImgs.splice(i, 1); _chatRenderPending(); }
function _chatCancelPending(){ _chatPendingImgs = []; _chatRenderPending(); }
function _chatSendPending(){
  const imgs = _chatPendingImgs.slice();
  _chatPendingImgs = []; _chatRenderPending();
  (function next(k){ if (k >= imgs.length) return; Promise.resolve(_chatPost(imgs[k])).then(() => next(k + 1)); })(0);   // ordre conservé
}

// Pièce jointe (image(s) ou fichier) → data URL. Les images passent par l'aperçu (jusqu'à 5).
function _chatAttach(input, kind){
  const files = input.files ? Array.from(input.files) : [];
  input.value = '';
  if (!files.length) return;
  if (kind === 'image'){
    files.filter(f => f.type && f.type.indexOf('image') === 0)
         .slice(0, CHAT_MAX_IMGS)
         .forEach(f => _chatCompressImage(f, url => _chatAddPending(url)));
    return;
  }
  const f = files[0];
  if (f.type && f.type.indexOf('image') === 0){ _chatCompressImage(f, url => _chatAddPending(url)); return; }
  if (f.size > 1.5*1024*1024){ alert('Fichier trop volumineux (max 1,5 Mo).'); return; }
  const reader = new FileReader();
  reader.onload = () => _chatPost(String(reader.result));   // data:...;base64,…
  reader.onerror = () => alert("Impossible de lire le fichier.");
  reader.readAsDataURL(f);
}

function _chatSetBadge(n){
  const b=document.getElementById('chat-badge');
  if(!b) return;
  if(n>0){ b.textContent=n>9?'9+':n; b.style.display=''; }
  else   { b.style.display='none'; }
}
// Le badge reflète EN PERMANENCE les messages non lus et ne se vide QUE lorsque la
// conversation est ouverte (côté support) / lue (côté client). On ne le coupe donc PAS
// quand le panneau est ouvert : tant que la conversation n'est pas ouverte, la notif reste.
function _chatPollUnread(){
  if (_chatIsSupport()){
    // côté support : nombre de PERSONNES qui ont écrit (threads avec au moins 1 message non lu)
    fetch('/api/admin/chat').then(r=>r.json())
      .then(d=>_chatSetBadge((d.threads||[]).filter(t=>(t.unread||0)>0).length))
      .catch(()=>{});
    return;
  }
  fetch('/api/chat/unread').then(r=>r.json()).then(d=>_chatSetBadge(d.unread||0)).catch(()=>{});
}

// Entrée = envoyer, Maj+Entrée = nouvelle ligne ; auto-grow ; poll des réponses
document.addEventListener('DOMContentLoaded', ()=>{
  const inp = document.getElementById('chat-input');
  if(inp){
    inp.addEventListener('keydown', e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); chatSend(); } });
    inp.addEventListener('input', ()=>{ inp.style.height='auto'; inp.style.height=Math.min(inp.scrollHeight,90)+'px'; if(inp.value.trim()) _chatSendTyping(); });
    // Coller une image (Ctrl+V) → compressée puis APERÇU (Envoyer/Annuler), pas d'envoi direct.
    inp.addEventListener('paste', e=>{
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (const it of items){
        if (it.type && it.type.indexOf('image') === 0){
          const f = it.getAsFile(); if(!f) continue;
          e.preventDefault();
          _chatCompressImage(f, url => _chatAddPending(url));   // ajoute à l'aperçu (jusqu'à 5)
          return;
        }
      }
    });
  }
  _chatPollUnread();
  _chatPollTimer = setInterval(_chatPollUnread, 8000);   // notif réactive (8s)
});

// ── Resizable Split Panel : barre orange draggable entre views-col et panel-right ──
//    État runtime (pas de localStorage) → la largeur revient à la valeur par défaut (CSS 50%)
//    à CHAQUE rechargement. Drag clampé (min/max) et DÉSACTIVÉ sur ≤1024px (mobile/tablette).
(function initLayoutResizer() {
  const resizer = document.getElementById('layout-resizer');
  const panel   = document.getElementById('panel-right');
  const layout  = document.getElementById('main-layout');
  if (!resizer || !panel || !layout) return;
  const isDesktop = () => window.matchMedia('(min-width: 1025px)').matches;
  let dragging = false;
  const clampWidth = w => {
    const min = 360;
    const max = Math.min(Math.round(window.innerWidth * 0.58), window.innerWidth - 420);   // jusqu'à ~58% (le défaut 50/50 ne re-snappe pas)
    return Math.max(min, Math.min(max, w));
  };
  const onMove = e => {
    if (!dragging) return;
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const w = clampWidth(window.innerWidth - x);          // rideau droit = largeur depuis le bord droit
    // Curtain Overlay : on pilote la largeur du rideau via la variable CSS. Le contenu gauche
    // + sa scrollbar suivent automatiquement (padding-right) → barre orange toujours isolée.
    layout.style.setProperty('--sidebar-w', w + 'px');
  };
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('dragging');
    document.body.classList.remove('is-resizing');
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', stop);
  };
  resizer.addEventListener('mousedown', e => {
    if (!isDesktop()) return;                              // drag off sur mobile/tablette
    e.preventDefault();
    dragging = true;
    resizer.classList.add('dragging');
    document.body.classList.add('is-resizing');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', stop);
  });
  // Repli sur mobile → on rend la main au CSS (largeur par défaut, pas de persistance)
  window.addEventListener('resize', () => { if (!isDesktop()) layout.style.removeProperty('--sidebar-w'); });
})();

// ── Resizer HORIZONTAL : hauteur du World Clock (barre entre World Clock et les onglets) ──
//    État runtime → reset à la valeur par défaut (CSS) au rechargement. Désactivé ≤1024px.
(function initClocksResizer() {
  const resizer = document.getElementById('clocks-resizer');
  const clocks  = document.getElementById('clocks-panel');
  const panel   = document.getElementById('panel-right');
  if (!resizer || !clocks || !panel) return;
  const isDesktop = () => window.matchMedia('(min-width: 1025px)').matches;
  let dragging = false;
  const onMove = e => {
    if (!dragging) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const top = clocks.getBoundingClientRect().top;
    const min = 90;
    const max = Math.max(min, panel.getBoundingClientRect().height - 220);  // garde la place aux onglets + contenu
    const h = Math.max(min, Math.min(max, y - top));
    clocks.style.flex = '0 0 ' + h + 'px';
    clocks.style.maxHeight = 'none';            // override le plafond 42%
    clocks.style.height = h + 'px';
  };
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('is-resizing-v');
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', stop);
  };
  resizer.addEventListener('mousedown', e => {
    if (!isDesktop()) return;
    e.preventDefault();
    dragging = true;
    document.body.classList.add('is-resizing-v');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', stop);
  });
  window.addEventListener('resize', () => { if (!isDesktop()) { clocks.style.flex = ''; clocks.style.maxHeight = ''; clocks.style.height = ''; } });
})();

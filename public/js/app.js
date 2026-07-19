/* ═══════════════════════════════════════════
   DataTradingPro : Frontend Logic
═══════════════════════════════════════════ */

'use strict';

// ═══ App DESKTOP (Electron) : filet de sécurité pour la MISE EN PAGE topbar intégrée ═══════════
// Double du script inline de <head> : si celui-ci n'a pas tourné (page servie depuis un cache, ancien
// index.html…), on RE-POSE .dtp-desktop + plateforme sur <html> ici → --topbar-h 50px + marges des
// boutons système s'appliquent. (Le DÉPLACEMENT de la fenêtre, lui, est géré par l'app — preload
// 1.0.10+ : pointer capture → IPC → win.setPosition ; plus AUCUN app-region:drag.) Web non affecté.
(function () {
  try {
    if (/Electron/i.test(navigator.userAgent || '')) {
      var r = document.documentElement;
      if (!r.classList.contains('dtp-desktop')) r.classList.add('dtp-desktop');
      var plat = /Mac OS X|Macintosh/i.test(navigator.userAgent) ? 'dtp-mac' : 'dtp-win';
      if (!r.classList.contains(plat)) r.classList.add(plat);
    }
  } catch (e) {}
})();

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

// ═══ Graphes : révélation « premium » : JAMAIS de dessin progressif visible ═══
// Problème : amCharts trace les courbes/barres progressivement (.appear()) → l'utilisateur voit le
// graphe « se construire ». Solution : un overlay OPAQUE shimmer (.chart-skel) est posé EN ENFANT du
// conteneur amCharts lui-même (qui ne contient QUE le graphe : les titres/légendes sont des frères,
// donc l'overlay couvre EXACTEMENT la zone du graphe, sans décalage à deviner). Le graphe se dessine
// SOUS l'overlay opaque, puis après `revealMs` (≈ durée de .appear + marge) l'overlay s'efface en fondu
// → le graphe apparaît DÉJÀ FINI. FAILSAFE 1800 ms : aucun graphe ne peut rester couvert.
// N'agit qu'au BUILD (ne PAS rappeler sur une simple MAJ de données via data.setAll) → zéro clignotement.
// Renvoie une fonction reveal() pour révéler immédiatement en sortie anticipée (pas de données / exception).
//   Usage : const rv = _dtpChartPremium(el, dur+delay+120); …build + series.appear(dur,delay)… (rv() dans un catch).
function _dtpChartPremium(host, revealMs) {
  try {
    const el = typeof host === 'string' ? document.getElementById(host) : host;
    if (!el) return function () {};
    try { if (getComputedStyle(el).position === 'static') el.style.position = 'relative'; } catch (e) {}
    const old = el.querySelector(':scope > .chart-skel'); if (old) { try { old.remove(); } catch (e) {} }
    const sk = document.createElement('div');
    sk.className = 'chart-skel';
    sk.setAttribute('aria-hidden', 'true');
    el.appendChild(sk);
    let done = false;
    const reveal = function () {
      if (done) return; done = true;
      sk.classList.add('chart-skel--hide');
      setTimeout(function () { try { sk.remove(); } catch (e) {} }, 380);
    };
    setTimeout(reveal, Math.max(0, revealMs || 0));   // reveal nominal ≈ fin de .appear
    setTimeout(reveal, 1800);                          // FAILSAFE : jamais couvert indéfiniment
    return reveal;
  } catch (e) { return function () {}; }
}
window._dtpChartPremium = _dtpChartPremium;

// ═══ MAJ de données : fondu d'arrivée + flash discret (UX Phase 2B) ═══
// _dtpDataIn : rejoue un léger fondu montant sur un conteneur quand les VRAIES données remplacent le skeleton.
// _dtpFlash  : halo de fond très bref sur une valeur mise à jour en place (dir 'up'/'dn' = vert/rouge, sinon or neutre).
const _dtpFadedKeys = new Set();
function _dtpDataIn(el, key) {
  if (!el) return;
  if (key) { if (_dtpFadedKeys.has(key)) return; _dtpFadedKeys.add(key); }   // fondu SEULEMENT au 1er remplacement skeleton->donnees (jamais aux refresh silencieux)
  el.classList.remove('dtp-fade-in'); void el.offsetWidth; el.classList.add('dtp-fade-in');   // reflow -> rejoue l'anim
}
function _dtpFlash(el, dir) {
  if (!el) return;
  const cls = dir === 'up' ? 'dtp-flash-up' : dir === 'dn' ? 'dtp-flash-dn' : 'dtp-flash';
  el.classList.remove('dtp-flash', 'dtp-flash-up', 'dtp-flash-dn'); void el.offsetWidth;
  el.classList.add(cls);
  el.addEventListener('animationend', function () { el.classList.remove(cls); }, { once: true });
}
window._dtpDataIn = _dtpDataIn; window._dtpFlash = _dtpFlash;

// ═══ Traduction FR des contenus SOURCE affichés en puces (.article-points) : citations speaker,
// propos Fed/BCE agrégés, puces d'article scrapées : ce qui échappait aux résumés IA. Affichage
// INSTANTANÉ en source, puis remplacement par le FR dès qu'il arrive (cache serveur par texte +
// cache client de session → jamais 2 fois la même requête ; repli silencieux = on garde la source). ═══
const _trClient = new Map();   // texte source → FR (cache session)
async function _dtpTranslateQuotes(container, sel) {
  if (!container) return;
  const lis = [...container.querySelectorAll(sel || '.article-points li, .art-pt')];
  if (!lis.length) return;
  const applyCache = () => lis.forEach(li => { const t = li.textContent.trim(); if (_trClient.has(t)) li.textContent = _trClient.get(t); });
  applyCache();
  const pending = [...new Set(lis.map(li => li.textContent.trim()).filter(t => t.length >= 2 && !_trClient.has(t)))];
  if (!pending.length) return;
  try {
    const r = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texts: pending }) });
    const d = await r.json();
    (d.translations || []).forEach((fr, i) => { if (fr && pending[i] && fr !== pending[i]) _trClient.set(pending[i], fr); });   // identité = repli serveur (échec) → ne pas figer l'anglais pour la session, on retentera
    applyCache();
  } catch {}
}
window._dtpTranslateQuotes = _dtpTranslateQuotes;

// ═══ Cache localStorage : affichage INSTANTANÉ au revisite / cold-start ═══
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
function aiComingSoon() { dtpToast('🤖 AI : bientôt disponible'); }
window.dtpToast = dtpToast; window.aiComingSoon = aiComingSoon;

// ════════════════ MACRO AI ASSISTANT : chat IA (volatil, streaming typewriter) ════════════════
let _aiMsgs = [];
let _aiBusy = false;
let _aiTyper = null;
const AI_AVATAR = '/assets/images/macro-ai-spark.svg';            // logo officiel sauvegardé en local (autonome)
try { const _aiAv = new Image(); _aiAv.src = AI_AVATAR; } catch {}   // PRÉCHARGÉ dès le boot → l'avatar s'affiche EN MÊME TEMPS que le message (plus jamais après)
const AI_CHIP = `<img class="ai-chip-img" src="${AI_AVATAR}" alt="Copilote Macro" width="22" height="22" decoding="sync">`;
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
  return `<div class="ai-sources" id="ai-src-${idx}"><span class="ai-sources-head" onclick="aiToggleSources(${idx})"><span class="ai-sources-arrow">›</span> ${(sources || []).length} sources utilisées</span><div class="ai-sources-list">${items}</div></div>`;
}
function aiToggleSources(idx) { const el = document.getElementById('ai-src-' + idx); if (el) el.classList.toggle('open'); }
function aiRender() {
  const box = document.getElementById('ai-messages'); if (!box) return;
  let html = '<div class="ai-day-sep"><span>Aujourd’hui</span></div>';
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
// Effet typewriter ADAPTATIF : révèle le texte façon flux SSE, mais à vitesse VARIABLE → toute réponse
// se termine en ~0,7 s quelle que soit sa longueur (avant : 3 car./14 ms ≈ 4 s figés sur les longues
// réponses, et même délai sur les hits de cache pourtant instantanés). Rapide + fluide.
function _aiStream(msg) {
  const full = msg.full || '';
  msg.text = ''; msg.streaming = true;
  const total = full.length;
  const STEP = Math.max(4, Math.ceil(total / 70));   // ≤ ~70 ticks → durée ~constante quelle que soit la longueur
  let i = 0;
  const tick = () => {
    i = Math.min(total, i + STEP);
    msg.text = full.slice(0, i);
    const el = document.querySelector('#ai-messages .ai-row--ai:last-of-type .ai-ai-text');
    if (el) el.innerHTML = _aiMdStream(msg.text);
    _aiAutoScroll();
    if (i < total) { _aiTyper = setTimeout(tick, 10); }
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
  const handled = await _aiSendStream(q);   // 1) vrai streaming token-par-token (SSE)
  if (!handled) await _aiSendBuffered(q);   // 2) repli : génération bufferisée + typewriter (l'ancien chemin)
}
// Streaming SSE : le texte apparaît au fil des tokens. Renvoie true si la réponse a été affichée
// (même partielle) → pas de repli ; false si RIEN n'a été reçu → l'appelant lance le repli bufferisé.
async function _aiSendStream(q) {
  let msg = null, started = false, sources = [], gotEvent = false;
  const ensureMsg = () => {
    if (msg) return;
    if (_aiMsgs.length && _aiMsgs[_aiMsgs.length - 1].thinking) _aiMsgs.pop();   // coupe « L'IA écrit… » au 1er token
    msg = { role: 'ai', text: '', streaming: true, sources: [], time: _aiTime() };
    _aiMsgs.push(msg); aiRender();
  };
  const renderLive = () => {
    const el = document.querySelector('#ai-messages .ai-row--ai:last-of-type .ai-ai-text');
    if (el) el.innerHTML = _aiMdStream(msg.text);
    _aiAutoScroll();
  };
  try {
    const r = await fetch('/api/ai/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: q }) });
    if (!r.ok || !r.body || !r.body.getReader) return false;
    const reader = r.body.getReader(); const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let sep;
      while ((sep = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, sep); buf = buf.slice(sep + 2);
        let ev = 'message', data = '';
        block.split('\n').forEach(l => { if (l.startsWith('event:')) ev = l.slice(6).trim(); else if (l.startsWith('data:')) data += l.slice(5).trim(); });
        if (!data) continue;
        let p; try { p = JSON.parse(data); } catch { continue; }
        if (ev === 'chunk' && p.t) { gotEvent = true; ensureMsg(); started = true; msg.text += p.t; renderLive(); }
        else if (ev === 'done') { gotEvent = true; sources = p.sources || []; }
        else if (ev === 'error') gotEvent = true;   // l'endpoint a tourné mais son repli interne a échoué
      }
    }
  } catch (e) { /* coupure réseau → on finalise ce qu'on a (si déjà affiché), sinon repli */ }
  if (started) { msg.streaming = false; msg.sources = sources; msg.time = _aiTime(); _aiBusy = false; aiRender(); return true; }
  if (gotEvent) {
    // L'endpoint a répondu SANS texte (son repli bufferisé interne a échoué) → inutile de rappeler
    // /api/ai/chat (même chaîne → même échec + 2e décompte burst). On affiche le message dédié.
    if (_aiMsgs.length && _aiMsgs[_aiMsgs.length - 1].thinking) _aiMsgs.pop();
    _aiMsgs.push({ role: 'ai', text: "🛠️ Cette fonctionnalité est en cours de développement et sera bientôt disponible. Merci de votre patience !", time: _aiTime() });
    _aiBusy = false; aiRender();
    return true;
  }
  return false;   // aucun événement reçu (transport KO) → repli bufferisé /api/ai/chat
}
// Repli : ancien chemin bufferisé (réponse complète d'un coup) + typewriter adaptatif.
async function _aiSendBuffered(q) {
  try {
    const r = await fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: q }) });
    const d = await r.json().catch(() => ({}));
    if (_aiMsgs.length && _aiMsgs[_aiMsgs.length - 1].thinking) _aiMsgs.pop();
    if (r.ok && d.answer) {
      const msg = { role: 'ai', full: d.answer, text: '', sources: d.sources || [], streaming: true, time: _aiTime() };
      _aiMsgs.push(msg); aiRender(); _aiStream(msg);
    } else {
      _aiMsgs.push({ role: 'ai', text: "🛠️ Cette fonctionnalité est en cours de développement et sera bientôt disponible. Merci de votre patience !", time: _aiTime() });
      _aiBusy = false; aiRender();
    }
  } catch (e) {
    if (_aiMsgs.length && _aiMsgs[_aiMsgs.length - 1].thinking) _aiMsgs.pop();
    _aiMsgs.push({ role: 'ai', text: "🛠️ Cette fonctionnalité est en cours de développement et sera bientôt disponible. Merci de votre patience !", time: _aiTime() });
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
// Le bouton AI de la topbar bascule le volet Copilote Macro
(function () { var b = document.getElementById('ai-btn'); if (b) b.addEventListener('click', aiToggle); })();

// ── Sélecteur de langue (dropdown custom à vraies images de drapeaux : les emoji-drapeaux ne s'affichent pas sur Windows) ──
function pdLangToggle(e) { if (e) e.stopPropagation(); document.getElementById('pd-lang-menu')?.classList.toggle('open'); }
function pdLangPick(val, name, iso) {
  const inp = document.getElementById('pd-lang'); if (inp) inp.value = val;
  const cur = document.getElementById('pd-lang-current'); if (cur) cur.textContent = name;
  const flag = document.getElementById('pd-lang-cur-flag'); if (flag) flag.src = `https://flagcdn.com/24x18/${iso}.png`;
  document.getElementById('pd-lang-menu')?.classList.remove('open');
  // Applique la langue choisie à TOUT le site (le moteur i18n traduit au reload). FR/EN supportés.
  try { var lg = String(val || '').slice(0, 2).toLowerCase(); if (['fr', 'en', 'de', 'es'].indexOf(lg) !== -1 && localStorage.getItem('dtp_lang') !== lg) { localStorage.setItem('dtp_lang', lg); location.reload(); } } catch (e) {}
}
// Au chargement : refléter la langue active (dtp_lang) dans le sélecteur du profil.
(function () {
  function _pdLangSync() {
    try {
      var lg = (localStorage.getItem('dtp_lang') || 'fr').slice(0, 2).toLowerCase();
      var M = { fr: ['Français', 'fr'], en: ['English', 'gb'], de: ['Deutsch', 'de'], es: ['Español', 'es'] };
      var m = M[lg]; if (!m) return;
      var inp = document.getElementById('pd-lang'); if (inp) inp.value = lg;
      var cur = document.getElementById('pd-lang-current'); if (cur) cur.textContent = m[0];
      var flag = document.getElementById('pd-lang-cur-flag'); if (flag) flag.src = 'https://flagcdn.com/24x18/' + m[1] + '.png';
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _pdLangSync); else _pdLangSync();
})();
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

// ═══ Filter : only real category names from the server ════════════════════════

const INTERNAL_CATS = [
  'Fed', 'ECB', 'BoJ', 'BoE', 'BoC', 'RBA', 'SNB', 'RBNZ',
  'Geopolitical', 'Economic Commentary', 'FX Flows', 'Market Analysis',
  'Energy & Power', 'Metals', 'Crypto', 'Fixed Income',
  'Global News', 'Asian News', 'Trade', 'DTP Update', 'Ags & Softs',
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
    { label: 'DTP Update',          cat: 'DTP Update'          },
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

// Libellés FR des catégories de news : AFFICHAGE UNIQUEMENT. La valeur brute (item.category)
// reste la clé logique (data-cat, comparaisons, enabledCategories, SETTINGS_PANEL.cat). On ne
// traduit que le texte rendu via CAT_FR[cat] || cat. Sigles (Fed/ECB/BoJ…) inchangés (fallback).
const CAT_FR = {
  'Economic Commentary': 'Commentaire économique',
  'Market Analysis':     'Analyse de marché',
  'Global News':         'Actualités mondiales',
  'Asian News':          'Actualités asiatiques',
  'Energy & Power':      'Énergie',
  'Fixed Income':        'Obligataire',
  'Metals':              'Métaux',
  'Crypto':              'Crypto',
  'Trade':               'Commerce',
  'FX Flows':            'Flux FX',
  'Geopolitical':        'Géopolitique',
  'DTP Update':          'Mise à jour DTP',
  'Ags & Softs':         'Agricoles',
  'EU Data':             'Données EU',
  'US Data':             'Données US',
  'UK Data':             'Données UK',
  'Swiss Data':          'Données Suisse',
  'Japanese Data':       'Données Japon',
  'Canadian Data':       'Données Canada',
  'Australian Data':     'Données Australie',
  'Chinese Data':        'Données Chine',
};
function catFr(cat) { return CAT_FR[cat] || cat || ''; }

// ═══ State ════════════════════════════════
let allItems          = [];
// Exposé pour la vue symbole (charts.js) : rendu news RICHE identique au ticker.
// getter (et non window.allItems figé) car allItems est réassigné par renderNews/WS.
window.getNewsMaster = () => allItems;
try { window.buildNewsItem = buildNewsItem; } catch {}   // rendu d'une ligne .news-item complète (badges/icône/chevron)
let enabledCategories = new Set(INTERNAL_CATS.filter(c => c !== 'Economic Commentary')); // tout activé SAUF "Commentaire économique" (désactivé par défaut, demande)
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
const _infoCache      = new Map(); // item.id → bullets[] (résumé Gemini style DTP, mémoire session)
const _reactCache     = new Map(); // item.id → texte (explication Gemini de la réaction, mémoire session)
let   _snapCache      = null;      // dernier Market Snapshot (prix réels) : partagé entre rapports
// Rend des puces Info/Analyse : texte propre, SANS gras ni balises (on retire HTML <…> et markdown **…**)
// Décode les entités HTML (&amp; → &, etc.) AVANT de ré-échapper → évite "S&amp;P" affiché tel quel.
function _decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
}
// Puce-déchet = jeton ISOLÉ sans valeur marché : chemin/handle/URL/domaine bruts laissés par le scrape
// (« /federalreserve », « @FederalReserve », « #fed », « federalreserve.gov », « www.x.com », « https://… »).
// Pas d'espace → ce n'est jamais une vraie phrase d'info → on l'écarte du panneau Info.
function _isJunkBullet(s) {
  const t = String(s == null ? '' : s).trim();
  if (!t || /\s/.test(t)) return false;                                                   // contient un espace = vraie puce
  if (/^[\/@#][\w.\-\/]+$/.test(t)) return true;                                           // /chemin · @handle · #tag
  if (/^(?:https?:\/\/|www\.)/i.test(t)) return true;                                      // URL nue
  if (/^[\w.\-]+\.(?:com|org|net|io|co|gov|edu|news|tv|us|uk|eu|fr)\/?[\w.\-\/]*$/i.test(t)) return true; // domaine nu
  return false;
}
function _renderInfoBullets(bullets) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // coupe toute attribution de source ("via NYT", "- Reuters", "(Mehr News)") en fin de puce
  const stripSrc = t => t.replace(_NEWS_SRC_RE, '').replace(/[,;]?\s*\(?\bvia\s+[A-Z][\w.&'’ /-]{1,28}\)?\.?\s*$/i, '').trim();
  const items = (bullets || [])
    .map(b => _decodeEntities(b).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter(s => !_isJunkBullet(s));   // écarte les jetons parasites (/federalreserve, @handle, url nue…)
  const html = items.map(it => {
    const noMd = it.replace(/\*\*/g, '').trim();
    // sous-titre : ligne courte finissant par ":" (ex. « Four points: ») → libellé, pas une puce
    if (noMd.length <= 44 && /\S.{1,42}:$/.test(noMd) && !/[.!?]/.test(noMd.slice(0, -1))) {
      return `<li class="ip-head">${esc(stripSrc(noMd))}</li>`;
    }
    // garde le GRAS markdown **…** → <strong>
    const body = esc(stripSrc(it)).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return `<li>${body}</li>`;
  }).join('');
  return `<ul class="article-points article-points--clean">${html}</ul>`;
}
let _sessionWraps = [];
let _brArticles  = [];
let _fxDaily     = [];     // FX Daily (ING THINK) : rapport dédié dans l'onglet Analyst
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
  const _bell = notifBadge.parentElement; if (_bell) _bell.classList.toggle('tb-alert', n > 0);   // anime l'icône (sonnerie + glow) tant qu'il y a du non-lu
}
const liveDot     = document.getElementById('live-dot');
const searchInput = document.getElementById('search-input');

// ═══ Init ═════════════════════════════════
function init() {
  loadSettings();
  buildSettingsPanel();
  buildSectionDropdown();
  loadCatFilterFromServer();   // persistance PAR COMPTE : réapplique le filtre de sections enregistré (cross-device)
  startClocks();
  // La carte monde (amCharts, panneau droit : PAS le fil principal que l'utilisateur regarde) est
  // LOURDE : on la dessine en temps IDLE pour ne pas retarder le 1er paint du fil. drawWorldMap /
  // startSessionMarkers ne sont appelees QUE depuis init() -> aucun risque de double-rendu. Repli
  // setTimeout si requestIdleCallback indispo (Safari ancien).
  (window.requestIdleCallback || function (f) { return setTimeout(f, 150); })(function () {
    try { drawWorldMap(); } catch (e) {}
    try { startSessionMarkers(); } catch (e) {}
  });

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
      newsList.innerHTML = '<div class="empty-state" style="color:var(--text4);padding:40px 20px;text-align:center;font-size:11px;">En attente du flux en direct : les éléments apparaîtront automatiquement</div>';
    }
  }, 12000);

  connectWS();

  searchInput.addEventListener('input', e => {
    searchQuery = e.target.value.toLowerCase().trim();
    displayLimit = 100;
    renderNews();
    _searchServer7d(searchQuery);   // etend la recherche aux 7 derniers jours (historique serveur)
  });
}
// Recherche NEWS 7 jours : la barre du flux couvre toute la fenetre serveur, pas seulement le lot charge.
// Debounce → /api/news/search → fusionne les resultats dans allItems (dedup par id) → re-render.
let _search7dT = null, _search7dSeq = 0;
function _searchServer7d(q) {
  if (_search7dT) clearTimeout(_search7dT);
  if (!q || q.length < 2) return;
  const seq = ++_search7dSeq;
  _search7dT = setTimeout(() => {
    fetch('/api/news/search?days=7&q=' + encodeURIComponent(q))
      .then(r => r.json())
      .then(d => {
        if (seq !== _search7dSeq) return;                       // requete perimee (l'utilisateur a continue a taper)
        if (searchQuery !== q) return;                          // la recherche a change entre-temps
        if (!d || !Array.isArray(d.items) || !d.items.length) return;
        const seen = new Set(allItems.map(i => i && i.id));
        let added = 0;
        for (const it of d.items) { if (it && it.id && !seen.has(it.id)) { allItems.push(it); seen.add(it.id); added++; } }
        if (added) {
          allItems.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));   // garde le flux du plus recent au plus ancien
          renderNews();
        }
      })
      .catch(() => {});
  }, 320);
}

// ═══ WebSocket ════════════════════════════
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    showStatus('Connecté', 'ok');
    if (liveDot) { liveDot.style.background = 'var(--green)'; liveDot.style.boxShadow = '0 0 6px var(--green)'; }
  };

  ws.onmessage = e => {
    try { handleMessage(JSON.parse(e.data)); }
    catch (err) { console.error('[WS] Parse error', err); }
  };

  ws.onerror = () => {
    showStatus('Erreur de connexion', 'err');
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
  } else if (msg.type === 'chat_new') {
    try { _chatOnPush(msg); } catch (e) {}                 // notif chat INSTANTANEE (push WS)
  } else if (msg.type === 'chat_typing') {
    try { _chatOnTypingPush(msg); } catch (e) {}
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
      const _fl = getFilteredItems();
      const _renderedIds = new Set(_fl.slice(0, _alignLimitToDay(_fl, displayLimit)).map(i => i.id));
      _flashBreakingNews(truly_new.find(i => _renderedIds.has(i.id) && !(i._briefing || i.source === 'DTP' || isPrimerItem(i)) && _isImportantNews(i)));
    }
    // Refresh analyst library if a new briefing arrived and analyst view is active
    if (truly_new.some(i => i._briefing || i.source === 'DTP')) {
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
    // Nouvelle matrice Radar de Biais générée → on met à jour l'onglet Bias
    if (msg.type === 'smartbias_update' && msg.bias) {
      _biasData = null; _biasView = null; _biasViewTs = null;   // force le re-fetch avec l'historique (versioning)
      const biasPanel = document.getElementById('view-bias');
      if (biasPanel && !biasPanel.classList.contains('hidden')) loadBiasView();
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
  // On ne fait JAMAIS flasher un rapport DTP/primer dans la bannière LIVE (plus de "PRIMER : …")
  if (!item || item._briefing || item.source === 'DTP' || isPrimerItem(item)) return;
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
  textEl.textContent = (item.headline || 'Actu Marché')
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
// Teaser de recherche de banque : "… – MUFG/Nomura/TD Securities…" = attribution sans contenu,
// pas une news → masqué du flux (les vrais rapports sont dans l'onglet Institution).
const _BANK_TEASER_RE = /\s[–—-]\s*(?:MUFG|Nomura|TD\s*Securities|TDS|Goldman(?:\s*Sachs)?|Morgan\s*Stanley|J\.?P\.?\s*Morgan|JPMorgan|JPM|Bank\s*of\s*America|BofA(?:\s*Securities)?|Citi(?:group|bank|\s*Research)?|Barclays|UBS|Deutsche\s*Bank|HSBC|BNP\s*Paribas|BNPP|Soci[ée]t[ée]\s*G[ée]n[ée]rale|SocGen|ING|Commerzbank|Rabobank|Danske(?:\s*Bank)?|Nordea|SEB|Scotia(?:bank)?|RBC|CIBC|BMO|National\s*Bank|Westpac|ANZ|CBA|NAB|Standard\s*Chartered|StanChart|Cr[ée]dit\s*Agricole|CACIB|Wells\s*Fargo|Mizuho|Macquarie|Jefferies|Lloyds(?:\s*Bank)?|NatWest|Capital\s*Economics|Oxford\s*Economics|Pantheon|BBVA|UniCredit|Intesa|Saxo(?:\s*Bank)?|Pepperstone|Convera|Natixis|KBC|Syz|OCBC|UOB|DBS|BBH|Wells)\s*$/i;
// Spam politique : reposts d'endorsements (style Truth Social) "… America First Patriot/Champion…",
// "MAGA Warrior…", "Complete and Total Endorsement…" : souvent mal catégorisés "Energy" → pas une news.
const _POLITICAL_SPAM_RE = /\b(?:america first\s+(?:patriot|champion|warrior|fighter|polic\w*)|maga\s+(?:warrior|champion|patriot|king|queen|fighter)|complete\s+and\s+total\s+endorsement|make\s+america\s+great\s+again|(?:great|total)\s+honou?r\s+to\s+(?:fully\s+)?endorse|tremendous\s+(?:champion|advocate))\b/i;
// ── Levier 1 : anti-bruit renforcé (réduction du flux News) ────────────────────
// Actions d'UNE société (dividende, rachat d'actions, split, BPA) : sans portée macro/FX.
const _SINGLE_STOCK_RE = /\b(?:dividend\s+(?:increase|hike|raise|boost)|(?:increase|hike|raise|boost|declare|announce)s?\s+(?:a\s+|its\s+|quarterly\s+|semi-?annual\s+|annual\s+|special\s+)*dividend|(?:share|stock|equity)\s+(?:repurchase|buyback)|(?:repurchase|buyback)\s+program|stock\s+split|reauthoriz\w*\b[^.]{0,40}\b(?:repurchase|buyback))/i;
// Éditorial retail / clickbait : pas d'info marché actionnable.
const _CLICKBAIT_RE = /(?:here'?s\s+(?:why|how|what|the\s+reason)|what\s+(?:it|this|that)\s+means\s+for\s+you|why\s+you\s+(?:should|shouldn'?t|might|need)|what\s+you\s+need\s+to\s+know|retail\s+(?:investors?|traders?)\s+(?:think|are\s|keep|love|hate|can'?t)|buying\s+(?:it\s+)?anyway|the\s+truth\s+about|you\s+won'?t\s+believe)/i;
// Suffixe horodaté/méta accolé par certaines sources (« … – UOB 20:30 Jun », « … 20:42 Jun 24 Energy US Bonds ») :
// casse les filtres ancrés en fin de titre. On le retire AVANT les tests « se termine par … ».
function _stripTrailingMeta(h) {
  return String(h || '').replace(/\s+\d{1,2}:\d{2}(?:\s+[A-Za-z0-9$]+){0,12}\s*$/i, '').trim();
}

// ── Levier 2 : mode « Essentiel » ──────────────────────────────────────────────
// Ne garde que la macro/FX qui compte (banques centrales, géopolitique, énergie, commerce,
// FX, obligataire, métaux) + tout ce qui est urgent/important/tier-1. Le mid-tier (Market
// Analysis, commentaires, news régionales mineures) est masqué → bouton « Tout » pour le réafficher.
const _ESSENTIAL_CATS = new Set(['Fed','ECB','BoJ','BoE','BoC','RBA','SNB','RBNZ','Geopolitical','Energy & Power','Trade','FX Flows','Fixed Income','Metals']);
function _isEssentialItem(item) {
  if (!item) return false;
  if (_isImportantNews(item)) return true;                                                       // urgent / high / tier-1 data / résultat calendrier
  if (item._marketWrap || item._reportType === 'DTP Daily' || item._eventAnalysis) return true;  // rapports DTP du flux
  return _ESSENTIAL_CATS.has(item.category || '');
}
let newsEssentialMode = false;  // Essentiel DÉSACTIVÉ (bouton retiré) → flux complet + anti-bruit léger seul
try { if (localStorage.getItem('dtp_news_essential') === '0') newsEssentialMode = false; } catch {}
function _syncNewsModeBtn() {
  const btn = document.getElementById('news-mode-toggle');
  if (!btn) return;
  btn.textContent = newsEssentialMode ? 'Essentiel' : 'Tout';
  btn.classList.toggle('news-mode-toggle--all', !newsEssentialMode);
  btn.title = newsEssentialMode
    ? 'Flux filtré sur l’essentiel (banques centrales, géopolitique, données macro, énergie, FX). Cliquer pour voir TOUT.'
    : 'Flux complet (toutes les news). Cliquer pour ne garder que l’ESSENTIEL.';
}
window._toggleNewsMode = function () {
  newsEssentialMode = !newsEssentialMode;
  try { localStorage.setItem('dtp_news_essential', newsEssentialMode ? '1' : '0'); } catch {}
  _syncNewsModeBtn();
  renderNews();
};

// Checks anti-bruit BASÉS SUR LE TITRE (immuable) → MÉMOÏSÉS sur l'item (item._hlNoiseOk) : calculés
// UNE fois, réutilisés à chaque rendu/frappe/dépêche WS (le titre ne change pas → ~12 regex évitées par
// item et par rendu). Tous ces checks aboutissent à une EXCLUSION, donc l'ordre entre eux n'importe pas.
// Le seul check dépendant de la DESCRIPTION (regroupable) reste EN DIRECT dans getFilteredItems.
function _hlNoisePass(item, _h) {
  if (item._hlNoiseOk !== undefined) return item._hlNoiseOk;
  const _hs = _stripTrailingMeta(_h);
  const ok = !(
    /^\s*\[?\s*primer\b/i.test(_h) ||
    /^\[No Title\]/i.test(_h) ||
    /^RT @/i.test(_h) ||
    /^@[A-Za-z]/i.test(_h) ||
    _h.replace(/[^a-z0-9]/gi, '').length < 14 ||
    _NEWS_NOISE.test(_h) ||
    _NEWS_BLOCK.test(_h) ||
    _BANK_TEASER_RE.test(_h) ||
    _POLITICAL_SPAM_RE.test(_h) ||
    _SINGLE_STOCK_RE.test(_h) ||
    _CLICKBAIT_RE.test(_h) ||
    (_hs !== _h && _BANK_TEASER_RE.test(_hs))
  );
  item._hlNoiseOk = ok;
  return ok;
}

function getFilteredItems() {
  const seen = new Set();   // dédoublonnage intelligent des titres quasi-identiques
  return allItems.filter(item => {
    // SYNCHRO bandeau LIVE ↔ feed : la news annoncée dans le bandeau n'est jamais masquée par la
    // dédup → on la retrouve TOUJOURS dans le flux. MAIS si une RECHERCHE est active, elle doit
    // respecter le filtre comme les autres (sinon "BoJ" laisse passer la news flashée hors-sujet).
    if (!searchQuery && item.id && item.id === _flashedNewsId) { const k = _newsKey(item.headline || ''); if (k) seen.add(k); return true; }
    // Rapports DTP (briefings, recaps) : masqués du flux : SAUF le « DTP Daily US Opening News » qui doit
    // apparaître dans l'onglet News (demande utilisateur), comme un point macro d'ouverture.
    if ((item._briefing || item.source === 'DTP') && item._reportType !== 'DTP Daily') return false;
    if (!isCategoryEnabled(item.category)) return false;
    // Bruit/reposts sans valeur : checks BASÉS SUR LE TITRE (immuable) MÉMOÏSÉS (voir _hlNoisePass) :
    // ~12 regex (primer, RT/@, longueur, _NEWS_NOISE/BLOCK, teasers banque, spam politique, single-stock,
    // clickbait…) ne sont plus relancées par item à CHAQUE rendu/frappe/dépêche WS.
    const _h = item.headline || '';
    if (!_hlNoisePass(item, _h)) return false;
    // Seul check dépendant de la DESCRIPTION (regroupable → peut changer) → gardé EN DIRECT :
    //   ex. « Thursday FX Option Expiries » : en-tête sans analyse/description.
    if (/options?\s+expir/i.test(_h) && (item.description || '').replace(/<[^>]*>/g, '').trim().length < 40) return false;
    // ── Levier 2 : mode Essentiel (hors recherche) : ne garder que la macro/FX qui compte ──
    if (newsEssentialMode && !searchQuery && !_isEssentialItem(item)) return false;

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

    // Only process quote items (not openers : those already handle grouping via getSpeakerQuotes)
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

// FJ-urgent RÉCENT (≤30 min) → flotte en tête du flux (demande : "annonces importantes rouge de FJ en tête").
// Au-delà de 30 min, retombe en ordre chronologique pour ne pas épingler une vieille alerte indéfiniment.
function _isFreshFJUrgent(it) {
  if (!it || it.urgent !== true) return false;
  const isFJ = it.source === 'FinancialJuice' || String(it.id || '').startsWith('fj-');
  return isFJ && (Date.now() - (it.timestamp || 0) < 30 * 60 * 1000);
}
function _newsCmp(a, b) {
  const fa = _isFreshFJUrgent(a) ? 1 : 0, fb = _isFreshFJUrgent(b) ? 1 : 0;
  if (fa !== fb) return fb - fa;                       // FJ-urgent récent d'abord
  return (b.timestamp || 0) - (a.timestamp || 0);      // sinon, le plus récent d'abord
}
// « Charger plus » PILE à la frontière des JOURS (demande user 15/07) : le feed n'affiche que des
// JOURNÉES COMPLÈTES — la limite est étendue jusqu'à la fin de la journée en cours d'affichage (même
// clé formatDate que les en-têtes de date) → le bouton arrive juste avant que la journée précédente
// commence, jamais au milieu d'une journée coupée en deux.
function _alignLimitToDay(filtered, limit) {
  if (filtered.length <= limit) return filtered.length;
  const lastDay = formatDate(filtered[limit - 1].timestamp);
  let end = limit;
  while (end < filtered.length && formatDate(filtered[end].timestamp) === lastDay) end++;
  return end;
}
function renderNews(hasNew = false) {
  const filtered = getFilteredItems();
  _syncNewsModeBtn();
  const _icTxt = `${filtered.length} items`;
  if (itemCountEl.textContent && itemCountEl.textContent !== '— items' && itemCountEl.textContent !== _icTxt && window._dtpFlash) window._dtpFlash(itemCountEl);   // flash discret : le compteur change vraiment (jamais au 1er remplissage du placeholder)
  itemCountEl.textContent = _icTxt;
  if (allItems.length) lsSet('dtp_news', allItems.slice(0, 150));   // persiste pour un affichage instantané au revisite

  if (filtered.length === 0) {
    if (!_wsInitReceived) return; // keep spinner until server acknowledges
    newsList.innerHTML = '<div class="empty-state" style="padding:40px 20px;text-align:center;color:var(--text4);font-size:11px;">Aucun élément : le flux est en direct, les mises à jour apparaissent automatiquement</div>';
    return;
  }

  // Collapse same-speaker quote clusters into single grouped cards
  const effLimit = _alignLimitToDay(filtered, displayLimit);   // journées complètes uniquement
  const visible = _groupSpeakerQuotes(filtered.slice(0, effLimit));

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
    items.sort(_newsCmp);   // FJ-urgent récent en tête, sinon chronologique
    const header = document.createElement('div');
    header.className = 'date-header';
    header.textContent = date;
    fragment.appendChild(header);
    for (const item of items) {
      fragment.appendChild(buildNewsItem(item));
    }
  }

  // "Charger plus" button — placé à la frontière des jours (effLimit finit toujours une journée)
  const hasMore = filtered.length > effLimit || allItems.length < serverTotal;
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
  // Traduction SYNCHRONE avant paint (langue ≠ FR) : le fil + les libellés/descriptions de tags
  // sortent DIRECTEMENT traduits, sans le flash de texte FR que produit le MutationObserver i18n
  // (qui traduit 1 frame plus tard). No-op en FR (source). Idempotent.
  if (window.DTP_translate) window.DTP_translate(newsList);
  if (hasNew) {
    // Une news vient d'ARRIVER : si l'utilisateur était en haut, on lui montre la nouvelle (haut du feed) ;
    // s'il lisait plus bas, on ANCRE sa position (pas de saut) en compensant la hauteur ajoutée au-dessus.
    newsList.scrollTop = atTop ? 0 : prevScrollTop + (newsList.scrollHeight - prevScrollHeight);
  } else {
    newsList.scrollTop = prevScrollTop;             // re-rendu (filtre, patch…) → on garde la position exacte
  }
  // Miroir LIVE : si l'onglet Semaine à Venir est ouvert, son « Realtime Headline Ticker » = clone exact de l'onglet News (mis à jour à chaque dépêche WebSocket).
  try { const _wav = document.getElementById('view-weekahead'); if (_wav && !_wav.classList.contains('hidden') && typeof _waSyncNews === 'function') _waSyncNews(); } catch {}
}

async function loadMore() {
  if (loadingMore) return;

  const filtered = getFilteredItems();
  const effLimit = _alignLimitToDay(filtered, displayLimit);
  if (filtered.length > effLimit) {
    // More items already loaded in memory : just reveal them. On repart de la FIN de journée affichée
    // (effLimit, pas displayLimit) + 100 → le rendu ré-alignera sur la fin de la journée suivante.
    displayLimit = effLimit + 100;
    renderNews();
    return;
  }

  // Need to fetch older items from server — on enchaîne les lots (max 4/clic) jusqu'à ce que la JOURNÉE
  // à la nouvelle frontière soit COMPLÈTE côté client : le bouton retombe toujours pile avant la journée
  // suivante, même les jours à très fort volume (>100 news, ex. FOMC/CPI).
  loadingMore = true;
  renderNews();

  try {
    for (let hop = 0; hop < 4; hop++) {
      const oldestTs = allItems.length > 0 ? Math.min(...allItems.map(i => i.timestamp)) : Date.now();
      const r    = await fetch(`/api/news/history?before=${oldestTs}&limit=100`);
      const data = await r.json();
      if (data.total) serverTotal = data.total;
      const existingIds = new Set(allItems.map(i => i.id));
      const fresh = (data.items || []).filter(i => !existingIds.has(i.id));
      if (!fresh.length) { serverTotal = allItems.length; break; }   // historique épuisé → plus de bouton
      allItems = [...allItems, ...fresh].sort((a, b) => b.timestamp - a.timestamp);
      const f2 = getFilteredItems();
      if (_alignLimitToDay(f2, displayLimit + 100) < f2.length) break;   // la journée à la frontière est complète
    }
    displayLimit += 100;
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
  // First segment before " : " or " - "
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
    if (pcts.length) points.push(`Core PCE: ${pcts.join(' / ')} : Fed's preferred inflation gauge`);
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
      points.push(`${ctx || 'Fed commentary'} : parse for signals on rate path timing, inflation trajectory, and balance sheet guidance. DXY and US 2Y yields are the real-time read.`);
    }
  }

  if (cat === 'ECB' || /\becb\b|lagarde/.test(t)) {
    if (/hike|hawkish|tighten/.test(t)) points.push('ECB hawkish → EUR ↑ · Bunds ↓');
    else if (/cut|dovish|eas/.test(t))  points.push('ECB dovish → EUR ↓ · Bunds ↑');
    else if (points.length === 0) {
      const ctx = headlineContext(item.headline);
      points.push(`${ctx || 'ECB commentary'} : watch EUR/USD and Bund 10Y yields for the market read on policy direction`);
    }
  }

  if (cat === 'BoE' || /\bboe\b|bank of england|bailey/.test(t)) {
    if (/hike|hawkish/.test(t)) points.push('BoE hawkish → GBP ↑ · Gilts ↓');
    else if (/cut|dovish/.test(t)) points.push('BoE dovish → GBP ↓ · Gilts ↑');
    else if (points.length === 0) {
      const ctx = headlineContext(item.headline);
      points.push(`${ctx || 'BoE commentary'} : watch GBP/USD and Gilt yields for the policy pricing read`);
    }
  }

  if (cat === 'BoJ' || /\bboj\b|bank of japan|ueda/.test(t)) {
    if (/hike|hawkish|tighten/.test(t)) points.push('BoJ tightening → JPY ↑ (carry trade unwind risk)');
    else if (/dovish|maintain|hold/.test(t)) points.push('BoJ stays dovish → JPY ↓ · carry trades supported');
    else if (points.length === 0) {
      const ctx = headlineContext(item.headline);
      points.push(`${ctx || 'BoJ commentary'} : watch USD/JPY and JGB 10Y yields for the policy signal read`);
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
      points.push('Iran de-escalation signal : oil geopolitical risk premium may ease');
    if (/nuclear|uranium|enrichment|weapon/.test(t)) {
      if (/deal|agreement|suspend|commit|progress|positive|sign/.test(t))
        points.push('Nuclear deal progress → Hormuz supply risk eases → Oil ↓, Gold ↓');
      else if (/reject|fail|break|collapse|no deal/.test(t))
        points.push('Talks failure → Hormuz closure risk remains → Oil ↑, Gold ↑');
      else
        points.push('Nuclear programme : Iran deal outcome drives oil risk premium');
    }
    if (/sanction|oil.*ban|oil.*export/.test(t))
      points.push('Iran oil ~1.3m bbl/day at risk : sanctions add Brent supply premium');
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
        points.push('No tariff progress confirmed : trade uncertainty persists');
      else
        points.push('US-China trade signal : watch DXY, CNY, Asian equity indices');
    }
    if (/europe|eu\b|eurozone/.test(t))
      points.push('EU trade friction → EUR/USD sensitive, export-heavy DAX/CAC names at risk');
  }

  // ── China / Asia policy ───────────────────────────────────────────────────
  if ((cat === 'Asian News' || /politburo|pboc|xi jinping|people.*bank.*china/.test(t)) && points.length === 0) {
    if (/yuan|cny|exchange rate|currency.*stable|stable.*currency/.test(t))
      points.push('CNY stability commitment : PBOC expected to defend near 7.30 on USD/CNY');
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
    if (/china|beijing|xi/.test(t))   points.push('US-China diplomatic signal : watch trade flows, tech sector, Taiwan posture');
    if (/russia|putin|ukraine/.test(t)) points.push('Russia signal : gas/energy supply risk, EUR/USD & Bunds sensitivity');
    if (/iran|nuclear|hormuz/.test(t)) points.push('Iran/nuclear stance drives oil supply risk premium');
    if (/tariff|trade|import|export/.test(t)) points.push('Trade policy signal : watch USD, affected sector ETFs');
    if (/rate|fed|economy|inflation/.test(t)) points.push('Political commentary on Fed/economy : watch USD reaction');
  }

  // ── Generic "says" fallback ───────────────────────────────────────────────
  if (points.length === 0 && /says|said|announces|reports|confirms|warns|states/.test(t)) {
    const ctx = headlineContext(item.headline);
    if (/stable|stability|maintain/.test(t))          points.push(`${ctx}: stability commitment : anchors near-term volatility expectations`);
    if (/concern|warn|risk|threat|caution/.test(t))   points.push(`${ctx}: risk warning : watch safe-haven flows (Gold, JPY, CHF)`);
    if (/growth|expand|recover|strong/.test(t))       points.push(`${ctx}: growth signal : risk assets may find support`);
    if (/cut.*spend|austerity|deficit.*reduc/.test(t)) points.push(`${ctx}: fiscal tightening : growth drag, bonds ↑`);
  }

  // Only return if we have something real : fallback suppressed
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
              'Watch: Brent, WTI : energy stocks under pressure, CAD ↓'],
  'Gold ↑': ['Risk-off → safe-haven demand flows into gold',
              'Watch: XAU/USD, Silver : USD/JPY likely lower, bond yields ↓'],
  'Gold ↓': ['Risk appetite returns → gold loses safe-haven premium',
              'Watch: XAU/USD : equities may be the beneficiary'],
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
  'JPY ↑':  ['Yen strengthens : BoJ hawkish or carry trade unwind',
              'Watch: USD/JPY ↓, EUR/JPY ↓ : carry trades at risk'],
  'JPY ↓':  ['Yen weakens : BoJ stays dovish, carry trades supported',
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
      paras.push('BoJ hawkish signal : carry traders are unwinding long USD/JPY, AUD/JPY and EUR/JPY positions as the rate differential with Japan narrows. Watch for stop clusters below key support in USD/JPY as leveraged positions flush out.');
      paras.push('Key pairs: USD/JPY (bearish near-term), EUR/JPY (downside risk), AUD/JPY (carry unwind). JGB 10Y yields rising : confirmation of the move. Nikkei may sell off on yen strength.');
    } else if (/dovish|hold|maintain|no change|uncertain|cautious|monitor|gradual/.test(all)) {
      paras.push('BoJ remains on hold : JPY weakness bias continues as the rate differential with the US stays wide. USD/JPY bulls retain the upper hand; carry trades intact and supported.');
      paras.push('Watch: USD/JPY (bullish bias), EUR/JPY (supported), AUD/JPY (carry supported). Nikkei likely to find support from the weaker yen. Monitor MoF intervention risk above 155–160 zone.');
    } else {
      const ctx = headlineContext(item.headline);
      paras.push(`${ctx || 'BoJ commentary'} : market is parsing for any guidance shift on the rate path or JGB tapering schedule. USD/JPY is the primary vehicle; JGB 10Y yields are the real-time confirmation signal.`);
    }
  }

  // Fed
  if (cat === 'Fed' || /\bfed\b|fomc|powell|federal reserve/.test(t)) {
    if (/hawkish|higher for longer|not cut|no cut|pause|persistent|resilient|inflation concern/.test(all)) {
      paras.push('Fed hawkish rhetoric : front-end US yields repricing higher as rate cut expectations are pushed back. DXY bid across the board; EUR/USD and GBP/USD face renewed selling pressure.');
      paras.push('Watch: DXY (bullish), USD/JPY (upside), Gold (near-term bearish), US 2Y yields (higher). Monitor CME FedWatch for cut probability shifts : rate-sensitive sectors (tech, utilities) likely under pressure.');
    } else if (/dovish|cut|eas|pivot|slow|cooling|below target|confident|progress/.test(all)) {
      paras.push('Fed dovish signal : USD offered as rate cut expectations gain traction. EUR/USD and GBP/USD catching bid; Gold breaking higher as real yields compress.');
      paras.push('Watch: DXY (bearish), EUR/USD (bullish), Gold (bullish), Nasdaq (risk-on). US 2Y yields dropping : monitor the 2Y/10Y spread. Bitcoin may also benefit from the liquidity easing signal.');
    } else {
      const ctx = headlineContext(item.headline);
      paras.push(`${ctx || 'Fed commentary'} : no clear directional policy signal yet. Parse for language shifts on: (1) rate cut timing, (2) inflation progress assessment, (3) balance sheet trajectory. DXY and US 2Y yields are the live tells.`);
    }
  }

  // ECB
  if (cat === 'ECB' || /\becb\b|lagarde|governing council/.test(t)) {
    if (/hawkish|hike|tighten|above target/.test(all)) {
      paras.push('ECB hawkish turn : EUR bid as rate hike expectations are repriced. EUR/USD pressing higher, EUR/GBP supported. Bund yields moving up.');
      paras.push('Watch: EUR/USD (bullish), EUR/GBP (bullish), EUR/JPY (bullish). German Bund 10Y yields higher. European bank stocks may outperform on margin expansion expectations.');
    } else if (/dovish|cut|eas|slow|below|concern|weak/.test(all)) {
      paras.push('ECB signals further easing : EUR offered as the market prices in more aggressive cuts. EUR/USD faces headwinds; Bund–Treasury spread widening.');
      paras.push('Watch: EUR/USD (bearish), EUR/GBP (bearish). Southern European bond spreads may tighten. European equities mixed : growth positive, FX headwind for exporters.');
    }
  }

  // BoE
  if (cat === 'BoE' || /\bboe\b|bank of england|bailey/.test(t)) {
    if (/hawkish|hike|tighten/.test(all)) {
      paras.push('BoE hawkish : GBP bid as rate expectations are revised higher. GBP/USD upside, EUR/GBP falling. Gilt yields higher.');
      paras.push('Watch: GBP/USD (bullish), EUR/GBP (bearish), GBP/JPY (bullish). FTSE may underperform : higher rates weigh on rate-sensitive sectors and UK housing names.');
    } else if (/dovish|cut|eas/.test(all)) {
      paras.push('BoE signals easing : GBP offered. GBP/USD downside, EUR/GBP higher. Gilts rallying.');
      paras.push('Watch: GBP/USD (bearish), EUR/GBP (bullish). FTSE 100 may find support as rate-cut expectations boost the UK domestic demand outlook.');
    }
  }

  // NFP
  if (/\bnfp\b|nonfarm payroll|non.?farm payroll/.test(t)) {
    if (/above|beat|strong|surge|jump|better/.test(all)) {
      paras.push('NFP beat : strong labour market reinforces the Fed\'s higher-for-longer stance. DXY surging, USD/JPY pressing higher. Gold selling off as rate cut pricing is aggressively unwound.');
      paras.push('Watch: DXY (bullish), USD/JPY (bullish), Gold (bearish near-term), US 2Y yields (spike). CME FedWatch cut probability will drop sharply : monitor EUR/USD support levels for the next leg.');
    } else if (/below|miss|weak|drop|fall|worse/.test(all)) {
      paras.push('NFP miss : weak jobs data revives Fed cut expectations. USD selling off; EUR/USD and GBP/USD catching a strong bid. Gold rallying as the market reprices a more aggressive easing cycle.');
      paras.push('Watch: DXY (bearish), EUR/USD (bullish), Gold (bullish), US 10Y yields (falling). Equities may initially rally on cut optimism before underlying growth concerns take over : watch the tone.');
    }
  }

  // CPI
  if (/\bcpi\b|consumer price index|inflation rate/.test(t)) {
    if (/above|hot|beat|surge|accelerat|rise|higher/.test(all)) {
      paras.push('Hot CPI : inflation staying elevated resets the rate cut timeline. USD front-end bid; 2Y yields spiking. EUR/USD under pressure; Gold facing near-term headwinds from higher real rates.');
      paras.push('Watch: DXY (bullish), USD/JPY (upside), Gold (near-term bearish), US 2Y yields (higher). Monitor the 5Y5Y inflation breakeven and TIPs for the bigger-picture read on real rates.');
    } else if (/below|cool|miss|fall|soft|lower/.test(all)) {
      paras.push('Soft CPI : disinflation narrative intact, opening the door to cuts. USD sold across the board as real yields compress; risk assets catching a bid.');
      paras.push('Watch: DXY (bearish), EUR/USD (bullish), Gold (bullish), Nasdaq (bullish). Rate-sensitive sectors likely to outperform. AUD and NZD may also benefit from the risk-on tone.');
    }
  }

  // GDP
  if (/\bgdp\b/.test(t)) {
    if (/above|beat|strong|exceed|grow|rise/.test(all)) {
      paras.push('GDP beat : robust growth supports the domestic currency and reduces the urgency of rate cuts. Domestic currency bid, equities supported, bonds may face mild selling as recession risk fades.');
    } else if (/below|miss|contraction|shrink|negative|fall/.test(all)) {
      paras.push('GDP miss/contraction : growth fears resurface. Domestic currency under pressure; safe-haven demand increasing. Watch: Gold (bullish), JPY/CHF (safe-haven bid), equities (bearish on growth outlook).');
    }
  }

  // PMI
  if (/\bpmi\b/.test(t)) {
    const nums = (item.headline || '').match(/\d+\.?\d*/g) || [];
    const pmiVal = nums.find(n => { const v = parseFloat(n); return v >= 40 && v <= 65; });
    if (pmiVal) {
      const v = parseFloat(pmiVal);
      paras.push(v > 50
        ? `PMI ${pmiVal} : expansion territory (above 50.0 threshold). Growth momentum positive; the domestic currency may find support. Risk-on tone if this is a major economy reading.`
        : `PMI ${pmiVal} : contraction territory (below the critical 50.0 level). Growth concerns weigh on the domestic currency; markets may start pricing in additional central bank easing.`
      );
    }
  }

  // Geopolitical
  if (cat === 'Geopolitical' || /attack|strike|missile|escalat/.test(t)) {
    if (/iran|hormuz|middle east|gulf/.test(t)) {
      paras.push('Middle East escalation : watch XBRUSD and XTIUSD for immediate spike (Hormuz supply risk). XAUUSD bid as geopolitical safe haven; USDJPY and USDCHF dropping on JPY/CHF flows. USDCAD may fall as CAD is oil-linked.');
      paras.push('Key pair moves: XAUUSD ↑ (spike), USDJPY ↓, USDCHF ↓, XBRUSD ↑, USDCAD ↓, AUDUSD ↓, NZDUSD ↓. VIX spike + XAUUSD velocity = scale gauge for the risk-off move.');
    } else if (/russia|ukraine/.test(t)) {
      paras.push('Russia/Ukraine escalation : EURUSD under pressure from European energy/growth risk. XAUUSD bullish (geopolitical bid); USDJPY and USDCHF dropping as safe-haven flows accelerate. Natural Gas spiking.');
      paras.push('Key pair moves: EURUSD ↓, XAUUSD ↑, USDJPY ↓, USDCHF ↓, NATGAS ↑. DAX and CAC selling off. Wheat futures may spike on supply disruption risk : watch agricultural commodities.');
    } else {
      paras.push('Geopolitical shock : immediate safe-haven rotation: XAUUSD spiking, USDJPY and USDCHF dropping as JPY/CHF attract flows. AUDUSD and NZDUSD lower on risk-off. DXY bid vs. commodity currencies.');
      paras.push('Key pair moves: XAUUSD ↑, USDJPY ↓, USDCHF ↓, AUDUSD ↓, NZDUSD ↓. VIX spike + XAUUSD velocity = scale gauge. S&P 500 futures direction confirms broader market tone.');
    }
  }

  // Trade / Tariffs
  if (cat === 'Trade' || /tariff|trade war|trade deal/.test(t)) {
    if (/escalat|increas|impose|raise|hike/.test(all)) {
      paras.push('Trade escalation : tariff risk weighing on global growth outlook. USD may initially benefit as a safe-haven but ultimately undermines growth. CNY/EM FX under pressure, Asian equities selling off.');
      paras.push('Watch: USD/CNY (CNY weaker), AUD (commodity/China-linked bearish), emerging market FX (broadly weaker). S&P 500 and Nasdaq face headwinds from supply chain and margin concerns.');
    } else if (/deal|resolv|cut|reduce|suspend/.test(all)) {
      paras.push('Trade de-escalation : risk-on move. CNY bid, EM FX recovering, equities rallying. The commodity-linked currencies (AUD, CAD, NZD) are likely to outperform in the risk-on regime.');
    }
  }

  return paras;
}

// ── Smart contextual tags ──────────────────────────────────────────────────
const TAG_CLASS = {
  'Data':        'tag--neutral',
  'Inflation':   'tag--neutral',
  'Rates':       'tag--neutral',
  // Banques centrales + emploi : tags neutres (blanc), comme « US » (demande utilisateur)
  'Fed':         'tag--neutral',
  'ECB':         'tag--neutral',
  'BoJ':         'tag--neutral',
  'BoE':         'tag--neutral',
  'BoC':         'tag--neutral',
  'RBA':         'tag--neutral',
  'SNB':         'tag--neutral',
  'RBNZ':        'tag--neutral',
  'Jobs':        'tag--neutral',
  'NFP':         'tag--neutral',
  'Payrolls':    'tag--neutral',
  'CPI':         'tag--neutral',
  'PCE':         'tag--neutral',
  'GDP':         'tag--neutral',
  'ISM':         'tag--neutral',
  'PMI':         'tag--neutral',

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

// Libellés FR des smart-tags news : appliqués UNIQUEMENT au point de rendu (textContent).
// La clé / data-cat / classe restent en anglais (valeur logique). Les sigles (Fed, ECB, BoJ,
// BoE, BoC, RBA, SNB, RBNZ, NFP, CPI, PCE, GDP, ISM, PMI, US, UK, EU) restent tels quels → absents ici.
const NEWS_TAG_FR = {
  'Data': 'Données', 'Inflation': 'Inflation', 'Rates': 'Taux', 'Jobs': 'Emploi',
  'Equities': 'Actions', 'Bonds': 'Obligations', 'Tariffs': 'Tarifs', 'Sanctions': 'Sanctions',
  'Geopolitical': 'Géopolitique', 'Yuan': 'Yuan', 'Asia': 'Asie', 'Energy': 'Énergie',
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
  // Requires named actor + concrete military/diplomatic action : avoids false fires
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

  // ── BONDS: tag retiré sur demande utilisateur (plus de tag « Bonds » sur les news). ───────────

  // ── INFLATION: CPI/PCE/PPI/HICP/Inflation Rate data releases ────────────
  // Covers "CPI YoY", "German Inflation Rate YoY Prel", "Italy Consumer Price Index" etc.
  const _inflationResult = /\b(?:actual|flash|prelim|final|yoy|mom|y\/y|m\/m|rose|fell|came in|above|below|meets?|surged|eased|increased|decreased|vs\.?\s*exp|vs\.?\s*forecast)\b/;
  if ((/\b(?:cpi|pce|ppi|hicp|core\s+cpi|core\s+pce|core\s+ppi)\b/.test(t) && _inflationResult.test(t)) ||
      (/\b(?:consumer prices?|consumer price index|producer prices?|producer price index|harmonized\s+index\s+of\s+consumer\s+prices?|hicp)\b/.test(t) && _inflationResult.test(t)) ||
      // "Inflation Rate YoY Prel" / "Inflation Rate MoM" : common FJ format
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

  // ── DATA: key macro statistical releases : not if Inflation/Rates already ─
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
      // "vs. Exp." / "vs. Forecast" format : always a real data release result
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
  catText.textContent = catFr('Economic Commentary');
  el.appendChild(catText);

  const content = document.createElement('div');
  content.className = 'news-content';

  const header = document.createElement('div');
  header.className = 'econ-group-header';

  const badge = document.createElement('span');
  badge.className = 'econ-group-badge';
  badge.textContent = `${count} Publications économiques`;

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
    hl.textContent = _dtpTitle(item.headline);
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

// Figures POLITIQUES/gouvernementales à fort débit (Trump, Vance, Bessent, Rubio…) : leurs citations
// en rafale spamment le flux → MÊME regroupement que les banquiers centraux (1 carte + le reste en Info).
const POL_SPEAKER_RX = /\b(trump|vance|bessent|rubio|lutnick|hassett|greer|navarro|miran|waltz|witkoff|leavitt|yellen|musk|reeves|lammy|kato|ishiba|takaichi|zelenskyy?|putin|lavrov|netanyahu|macron|merz|starmer|meloni|von\s+der\s+leyen|sefcovic|dombrovskis)\b/i;

// "BoE's Mann Speaks" / "Fed's Powell Speaking" / "ECB Lagarde Testimony"
function isSpeakerOpener(item) {
  const h = (item.headline || '').trim();
  return CB_SPEAKER_RX.test(h) &&
    /\b(?:speaks?|speaking|delivers?\s+(?:speech|remarks?|address)|gives?\s+(?:speech|remarks?)|presents?|testif(?:y|ies|ied)|testimony|press\s+(?:conference|briefing)|opening\s+(?:statement|remarks?)|keynote)\s*$/i.test(h);
}

// "BoE's Mann: Inflation sticky" / "Fed's Powell - Data dependent" / "Powell Says..."
function isSpeakerQuote(item) {
  const h = item.headline || '';
  if (!CB_SPEAKER_RX.test(h) && !POL_SPEAKER_RX.test(h)) return false;   // banquiers centraux OU figures politiques
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
  if (m2) return m2[1].toLowerCase();
  const m3 = h.match(POL_SPEAKER_RX);   // figure politique (Trump/Vance/Bessent…) → même clé pour toutes les variantes
  return m3 ? m3[1].toLowerCase() : null;
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
  if (item._eventAnalysis) return true;   // analyse FOMC/NFP (~30 min après) → rendu structuré sectionné, jamais re-résumé
  if (item._briefing || item.source === 'DTP') return true;   // rapports DTP (rendu structuré conservé)
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
  // Par défaut : rapport d'analyste / briefing → PAS de badge (retiré sur demande ; INSTITUTION/CALENDRIER restent).
  return '';
}

function parsePrimerBullets(description) {
  if (!description) return [];
  const clean = description.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  return clean.split(/\n+/)
    .map(l => l.trim())
    .map(l => l.replace(/^[-•·]\s+/, ''))   // strip leading dash/bullet
    .filter(l => l.length > 4 || _isSectionHead(l));   // garde les rubriques COURTES en MAJUSCULES (ex. « FX ») comme titres
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
// Remplace la marque DTP par DTP dans les titres de rapport
// Suffixes de SOURCE à ne PAS afficher dans le flux temps réel (on coupe " - Source" en fin de titre)
const _NEWS_SRC_RE = /\s*[-–—]\s*(?:Axios|Politico|Semafor|Punchbowl|Reuters|RTRS|Bloomberg|BBG|CNBC|CNN|BBC|NBC|ABC|CBS|MSNBC|Fox(?: News| Business)?|Newsmax|OANN|WSJ|Wall Street Journal|FT|Financial Times|NYT|New York Times|Washington Post|WaPo|Forbes|Barron'?s|MarketWatch|Dow Jones|Investing\.com|FXStreet|Forex ?Live|Zero ?Hedge|The Block|CoinDesk|AP|AFP|DPA|ANSA|EFE|PA Media|Xinhua|TASS|RIA(?: Novosti)?|Interfax|Sputnik|Mehr(?: News)?|IRNA|Fars(?: News)?|Tasnim|Press TV|Tehran Times|Al[\s-]?Jazeera|Al[\s-]?Arabiya|Sky News(?: Arabia)?|Anadolu|Trend|Nikkei|Kyodo|Jiji|Yonhap|SCMP|Global Times|Caixin|Times of Israel|Jerusalem Post|Haaretz|Ynet|The Guardian|Guardian|Telegraph|Independent|Economist|Truth Social|Twitter\/?X?|X \(Twitter\)|Telegram|Financial ?Juice|Newswires?|[a-z0-9][a-z0-9-]*\.(?:com|net|org|io))\.?\s*$/i;
// Retire les marqueurs markdown bruts (**gras**, *ital*, `code`, __ __, ~~ ~~, # titres, [txt](url))
// en GARDANT le texte : filet de sécurité pour les titres/textes rendus en TEXTE BRUT (textContent)
// et les rapports DÉJÀ en cache avant le nettoyage côté serveur. Aucune astérisque ne doit s'afficher.
function _mdStrip(s) {
  return String(s == null ? '' : s)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/\*+/g, '')             // titres en texte brut : aucune astérisque légitime → on enlève tout résidu
    .replace(/\s{2,}/g, ' ')
    .trim();
}
function _dtpTitle(s) { return _mdStrip(String(s || '').replace(_NEWS_SRC_RE, '').replace(/[,;]?\s*\(?\bvia\s+[A-Z][\w.&'’ /-]{1,28}\)?\.?\s*$/i, '').trim()); }
// Titre AFFICHÉ d'une news « propos/citation » hors marché (item._infoQuote, posé côté serveur) : titre
// explicatif IA (item._infoTitle) s'il est prêt, sinon repli déterministe INSTANTANÉ. AFFICHAGE SEULEMENT —
// item.headline n'est JAMAIS muté (veto 2026-07-03) ; la citation brute reste lisible dans le déplié.
const _INFO_QUOTE_FALLBACK = 'Propos personnels, hors données de marché';
function _newsDisplayTitle(item) {
  if (item && item._infoQuote) return _dtpTitle(item._infoTitle) || _INFO_QUOTE_FALLBACK;
  return _dtpTitle(item ? item.headline : '');
}

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

// Pertinence d'un mouvement à une news : on n'affiche dans la RÉACTION que les instruments dont la
// devise/commodité est CITÉE dans le titre/tags (ex. USD/JPY pour une news Yen) : jamais un actif sans
// rapport (ex. Brent pour une intervention JPY). Instrument hors map → conservé (pas de sur-filtrage).
const _MOVE_KEYS = {
  'brent crude':   /\b(oil|crude|brent|wti|opec|petroleum|barrel|energy|refinery|saudi|iran|hormuz|supply|gas)\b/i,
  'or (xau/usd)':  /\b(gold|xau|bullion|precious|safe.?haven|geopolit|war|conflict|risk.?off)\b/i,
  'dxy':           /\b(dxy|dollar|\busd\b|\bfed\b|fomc|powell|greenback)\b/i,
  'eur/usd':       /\b(eur\b|euro|ecb|lagarde|eurozone|german|france|italy|\busd\b|dollar|\bfed\b|powell)\b/i,
  'nasdaq (qqq)':  /\b(nasdaq|tech|equit|stocks?|shares|wall street|qqq)\b/i,
  's&p 500 (spy)': /\b(s&p|sp ?500|spy|equit|stocks?|shares|wall street|\bdow\b)\b/i,
  'usd/jpy':       /\b(jpy|yen|boj|bank of japan|japan|japanese|ueda|intervention|\busd\b|dollar|\bfed\b)\b/i,
  'gbp/usd':       /\b(gbp|pound|sterling|\bboe\b|bailey|\buk\b|britain|british|\busd\b|dollar)\b/i,
  'aud/usd':       /\b(aud|aussie|\brba\b|australia|australian|\busd\b|dollar)\b/i,
};
function _moveRelevant(label, hay) {
  const re = _MOVE_KEYS[String(label || '').toLowerCase().trim()];
  return re ? re.test(hay) : true;   // instrument hors map → conservé
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
    // Bruit métadonnées (auteur/source) : pas de valeur marché (n'importe où dans la phrase)
    .filter(s => !/^(?:authored by|written by|by\s+[A-Z]|via\s+|source\s*:|courtesy of|published by|republished)/i.test(s))
    .filter(s => !/(?:this article was written by|\bwritten by\s+[\w.\- ]+\s+at\b|\bat\s+(?:investinglive|forexlive|think\.ing|fxstreet|actionforex)\.com|follow .* on (?:twitter|x)\b)/i.test(s))
    .filter(s => !/^[\w .'-]+\bvia\b\s+the\b/i.test(s))
    .filter(s => !_isJunkBullet(s))            // jeton parasite scrappé (/federalreserve, @handle, domaine/url nu…)
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
    if (diff > 0)      bullets.push(`Sort à <strong>${actual}</strong> vs <strong>${forecast}</strong> attendu : <strong>au-dessus</strong> du consensus (+${diff}).`);
    else if (diff < 0) bullets.push(`Sort à <strong>${actual}</strong> vs <strong>${forecast}</strong> attendu : <strong>sous</strong> le consensus (${diff}).`);
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
  el.className = `news-item${baseClass}${item._eventAnalysis ? ' news-item--eva' : ''}${isUrgent ? ' news-item--urgent' : ''}${isPrimer ? ' news-item--primer' : ''}${(isSpeaker || hasGrouped) ? ' news-item--speaker' : ''}${item._new ? ' news-item--new' : ''}${isRead(item.id) ? ' news-item--read' : ''}`;
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
  catText.textContent = catFr(item.category);
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
  // News « propos/citation » hors marché : titre reframé + tag « Contexte » + citation gardée au déplié.
  const isInfoQuote = !!(item && item._infoQuote);
  // Info tag shown ONLY when we already have real content to display
  const hasInfo   = rawDesc.length > 30
    || hasGrouped
    || autoSummary.length > 0
    || isInfoQuote                                    // la citation brute est toujours consultable au déplié
    || (isSpeaker && (rawDesc.length > 10 || speakerQuotesAtRender.length > 0));
  // Décryptage DTP (demande user 16/07 « ajoute de la valeur… avec un tag Info ») : news d'ÉVÉNEMENT
  // (donnée éco CPI/NFP/PMI…, discours/minutes/conférence de banque centrale) → même bloc pédagogique
  // que le calendrier (impact, réaction classique, anticipation, ton BC + prochaine réunion). Déterministe,
  // zéro IA. Helpers exposés par charts.js (garde typeof : dégradation propre si absent).
  const hasEco = !isPrimer && !item._dtpd && !item._marketWrap
    && typeof dtpEventInsightMatch === 'function' && dtpEventInsightMatch(item.headline, item.currency);

  const headline = document.createElement('div');
  headline.className = 'news-headline';

  if (isPrimer) {
    // On retire UNIQUEMENT le préfixe "PRIMER —" (sans casser "DTP Daily Asia-Pac …")
    const titleText = (item.headline || '')
      .replace(/^\s*(?:PRIMER|PREVIEW|RESEARCH|INSIGHT|ANALYSIS|TALKING POINTS?)\s*[-:—]\s*/i, '')
      .trim();
    // Rapports DTP (briefings) → présentés comme des news, SANS badge PRIMER/ANALYST.
    // Les autres primers (institution/calendrier) gardent leur badge.
    const isReport = item._briefing || item.source === 'DTP';
    const _blab = isReport ? '' : primerBadgeLabel(item);
    if (_blab) {   // badge seulement s'il y a un label (INSTITUTION/CALENDRIER) : plus de badge « ANALYST »
      const badge = document.createElement('span');
      badge.className = 'primer-badge';
      badge.textContent = _blab;
      headline.appendChild(badge);
    }
    const titleSpan = document.createElement('span');
    titleSpan.textContent = _dtpTitle(titleText);
    headline.appendChild(titleSpan);
  } else {
    headline.textContent = _newsDisplayTitle(item);   // reframe explicatif pour les news « propos » (_infoQuote), sinon titre normal
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

  if (hasNotes || hasInfo || hasEco) {
    expandEl = document.createElement('div');
    expandEl.className = 'news-description';
    content.appendChild(expandEl);
  }

  // Arrow column : sits between category col and content col
  arrowEl = document.createElement('div');
  arrowEl.className = 'news-arrow-col';
  if (expandEl) {
    arrowEl.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    // Défaut au dépliage : on PRÉFÈRE l'analyse FR pré-calculée (instantanée, aucun fetch) au résumé « Info »
    // (souvent la description SOURCE en anglais) → la description s'affiche instantanément EN FRANÇAIS.
    const _togglePanel = e => { e.stopPropagation(); openPanel(hasNotes ? 'analysis' : hasInfo ? 'info' : hasEco ? 'eco' : 'reaction'); };
    arrowEl.onclick = _togglePanel;
    // Clic sur le TITRE de la news → déroule aussi (description / analyse / réaction)
    headline.classList.add('news-headline--clickable');
    headline.onclick = _togglePanel;
  }
  el.insertBefore(arrowEl, content);

  // ── Décryptage DTP EN BAS DU PANNEAU INFO (17/07) : le pill dédié a été retiré du fil à la demande
  //    du user, et les onglets internes (tabsHtml) ne sont pas rendus → sans ça, le Décryptage serait
  //    inaccessible sur toute news ayant aussi « Info ». Slot séparé, re-rempli après CHAQUE rendu du
  //    panneau (le résumé IA remplace innerHTML de façon asynchrone et écraserait le bloc).
  async function _ecoFill(host) {
    if (!hasEco || !host || !host.isConnected) return;
    try {
      const html = (typeof dtpEventInsightHtml === 'function') ? await dtpEventInsightHtml(item) : '';
      if (!html || !host.isConnected || !host.classList.contains('visible')) return;
      let slot = host.querySelector('.news-eco-slot');
      if (!slot) { slot = document.createElement('div'); slot.className = 'news-eco-slot'; host.appendChild(slot); }
      slot.innerHTML = html;
      if (window._dtpTranslateQuotes) window._dtpTranslateQuotes(host, '.cal-kb-quote');   // propos BC → FR en place
    } catch {}
  }

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
    // État actif des pills (Info/Analyse/Réaction) : un seul actif à la fois
    [infoTagEl, analysisTagEl, reactionTagEl].forEach(t => t && t.classList.remove('tag--active'));
    const _activePill = tab === 'info' ? infoTagEl : tab === 'analysis' ? analysisTagEl : reactionTagEl;
    if (_activePill) _activePill.classList.add('tag--active');
    const nowTime = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    const tabsHtml = [
      hasNotes  && `<button class="expand-tab${tab === 'analysis' ? ' expand-tab--active' : ''}" data-tab="analysis"><span class="tag-icon">⊙</span> Analyse</button>`,
      hasInfo   && `<button class="expand-tab${tab === 'info'     ? ' expand-tab--active' : ''}" data-tab="info"><span class="tag-icon">ⓘ</span> ${isInfoQuote ? 'Contexte' : 'Info'}</button>`,
      hasEco    && `<button class="expand-tab${tab === 'eco'      ? ' expand-tab--active' : ''}" data-tab="eco"><span class="tag-icon">ⓘ</span> Décryptage</button>`,
    ].filter(Boolean).join('');

    const infoBody = (() => {
      // ── PROPOS / CITATION HORS MARCHÉ (_infoQuote) : on affiche la CITATION BRUTE (le titre d'origine,
      //    verbatim) + une note de cadrage. Le titre de la carte est le reframe explicatif ; ici on garde
      //    la parole d'origine pour la transparence (rien n'est masqué). ──
      if (isInfoQuote) {
        const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const quote = _dtpTitle(item.headline);
        const extra = rawDesc.length > 30 ? `<li>${esc(rawDesc)}</li>` : '';
        return `<div class="iq-note">Propos personnels repris tels quels, sans portée directe sur les marchés.</div>
          <ul class="article-points article-points--clean"><li>${esc(quote)}</li>${extra}</ul>`;
      }
      // ── [MARKET UPDATE] (Convera) : rapport COMPLET avec images, affiché directement ──
      if (item._marketUpdate && item.fullContent) {
        return `<div class="market-update-body">${item.fullContent}</div>`;
      }
      // ── DTP MARKET WRAP : news VISIBLE (non-primer) façon pro → bloc LEAD de synthèse en tête
      //    (puces simples, avant le 1er titre), rubriques EN MAJUSCULES → titres orange, reste = puces. ──
      if (item._marketWrap) {
        // MÊME format que les autres descriptions (analyse d'événement) : liste à PUCES + titres/sous-titres
        // en GRAS (.ip-head), PAS de titres orange. Sections (EQUITIES, FX…) = sous-titres gras ; chaque ligne
        // = puce avec son lead en gras (_reportLead).
        const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const lines = String(item.description || '').split(/\n+/).map(l => l.replace(/^[-•·]\s*/, '').trim()).filter(Boolean);
        const html = lines.map(t => {
          const isHead = _isSectionHead(t) || (t.length <= 46 && /:$/.test(t) && !/[.!?]/.test(t.slice(0, -1)));
          if (isHead) return `<li class="ip-head">${esc(t.replace(/\s*:\s*$/, ''))}</li>`;
          return `<li>${_reportLead(t)}</li>`;
        }).join('');
        return `<ul class="article-points article-points--clean">${html}</ul>`;
      }
      // ── ANALYSE D'ÉVÉNEMENT (FOMC/BCE/NFP/CPI…) : MÊME format que les autres news → puces +
      //    sous-titres en GRAS (pas de titres orange/encadrés). Gère le nouveau format « Titre : »
      //    ET l'ancien format MAJUSCULES (analyses déjà publiées).
      if (item._eventAnalysis) {
        const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const lines = String(item.description || '').split(/\n+/).map(l => l.replace(/^[-•·]\s*/, '').trim()).filter(Boolean);
        const html = lines.map(t => {
          const isHead = _isSectionHead(t) || (t.length <= 46 && /:$/.test(t) && !/[.!?]/.test(t.slice(0, -1)));
          if (isHead) return `<li class="ip-head">${esc(t.replace(/\s*:\s*$/, ''))}</li>`;
          return `<li>${esc(t).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')}</li>`;
        }).join('');
        return `<ul class="article-points article-points--clean">${html}</ul>`;
      }
      // ── DTP DAILY US OPENING NEWS : rapport structuré COMPLET déroulé dans le flux (sections : puces / paragraphes / données) ──
      if (item._dtpd) {
        const w = item._dtpd;
        const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const bold = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        let lis = '';
        if (w.summary) lis += `<li class="ip-head">Synthèse</li><li>${bold(w.summary)}</li>`;
        (w.sections || []).forEach(s => {
          if (!s || !s.title) return;
          lis += `<li class="ip-head">${esc(s.title)}</li>`;
          if (s.kind === 'data' && (s.data || []).length) {
            s.data.forEach(r => { const cc = r.ccy ? `<span class="dtpd-eco-ccy">${esc(r.ccy)}</span> ` : ''; lis += `<li>${cc}<strong>${esc(r.release)}</strong>${r.actual ? ' : ' + esc(r.actual) : ''}${r.expected ? ' (att. ' + esc(r.expected) + ')' : ''}${r.previous ? ' (préc. ' + esc(r.previous) + ')' : ''}</li>`; });
          } else if (s.kind === 'paras' && (s.paras || []).length) {
            s.paras.forEach(p => { lis += `<li>${bold(p)}</li>`; });
          } else {
            (s.items || []).forEach(it => { lis += `<li>${bold(it)}</li>`; });
          }
        });
        // UNE seule liste « article-points--clean » → MÊME forme/alignement que les autres descriptions (analyses d'événement).
        return `<ul class="article-points article-points--clean">${lis || '<li>Rapport en cours de génération…</li>'}</ul>`;
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
      expandEl.classList.add('visible'); if (window.DTP_translate) window.DTP_translate(expandEl);
      if (reactionTagEl) reactionTagEl.classList.add('tag--active');
      if (analysisTagEl) analysisTagEl.classList.remove('tag--active');

      fetch(`/api/market-moves?since=${item.timestamp}`)
        .then(r => r.json())
        .then(data => {
          if (activeTab !== 'reaction') return;
          // Ne garder QUE les mouvements PERTINENTS à la news (devise/commodité citée dans le titre/tags)
          // → plus jamais un actif sans rapport (ex. Brent pour une news Yen).
          const _hay = ((item.headline || '') + ' ' + (item.tags || []).join(' ') + ' ' + (item.category || '')).toLowerCase();
          const _rxMoves = (data.moves || []).filter(m => _moveRelevant(m.label, _hay));
          if (!_rxMoves.length) {
            // No real moves : remove the Réaction tag entirely and fall back to Info
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
            // Réaction façon flux marché : une PUCE par actif, prix AVANT → APRÈS + variation (style "X passé de A à B").
            const movesHtml = _rxMoves.map(m => {
              const cls = m.dir === 'up' ? 'rx-up' : 'rx-dn';
              const u   = m.unit ? ' ' + m.unit : '';
              return `<li class="rx-li ${cls}">`
                + `<span class="rx-name">${m.label}</span>`
                + `<span class="rx-flow">${m.refPrice}${u} <span class="rx-ar">&rarr;</span> ${m.peakPrice}${u}</span>`
                + `<span class="rx-pct">${m.movePct}</span>`
                + `</li>`;
            }).join('');
            expandEl.innerHTML =
              `<div class="rx-block${isRed ? ' rx-block--alert' : ''}">`
              + `<div class="rx-head">R&eacute;action &agrave; : ${nowTime}</div>`
              + `<ul class="rx-list">${movesHtml}</ul>`
              + `<div class="rx-explain" id="rx-explain-${item.id}"></div>`
              + `</div>`;

            // Explication Gemini du mouvement (mise en cache → 0 requête à la réouverture)
            const movesStr = _rxMoves.map(m => `${m.label} ${m.dir === 'up' ? '+' : '-'}${m.movePct}`).join(', ');
            // Explication = LISTE À PUCES (1 phrase courte par puce, en langue source) : façon pro.
            const _applyExplain = val => {
              const arr = Array.isArray(val) ? val : (val ? [String(val)] : []);
              if (!arr.length) return;
              const el = document.getElementById(`rx-explain-${item.id}`);
              if (el && activeTab === 'reaction') el.innerHTML = _renderInfoBullets(arr);
            };
            if (_reactCache.has(item.id)) {
              _applyExplain(_reactCache.get(item.id));
            } else {
              fetch('/api/reaction-explain', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: item.id, headline: item.headline, moves: movesStr, important: !!(item.priority === 'high' || item.urgent) }),
              })
                .then(r => r.json())
                .then(d => {
                  const b = (d && Array.isArray(d.bullets) && d.bullets.length) ? d.bullets : ((d && d.text) ? [d.text] : []);
                  if (b.length) _reactCache.set(item.id, b);   // succès uniquement (un échec réessaie à la prochaine ouverture)
                  _applyExplain(b);
                })
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

    if (tab === 'eco') {
      // Décryptage DTP (pédagogie éco / banque centrale) : même bloc que le déroulé calendrier.
      expandEl.innerHTML = dtpLoader('Chargement du décryptage…', { small: true });
      expandEl.classList.add('visible'); if (window.DTP_translate) window.DTP_translate(expandEl);
      if (analysisTagEl) analysisTagEl.classList.remove('tag--active');
      if (reactionTagEl) reactionTagEl.classList.remove('tag--active');
      Promise.resolve(typeof dtpEventInsightHtml === 'function' ? dtpEventInsightHtml(item) : '')
        .then(html => {
          if (activeTab !== 'eco' || !expandEl.isConnected) return;
          expandEl.innerHTML = html || '<ul class="article-points article-points--clean"><li>Décryptage indisponible pour cet événement.</li></ul>';
          if (window._dtpTranslateQuotes) window._dtpTranslateQuotes(expandEl, '.cal-kb-quote');   // propos BC (titres du fil, EN) → FR en place
        })
        .catch(() => {});
      return;
    }

    if (tab === 'analysis') {
      // Analyse PRÉ-CALCULÉE côté serveur, attachée à la news → affichage instantané, aucun fetch.
      expandEl.innerHTML = _renderInfoBullets(item.analyse || []);
      expandEl.classList.add('visible'); if (window.DTP_translate) window.DTP_translate(expandEl);
      if (analysisTagEl) analysisTagEl.classList.add('tag--active');
      if (reactionTagEl) reactionTagEl.classList.remove('tag--active');
      return;
    }

    // Info tab : if no inline description but has a ForexFactory article URL, fetch real content
    if (tab === 'info' && rawDesc.length <= 30 && hasArticleUrl) {
      expandEl.innerHTML = dtpLoader('Chargement du résumé…', { small: true });
      expandEl.classList.add('visible'); if (window.DTP_translate) window.DTP_translate(expandEl);
      if (analysisTagEl) analysisTagEl.classList.remove('tag--active');
      if (reactionTagEl) reactionTagEl.classList.remove('tag--active');
      fetch(`/api/article?url=${encodeURIComponent(item.url)}&headline=${encodeURIComponent(item.headline || '')}`)
        .then(r => r.json())
        .then(data => {
          if (activeTab !== 'info') return;
          if (data.points && data.points.length > 0) {
            // Image illustrative (si l'article en a une) : propre, arrondie ; se retire d'elle-même si cassée.
            const _img = (data.image && /^https?:\/\//.test(data.image))
              ? `<div class="article-img-wrap"><img class="article-img" src="${data.image}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.article-img-wrap').remove()"></div>`
              : '';
            expandEl.innerHTML = `${_img}<ul class="article-points">${data.points.map(p => `<li>${p}</li>`).join('')}</ul>`;
            if (window._dtpTranslateQuotes) window._dtpTranslateQuotes(expandEl);   // puces d'article scrapées (souvent EN) → FR
            _ecoFill(expandEl);   // Décryptage DTP sous les puces (plus de pill dédiée)
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
          // Network error : close panel silently, keep the tag
          activeTab = null;
          expandEl.classList.remove('visible');
          if (arrowEl) arrowEl.classList.remove('news-arrow-col--open');
        });
      return;
    }

    // Affichage immédiat (description brute) : instantané
    expandEl.innerHTML = infoBody;
    expandEl.classList.add('visible'); if (window.DTP_translate) window.DTP_translate(expandEl);
    _ecoFill(expandEl);   // Décryptage DTP sous les puces (plus de pill dédiée dans le fil)
    // Contenu SOURCE anglais qui échappe aux résumés IA (citations speaker, propos agrégés, puces de la
    // description scrapée des news standard) → traduction FR en place (instantané en source puis remplacé).
    // Les contenus DÉJÀ produits en FR (rapports DTP, market wrap, analyses d'événement) ne repassent pas par l'IA.
    if (!isPrimer && !item._marketWrap && !item._eventAnalysis && !item._dtpd && window._dtpTranslateQuotes) window._dtpTranslateQuotes(expandEl);
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

    // Amélioration Gemini (style DTP), mise en cache → aucune requête aux ouvertures suivantes
    const _improvable = !isPrimer && !hasGrouped && !isSpeaker && rawDesc.length >= 30;
    if (_improvable) {
      if (_infoCache.has(item.id)) {
        const b = _infoCache.get(item.id);
        if (b && b.length) { expandEl.innerHTML = _renderInfoBullets(b); _ecoFill(expandEl); }   // innerHTML remplacé → on re-pose le Décryptage
      } else {
        // La dépêche brute (langue source) est affichée immédiatement (infoBody) ; on la remplace par le
        // résumé FR dès qu'il arrive (le serveur répond désormais en FRANÇAIS pour toutes les news).
        fetch('/api/news-info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id, headline: item.headline, category: item.category, description: item.description, important: !!(isRed || item.priority === 'high' || item.urgent) }),
        })
          .then(r => r.json())
          .then(data => {
            const b = data.bullets || [];
            if (b.length) _infoCache.set(item.id, b);   // on ne mémorise QUE le succès : un échec (IA en panne) réessaie à la prochaine ouverture au lieu de figer l'anglais pour la session
            if (b.length && activeTab === 'info' && expandEl.classList.contains('visible')) {
              expandEl.innerHTML = _renderInfoBullets(b);
              _ecoFill(expandEl);   // le résumé IA écrase innerHTML → on re-pose le Décryptage sous les puces
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
  // Doublon catégorie↔tag : on ne montre JAMAIS un tag dont le LIBELLÉ AFFICHÉ (FR) est déjà celui de la
  // catégorie rendue à gauche (ex. cat « Géopolitique » + tag « Géopolitique », ou « Énergie »/« Énergie »).
  // Comparaison sur le label FR (pas la valeur brute) → attrape aussi Energy & Power↔Energy.
  const _catLabel = catFr(item.category || '');
  const _isCatDup = tag => (NEWS_TAG_FR[tag] || tag) === _catLabel;
  const _HIDDEN_TAGS = new Set(['China', 'Japan', 'Trade', 'Market Wrap', 'FX Flows', 'Energy & Power', 'Global News', 'Market Analysis', 'Japanese Data', 'Economic Commentary']);   // tags supprimés à l'affichage (Trade = redondant avec Tariffs ; Market Wrap = redondant avec le rapport ; FX Flows/Energy & Power/Global News/Market Analysis/Japanese Data/Economic Commentary = retirés à la demande — « Economic Commentary » doublonnait la catégorie « Commentaire économique » affichée à gauche, et s'affichait en anglais faute d'entrée NEWS_TAG_FR)
  // DTP Daily : on ne montre que quelques tags « de base » (pas les 8 thèmes IA) → flux net comme les autres news.
  for (const tag of (item._dtpd ? (item.tags || []).slice(0, 3) : (item.tags || []))) {
    if (tag === 'High' || tag === 'Medium' || _isCatDup(tag)) continue;
    if (_HIDDEN_TAGS.has(tag)) continue;
    if (tag === 'FX' && item.category === 'FX Flows') continue;   // redondant : la catégorie « Flux FX » est déjà affichée à gauche (demande user)
    if (tag === 'Rates' && !_ratesGuard.test(_hl)) continue;
    if (shownTags.has(tag)) continue;
    shownTags.add(tag);
    const t = document.createElement('span');
    t.className = 'tag ' + (TAG_CLASS[tag] || (item._dtpd ? 'tag--neutral' : 'tag--default'));
    t.dataset.cat = tag;
    t.textContent = NEWS_TAG_FR[tag] || tag;
    tagsEl.appendChild(t);
  }
  for (const tag of (item._dtpd ? [] : smartTags)) {
    if (_isCatDup(tag) || shownTags.has(tag)) continue;
    shownTags.add(tag);
    const t = document.createElement('span');
    t.className = 'tag ' + (TAG_CLASS[tag] || (item._dtpd ? 'tag--neutral' : 'tag--default'));
    t.dataset.cat = tag;
    t.textContent = NEWS_TAG_FR[tag] || tag;
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
    // News « propos/citation » → tag « Contexte » (informatif, hors marché) à la place du générique « Info ».
    infoTagEl.className = 'tag ' + (isInfoQuote ? 'tag--contexte' : 'tag--info');
    infoTagEl.style.cursor = 'pointer';
    infoTagEl.innerHTML = '<svg class="tag-svg" width="11" height="11" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5.25" stroke="currentColor" stroke-width="1.5"/><path d="M6 5.5V8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="6" cy="3.5" r="0.75" fill="currentColor"/></svg> ' + (isInfoQuote ? 'Contexte' : 'Info');
    infoTagEl.onclick = e => { e.stopPropagation(); openPanel('info'); };
    tagsEl.appendChild(infoTagEl);
  }

  // (Pas de pill « Décryptage » dans la rangée de tags — retiré à la demande user 17/07 : le fil reste
  //  net. Le Décryptage DTP reste accessible dans le DÉPLIÉ, via son onglet à côté d'Info/Analyse.)

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
    const _ok = (_t === 'info' && hasInfo) || (_t === 'analysis' && hasNotes) || (_t === 'eco' && hasEco) || (_t === 'reaction' && reactionTagEl);
    if (_ok) requestAnimationFrame(() => openPanel(_t));
    else delete _openNewsPanels[item.id];                    // l'onglet n'existe plus → on nettoie
  }

  // ── Background reaction check ──
  // Only for items that are:
  //   1. Within the 5-day YF 1m data window
  //   2. Genuinely market-moving categories / high priority
  // This avoids spamming the API with routine data or speaker items.
  // On ne CHERCHE une réaction que sur des news vraiment susceptibles de bouger le marché macro
  // (sinon on spamme l'API + on tague tout). Le vrai filtre reste le seuil de mouvement côté serveur.
  const _REACTION_CATS = /^(Geopolitical|Energy & Power|Metals|Fed|ECB|BoJ|BoE|Fixed Income)$/;
  const _REACTION_KW   = /\b(iran|opec\+?|ukraine|russia|israel|war|conflict|invasion|attack|strike|ceasefire|nuclear|emergency|rate (decision|hike|cut)|tariff|sanction)\b/i;
  const _isMarketMoving = item.priority === 'high' || item.urgent
    || (_REACTION_CATS.test(item.category) && _REACTION_KW.test(item.headline))
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
          reactionTagEl.innerHTML = '<svg class="tag-svg" width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M1.5 9L4.5 6L7 8.5L10.5 3.5M10.5 3.5H8M10.5 3.5V6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Réaction';
          reactionTagEl.onclick = e => { e.stopPropagation(); openPanel('reaction'); };
          tagsEl.appendChild(reactionTagEl);
        })
        .catch(() => {})
    );
  }

  return el;
}

// Formateur de date RÉUTILISÉ (au lieu d'en recréer un via toLocaleDateString à CHAQUE appel dans la
// boucle de rendu = coûteux). Sortie identique. Instancié à la volée (au 1er appel) pour ne rien exécuter au boot.
let _fmtDayParis = null;
function formatDate(ts) {
  // timeZone Paris explicite : les en-têtes de jour collent à l'heure de Paris affichée
  // (item.time), même si le navigateur est dans un autre fuseau → plus de décalage de date.
  if (!_fmtDayParis) _fmtDayParis = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'Europe/Paris' });
  const s = _fmtDayParis.format(new Date(ts));
  return s.charAt(0).toUpperCase() + s.slice(1);   // « Mercredi 24/06/2026 » (FR, weekday capitalisé)
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
    const wday     = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'][localNow.getDay()];
    const hr       = localNow.getHours();
    const isDay    = hr >= 6 && hr < 20;
    const wx       = _weatherCache[c.city] || { temp: '--', wind: '--', windDir: 0, icon: '☁' };
    const arrow    = wx.wind !== '--' ? windArrow(wx.windDir) : '';
    const dayNightIcon = isDay ? '<span class="clock-sun">☀︎</span>' : '<span class="clock-moon">☾</span>';
    const label    = c._local ? 'Mon fuseau' : `${c.city} (${c.code})`;
    const tempStr = wx.temp !== '--' ? `${wx.temp}°C` : '--';
    const windStr = wx.wind !== '--' ? `${wx.wind} km/h ${arrow}` : '--';
    return `
      <div class="clock-item${c._local ? ' clock-item--local' : ''}${isOpen ? ' clock-item--open' : ''}">
        <div class="clock-top-row">
          <span class="clock-wday">${wday}</span>
          <span class="clock-date">${month}/${day}</span>
        </div>
        <div class="clock-time"><span class="clock-code">${c._local ? 'ICI' : c.code}</span>${timeStr}<span class="clock-dn-mini">${dayNightIcon}</span></div>
        <div class="clock-mid-row">
          <span class="clock-gmt">GMT ${offset}</span>
          <span class="clock-city-label clock-city-label--${isOpen ? 'open' : 'closed'}">${label}</span>
        </div>
        <div class="clock-sub-row">
          <span class="clock-country-row">${c.country || ''}</span>
          <span class="clock-wx-row">${wx.icon} ${tempStr}</span>
        </div>
        <div class="clock-sub-row">
          <span class="clock-daynight-lbl">${dayNightIcon} ${isDay ? 'Jour' : 'Nuit'}</span>
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

// ═══ World Map (SVG legacy : hidden by CSS, kept for session overlays) ════════
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
      lbl.textContent = catFr(cat);

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
  _syncCatFilterToServer();   // + persistance PAR COMPTE (KV durable) → le choix suit mobile ↔ desktop
}

// ── Filtre de sections PERSISTANT PAR COMPTE (modèle symrecent : suit la reconnexion / le changement
//    d'appareil). On stocke les catégories DÉSACTIVÉES (« off ») → une nouvelle catégorie reste ACTIVE
//    par défaut. localStorage = cache instantané ; le KV serveur est la source de vérité cross-device.
let _catFilterSyncT = null;
function _catFilterOff() { return INTERNAL_CATS.filter(c => !enabledCategories.has(c)); }
function _syncCatFilterToServer() {
  clearTimeout(_catFilterSyncT);
  _catFilterSyncT = setTimeout(() => {
    fetch('/api/cat-filter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ off: _catFilterOff() }) }).catch(() => {});
  }, 800);   // débounce : un seul POST après une salve de décochages
}
async function loadCatFilterFromServer() {
  try {
    const d = await fetch('/api/cat-filter').then(r => r.json());
    if (!d || !Array.isArray(d.off)) return;   // off === null → aucune préférence serveur : on garde localStorage/défaut
    const off = new Set(d.off);
    enabledCategories = new Set(INTERNAL_CATS.filter(c => !off.has(c)));
    try { localStorage.setItem('pt_enabled', JSON.stringify([...enabledCategories])); } catch {}
    buildSectionDropdown(); syncSettingsUI(); syncDropdownUI(); renderNews();   // ré-applique l'état enregistré
  } catch {}
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
      // Migration one-shot : "Commentaire économique" désactivé par défaut (demande). On le retire UNE
      // fois des préférences sauvegardées (flag pt_ec_off_v1), puis on respecte le choix si l'utilisateur le réactive.
      if (!localStorage.getItem('pt_ec_off_v1')) {
        const _eci = valid.indexOf('Economic Commentary');
        if (_eci >= 0) valid.splice(_eci, 1);
        try { localStorage.setItem('pt_ec_off_v1', '1'); } catch {}
      }
      enabledCategories = valid.length > 0 ? new Set(valid) : new Set(INTERNAL_CATS.filter(c => c !== 'Economic Commentary'));
    }
  } catch {
    enabledCategories = new Set(INTERNAL_CATS.filter(c => c !== 'Economic Commentary'));
  }
}

// ═══ Section Dropdown ═════════════════════
function buildSectionDropdown() {
  const container = document.getElementById('section-checkboxes');
  if (!container) return;
  container.innerHTML = INTERNAL_CATS.map(cat => `
    <div class="dropdown-item${enabledCategories.has(cat) ? ' active' : ''}" data-cat="${cat}" onclick="toggleDropdownItem(this)">
      <span class="dropdown-item-label">${catFr(cat)}</span>
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
  if (type === 'ok') return;   // plus d'indicateur "Connected" (inutile) : on ne montre que les erreurs
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
// GARDE : en page ISOLEE (rendu widget e-mail), la topbar n'existe pas → sans elle, ce top-level
// crashait et TUAIT toute la suite d'app.js (les `let` suivants restaient en TDZ → sparkline
// Semaine à Venir silencieusement vide). Ne jamais laisser un top-level toucher le DOM sans garde.
if (notifBadge && notifBadge.parentElement) notifBadge.parentElement.addEventListener('click', () => {
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

  // Aiguille teintée selon l'état (cohérent avec la jauge amCharts de l'onglet RISK)
  const NEEDLE_COLOR = { 'risk-on': '#2dc653', 'risk-off': '#d62828', 'neutral': '#fcbf49' };
  const ncol = NEEDLE_COLOR[cls] || '#fcbf49';
  if (needleEl) { needleEl.setAttribute('transform', `rotate(${angle}, 100, 106)`); needleEl.setAttribute('stroke', ncol); }
  if (gaugePctEl) gaugePctEl.textContent = `${pctSign}${pctAbs}%`;
  if (gaugeLblEl) { gaugeLblEl.textContent = frLabel; gaugeLblEl.className = `rp-gauge-lbl rp-gauge-lbl--${cls}`; }
  gaugeWrap.className = `rp-gauge-wrap rp-gauge-wrap--${cls}`;
}

// Dropdowns : système ceq RETIRÉ (il faisait DOUBLON avec le système global `dtpsel`). Désormais TOUS les
// <select> : filtres Analyst/Institution compris : sont stylés par l'UNIQUE système global `dtpsel`
// (enhanceAllSelects + MutationObserver, plus bas dans ce fichier) → un seul et même design partout.

function _applyRiskTopbar(data) {
  const cls   = _sentClass(data.label);
  const arrow = cls === 'risk-on' ? '↗' : cls === 'risk-off' ? '↘' : '→';
  const short = cls === 'risk-on' ? 'RISK ON' : cls === 'risk-off' ? 'RISK OFF' : 'NEUTRE';   // NEUTRE = cohérent avec le placeholder HTML (Risk on/off = jargon de marché assumé, cf. charte)
  const dotEl = document.getElementById('sentiment-dot-top');
  const lblEl = document.getElementById('sentiment-label-top');
  const btnEl = document.getElementById('sentiment-btn');
  // Look "↘ RISK OFF ⌄" : flèche fine colorée + libellé COURT (pas la forme longue)
  if (dotEl) { dotEl.textContent = arrow; dotEl.className = 'sentiment-dir ' + cls; }
  if (lblEl) {
    if (lblEl.textContent && lblEl.textContent !== 'NEUTRE' && lblEl.textContent !== short && window._dtpFlash) window._dtpFlash(lblEl);   // flash discret : le sentiment topbar bascule vraiment (pas au 1er remplissage du placeholder)
    lblEl.textContent = short;
  }
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
  // En-tête type "Sentiment de marché : AVERSION AU RISQUE" : libellé TRADUIT (la carte LABEL_FR
  // existait mais n'était pas branchée : l'en-tête affichait le label serveur anglais brut).
  const frLbl = LABEL_FR[data.label] || data.label;
  if (lbl) { lbl.textContent = `Sentiment de marché : ${frLbl}`; lbl.className = 'rp-label ' + cls; }
  if (ti) ti.textContent = `Sentiment de marché : ${frLbl}`;
  // Dropdown épuré : pas de jauge ni de bande dans ce popup (la jauge vit dans l'onglet RISK)
  const gw = el('rp-gauge-wrap'); if (gw) gw.style.display = 'none';
  const band = el('rp-band'); if (band) band.style.display = 'none';
  // Description longue (anglais) selon le niveau de risque : exactement comme l'image
  const POPUP_DESC2 = {
    'STRONG RISK-ON':  { lead: 'Fort appétit pour le risque.', detail: 'Capitaux vers les actions et les actifs à fort bêta ; refuges largement vendus.', trade: 'Vent porteur pour AUD/NZD et les indices ; prudence sur JPY, CHF et l’or.' },
    'RISK-ON':         { lead: 'L’appétit pour le risque domine.', detail: 'Actions et cycliques recherchés, le positionnement défensif se dénoue.', trade: 'Biais favorable aux paires risquées et aux indices.' },
    'WEAK RISK-ON':    { lead: 'Léger penchant pour le risque.', detail: 'Ton constructif mais conviction limitée, positionnement prudent.', trade: 'Biais haussier modéré : réduire la taille des positions.' },
    'NEUTRAL':         { lead: 'Marché sans direction claire.', detail: 'Signaux mitigés sur l’ensemble des classes d’actifs, aucun biais dominant.', trade: 'Privilégier les ranges et la patience : attendre un catalyseur.' },
    'WEAK RISK-OFF':   { lead: 'La prudence s’installe.', detail: 'Refuges discrètement soutenus, volatilité en hausse.', trade: 'Alléger le risque ; surveiller le JPY et l’or.' },
    'RISK-OFF':        { lead: 'Recherche de sécurité.', detail: 'Positionnement défensif net ; préservation du capital prioritaire.', trade: 'Favorable JPY, CHF, or et obligations ; éviter les actifs risqués.' },
    'STRONG RISK-OFF': { lead: 'Aversion au risque marquée.', detail: 'Fuite vers les refuges (obligations, or, JPY, CHF), volatilité qui s’envole.', trade: 'Fortement favorable aux refuges ; couper ou couvrir le risque.' },
  };
  const de = el('rp-desc');
  if (de) {
    de.style.display = '';
    const d2 = POPUP_DESC2[data.label];
    if (d2) {
      de.innerHTML = '<div class="rp-d-lead">' + d2.lead + '</div>'
        + '<div class="rp-d-row"><span class="rp-d-k">Lecture</span><span class="rp-d-v">' + d2.detail + '</span></div>'
        + '<div class="rp-d-row"><span class="rp-d-k">Pour trader</span><span class="rp-d-v">' + d2.trade + '</span></div>';
    } else { de.textContent = data.description || ''; }
  }
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
    const _t = `Mis à jour : ${d.toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}`;
    if (up.textContent && up.textContent !== _t && window._dtpFlash) window._dtpFlash(up);   // flash discret : horodatage rafraîchi pendant que le popup est ouvert
    up.textContent = _t;
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
    if (!data.currencies?.length) { grid.innerHTML = '<div class="inst-empty">Aucune donnée COT disponible</div>'; return; }

    const updatedEl = document.getElementById('inst-updated');
    const rpt = data.currencies[0]?.reportDate;
    if (updatedEl && rpt) updatedEl.textContent = `Rapport COT : ${rpt}`;
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
    grid.innerHTML = '<div class="inst-empty">Données COT indisponibles</div>';
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
    if (!raw?.length) { grid.innerHTML = '<div class="inst-empty">Aucune donnée disponible</div>'; return; }

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
    grid.innerHTML = '<div class="inst-empty">Données de sentiment indisponibles</div>';
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

    if (!cot.length) { grid.innerHTML = '<div class="inst-empty">Données insuffisantes pour l’analyse des flux</div>'; return; }

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
        if (div > 15)   { sig = '▲ HAUSSIER'; sigCls = 'inst-sig-bull'; }
        else if (div < -15) { sig = '▼ BAISSIER'; sigCls = 'inst-sig-bear'; }
        else            { sig = '→ NEUTRE';  sigCls = 'inst-sig-neut'; }
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
    grid.innerHTML = '<div class="inst-empty">Données de flux indisponibles</div>';
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
  _ensureReadLoaded();                 // fusionne d'abord l'état serveur (cross-device) avant tout push
  const sid = String(id);
  if (!sid || _readIds.has(sid)) return;
  _readIds.add(sid);
  try { localStorage.setItem('dtp_read_ids', JSON.stringify([..._readIds].slice(-500))); } catch {}
  _syncReadReports();                  // persiste PAR COMPTE (KV durable) → carte grisée sur TOUS les appareils
}
function isRead(id) {
  if (id == null) return false;
  return _readIds.has(String(id));
}
// ── Persistance PAR COMPTE de l'état « lu » (cartes Analyst grisées) : modèle symrecent (KV durable
//    Supabase, dual-write → survit au blackout egress) : suit la reconnexion / le changement d'appareil.
//    localStorage = cache instantané ; le KV serveur fait foi (fusion à l'ouverture). [[datatradingpro-feed-visibility]]
let _readLoaded = false, _readSyncT = null;
function _ensureReadLoaded() { if (_readLoaded) return; _readLoaded = true; _loadReadReports(); }
async function _loadReadReports() {
  try {
    const d = await (await fetch('/api/read-reports')).json();
    if (!d || !Array.isArray(d.ids) || !d.ids.length) return;
    let added = false;
    d.ids.forEach(x => { const s = String(x); if (s && !_readIds.has(s)) { _readIds.add(s); added = true; } });
    if (added) {
      try { localStorage.setItem('dtp_read_ids', JSON.stringify([..._readIds].slice(-500))); } catch {}
      if (typeof renderArlibList === 'function') renderArlibList();   // re-grise les cartes déjà lues sur un autre appareil
    }
  } catch {}
}
function _syncReadReports() {
  clearTimeout(_readSyncT);
  _readSyncT = setTimeout(() => {
    fetch('/api/read-reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [..._readIds].slice(-500) }) }).catch(() => {});
  }, 1200);
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
  if (item._reportType === 'FX Daily Recap') {   // l'id serveur change à CHAQUE régénération → clé par JOUR couvert (stable)
    const day = (item._fxr && item._fxr.day) ? item._fxr.day : new Date(item.timestamp || Date.now()).toISOString().slice(0, 10);
    return 'fxr:' + day;
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
            <span class="arlib-insights-conf">${data.confidence || '—'}% de confiance</span>
            <span class="arlib-insights-close" id="arlib-insights-close">×</span>
          </div>
          <div class="arlib-insights-summary">${data.summary || ''}</div>
          ${bulletsHtml}
          ${levelsHtml ? `<div class="arlib-rsection">Niveaux clés</div>${levelsHtml}` : ''}
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

// ═══════════════════ ONGLET BIAS : Radar de Biais (matrice) ═══════════════════
let _biasData    = null;
let _biasView    = null;   // snapshot actuellement AFFICHÉ (courant ou semaine archivée)
let _biasViewTs  = null;   // generatedAt de la semaine affichée
let _sbClockTimer = null;
const SB_CLOCKS = [
  { city: 'London',   code: 'LON',  tz: 'Europe/London' },
  { city: 'New York', code: 'NY',   tz: 'America/New_York' },
  { city: 'Tokyo',    code: 'TKYO', tz: 'Asia/Tokyo' },
  { city: 'Dubai',    code: 'DXB',  tz: 'Asia/Dubai' },
  { city: 'Paris',    code: 'PAR',  tz: 'Europe/Paris' },
];

let _biasRetry = 0;
// Skeleton de la matrice Radar de Biais : epouse la grille reelle (en-tetes devises + lignes indicateurs)
// pour zero reflow. Ecrit dans #bias-content, que renderBiasView reecrit ensuite -> auto-efface.
function _biasSkeleton() {
  const COLS = 7, ROWS = 9;
  const th = '<th class="sbm-cur"><span class="sbm-cur-in"><span class="dtp-skel sbm-skel-cur"></span></span></th>';
  const head = '<tr><th class="sbm-ind"><span class="dtp-skel"></span></th>' + th.repeat(COLS) + '</tr>';
  const cell = '<td class="sbm-cell sbm-skel-cell"><span class="dtp-skel"></span></td>';
  const bodyRow = '<tr><td class="sbm-ind"><span class="dtp-skel"></span></td>' + cell.repeat(COLS) + '</tr>';
  const body = Array.from({ length: ROWS }).map(() => bodyRow).join('') +
    '<tr class="sbm-overall"><td class="sbm-ind"><span class="dtp-skel"></span></td>' + cell.repeat(COLS) + '</tr>';
  return '<div class="sbm-matrix-zone" aria-hidden="true">' +
           '<div class="sbm-grid-wrap"><table class="sbm-grid"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
         '</div>';
}
function loadBiasView() {
  const host = document.getElementById('bias-content');
  if (!host) return;
  if (_biasData) { renderBiasView(_biasView || _biasData); return; }
  host.innerHTML = _biasSkeleton();
  // Fetch RÉSILIENT (anticipation) : tolère un hoquet serveur (502/HTML pendant un redéploiement) → réessaie
  // ~80 s au lieu de rester bloqué sur « indisponible ». Jamais d'« Unexpected token '<' ».
  (window._dtpJSON ? window._dtpJSON('/api/smart-bias') : fetch('/api/smart-bias').then(r => r.json()))
    .then(d => { if (!d || !d.currencies) throw new Error('no data'); _biasRetry = 0; _biasData = d; _biasView = d; _biasViewTs = d.generatedAt || 0; renderBiasView(d); })
    .catch(() => {
      if (_biasRetry++ < 20) { host.innerHTML = _biasSkeleton(); setTimeout(loadBiasView, 4000); }
      else host.innerHTML = '<div class="bias-loading">Radar de Biais momentanément indisponible : réessaie dans un instant.</div>';
    });
}
window.loadBiasView = loadBiasView;

// ═══════════════════ SEMAINE À VENIR : aperçu hebdomadaire (timeline + risk amCharts) ═══════════════════
let _waData = null, _waChartRoot = null, _waPollTimer = null, _waPollCount = 0;
async function loadWeekAheadView() {
  const host = document.getElementById('wa-content');
  if (!host) return;
  const isPoll = !!_waPollTimer;                 // continuation d'un poll ?
  if (_waPollTimer) { clearTimeout(_waPollTimer); _waPollTimer = null; }
  if (!isPoll) { _waPollCount = 0; if (window._calResetToLive) _calResetToLive(); _waLoadPanels(true); }   // ouverture fraîche → le miroir calendrier repart en LIVE (jamais une vue historique) puis clone News + Calendar + auto-scroll
  try {
    const d = await fetch('/api/week-ahead').then(r => r.json());
    if (d && Array.isArray(d.days) && d.days.length) { _waData = d; _waPollCount = 0; _renderWeekAhead(d); return; }
    if (_waData) return;                          // on a déjà des données affichées → on n'écrase pas
    // Pas encore de données → la génération tourne en arrière-plan côté serveur.
    _waPollCount++;
    const visible = !document.getElementById('view-weekahead')?.classList.contains('hidden');
    if (_waPollCount <= 6 && visible) {
      host.innerHTML = _waSkel();   // skeleton (epouse .wa-wrap : placeholder graphe + cartes jour) au lieu du loader texte : zero pop-in
      _waPollTimer = setTimeout(loadWeekAheadView, 12000);   // re-poll dans 12s
    } else {
      host.innerHTML = `<div class="wa-empty">L'aperçu de la semaine se génère en arrière-plan : reviens dans quelques minutes, il s'affichera automatiquement.</div>`;
    }
  } catch { if (!_waData) host.innerHTML = '<div class="wa-empty">Semaine à Venir indisponible pour le moment.</div>'; }
}
window.loadWeekAheadView = loadWeekAheadView;

// Skeleton Semaine a Venir : epouse .wa-wrap (placeholder graphe + N cartes jour) ; injecte dans #wa-content
// PENDANT le polling -> auto-efface par _renderWeekAhead() qui reecrit #wa-content (et cree alors #wa-risk-chart).
function _waSkel() {
  let days = '';
  for (let i = 0; i < 4; i++) {
    days += '<div class="wa-day wa-skel-day" aria-hidden="true">'
      + '<div class="wa-node"><span class="dtp-skel wa-skel-dow"></span><span class="dtp-skel wa-skel-date"></span><span class="dtp-skel wa-skel-mon"></span></div>'
      + '<div class="wa-card wa-card--med">'
      + '<div class="wa-card-head"><div class="wa-card-headl"><span class="dtp-skel wa-skel-title"></span></div><span class="dtp-skel wa-skel-imp"></span></div>'
      + '<div class="wa-card-desc"><span class="dtp-skel wa-skel-line"></span><span class="dtp-skel wa-skel-line wa-skel-line--short"></span></div>'
      + '</div></div>';
  }
  return '<div class="wa-wrap wa-skel-wrap" aria-hidden="true">'
    + '<div class="wa-head"><span class="dtp-skel wa-skel-head"></span></div>'
    + '<div class="wa-chartbox"><div class="wa-chart-label">PROFIL DE RISQUE HEBDO</div><div class="wa-chart wa-skel-chart"><span class="dtp-skel"></span></div></div>'
    + '<div class="wa-timeline">' + days + '</div>'
    + '</div>';
}

function _renderWeekAhead(d) {
  const host = document.getElementById('wa-content');
  if (!host) return;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Jours/mois en FRANÇAIS (le serveur envoie l'anglais « Monday » / « JAN » ; traduction à l'affichage).
  const _DOW_FR = { mon: 'LUN', tue: 'MAR', wed: 'MER', thu: 'JEU', fri: 'VEN', sat: 'SAM', sun: 'DIM' };
  const _MON_FR = { jan: 'JANV', feb: 'FÉVR', mar: 'MARS', apr: 'AVR', may: 'MAI', jun: 'JUIN', jul: 'JUIL', aug: 'AOÛT', sep: 'SEPT', oct: 'OCT', nov: 'NOV', dec: 'DÉC' };
  const _dowFr = s => _DOW_FR[String(s || '').slice(0, 3).toLowerCase()] || String(s || '').slice(0, 3).toUpperCase();
  const _monFr = s => _MON_FR[String(s || '').slice(0, 3).toLowerCase()] || String(s || '').slice(0, 3).toUpperCase();
  const todayD = String(new Date().getDate());
  const rows = (d.days || []).map(day => {
    const isToday = String(day.date) === todayD;
    const hi = /high/i.test(day.impact);
    return `<div class="wa-day${isToday ? ' wa-day--today' : ''}">
      <div class="wa-node">
        <span class="wa-dow">${esc(_dowFr(day.dow))}</span>
        <span class="wa-date">${esc(day.date || '')}</span>
        <span class="wa-month">${esc(_monFr(day.month))}</span>
      </div>
      <div class="wa-card ${hi ? 'wa-card--high' : 'wa-card--med'}">
        <div class="wa-card-head">
          <div class="wa-card-headl">
            <span class="wa-card-title">${esc(day.headline || day.title)}</span>
          </div>
          <span class="wa-impact wa-impact--${hi ? 'high' : 'medium'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>${hi ? 'IMPACT ÉLEVÉ' : 'IMPACT MOYEN'}</span>
        </div>
        <div class="wa-card-desc">${esc(day.summary || day.description || '')}</div>
        <button class="wa-more" type="button" onclick="_waToggle(this)">Lire la suite <span class="wa-more-chev">∨</span></button>
      </div>
    </div>`;
  }).join('');
  host.innerHTML = `<div class="wa-wrap">
    <div class="wa-head"><span class="wa-title">Semaine à Venir</span>${d.week ? `<span class="wa-week">${esc(d.week)}</span>` : ''}</div>
    <div class="wa-chartbox"><div class="wa-chart-label">PROFIL DE RISQUE HEBDO</div><div class="wa-chart" id="wa-risk-chart"></div></div>
    <div class="wa-timeline">${rows}</div>
  </div>`;
  requestAnimationFrame(() => {
    host.querySelectorAll('.wa-card').forEach(c => {
      const body = c.querySelector('.wa-events') || c.querySelector('.wa-card-desc');
      const btn = c.querySelector('.wa-more');
      if (body && btn && body.scrollHeight <= body.clientHeight + 4) btn.style.display = 'none';   // pas de débordement → pas de bouton
    });
    _waBuildChart(d.days || []);
  });
}
function _waToggle(btn) {
  const card = btn.closest('.wa-card'); if (!card) return;
  const open = card.classList.toggle('wa-card--open');
  btn.innerHTML = open ? 'Voir moins <span class="wa-more-chev">∧</span>' : 'Lire la suite <span class="wa-more-chev">∨</span>';
}
window._waToggle = _waToggle;

// ── Semaine à Venir (desk) : panneaux droite = VRAIS DOUBLONS (miroir live) des onglets News (#news-list) et Calendar (#cal-table-wrap) ──
// On clone le HTML rendu des onglets réels → look + contenu STRICTEMENT identiques (classes CSS globales).
function _waSyncNews(){ const src=document.getElementById('news-list'), dst=document.getElementById('wa-news-body'); if(!src||!dst) return; const h=src.innerHTML; if(h && h.indexOf('empty-state')<0) dst.innerHTML=h; }
function _waSyncCal(scroll){ const src=document.getElementById('cal-table-wrap'), dst=document.getElementById('wa-cal-body'); if(!src||!dst) return; const h=src.innerHTML; if(h && h.trim()) dst.innerHTML=h; const dr=document.getElementById('cal-daterange'), meta=document.getElementById('wa-cal-range'); if(dr&&meta) meta.textContent=(dr.textContent||'').trim();
  // Auto-scroll sur l'événement EN COURS (.cal-row--next), repli sur le dernier passé. Uniquement à
  // l'ouverture (scroll=true) : PAS au refresh 60s, pour ne pas ramener l'utilisateur de force.
  if(scroll){ var row=dst.querySelector('.cal-row--next'); if(!row){ var p=dst.querySelectorAll('.cal-row--past'); row=p.length?p[p.length-1]:null; } if(row){ var cr=dst.getBoundingClientRect(), rr=row.getBoundingClientRect(); dst.scrollTop += (rr.top-cr.top) - dst.clientHeight/2 + rr.height/2; } }
}
window._waSyncNews=_waSyncNews; window._waSyncCal=_waSyncCal;
function _waLoadPanels(scroll){
  _waSyncNews();   // News : doublon instantané (l'onglet News est déjà tenu à jour en direct par renderNews + WebSocket)
  try { if (typeof buildCalendar === 'function') { const r = buildCalendar(); if (r && typeof r.then === 'function') r.then(()=>_waSyncCal(scroll)).catch(()=>{}); } } catch {}
  setTimeout(()=>_waSyncCal(scroll), 60); setTimeout(()=>_waSyncCal(scroll), 700);   // clone après le rendu de la table calendrier
}
window._waLoadPanels=_waLoadPanels;
// Tant que la vue Semaine à Venir est ouverte : on rafraîchit le doublon calendrier (le ticker News, lui, est déjà live).
setInterval(function(){ const v=document.getElementById('view-weekahead'); if(v && !v.classList.contains('hidden')){ _waLoadPanels(); } }, 60000);

// ── Éjection de session : si le compte est suspendu / déconnecté par l'admin (ou blacklisté), le desk
//    redirige vers /login sous ~20 s (heartbeat léger : /api/auth/me = lecture 1 ligne → egress négligeable). ──
(function _authHeartbeat(){
  if (location.pathname === '/login') return;
  let _dead = false;
  async function _beat(){
    if (_dead) return;
    try {
      const r = await fetch('/api/auth/me', { cache: 'no-store' });
      if (r.status === 401) { _dead = true; return location.replace('/login'); }
      const d = await r.json().catch(function(){ return null; });
      if (d && d.loggedIn === false) { _dead = true; location.replace('/login' + (d.reason === 'elsewhere' ? '?ended=elsewhere' : '')); }
    } catch (e) {}
  }
  setInterval(_beat, 20000);
})();

// ── Semaine à Venir : glisser pour redimensionner : splitter vertical (frise/panneaux) + horizontal (ticker/calendrier). Volatil : reset au reload. ──
(function initWaResize(){
  const wa3 = document.getElementById('wa3');
  const vsplit = document.getElementById('wa3-vsplit');
  const hsplit = document.getElementById('wa3-hsplit');
  if (!wa3) return;
  function drag(handle, axis, target, prop){
    if (!handle || !target) return;
    const down = e => {
      e.preventDefault();
      const rect = target.getBoundingClientRect();
      handle.classList.add('dragging'); wa3.classList.add('wa-dragging');
      document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
      const move = ev => {
        const p = ev.touches ? ev.touches[0] : ev;
        if (axis === 'x') {
          const v = Math.max(rect.width * 0.25, Math.min(rect.width * 0.75, p.clientX - rect.left));
          target.style.setProperty(prop, v + 'px');
        } else {
          const v = Math.max(rect.height * 0.2, Math.min(rect.height * 0.8, p.clientY - rect.top));
          target.style.setProperty(prop, v + 'px');
        }
      };
      const up = () => {
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
        document.removeEventListener('touchmove', move); document.removeEventListener('touchend', up);
        handle.classList.remove('dragging'); wa3.classList.remove('wa-dragging'); document.body.style.cursor = '';
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      document.addEventListener('touchmove', move, { passive:false }); document.addEventListener('touchend', up);
    };
    handle.addEventListener('mousedown', down);
    handle.addEventListener('touchstart', down, { passive:false });
  }
  drag(vsplit, 'x', wa3, '--wa-left');                                  // gauche/droite (sur #wa3)
  drag(hsplit, 'y', hsplit && hsplit.parentNode, '--wa-top');          // ticker/calendrier (sur .wa3-right)
})();
// Sparkline amCharts (Weekly Risk Profile) : orange mat, dégradé vers le noir, sans grille/axe (look cockpit).
function _waBuildChart(days) {
  const el = document.getElementById('wa-risk-chart');
  if (!el || typeof am5 === 'undefined' || typeof am5xy === 'undefined') return;
  try {
    if (_waChartRoot) { try { _waChartRoot.dispose(); } catch {} _waChartRoot = null; }
    const root = am5.Root.new('wa-risk-chart');
    _waChartRoot = root;
    _dtpChartPremium(el, 300);   // chargement premium : overlay shimmer -> reveal en fondu (build-only ; sparkline sans .appear -> reveal court)
    try { root._logo && root._logo.dispose(); } catch {}
    const chart = root.container.children.push(am5xy.XYChart.new(root, {
      panX: false, panY: false, wheelX: 'none', wheelY: 'none',
      paddingLeft: 4, paddingRight: 4, paddingTop: 4, paddingBottom: 0,
    }));
    const xAxis = chart.xAxes.push(am5xy.CategoryAxis.new(root, {
      categoryField: 'day', renderer: am5xy.AxisRendererX.new(root, { minGridDistance: 16 }),
    }));
    xAxis.get('renderer').grid.template.set('forceHidden', true);
    xAxis.get('renderer').labels.template.setAll({ fill: am5.color(0x8a8a90), fontSize: 10 });
    const yAxis = chart.yAxes.push(am5xy.ValueAxis.new(root, {
      min: 0, max: 100, renderer: am5xy.AxisRendererY.new(root, {}),
    }));
    yAxis.get('renderer').grid.template.set('forceHidden', true);
    yAxis.get('renderer').labels.template.set('forceHidden', true);
    const series = chart.series.push(am5xy.SmoothedXLineSeries.new(root, {
      xAxis, yAxis, valueYField: 'risk', categoryXField: 'day', stroke: am5.color(0xe28b41), fill: am5.color(0xe28b41),
    }));
    series.strokes.template.setAll({ strokeWidth: 2 });
    series.fills.template.setAll({
      visible: true,
      fillGradient: am5.LinearGradient.new(root, {
        rotation: 90,
        stops: [{ color: am5.color(0xe28b41), opacity: 0.35 }, { color: am5.color(0x0c0c0e), opacity: 0 }],
      }),
    });
    const data = (days || []).map(d => ({ day: (d.dow || '').slice(0, 3), risk: typeof d.risk === 'number' ? d.risk : 50 }));
    xAxis.data.setAll(data);
    series.data.setAll(data);
  } catch (e) { /* le graphique est un bonus → ne jamais casser la timeline */ }
}

// Devise → code pays ISO (flagcdn) pour les micro-drapeaux ronds.
const SB_FLAG_ISO = { USD: 'us', EUR: 'eu', GBP: 'gb', CAD: 'ca', AUD: 'au', NZD: 'nz', JPY: 'jp', CHF: 'ch' };
function _sbFlag(c) {
  const iso = SB_FLAG_ISO[c];
  return iso ? `<img class="sbm-flag" src="https://flagcdn.com/w20/${iso}.png" srcset="https://flagcdn.com/w40/${iso}.png 2x" alt="" loading="lazy">` : '';
}
// Libellés FR des valeurs de biais : appliqués UNIQUEMENT à l'affichage (badges/cellules du Radar
// de Biais & Bias Summary). La valeur d'origine (v) reste la clé logique : classe (_sbColorCls),
// score, comparaisons. → on n'enveloppe QUE le texte final affiché avec `BIAS_FR[v] || v`.
const BIAS_FR = {
  'Very Bullish': 'Très Haussier', 'Bullish': 'Haussier', 'Weak Bullish': 'Légèrement Haussier',
  'Neutral': 'Neutre', 'Weak Bearish': 'Légèrement Baissier', 'Bearish': 'Baissier',
  'Very Bearish': 'Très Baissier', 'Uptrend': 'Haussier', 'Downtrend': 'Baissier',
  'Range': 'Range', 'N/A': 'N/D',
};
// Libellés FR des badges d'impact (calendrier / Key Risk Events) : affichage UNIQUEMENT.
// La valeur d'origine (HIGH/MED/LOW) reste la clé logique : data-imp, comparaisons, dérivation de classe.
const IMPACT_FR = { HIGH: 'ÉLEVÉ', MED: 'MOYEN', LOW: 'FAIBLE' };
// Valeur de biais → classe couleur sémantique FIXE (5 états, hex exacts DTP : voir CSS .sbm-*).
function _sbColorCls(v) {
  switch (v) {
    case 'Very Bullish': return 'sbm-vbull';
    case 'Bullish':
    case 'Weak Bullish':
    case 'Uptrend':      return 'sbm-bull';
    case 'Bearish':
    case 'Weak Bearish':
    case 'Downtrend':    return 'sbm-bear';
    case 'Very Bearish': return 'sbm-vbear';
    case 'N/A':          return 'sbm-na';      // donnée non chargée
    default:             return 'sbm-neut';   // Neutral, Range
  }
}

function renderBiasView(d) {
  const host = document.getElementById('bias-content');
  if (!host) return;
  const cur  = (d && d.currencies) || [];
  const rows = (d && d.rows) || [];
  const badge = document.getElementById('bias-update-badge');
  if (badge) badge.textContent = '';   // badge « MAJ <date> » retiré (demande utilisateur)

  if (!rows.length) {
    host.innerHTML = '<div class="bias-loading">La matrice Radar de Biais sera générée dimanche (force : /api/smart-bias?force=1).</div>';
    return;
  }

  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // En-têtes : micro-drapeau rond + code devise, cliquable → ouvre le Bias Summary inférieur.
  const head = `<tr><th class="sbm-ind">Indicateurs</th>${cur.map(c =>
    `<th class="sbm-cur" onclick="_sbOpenSummary('${c}')"><span class="sbm-cur-in">${_sbFlag(c)}<span>${esc(c)}</span></span></th>`).join('')}</tr>`;
  // Fundamental Data & Bank Overview = accordéons dans la matrice (clic → sous-indicateurs par devise).
  const _accKeys = { fundamental: 1, bankOverview: 1 };
  // Libelles FR de la matrice : IDENTIQUES a ceux de la synthese (volet gauche) pour que radar et
  // synthese listent exactement les memes indicateurs (demande : coherence logique + charte FR).
  const _sbRowFr = { fundamental: 'Données fondamentales', bankOverview: 'Vue des banques', hedgeFund: 'Positionnement Hedge Funds', retail: 'Positionnement Particuliers', monetary: 'Politique monétaire', trend: 'Tendance', seasonality: 'Seasonality' };
  const body = rows.map(r => {
    const isAcc = _accKeys[r.key];
    const rlabel = _sbRowFr[r.key] || r.label;
    const indCell = isAcc
      ? `<td class="sbm-ind sbm-ind-acc" onclick="_sbMatToggleAcc('${r.key}',event)" title="Déplier les sous-indicateurs"><span class="sbm-acc-arrow">›</span>${esc(rlabel)}</td>`
      : `<td class="sbm-ind">${esc(rlabel)}</td>`;
    return `<tr data-mrow="${esc(r.key || '')}">${indCell}${
      cur.map(c => { const v = r.values[c] || 'N/A'; return `<td class="sbm-cell ${_sbColorCls(v)}" onclick="_sbOpenSummary('${c}')" title="${esc(c)} · ${esc(rlabel)} : ${esc(BIAS_FR[v] || v)}">${esc(BIAS_FR[v] || v)}</td>`; }).join('')
    }</tr>`;
  }).join('');
  const arrow = v => /bull|uptrend/i.test(v) ? '<span class="sbm-arr">↗</span>' : /bear|downtrend/i.test(v) ? '<span class="sbm-arr">↘</span>' : '';
  const concl = `<tr class="sbm-overall"><td class="sbm-ind">Conclusion globale</td>${
    cur.map(c => { const v = (d.conclusion || {})[c] || 'N/A'; return `<td class="sbm-cell sbm-concl ${_sbColorCls(v)}" onclick="_sbOpenSummary('${c}')">${arrow(v)}${esc(BIAS_FR[v] || v)}</td>`; }).join('')
  }</tr>`;

  host.innerHTML = `
    <div class="sbm-matrix-zone" id="sbm-matrix-zone"${_sbMatrixH ? ` style="height:${_sbMatrixH}px"` : ''}>
      <div class="sbm-grid-wrap">
        <table class="sbm-grid"><thead>${head}</thead><tbody>${body}${concl}</tbody></table>
      </div>
    </div>
    <div class="sbm-vsplit" id="sbm-vsplit" onmousedown="_sbVSplitStart(event)" title="Glisser pour redimensionner"></div>
    <div id="sbm-summary" class="sbm-summary-host"></div>`;
  if (window._dtpDataIn) window._dtpDataIn(host, 'bias');   // fondu d'arrivee (1re fois : skeleton -> matrice)
  // Dropdowns "Scanner" + historique de semaines dans l'en-tête du haut.
  _sbRenderHeadDd(cur.includes(_sbActiveCur) ? _sbActiveCur : cur[0]);
  // Bias Summary affiché DIRECTEMENT (plus de clic requis) : on garde la devise active, sinon la 1ère.
  if (cur.length) _sbOpenSummary(cur.includes(_sbActiveCur) ? _sbActiveCur : cur[0]);
}
// Libellé de semaine façon DTP : "1-7/06/2026" (lundi→dimanche).
function _sbWeekLabel(ts) {
  // LOGIQUE : généré le samedi (Paris, après clôture vendredi) à partir de la semaine ÉCOULÉE (N-1),
  // le bias SERT à trader la semaine À VENIR (N) → on LIBELLE la semaine N (à trader). Ex. généré le
  // 13/06 (analyse 8-14) → libellé 15-21. Donc week-end (sam/dim) → décalage au lundi suivant.
  const d = new Date(ts ? new Date(ts).toLocaleString('en-US', { timeZone: 'Europe/Paris' }) : Date.now());
  const dow = d.getDay() || 7;   // 1=lun … 7=dim (Paris)
  const mon = new Date(d); mon.setDate(d.getDate() - dow + 1);
  if (dow >= 6) mon.setDate(mon.getDate() + 7);   // généré le week-end → semaine À TRADER = la suivante
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const _MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const _m1 = mon.getMonth(), _m2 = sun.getMonth();
  return _m1 === _m2
    ? `${mon.getDate()}–${sun.getDate()} ${_MOIS[_m2]} ${sun.getFullYear()}`
    : `${mon.getDate()} ${_MOIS[_m1]} – ${sun.getDate()} ${_MOIS[_m2]} ${sun.getFullYear()}`;
}

// ── Panneau inférieur Bias Summary (clic sur une devise) : volet gauche (badges) + droite (narratif + risques) ──
let _sbActiveCur = null, _sbSplitFrac = 0.30, _sbMatrixH = null;   // 30% gauche / 70% droite (façon DTP) · _sbMatrixH = hauteur matrice (null = auto)
// Splitter orange HORIZONTAL : glisser pour redimensionner la matrice ↔ le panneau détail.
function _sbVSplitStart(e) {
  e.preventDefault();
  const zone = document.getElementById('sbm-matrix-zone'); if (!zone) return;
  const startY = e.clientY, startH = zone.offsetHeight;
  document.body.style.cursor = 'row-resize'; document.body.style.userSelect = 'none';
  const onMove = ev => { let h = startH + (ev.clientY - startY); h = Math.max(120, Math.min(760, h)); _sbMatrixH = h; zone.style.height = h + 'px'; };
  const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); document.body.style.cursor = ''; document.body.style.userSelect = ''; };
  window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
}
window._sbVSplitStart = _sbVSplitStart;
// Dropdown devise CUSTOM (drapeau rond + code + caret ; popover "Scanner" ; actif = orange, hover = clair).
function _sbCurDropdown(curr, currencies) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const items = (currencies || []).map(c =>
    `<div class="sbs-cdd-item${c === curr ? ' active' : ''}" onclick="event.stopPropagation();_sbPickCur('${c}')">${_sbFlag(c)}<span>${esc(c)}</span></div>`).join('');
  return `<div class="sbs-cdd" onclick="_sbToggleCurDd(event)">
    <span class="sbs-cdd-cur">${_sbFlag(curr)}<span>${esc(curr)}</span></span><span class="sbs-cdd-caret">⌄</span>
    <div class="sbs-cdd-menu" hidden><div class="sbs-cdd-title">Scanner</div>${items}</div></div>`;
}
function _sbToggleCurDd(e) { e.stopPropagation(); const m = e.currentTarget.querySelector('.sbs-cdd-menu'); if (!m) return; const wasOpen = !m.hasAttribute('hidden'); document.querySelectorAll('.sbs-cdd-menu').forEach(x => x.setAttribute('hidden', '')); if (!wasOpen) m.removeAttribute('hidden'); }
function _sbPickCur(c) { document.querySelectorAll('.sbs-cdd-menu').forEach(x => x.setAttribute('hidden', '')); _sbOpenSummary(c); }
window._sbToggleCurDd = _sbToggleCurDd; window._sbPickCur = _sbPickCur;
if (!window._sbCddCloser) { window._sbCddCloser = true; document.addEventListener('click', () => document.querySelectorAll('.sbs-cdd-menu').forEach(x => x.setAttribute('hidden', ''))); }
// Remonte les 2 dropdowns (Scanner devise + historique de semaines) dans l'EN-TÊTE du haut (haut-droite, façon capture).
function _sbRenderHeadDd(active) {
  const el = document.getElementById('bias-head-dd'); if (!el) return;
  const d = _biasView || _biasData;
  if (!d || !Array.isArray(d.currencies) || !d.currencies.length) { el.innerHTML = ''; return; }
  const cur = d.currencies;
  const a = (active && cur.includes(active)) ? active : (cur.includes(_sbActiveCur) ? _sbActiveCur : cur[0]);
  el.innerHTML = _sbCurDropdown(a, cur) + _sbDateDropdown(_biasViewTs != null ? _biasViewTs : (d.generatedAt || 0));
}
window._sbRenderHeadDd = _sbRenderHeadDd;
// Dropdown HISTORIQUE de dates (versioning Radar de Biais, 5 semaines max) : format DTP "1-7/06/2026".
function _sbDateDropdown(activeTs) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hist = (_biasData && Array.isArray(_biasData.history) ? _biasData.history : []).slice(0, 5);
  const label = esc(_sbWeekLabel(activeTs));
  if (hist.length <= 1) {
    return `<span class="sbs-cdd sbs-cdd--date" title="Semaine couverte"><span class="sbs-cdd-cur">${label}</span></span>`;
  }
  const items = hist.map(h => {
    const ts = Number(h.generatedAt);
    return `<div class="sbs-cdd-item${ts === Number(activeTs) ? ' active' : ''}" onclick="event.stopPropagation();_sbPickWeek(${ts})">${esc(_sbWeekLabel(ts))}</div>`;
  }).join('');
  return `<div class="sbs-cdd sbs-cdd--date" onclick="_sbToggleCurDd(event)" title="Historique (5 semaines max)">
    <span class="sbs-cdd-cur">${label}</span><span class="sbs-cdd-caret">⌄</span>
    <div class="sbs-cdd-menu" hidden><div class="sbs-cdd-title">Historique</div>${items}</div></div>`;
}
function _sbPickWeek(ts) { document.querySelectorAll('.sbs-cdd-menu').forEach(x => x.setAttribute('hidden', '')); _sbSwitchWeek(ts); }
async function _sbSwitchWeek(ts) {
  ts = Number(ts);
  if (ts === Number(_biasViewTs)) return;
  if (_biasData && Number(_biasData.generatedAt) === ts) { _biasView = _biasData; _biasViewTs = ts; renderBiasView(_biasView); return; }
  try {
    const snap = await fetch('/api/smart-bias?at=' + ts).then(r => r.json());
    if (snap && Array.isArray(snap.rows) && snap.rows.length) { _biasView = snap; _biasViewTs = ts; renderBiasView(_biasView); }
  } catch {}
}
window._sbDateDropdown = _sbDateDropdown; window._sbPickWeek = _sbPickWeek; window._sbSwitchWeek = _sbSwitchWeek;
// Qualificatifs FR par niveau de biais (formulation neutre en genre → s'insere apres "est ...").
const _SB_QUAL = {
  'Very Bullish': 'nettement favorable', 'Bullish': 'favorable', 'Weak Bullish': 'légèrement favorable',
  'Neutral': 'neutre', 'Range': 'neutre', 'N/A': 'neutre',
  'Weak Bearish': 'légèrement défavorable', 'Bearish': 'défavorable', 'Very Bearish': 'nettement défavorable',
  'Uptrend': 'favorable', 'Downtrend': 'défavorable',
};
const _SB_TREND_Q = { 'Uptrend': 'haussière', 'Downtrend': 'baissière', 'Range': 'sans direction nette', 'Neutral': 'sans direction nette', 'N/A': 'sans direction nette' };

// Narratif data-driven (0 token, sans IA) : vraie synthese institutionnelle multi-phrases batie
// sur les indicateurs reels de la matrice. Sert de repli quand le narratif IA est absent (quota/seed).
function _sbFallbackNarrative(curr, val, overall, bulls, bears, esc) {
  const q  = v => _SB_QUAL[v] || 'neutre';
  const qt = v => _SB_TREND_Q[v] || 'sans direction nette';
  const has = v => v && v !== 'N/A';
  const fund = val('fundamental'), mon = val('monetary'), hf = val('hedgeFund'),
        ret = val('retail'), bank = val('bankOverview'), tr = val('trend'), seas = val('seasonality');
  const P = [];
  P.push(`Le biais hebdomadaire global ressort <b>${esc(BIAS_FR[overall] || overall)}</b> sur ${esc(curr)}.`);
  const macro = [];
  if (has(fund)) macro.push(`le contexte fondamental est ${q(fund)}`);
  if (has(mon))  macro.push(`la politique monétaire est ${q(mon)}`);
  if (macro.length) P.push(`Sur le plan macro, ${macro.join(' et ')}.`);
  const pos = [];
  if (has(hf))   pos.push(`celui des fonds (COT) est ${q(hf)}`);
  if (has(ret))  pos.push(`le sentiment retail est ${q(ret)}`);
  if (has(bank)) pos.push(`le consensus bancaire est ${q(bank)}`);
  if (pos.length) P.push(`Côté positionnement, ${pos.join(', ')}.`);
  const tech = [];
  if (has(tr))   tech.push(`la tendance est ${qt(tr)}`);
  if (has(seas)) tech.push(`la saisonnalité est ${q(seas)}`);
  if (tech.length) P.push(`Techniquement, ${tech.join(' et ')}.`);
  if (bulls.length || bears.length) {
    let s = '';
    if (bulls.length) s += `Soutiens haussiers : ${esc(bulls.join(', '))}. `;
    if (bears.length) s += `Pressions baissières : ${esc(bears.join(', '))}.`;
    P.push(s.trim());
  } else {
    P.push('Signaux globalement neutres, sans direction marquée.');
  }
  return P.join(' ');
}

function _sbOpenSummary(curr) {
  _sbActiveCur = curr;
  const wrap = document.getElementById('sbm-summary');
  const d = _biasView || _biasData;
  if (!wrap || !d) return;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = d.rows || [];
  const val = key => { const r = rows.find(x => x.key === key || x.label === key); return r ? (r.values[curr] || 'N/A') : null; };
  // Technical + Sentiment : hors matrice (façon pro) mais AFFICHÉS dans le panneau (champs serveur séparés).
  const tval = key => { const o = d[key]; return (o && o[curr]) ? o[curr] : null; };
  const overall = (d.conclusion || {})[curr] || 'N/A';

  // Lignes d'indicateurs (volet gauche) : chaque ligne = libellé + badge 64px coloré.
  const line = (label, v, opts) => {
    if (v == null) return '';
    const o = opts || {};
    return `<div class="sbs-row${o.child ? ' sbs-row--child' : ''}${o.acc ? ' sbs-acc' : ''}"${o.acc ? ` data-acc="${o.acc}" onclick="_sbToggleAcc('${o.acc}')"` : ''}>
      <span class="sbs-row-lbl">${o.acc ? '<span class="sbs-acc-arrow">›</span> ' : ''}${esc(label)}</span>
      <span class="sbs-badge ${_sbColorCls(v)}">${esc(BIAS_FR[v] || v)}</span></div>`;
  };

  const leftRows = [
    line('Données fondamentales', val('fundamental'), { acc: 'fundamental' }),
    `<div class="sbs-children" id="sbs-acc-fundamental" hidden></div>`,
    line('Vue des banques', val('bankOverview'), { acc: 'bankOverview' }),
    `<div class="sbs-children" id="sbs-acc-bankOverview" hidden></div>`,
    line('Positionnement Hedge Funds', val('hedgeFund')),
    line('Positionnement Particuliers', val('retail')),
    line('Politique monétaire', val('monetary')),
    line('Tendance', val('trend')),
    line('Seasonality', val('seasonality')),
    // Ligne Overall (conclusion) : encadrée orange façon DTP, en bas de la liste.
    `<div class="sbs-row sbs-row--overall"><span class="sbs-row-lbl">Overall</span><span class="sbs-badge ${_sbColorCls(overall)}">${/bull|uptrend/i.test(overall) ? '↗ ' : /bear|downtrend/i.test(overall) ? '↘ ' : ''}${esc(BIAS_FR[overall] || overall)}</span></div>`,
  ].filter(Boolean).join('');

  // Narratif data-driven (sans IA) : synthèse à partir des indicateurs de la devise.
  const score = { 'Very Bullish': 2, 'Bullish': 1, 'Weak Bullish': 1, 'Uptrend': 1, 'Neutral': 0, 'Range': 0, 'Weak Bearish': -1, 'Bearish': -1, 'Downtrend': -1, 'Very Bearish': -2 };
  const _rowFr = { fundamental: 'Données fondamentales', bankOverview: 'Vue des banques', hedgeFund: 'Positionnement Hedge Funds', retail: 'Positionnement Particuliers', monetary: 'Politique monétaire', trend: 'Tendance', seasonality: 'Saisonnalité' };
  const bulls = rows.filter(r => (score[r.values[curr]] || 0) > 0).map(r => _rowFr[r.key] || r.label);
  const bears = rows.filter(r => (score[r.values[curr]] || 0) < 0).map(r => _rowFr[r.key] || r.label);
  // Narratif IA hebdo si dispo (généré côté serveur), sinon synthèse data-driven (0 token).
  const aiNarr = (d.narrative && typeof d.narrative[curr] === 'string' && d.narrative[curr].trim()) ? d.narrative[curr].trim() : null;
  const narrative = aiNarr ? esc(aiNarr) : _sbFallbackNarrative(curr, val, overall, bulls, bears, esc);

  wrap.innerHTML = `
    <div class="sbs-panel">
      <div class="sbs-body" id="sbs-body">
        <div class="sbs-left" id="sbs-left" style="flex-basis:${(_sbSplitFrac * 100).toFixed(1)}%"><div class="sbs-left-title">Synthèse de Biais</div>${leftRows}</div>
        <div class="sbs-split" id="sbs-split" title="Glisser pour redimensionner"></div>
        <div class="sbs-right" id="sbs-right">
          <div class="sbs-narr-title">${esc(curr)} : Performance de la semaine dernière :</div>
          <div class="sbs-narr">${narrative}</div>
          <div class="sbs-risk" id="sbs-riskevents"></div>
        </div>
      </div>
    </div>`;
  _sbInitSplitter();
  _sbLoadBankPos();   // précharge les positions de banques → accordéon Bank Overview instantané
  _sbLoadCal();       // précharge le calendrier → accordéon Fundamental instantané
  _sbRenderRiskEvents(curr);   // « Risques clés de la semaine » (calendrier high/med à venir, façon pro)
  _sbRenderHeadDd(curr);   // synchronise le dropdown "Scanner" de l'en-tête sur la devise active
  requestAnimationFrame(() => wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
}
window._sbOpenSummary = _sbOpenSummary;
function _sbCloseSummary() { const w = document.getElementById('sbm-summary'); if (w) w.innerHTML = ''; _sbActiveCur = null; }
window._sbCloseSummary = _sbCloseSummary;

// « Risques clés de la semaine » (façon pro) : événements calendrier HIGH/MEDIUM À VENIR pour la
// devise, groupés par jour. Source = /api/calendar-events (déjà chargé par _sbLoadCal). 0 IA, 0 invention.
function _sbRenderRiskEvents(curr) {
  const host = document.getElementById('sbs-riskevents');
  if (!host) return;
  const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  _sbLoadCal().then(() => {
    if (_sbActiveCur !== curr) return;   // l'utilisateur a changé de devise entre-temps
    const now = Date.now();
    const evs = (_sbCalEv || [])
      .filter(e => e && e.currency === curr && (e.impact === 'High' || e.impact === 'Medium')
        && e.timestamp >= now - 12 * 3600000 && e.timestamp <= now + 8 * 86400000
        && ![0, 6].includes(new Date(e.timestamp).getDay())   // SEMAINE uniquement : pas de samedi/dimanche (marché fermé)
        && !/holiday|bank holiday/i.test(e.title || ''))
      .sort((a, b) => a.timestamp - b.timestamp);
    if (!evs.length) { host.innerHTML = ''; return; }
    const byDay = new Map();
    evs.forEach(e => {
      const dt = new Date(e.timestamp), k = dt.toISOString().slice(0, 10);
      if (!byDay.has(k)) byDay.set(k, { day: DAYS[dt.getDay()], titles: [] });
      const g = byDay.get(k), t = String(e.title || '').replace(/\s+/g, ' ').trim();
      if (t && g.titles.length < 4 && !g.titles.includes(t)) g.titles.push(t);
    });
    const rows = [...byDay.values()].slice(0, 7).map(g =>
      `<div class="sbs-risk-row"><span class="sbs-risk-day">${esc(g.day)}</span><span class="sbs-risk-ev">${esc(g.titles.join(', '))}</span></div>`).join('');
    host.innerHTML = `<div class="sbs-risk-title">Risques clés de la semaine</div><div class="sbs-risk-list">${rows}</div>`;
  }).catch(() => { host.innerHTML = ''; });
}
window._sbRenderRiskEvents = _sbRenderRiskEvents;

// ── Accordéons : Bank Overview branché sur les VRAIES positions de banques (terminal Institution) ──
// Le biais de chaque banque sur la devise est DÉRIVÉ de sa position réelle (0 invention, 0 IA) :
//   long GBP/USD → haussier GBP ; long EUR/GBP → baissier GBP ; etc.
let _sbBankPos = null;
function _sbLoadBankPos() {
  if (_sbBankPos) return Promise.resolve(_sbBankPos);
  return fetch('/api/bank-positions').then(r => r.json())
    .then(d => { _sbBankPos = (d && d.positions) || []; return _sbBankPos; })
    .catch(() => { _sbBankPos = []; return _sbBankPos; });
}
function _sbBankStance(pos, cur) {
  const parts = String(pos.pair || '').toUpperCase().split('/');
  if (parts.length !== 2) return null;
  const [base, quote] = parts;
  const isBuy = pos.dir ? pos.dir === 'buy' : (/buy/i.test(pos.orderType || '') || (Number(pos.tp) > Number(pos.entry)));
  if (base === cur)  return isBuy ? 'Bullish' : 'Bearish';
  if (quote === cur) return isBuy ? 'Bearish' : 'Bullish';
  return null;   // devise absente de cette paire
}
function _sbRenderBankChildren(box, cur) {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // ── Source PRIORITAIRE : biais IA par banque (toutes les banques d'Institution, dynamique) ──
  const bs = _biasData && _biasData.bankStances;
  if (bs && Object.keys(bs).length) {
    const banks = Object.keys(bs).sort();
    box.innerHTML = banks.map(name => {
      const stance = (bs[name] || {})[cur] || 'Neutral';
      return `<div class="sbs-row sbs-row--child"><span class="sbs-row-lbl">${esc(name)}</span><span class="sbs-badge ${_sbColorCls(stance)}">${esc(BIAS_FR[stance] || stance)}</span></div>`;
    }).join('');
    return;
  }
  // ── Repli : positions de trade extraites (ancien mécanisme) ──
  const byBank = new Map();   // agrège par banque : net haussier/baissier sur la devise
  (_sbBankPos || []).forEach(p => {
    const st = _sbBankStance(p, cur); if (!st) return;
    const name = (p.bank || '').replace(/\s+Research$/i, '').trim(); if (!name) return;
    const e = byBank.get(name) || { name, score: 0 };
    e.score += st === 'Bullish' ? 1 : -1;
    byBank.set(name, e);
  });
  const banks = [...byBank.values()];
  if (!banks.length) { box.innerHTML = `<div class="sbs-child-note">Aucune position de banque sur ${esc(cur)} dans le terminal actuellement.</div>`; return; }
  box.innerHTML = banks.map(b => {
    const stance = b.score > 0 ? 'Bullish' : b.score < 0 ? 'Bearish' : 'Neutral';
    return `<div class="sbs-row sbs-row--child"><span class="sbs-row-lbl">${esc(b.name)}</span><span class="sbs-badge ${_sbColorCls(stance)}">${esc(BIAS_FR[stance] || stance)}</span></div>`;
  }).join('');
}
// ── Accordéon Fundamental : sous-indicateurs dérivés du CALENDRIER réel (actual vs forecast), 0 IA, 0 invention ──
let _sbCalEv = null;
function _sbLoadCal() {
  if (_sbCalEv) return Promise.resolve(_sbCalEv);
  return fetch('/api/calendar-events').then(r => r.json())
    .then(d => { _sbCalEv = (d && d.items) || []; return _sbCalEv; })
    .catch(() => { _sbCalEv = []; return _sbCalEv; });
}
// Regex ÉLARGIES par pays (Tankan JP, Ivey CA, GfK UK/DE, Westpac AU, ANZ NZ, approvals/consents…)
// → chaque devise matche sa propre publication nationale, plus de cases vides évitables.
const SB_FUND_SUBS = [
  { label: 'Croissance économique',     re: /\bGDP\b|gross domestic|economic growth/i },
  { label: 'Hausse des prix',       re: /\bCPI\b|inflation|consumer price|\bPPI\b|producer price|pce price|core pce/i },
  { label: 'Confiance des consommateurs', re: /consumer confidence|consumer sentiment|michigan|gfk|westpac consumer|anz.*confidence/i },
  { label: 'Activité manufacturière',    re: /manufacturing pmi|\bfactory\b|industrial production|ism manufactur|tankan|ivey|manufacturing production/i },
  { label: 'Activité des services',    re: /services? pmi|ism (services|non-manufactur)|tertiary industry/i },
  { label: 'Mises en chantier',   re: /housing starts|new home/i },
  { label: 'Permis de construire',    re: /building permits|building approvals|building consents/i },
  { label: 'Ventes au détail',        re: /retail sales|retail trade/i },
];
function _sbNum(v) { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; }
function _sbFundStance(actual, forecast) {
  const a = _sbNum(actual), f = _sbNum(forecast);
  if (a == null || f == null) return null;
  const thr = Math.abs(f) * 0.001 + 0.0001;
  return a > f + thr ? 'Bullish' : a < f - thr ? 'Bearish' : 'Neutral';   // beat = haussier (surprise de donnée)
}
function _sbRenderFundChildren(box, cur) {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Source PRIORITAIRE : les 8 sous-indicateurs calculés par le SERVEUR (parent = enfants garanti, même
  // méthodo pro). Repli sur le calcul local depuis le calendrier si le serveur ne les fournit pas.
  const _fr = ((_biasView || _biasData) && (((_biasView || _biasData).rows) || []).find(r => r.key === 'fundamental'));
  if (_fr && Array.isArray(_fr.subs) && _fr.subs.length) {
    box.innerHTML = _fr.subs.map(sub => {
      const st = (sub.values && sub.values[cur]) || 'Neutral';
      return `<div class="sbs-row sbs-row--child" title="${esc(sub.label)} (${esc(cur)})"><span class="sbs-row-lbl">${esc(sub.label)}</span><span class="sbs-badge ${_sbColorCls(st)}">${esc(BIAS_FR[st] || st)}</span></div>`;
    }).join('');
    return;
  }
  const evs = (_sbCalEv || []).filter(e => e && e.currency === cur && e.actual != null && e.actual !== '');
  box.innerHTML = SB_FUND_SUBS.map(sub => {
    const ev = evs.filter(e => sub.re.test(e.title || '')).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];
    const stance = ev ? _sbFundStance(ev.actual, ev.forecast) : null;
    // Pas de publication récente → Neutral par défaut (convention du terminal : pas de donnée = Neutral, jamais de case vide)
    if (!stance) return `<div class="sbs-row sbs-row--child" title="Pas de publication récente : Neutre par défaut"><span class="sbs-row-lbl">${esc(sub.label)}</span><span class="sbs-badge ${_sbColorCls('Neutral')}">${BIAS_FR['Neutral']}</span></div>`;
    return `<div class="sbs-row sbs-row--child" title="${esc(ev.title)} : ${esc(ev.actual)} vs ${esc(ev.forecast)}"><span class="sbs-row-lbl">${esc(sub.label)}</span><span class="sbs-badge ${_sbColorCls(stance)}">${esc(BIAS_FR[stance] || stance)}</span></div>`;
  }).join('');
}
function _sbToggleAcc(key) {
  const box = document.getElementById('sbs-acc-' + key);
  const row = document.querySelector(`.sbs-acc[data-acc="${key}"]`);
  if (!box) return;
  if (!box.hasAttribute('hidden')) { box.setAttribute('hidden', ''); row && row.classList.remove('sbs-acc--open'); return; }
  box.removeAttribute('hidden'); row && row.classList.add('sbs-acc--open');
  if (box.dataset.loaded) return;
  box.dataset.loaded = '1';
  if (key === 'bankOverview') {
    box.innerHTML = `<div class="sbs-child-note">Chargement des banques…</div>`;
    _sbLoadBankPos().then(() => _sbRenderBankChildren(box, _sbActiveCur));
  } else {
    box.innerHTML = `<div class="sbs-child-note">Chargement du calendrier…</div>`;
    _sbLoadCal().then(() => _sbRenderFundChildren(box, _sbActiveCur));
  }
}
window._sbToggleAcc = _sbToggleAcc;

// ── Accordéon de la MATRICE supérieure : Fundamental Data / Bank Overview se déplient en
// sous-indicateurs avec une valeur PAR DEVISE (mêmes sources réelles que le volet : calendrier
// pour Fundamental, positions de banques pour Bank Overview). 0 invention, 0 IA. ──
function _sbMatEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function _sbFundMatrixRows(cur) {
  // Source PRIORITAIRE : sous-indicateurs du SERVEUR (parent = enfants garanti) ; repli = calcul local calendrier.
  const _fr = ((_biasView || _biasData) && (((_biasView || _biasData).rows) || []).find(r => r.key === 'fundamental'));
  if (_fr && Array.isArray(_fr.subs) && _fr.subs.length) return _fr.subs;
  return SB_FUND_SUBS.map(sub => {
    const values = {};
    cur.forEach(c => {
      const ev = (_sbCalEv || []).filter(e => e && e.currency === c && e.actual != null && e.actual !== '' && sub.re.test(e.title || ''))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];
      values[c] = ev ? (_sbFundStance(ev.actual, ev.forecast) || 'Neutral') : 'Neutral';   // pas de donnée → Neutral (plus de case vide)
    });
    return { label: sub.label, values };
  });
}
function _sbBankMatrixRows(cur) {
  // Source PRIORITAIRE : biais IA par banque (toutes les banques d'Institution, valeur par devise).
  const bs = _biasData && _biasData.bankStances;
  if (bs && Object.keys(bs).length) {
    return Object.keys(bs).sort().map(name => {
      const values = {};
      cur.forEach(c => { values[c] = (bs[name] || {})[c] || '—'; });
      return { label: name, values };
    });
  }
  // Repli : positions de trade extraites.
  const byBank = new Map();
  (_sbBankPos || []).forEach(p => {
    const name = (p.bank || '').replace(/\s+Research$/i, '').trim(); if (!name) return;
    let e = byBank.get(name); if (!e) { e = { name, scores: {} }; byBank.set(name, e); }
    cur.forEach(c => { const st = _sbBankStance(p, c); if (st) e.scores[c] = (e.scores[c] || 0) + (st === 'Bullish' ? 1 : -1); });
  });
  return [...byBank.values()].map(b => {
    const values = {};
    cur.forEach(c => { const s = b.scores[c] || 0; values[c] = s > 0 ? 'Bullish' : s < 0 ? 'Bearish' : '—'; });
    return { label: b.name, values };
  });
}
function _sbMatToggleAcc(key, e) {
  if (e) e.stopPropagation();
  const table = document.querySelector('.sbm-grid'); if (!table) return;
  const headRow = table.querySelector(`tr[data-mrow="${key}"]`); if (!headRow) return;
  const arrow = headRow.querySelector('.sbm-acc-arrow');
  const existing = table.querySelectorAll(`tr.sbm-sub-row[data-parent="${key}"]`);
  if (existing.length) { existing.forEach(n => n.remove()); arrow && arrow.classList.remove('open'); return; }   // toggle off
  arrow && arrow.classList.add('open');
  const cur = (_biasData && _biasData.currencies) || [];
  const loading = document.createElement('tr');
  loading.className = 'sbm-sub-row'; loading.dataset.parent = key;
  loading.innerHTML = `<td class="sbm-ind sbm-sub">…</td><td class="sbm-cell sbm-na" colspan="${cur.length}">Chargement…</td>`;
  headRow.after(loading);
  const render = subRows => {
    loading.remove();
    let anchor = headRow;
    if (!subRows.length) {
      const tr = document.createElement('tr'); tr.className = 'sbm-sub-row'; tr.dataset.parent = key;
      tr.innerHTML = `<td class="sbm-ind sbm-sub">—</td><td class="sbm-cell sbm-na" colspan="${cur.length}">Aucune donnée récente.</td>`;
      anchor.after(tr); return;
    }
    subRows.forEach(sr => {
      const tr = document.createElement('tr'); tr.className = 'sbm-sub-row'; tr.dataset.parent = key;
      tr.innerHTML = `<td class="sbm-ind sbm-sub">${_sbMatEsc(sr.label)}</td>` + cur.map(c => {
        const v = sr.values[c] || '—';
        return v === '—'
          ? `<td class="sbm-cell sbm-na">—</td>`
          : `<td class="sbm-cell ${_sbColorCls(v)}" title="${_sbMatEsc(c)} · ${_sbMatEsc(sr.label)} : ${_sbMatEsc(BIAS_FR[v] || v)}">${_sbMatEsc(BIAS_FR[v] || v)}</td>`;
      }).join('');
      anchor.after(tr); anchor = tr;
    });
  };
  if (key === 'fundamental') _sbLoadCal().then(() => render(_sbFundMatrixRows(cur)));
  else _sbLoadBankPos().then(() => render(_sbBankMatrixRows(cur)));
}
window._sbMatToggleAcc = _sbMatToggleAcc;

// Splitter redimensionnable (1px) entre volets gauche/droite.
function _sbInitSplitter() {
  const split = document.getElementById('sbs-split'), body = document.getElementById('sbs-body'), left = document.getElementById('sbs-left');
  if (!split || !body || !left) return;
  let dragging = false;
  const onMove = e => {
    if (!dragging) return;
    const rect = body.getBoundingClientRect();
    let frac = (e.clientX - rect.left) / rect.width;
    frac = Math.max(0.2, Math.min(0.8, frac));
    _sbSplitFrac = frac;
    left.style.flexBasis = (frac * 100).toFixed(1) + '%';
  };
  split.addEventListener('mousedown', e => { dragging = true; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; e.preventDefault(); });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', () => { if (dragging) { dragging = false; document.body.style.cursor = ''; document.body.style.userSelect = ''; } });
}

// Key Risk Events : réutilise le Semaine à Venir (calendrier) → jours + impact.
function _sbLoadRiskEvents() {
  const box = document.getElementById('sbs-risk');
  if (!box) return;
  const render = d => {
    const days = (d && d.days) || [];
    if (!days.length) { box.innerHTML = '<div class="sbs-risk-load">Aucun événement majeur cette semaine.</div>'; return; }
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    box.innerHTML = days.map(day => {
      const hi = /high/i.test(day.impact || ''); const imp = hi ? 'HIGH' : (/(medium|med)/i.test(day.impact || '') ? 'MED' : 'LOW');
      return `<div class="sbs-risk-row"><span class="sbs-risk-day">${esc((day.dow || '').slice(0, 3))} : ${esc(day.title || '')}</span><span class="sbs-risk-imp sbs-imp--${imp.toLowerCase()}">${IMPACT_FR[imp] || imp}</span></div>`;
    }).join('');
  };
  if (_waData) { render(_waData); return; }
  fetch('/api/week-ahead').then(r => r.json()).then(d => { if (d && d.days) _waData = d; render(d); }).catch(() => { box.innerHTML = '<div class="sbs-risk-load">Risques indisponibles.</div>'; });
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

// ═══════════════════ ONGLET BANK : transactions bancaires ═══════════════════
let _bankPositions = [];
let _bankActiveId  = null;
let _bankChartRoot = null;
let _bankLiveGuide = null;   // ligne de prix LIVE du chart (déplacée à chaque refresh, sans rebuild)
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

const _BANK_SKEL_ROW = '<tr class="bank-row bank-skel-row" aria-hidden="true">' +
  '<td class="bank-exp"><span class="dtp-skel"></span></td>' +
  '<td class="bank-name"><span class="dtp-skel"></span></td>' +
  '<td><span class="dtp-skel"></span></td>' +
  '<td><span class="dtp-skel"></span></td>' +
  '<td class="bank-date"><span class="dtp-skel"></span></td>' +
  '<td class="bank-num"><span class="dtp-skel"></span></td>' +
  '<td class="bank-num"><span class="dtp-skel"></span></td>' +
  '<td class="bank-num"><span class="dtp-skel"></span></td>' +
  '<td><span class="dtp-skel"></span></td>' +
  '<td class="bank-chart-cell"><span class="dtp-skel"></span></td></tr>';
function _fetchBankPositions(silent) {
  if (!silent && !_bankPositions.length) {              // 1er chargement / re-fetch a froid -> skeleton (jamais sur un refresh 60s silencieux)
    const tb = document.getElementById('bank-tbody');
    if (tb) tb.innerHTML = Array.from({ length: 6 }).map(() => _BANK_SKEL_ROW).join('');
  }
  fetch('/api/bank-positions')
    .then(r => r.json())
    .then(d => {
      _bankPositions = d.positions || [];
      const u = document.getElementById('bank-update');
      if (u && d.updatedAt) {
        const _t = 'MAJ ' + new Date(d.updatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        if (u.textContent && u.textContent !== _t && window._dtpFlash) window._dtpFlash(u);   // flash discret : heure de MAJ change vraiment
        u.textContent = _t;
      }
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
  if (window._dtpDataIn) window._dtpDataIn(tb, 'bank');   // fondu d'arrivee (1re fois : skeleton -> lignes)

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
  if (el) {
    const _oldP = el.textContent;
    const _newP = p.currentPrice != null ? _bankFmt(p.pair, p.currentPrice) : '';
    if (_oldP && _newP && _oldP !== _newP && window._dtpFlash) window._dtpFlash(el);   // flash discret SEULEMENT si le prix change vraiment (sensation temps réel)
    el.textContent = _newP;
  }
  // Temps réel : déplace la ligne de prix LIVE sur le chart (sans recharger les bougies)
  if (_bankLiveGuide && _bankLiveGuide.pair === p.pair && p.currentPrice != null) {
    try {
      _bankLiveGuide.di.set('value', p.currentPrice);
      _bankLiveGuide.di.get('label')?.set('text', _bankFmt(p.pair, p.currentPrice));
    } catch {}
  }
}

// Double drapeau rond de la paire (façon pro) dans l'en-tête du chart
const _BANK_ISO = { USD:'us', EUR:'eu', GBP:'gb', JPY:'jp', CHF:'ch', CAD:'ca', AUD:'au', NZD:'nz', SEK:'se', NOK:'no', DKK:'dk', PLN:'pl', MXN:'mx', ZAR:'za', SGD:'sg', HKD:'hk', TRY:'tr', CNY:'cn', CNH:'cn' };
function _bankFlagsHtml(pair) {
  const f = c => _BANK_ISO[c] ? `<img class="bank-flag" src="https://flagcdn.com/w20/${_BANK_ISO[c]}.png" srcset="https://flagcdn.com/w40/${_BANK_ISO[c]}.png 2x" alt="" loading="lazy">` : '';
  const [b, q] = String(pair || '').split('/');
  const h2 = q ? f(q) : '';
  return f(b) + (h2 ? h2.replace('class="bank-flag"', 'class="bank-flag bank-flag--2"') : '');
}

function selectBankRow(id) {
  const p = _bankPositions.find(x => x.id === id);
  if (!p) return;
  _bankActiveId = id;
  _highlightBankRow(id);
  const fl = document.getElementById('bank-chart-flags'); if (fl) fl.innerHTML = _bankFlagsHtml(p.pair);
  document.getElementById('bank-chart-pair').textContent = p.pair;
  _updateBankChartPrice(p);
  buildBankChart(p);
}

function buildBankChart(p) {
  const el = document.getElementById('bank-chart');
  if (!el || typeof am5 === 'undefined') return;
  if (_bankChartRoot) { try { _bankChartRoot.dispose(); } catch {} _bankChartRoot = null; }
  _bankLiveGuide = null;
  el.innerHTML = dtpLoader('Chargement du graphique…', { small: true });

  fetch('/api/bank-ohlc?pair=' + encodeURIComponent(p.pair))
    .then(r => r.json())
    .then(d => {
      const candles = (d.candles || []).map(c => ({ Date: c.t, Open: c.o, High: c.h, Low: c.l, Close: c.c }));
      el.innerHTML = '';
      if (!candles.length) { el.innerHTML = '<div class="bank-chart-loading">Graphique indisponible.</div>'; return; }

      const dec  = p.pair.includes('JPY') ? 2 : (candles[0].Close < 10 ? 4 : 2);
      const fmt  = '#,###.' + '0'.repeat(dec);
      const mono = "'SF Mono', ui-monospace, Menlo, Consolas, monospace";
      const root = am5.Root.new('bank-chart');
      _bankChartRoot = root;
      _dtpChartPremium(el, 640);   // chargement premium : overlay shimmer pendant appear(500,60) -> reveal en fondu (re-build a chaque clic de ligne)
      // Suppression robuste du logo amCharts (le petit rond bleu) : forceHidden ne suffit pas
      if (root._logo) {
        root._logo.set('forceHidden', true);
        root._logo.set('visible', false);
        try { root._logo.children.clear(); } catch {}
        try { root._logo.dispose(); } catch {}
      }
      if (window.am5locales_fr_FR) root.locale = am5locales_fr_FR;   // mois en français (mars, avr., juin) + virgule décimale sur l'axe
      root.setThemes([am5themes_Animated.new(root)]);
      root.interfaceColors.set('text', am5.color(0x8a8a93));

      const chart = root.container.children.push(am5xy.XYChart.new(root, {
        panX: true, panY: false, wheelY: 'zoomX', pinchZoomX: true, paddingLeft: 0, paddingRight: 2, paddingTop: 6, paddingBottom: 4,
      }));
      chart.zoomOutButton.set('forceHidden', true);   // masque le bouton bleu de dézoom amCharts

      // ── Axe prix à droite + grille discrète (façon TradingView) ──
      const yRend = am5xy.AxisRendererY.new(root, { opposite: true });
      yRend.labels.template.setAll({ fill: am5.color(0x8a8a93), fontSize: 10, fontFamily: mono });
      yRend.grid.template.setAll({ stroke: am5.color(0x1c1c20), strokeOpacity: 1 });
      const yAxis = chart.yAxes.push(am5xy.ValueAxis.new(root, {
        renderer: yRend, numberFormat: fmt, tooltip: am5.Tooltip.new(root, {}),
      }));
      const xRend = am5xy.AxisRendererX.new(root, {});
      xRend.labels.template.setAll({ fill: am5.color(0x6f6f78), fontSize: 10, fontFamily: mono });
      xRend.grid.template.setAll({ stroke: am5.color(0x16161a), strokeOpacity: 1 });
      const xAxis = chart.xAxes.push(am5xy.DateAxis.new(root, {
        baseInterval: { timeUnit: 'day', count: 1 },
        renderer: xRend, tooltip: am5.Tooltip.new(root, {}),
      }));
      // Tooltips d'axes sombres (date en bas, prix à droite)
      [xAxis, yAxis].forEach(ax => {
        const tt = ax.get('tooltip'); if (!tt) return;
        tt.get('background')?.setAll({ fill: am5.color(0x18181c), stroke: am5.color(0x2a2a30) });
        tt.label.setAll({ fill: am5.color(0xe8e8ea), fontSize: 10, fontFamily: mono });
      });

      // ── Bougies aux couleurs TradingView + lecture OHLC au survol ──
      const series = chart.series.push(am5xy.CandlestickSeries.new(root, {
        xAxis, yAxis, valueXField: 'Date',
        openValueYField: 'Open', highValueYField: 'High', lowValueYField: 'Low', valueYField: 'Close',
        tooltip: am5.Tooltip.new(root, {
          pointerOrientation: 'horizontal',
          labelText: `O {openValueY.formatNumber('${fmt}')}   H {highValueY.formatNumber('${fmt}')}   L {lowValueY.formatNumber('${fmt}')}   C {valueY.formatNumber('${fmt}')}`,
        }),
      }));
      const stt = series.get('tooltip');
      if (stt) {
        stt.get('background')?.setAll({ fill: am5.color(0x141418), stroke: am5.color(0x2a2a30) });
        stt.label.setAll({ fill: am5.color(0xe8e8ea), fontSize: 10.5, fontFamily: mono });
      }
      series.columns.template.setAll({ strokeWidth: 1, width: am5.percent(62) });
      const colOf = t => { const di = t.dataItem; return di && di.get('valueY') >= di.get('openValueY') ? am5.color(0x26a69a) : am5.color(0xef5350); };
      series.columns.template.adapters.add('fill', (_f, t) => colOf(t));
      series.columns.template.adapters.add('stroke', (_s, t) => colOf(t));
      series.data.setAll(candles);

      // ── Crosshair façon TradingView ──
      const cursor = chart.set('cursor', am5xy.XYCursor.new(root, { behavior: 'none', xAxis, yAxis, snapToSeries: [series], snapToSeriesBy: 'x' }));   // 'none' = crosshair seul ; le glisser fait un PAN (panX), plus de zoom de sélection
      cursor.lineX.setAll({ stroke: am5.color(0x52525c), strokeDasharray: [3, 3], strokeOpacity: 0.9 });
      cursor.lineY.setAll({ stroke: am5.color(0x52525c), strokeDasharray: [3, 3], strokeOpacity: 0.9 });

      // ── Lignes Entry / Take Profit / Stop Loss + prix LIVE : clone pro : pilule de NOM collée au
      // bord droit DU GRAPHE + pilule de VALEUR sur l'axe de prix (façon TradingView). La ligne du
      // prix live (verte, pointillée) bouge ensuite à chaque refresh sans recharger le chart. ──
      const fmtFr = v => v.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
      const pill = { cornerRadiusTL: 2, cornerRadiusTR: 2, cornerRadiusBL: 2, cornerRadiusBR: 2 };
      const mkGuide = (value, name, color, dash) => {
        // 1) ligne + pilule de VALEUR sur l'axe
        const di = yAxis.makeDataItem({ value });
        yAxis.createAxisRange(di);
        di.get('grid')?.setAll({ stroke: am5.color(color), strokeOpacity: 0.95, strokeWidth: 1, strokeDasharray: dash });
        di.get('label')?.setAll({
          text: fmtFr(value), inside: false, centerY: am5.p50,
          fontSize: 10.5, fontWeight: '700', fontFamily: mono, fill: am5.color(0xffffff),
          background: am5.RoundedRectangle.new(root, { fill: am5.color(color), ...pill }),
        });
        // 2) pilule de NOM dans le graphe, alignée à droite (Entry / Take Profit / Stop Loss)
        if (name) {
          const dn = yAxis.makeDataItem({ value });
          yAxis.createAxisRange(dn);
          dn.get('grid')?.setAll({ strokeOpacity: 0 });
          dn.get('label')?.setAll({
            text: name, inside: true, x: am5.p100, centerX: am5.p100, dx: -4, centerY: am5.p50,
            fontSize: 10.5, fontWeight: '700', fill: am5.color(0xffffff),
            background: am5.RoundedRectangle.new(root, { fill: am5.color(color), ...pill }),
          });
        }
        return di;
      };
      if (p.entry) mkGuide(p.entry, 'Entry',       0x2962ff, [4, 3]);
      if (p.tp)    mkGuide(p.tp,    'Take Profit', 0x26a69a, [4, 3]);
      if (p.sl)    mkGuide(p.sl,    'Stop Loss',   0xef5350, [4, 3]);
      if (p.currentPrice) {
        const di = mkGuide(p.currentPrice, '', 0x26a69a, [1, 2]);   // prix live = vert pointillé (la référence)
        _bankLiveGuide = { di, pair: p.pair, dec };
      }

      // FIX : l'axe Y auto-calé sur les BOUGIES → toute ligne Entry/TP/SL/prix HORS de cette plage était
      // CLIPPÉE (ex. SL 162,50 au-dessus du plus haut 162 = invisible). On étend min/max pour TOUJOURS
      // afficher l'intégralité du trade (entrée + objectif + stop + prix live), avec une marge de respiration.
      {
        let lo = Infinity, hi = -Infinity;
        candles.forEach(c => { if (c.Low < lo) lo = c.Low; if (c.High > hi) hi = c.High; });
        [p.entry, p.tp, p.sl, p.currentPrice].forEach(v => { const n = +v; if (n) { if (n < lo) lo = n; if (n > hi) hi = n; } });
        if (isFinite(lo) && isFinite(hi) && hi > lo) { const pad = (hi - lo) * 0.06; yAxis.set('min', lo - pad); yAxis.set('max', hi + pad); }
      }

      series.appear(500);
      chart.appear(500, 60);
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
  // categories peut contenir des OBJETS (ex. displayTags de SEB) → on extrait la chaîne, sinon on
  // obtient « [object Object] ». Coercition robuste (name/tag/label/value/text/title), vides filtrés.
  const tags = (item.categories || [])
    .map(c => typeof c === 'string' ? c : (c && (c.name || c.tag || c.label || c.value || c.text || c.title)) || '')
    .flatMap(s => String(s).split(/\s*[,;]\s*/))   // une « catégorie » peut être une LISTE collée « A, B, C » → 1 tag par élément
    .map(s => s.trim()).filter(Boolean);
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
    [/iran|russia|ukraine|israel|hormuz|geopolit|conflict|war\b/i, 'Geopolitical'],
    [/middle east|gulf|saudi|uae|qatar|opec/i, 'Middle East'],
    [/energy|natural gas|\blng\b|petrol/i, 'Energy'],
    [/equit|stock|nasdaq|s&p|index|shares/i, 'Equities'],
    [/\brate(s)?\b|hike|cut|monetary policy|hawkish|dovish/i, 'Rates'],
    [/\bfx\b|forex|currency|exchange rate/i, 'FX'],
    [/bitcoin|crypto|ethereum|\bbtc\b/i, 'Crypto'],
    [/recession|slowdown|contraction/i,  'Recession'],
    [/jobs|employment|payroll|labou?r|unemployment/i, 'Jobs'],
    [/housing|home sales|mortgage|real estate/i, 'Housing'],
    [/central bank|\bfed\b|\becb\b|\bboe\b|\bboj\b|\bpboc\b|\bsnb\b/i, 'Central Banks'],
    [/commodit|copper|metal|silver/i,    'Commodities'],
    [/aud|nzd|cad|kiwi|aussie|loonie/i,  'Commodity FX'],
    [/switzerland|\bsnb\b|\bchf\b|franc suisse|swiss/i, 'CHF'],
    [/fiscal|budget|deficit|\bdebt\b|treasury issuance/i, 'Fiscal'],
    [/election|president|parliament|congress|senate|white house|politic/i, 'Politics'],
    [/credit|spread|corporate bond|high yield|investment grade/i, 'Credit'],
  ];
  // SCORING par fréquence : chaque thème est compté (occurrences dans titre + contenu) puis trié →
  // les tags retenus sont les PLUS PRÉSENTS dans le rapport, pas les premiers de la liste. Cible
  // 4 à 6 tags par rapport (jamais un tag isolé, jamais une rangée interminable).
  const scored = [];
  for (const [rx, label] of checks) {
    if (tags.includes(label)) continue;
    const m = h.match(new RegExp(rx.source, 'gi'));
    if (m && m.length) scored.push([label, m.length]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  for (const [label] of scored) {
    if (tags.length >= 6) break;
    if (!tags.includes(label)) tags.push(label);
  }
  // Plancher 4 : un rapport au texte pas (encore) extractible garde des tags génériques utiles.
  for (const f of ['Macro', 'Markets', 'Outlook', 'Research']) {
    if (tags.length >= 4) break;
    if (!tags.includes(f)) tags.push(f);
  }
  return _dedupeTags(tags).slice(0, 6);
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
  _selSync('br-inst', '<option value="all">Tous les instituts</option>' +
    insts.map(i => `<option value="${i}">${LABELS[i] || i}</option>`).join(''));
  // 2) Types présents (Articles / Opinions)
  const types = [...new Set(arts.map(i => _brItemType(i)).filter(Boolean))];
  const TLAB = { article: 'Articles', opinion: 'Opinions' };
  _selSync('br-type', '<option value="all">Tous les fichiers</option>' +
    types.map(t => `<option value="${t}">${TLAB[t] || t}</option>`).join(''));
  // (Le dropdown global dtpsel observe le <select> et se re-rend tout seul quand les options changent.)
}

// ── PERTINENCE « vision du terminal » : score haut = macro / banques centrales / FX / taux /
// données éco / commodités ; pénalité pour le hors-sujet (ESG, gestion de patrimoine, corporate,
// événementiel…). Sert à GARDER L'ESSENTIEL quand on plafonne le nombre de rapports par jour. ──
const _BR_KEY = /\b(fed|fomc|powell|ecb|bce|lagarde|boe|bailey|boj|ueda|snb|boc|rba|rbnz|pboc|rate decision|interest rate|monetary|hawkish|dovish|rate cut|rate hike|fx|forex|currenc|dollar|euro|sterling|yen|aussie|kiwi|loonie|franc|usd|eur|gbp|jpy|aud|nzd|cad|chf|cpi|inflation|gdp|pmi|payroll|nfp|jobless|retail sales|ppi|pce|unemployment|wage|trade balance|yield|bond|treasury|gilt|bund|jgb|ois|oil|crude|brent|opec|gold|xau|natural gas|commodit|tariff|geopolit|sanction|outlook|forecast|preview|recap|week ahead|strateg|macro|economic|markets?)\b/gi;
const _BR_OFF = /\besg\b|sustainab|net[- ]?zero|\bclimate\b|diversity|charity|donation|\baward|podcast|webinar|wealth|legacy|estate plan|premier elite|affluent|retail banking|mortgage product|insurance product|fund launch/i;
function _brRelevance(it) {
  const t = ((it.title || '') + ' ' + (it.description || '') + ' ' + ((it.categories || []).join(' '))).toLowerCase();
  const m = t.match(_BR_KEY);
  let s = m ? Math.min(m.length, 6) : 0;   // densité de mots-clés terminal (plafonnée +6)
  if (_BR_OFF.test(t)) s -= 5;             // hors vision → relégué sous le quota
  return s;
}
// Curation + dosage PAR JOUR : (1) on garde les ~CAP rapports les PLUS ESSENTIELS du jour
// (pertinence puis récence), (2) on les ENTRELACE par banque (round-robin) pour qu'aucune banque
// prolifique ne noie les autres. La chronologie jour-par-jour reste respectée. Vue « toutes banques »
// uniquement ; le filtre par banque montre TOUT (rien n'est définitivement perdu).
const _BR_CAP_PER_DAY = 35;
// ── Anti-doublon de rapports (Analyst + Institution) ────────────────────────
// Aucun rapport ne doit apparaître deux fois (seeds qui se recoupent, re-scrape, même rapport
// servi par deux flux). Clé d'unicité : l'URL (identifiant le plus fiable) ; à défaut,
// source/banque + JOUR + titre normalisé : un même titre un AUTRE jour n'est PAS un doublon
// (ex. « Daily Coffee Break » publié chaque jour).
function _reportDedupKey(item) {
  let u = String(item && item.url || '').trim().toLowerCase();
  if (u) return 'u:' + u.replace(/#.*$/, '').replace(/\/+$/, '');   // même URL = même rapport (on garde la query : un ?id= distingue 2 rapports)
  const day = new Date((item && item.timestamp) || 0).toISOString().slice(0, 10);
  const t   = String((item && (item.title || item.headline)) || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 90);
  const src = String((item && (item.institution || item._reportType || item._source)) || '').toLowerCase();
  return 't:' + src + '|' + day + '|' + t;
}
// Retire les doublons en gardant la 1re occurrence (les items en conflit sont le même rapport).
function _dedupeReports(arr) {
  const seen = new Set(), out = [];
  for (const it of (arr || [])) {
    if (!it) continue;
    const k = _reportDedupKey(it);
    if (seen.has(k)) continue;
    seen.add(k); out.push(it);
  }
  return out;
}

function _brBalanceByDay(arr) {
  const dayKey = t => new Date(t || 0).toISOString().slice(0, 10);
  const byDay = new Map(); const dayOrder = [];   // jours dans l'ordre reçu (déjà date desc)
  for (const it of arr) {
    const d = dayKey(it.timestamp);
    if (!byDay.has(d)) { byDay.set(d, []); dayOrder.push(d); }
    byDay.get(d).push(it);
  }
  const out = [];
  for (const d of dayOrder) {
    // 1) sélection des plus ESSENTIELS du jour : tri pertinence ↓ puis récence ↓, plafonné au quota
    let day = byDay.get(d)
      .map(it => ({ it, r: _brRelevance(it) }))
      .sort((a, b) => b.r - a.r || (b.it.timestamp || 0) - (a.it.timestamp || 0))
      .slice(0, _BR_CAP_PER_DAY)
      .map(x => x.it);
    day.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));   // récence pour l'entrelacement
    // 2) round-robin par banque (1 rapport de chaque banque par tour)
    const byBank = new Map(); const bankOrder = [];
    for (const it of day) {
      const b = it.institution || it._source || '?';
      if (!byBank.has(b)) { byBank.set(b, []); bankOrder.push(b); }
      byBank.get(b).push(it);
    }
    let more = true;
    while (more) {                                   // tour par tour : 1 rapport de chaque banque
      more = false;
      for (const b of bankOrder) { const q = byBank.get(b); if (q.length) { out.push(q.shift()); more = true; } }
    }
  }
  return out;
}

let _brRows = {};   // id -> item : clic délégué sur les lignes du tableau Institution
let _brWarmTimer = null;   // débounce du préchauffage PDF proactif (après filtre/recherche stabilisé)
// Skeleton catalogue Institution : memes colonnes que la table Analyste (colgroup arl-col-inst-br), ~10 lignes.
// Injecte dans #br-list tant que _brArticles est vide -> auto-efface par le renderBrList() plein.
function _brSkel() {
  let rows = '';
  for (let i = 0; i < 10; i++) {
    rows += '<tr class="arl-row arl-skel-row" aria-hidden="true">'
      + '<td class="arl-c-bm"><span class="dtp-skel arl-skel-bm"></span></td>'
      + '<td class="arl-c-date"><span class="dtp-skel"></span></td>'
      + '<td class="arl-c-title"><div class="arl-tw"><span class="dtp-skel arl-skel-ico"></span><span class="dtp-skel arl-skel-ttl"></span></div></td>'
      + '<td class="arl-c-inst"><span class="dtp-skel arl-skel-inst"></span></td></tr>';
  }
  return '<table class="arlib-table"><colgroup>'
    + '<col class="arl-col-bm"><col class="arl-col-date"><col class="arl-col-title"><col class="arl-col-inst-br"></colgroup>'
    + '<thead><tr><th class="arl-th"></th><th class="arl-th">Date</th><th class="arl-th">Titre</th><th class="arl-th arl-th-c">Institut</th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table>';
}
function renderBrList() {
  const list   = document.getElementById('br-list');
  const footer = document.getElementById('br-footer');
  if (!list) return;
  _populateBrInstFilter();

  // Anti-doublon : aucun rapport ne doit apparaître deux fois (seeds qui se recoupent, re-scrape,
  // même URL servie par deux passages). Dédup AVANT filtres/dosage → le total « of N » est honnête.
  const all = _dedupeReports(_brArticles);
  let items = all;
  if (_brInst   !== 'all') items = items.filter(i => i.institution === _brInst);
  if (_brType   !== 'all') items = items.filter(i => _brItemType(i) === _brType);
  if (_brSearch)           items = items.filter(i =>
    (i.title || '').toLowerCase().includes(_brSearch) ||
    (i.description || '').toLowerCase().includes(_brSearch));
  // DOSAGE par banque : chronologie respectée AU NIVEAU DU JOUR, mais à l'intérieur de chaque
  // journée on ENTRELACE les banques (round-robin) → le rapport le plus récent de CHAQUE banque
  // remonte (un SEB isolé n'est plus noyé sous 15 HSBC), aucun rapport n'est caché. Désactivé
  // quand on a déjà filtré sur une seule banque (l'entrelacement n'a alors aucun sens).
  if (_brInst === 'all') items = _brBalanceByDay(items);

  if (items.length === 0) {
    // Si aucun article du tout (pas un filtre trop strict) → on est en chargement : on montre le loader.
    const noneAtAll = _brArticles.length === 0;
    if (noneAtAll) {
      list.innerHTML = _brSkel();   // skeleton (epouse .arlib-table) au lieu du loader texte
    } else {
      list.innerHTML = '<div class="br-empty">Aucun rapport ne correspond à ces filtres.</div>';
    }
    if (footer) footer.textContent = '';
    return;
  }

  // ── Rendu en TABLEAU institutionnel (Date | Titre | Institut) : identique à l'onglet Analyst ──
  if (footer) footer.textContent = 'Affichage de ' + items.length + ' sur ' + all.length + ' document' + (all.length > 1 ? 's' : '') + ' de recherche';
  _brRows = {};
  const _e = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const _DOC = '<svg width="13" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>';
  const _BM = '<svg width="12" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>';
  let _rows = '';
  for (const item of items) {
    _brRows[item.id] = item;
    const read    = isBrRead(item.id);
    const dateStr = new Date(item.timestamp).toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'2-digit' });
    const title   = item.title || '';
    const inst    = _instLogoHtml(_instBadge(item)) || '';
    _rows += `<tr class="arl-row${read ? ' arl-row--read' : ''}" data-id="${_e(item.id)}">`
      + `<td class="arl-c-bm"><span class="arl-bm">${_BM}</span></td>`
      + `<td class="arl-c-date">${_e(dateStr)}</td>`
      + `<td class="arl-c-title"><div class="arl-tw"><span class="arl-ico br-doc-ico">${_DOC}</span><span class="arl-ttl" title="${_e(title).replace(/"/g, '&quot;')}">${_e(title)}</span></div></td>`
      + `<td class="arl-c-inst"><span class="br-inst-logo-card">${inst}</span></td></tr>`;
  }
  list.innerHTML = '<table class="arlib-table"><colgroup>'
    + '<col class="arl-col-bm"><col class="arl-col-date"><col class="arl-col-title"><col class="arl-col-inst-br"></colgroup>'
    + '<thead><tr><th class="arl-th"></th><th class="arl-th">Date</th><th class="arl-th">Titre</th><th class="arl-th arl-th-c">Institut</th></tr></thead>'
    + '<tbody>' + _rows + '</tbody></table>';

  // Préchauffage PROACTIF (débounce → après un filtre/recherche stabilisé) : le PDF des premiers rapports
  // natifs est réchauffé dès l'affichage → le clic ouvre depuis le cache = quasi instantané.
  clearTimeout(_brWarmTimer);
  _brWarmTimer = setTimeout(() => { try { _brWarmTopPdfs(items); } catch (e) {} }, 500);
}

// Clic délégué sur une ligne du tableau Institution → ouvre le lecteur de rapport bancaire
document.addEventListener('click', (ev) => {
  const row = ev.target.closest && ev.target.closest('#br-list .arl-row');
  if (!row) return;
  const item = _brRows[row.dataset.id];
  if (!item) return;
  markBrRead(item.id);
  row.classList.add('arl-row--read');
  renderBrReader(item);
});

// Cache ArrayBuffer EN MEMOIRE JS (survit a l'eviction du cache HTTP mobile) : id -> {ab, size, endpoint}.
// Le clic reutilise les octets stockes = ZERO fetch = ouverture INSTANTANEE, et alimente PDF.js directement.
// Borne (8 max) + eviction du plus ancien -> pas d'OOM sur le tier 512 Mo (8 PDF x ~4 Mo ~ 32 Mo).
const _brBlobCache = new Map();
const _BR_BLOB_CAP = 8;
function _brBlobStore(id, endpoint, ab) {
  if (!id || !ab || ab.byteLength < 1000) return;
  if (_brBlobCache.has(id)) _brBlobCache.delete(id);
  while (_brBlobCache.size >= _BR_BLOB_CAP) { _brBlobCache.delete(_brBlobCache.keys().next().value); }
  _brBlobCache.set(id, { ab, size: ab.byteLength, endpoint });
}

// Préchauffage PDF : au survol soutenu (desktop) / au 1er contact (mobile) d'une ligne, on réchauffe le
// cache serveur ET on STOCKE les octets du PDF (cache blob JS) AVANT le clic → ouverture instantanée.
// Garde 1 fetch/rapport (Set) + intention de survol 180ms → pas de sur-préchauffage en passant la souris.
const _brPrefetched = new Set();
let _brHoverTimer = null;
function _brPrefetch(item) {
  if (!item || _brPrefetched.has(item.id)) return;
  _brPrefetched.add(item.id);
  try {
    let pdf = '';
    if (item._pdfUrl) pdf = item._pdfUrl;
    else if (item._pdf || /\.pdf(?:[?#]|$)/i.test(item.url || '')) pdf = item.url;
    else if (item._source === 'ing-think') { try { pdf = _ingPdfUrl(item.url); } catch (e) {} }
    if (pdf) { const ep = _brPdfProxy(pdf), id = item.id; fetch(ep).then(r => r.ok ? r.arrayBuffer() : null).then(ab => ab && _brBlobStore(id, ep, ab)).catch(() => {}); }   // STOCKE les octets (cache blob JS) → clic instantané, alimente PDF.js
    if (item.url) fetch('/api/bank-research-content?url=' + encodeURIComponent(item.url)).catch(() => {});  // réchauffe contenu + segmentation IA + résolution pdfUrl/renderUrl
  } catch (e) {}
}
document.addEventListener('mouseover', (ev) => {
  const row = ev.target.closest && ev.target.closest('#br-list .arl-row');
  if (!row) return;
  const item = _brRows[row.dataset.id];
  if (!item || _brPrefetched.has(item.id)) return;
  clearTimeout(_brHoverTimer);
  _brHoverTimer = setTimeout(() => _brPrefetch(item), 180);
});
document.addEventListener('mouseout', () => { clearTimeout(_brHoverTimer); });
document.addEventListener('touchstart', (ev) => {
  const row = ev.target.closest && ev.target.closest('#br-list .arl-row');
  if (row) _brPrefetch(_brRows[row.dataset.id]);
}, { passive: true });

// PROACTIF : réchauffe le PDF des ~6 premiers rapports NATIFS dès l'affichage de la liste (proxy léger,
// PAS de Puppeteer), étalé 350ms → au clic, le PDF sort du cache navigateur = ouverture quasi instantanée.
// Natifs seulement + top 6 + Set anti-doublon → borné, zéro risque de rafale/OOM sur le tier 512 Mo.
function _brWarmTopPdfs(items) {
  let n = 0;
  for (const it of items) {
    if (n >= 6) break;
    if (!it || _brPrefetched.has(it.id)) continue;
    let pdf = '';
    if (it._pdfUrl) pdf = it._pdfUrl;
    else if (it._pdf || /\.pdf(?:[?#]|$)/i.test(it.url || '')) pdf = it.url;
    else if (it._source === 'ing-think') { try { pdf = _ingPdfUrl(it.url); } catch (e) {} }
    if (!pdf) continue;
    _brPrefetched.add(it.id);
    ((u, k, id) => setTimeout(() => { try { const ep = _brPdfProxy(u); fetch(ep).then(r => r.ok ? r.arrayBuffer() : null).then(ab => ab && _brBlobStore(id, ep, ab)).catch(() => {}); } catch (e) {} }, k * 350))(pdf, n, it.id);
    n++;
  }
}

// Badge institution = la VRAIE banque du rapport. ING→"ING", MUFG→"MUFG", autres banques
// reconnues (notes agrégées ActionForex…) → leur sigle ; sinon (agrégateur sans banque
// identifiable) → "DTP". On ne met JAMAIS "ING" par défaut.
const _INST_BANKS = [
  [/\bblackrock\b/i, 'BlackRock'], [/\bunicredit\b/i, 'UniCredit'], [/\bsyz\b/i, 'Syz Group'], [/\bcibc\b/i, 'CIBC'], [/\blloyds\b/i, 'Lloyds Bank'], [/\bkbc\b/i, 'KBC'],
  [/\bamundi\b/i, 'Amundi'], [/\bqcam\b|q-?cam/i, 'QCAM'],
  [/\bmufg\b|mitsubishi ufj/i, 'MUFG'], [/\buob\b/i, 'UOB'], [/\bocbc\b/i, 'OCBC'],
  [/\bdanske\b/i, 'Danske'], [/\bnomura\b/i, 'Nomura'], [/\bgoldman\b/i, 'Goldman Sachs'],
  [/\bmorgan stanley\b/i, 'MS'], [/\bjp ?morgan\b/i, 'JPM'], [/\bciti\b/i, 'Citi'],
  [/\bbarclays\b/i, 'Barclays'], [/\bhsbc\b/i, 'HSBC'], [/\brabobank\b/i, 'Rabo'],
  [/\bscotiabank\b|\bscotia\b/i, 'Scotia'], [/\bwestpac\b/i, 'Westpac'], [/\bnab\b/i, 'NAB'],
  [/\bcommerzbank\b/i, 'Commerz'], [/\bsocgen\b|société générale|societe generale/i, 'SocGen'],
  [/\bbnp\b/i, 'BNP'], [/crédit agricole|credit agricole|\bcacib\b/i, 'CACIB'],
  [/standard chartered/i, 'StanChart'], [/\bwells fargo\b/i, 'Wells Fargo'],
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
  ING: '#ff6200', MUFG: '#e60012', Natixis: '#5b2d86', CACIB: '#009597', 'Goldman Sachs': '#6f93c0',
  JPM: '#7a2a2a', MS: '#00a3e0', Citi: '#1b5fae', Barclays: '#00aeef', HSBC: '#db0011',
  Deutsche: '#2c7be5', UOB: '#1b5fae', OCBC: '#e2231a', Danske: '#19a6dc', Nomura: '#c0233a',
  SocGen: '#e60028', BNP: '#00915a', StanChart: '#1b8fea', BofA: '#1f5fb0', 'Wells Fargo': '#d71e28',
  NatWest: '#7b3fa0', Rabo: '#fe6e00', Scotia: '#ec111a', Westpac: '#d5002b', Commerz: '#e7b000',
  NAB: '#c20029', ANZ: '#1b8fea', Nordea: '#0000a0', SEB: '#5ca800',
  BlackRock: '#ededf0', UniCredit: '#e2231a', 'Syz Group': '#ff9c0c', CIBC: '#b71e3f', 'Lloyds Bank': '#0a9d58', KBC: '#0097db',
  Amundi: '#0093d0', QCAM: '#e30613',
};
function _instBrandColor(label) { return _BANK_BRAND[label] || '#e3b23a'; }
// Domaine officiel par banque → vrai logo via le service Clearbit (repli wordmark si indispo).
const _BANK_DOMAIN = {
  ING: 'ing.com', MUFG: 'mufg.jp', Natixis: 'natixis.com', CACIB: 'ca-cib.com',
  'Goldman Sachs': 'goldmansachs.com', JPM: 'jpmorgan.com', MS: 'morganstanley.com', Citi: 'citigroup.com',
  Barclays: 'barclays.com', HSBC: 'hsbc.com', Deutsche: 'db.com', UOB: 'uobgroup.com',
  OCBC: 'ocbc.com', Danske: 'danskebank.com', Nomura: 'nomura.com', SocGen: 'societegenerale.com',
  BNP: 'bnpparibas.com', StanChart: 'sc.com', BofA: 'bankofamerica.com', 'Wells Fargo': 'wellsfargo.com',
  NatWest: 'natwest.com', Rabo: 'rabobank.com', Scotia: 'scotiabank.com', Westpac: 'westpac.com.au',
  Commerz: 'commerzbank.com', NAB: 'nab.com.au', ANZ: 'anz.com', Nordea: 'nordea.com', SEB: 'sebgroup.com',
  UniCredit: 'unicredit.eu', 'Syz Group': 'syzgroup.com', CIBC: 'cibccm.com', 'Lloyds Bank': 'lloydsbank.com', KBC: 'kbc.com',
  Amundi: 'amundi.com', QCAM: 'q-cam.com',
};
// Logos téléchargés en local (assets DTP) → prioritaires sur Clearbit pour ces banques.
const _BANK_LOCAL_LOGO = {
  MUFG:      '/assets/images/banks/MUFG.png',
  SEB:       '/assets/images/banks/SEB.png',
  ING:       '/assets/images/banks/ING.png',
  Natixis:   '/assets/images/banks/Natixis.png',     // téléchargé + recoloré blanc (local → aucune dépendance externe)
  BlackRock: '/assets/images/banks/BlackRock.png',   // wordmark blanc (fond noir keyé), rogné
  Danske:    '/assets/images/banks/Danske.png',      // logo authentique deux-tons « Danske Bank »
  Scotia:    '/assets/images/banks/Scotia.png',      // icône rouge Scotiabank (fond transparent), rognée
  'Wells Fargo': '/assets/images/banks/Wells.png',   // logo Wells Fargo (carré rouge, texte jaune)
  UniCredit: '/assets/images/banks/UniCredit.png',   // icône rouge UniCredit (fond transparent), rognée
  SocGen:    '/assets/images/banks/SocGen.png',      // logo Société Générale (carré rouge/noir)
  HSBC:      '/assets/images/banks/HSBC.png',        // hexagone rouge HSBC (fond transparent), rogné
  'Syz Group': '/assets/images/banks/Syz.png',       // logo Syz Group (orange)
  CIBC:      '/assets/images/banks/CIBC.png',        // losange rouge CIBC Capital Markets
  Nordea:    '/assets/images/banks/Nordea.png',      // icône bleue Nordea (fond blanc keyé)
  'Lloyds Bank': '/assets/images/banks/Lloyds.png',  // cheval blanc Lloyds Bank (recoloré)
  KBC:       '/assets/images/banks/KBC.svg',         // logo KBC (cercle bleu + KBC blanc) : SVG
  StanChart: '/assets/images/banks/StanChart.png',   // logo Standard Chartered (téléchargé en local)
};
// HTML du logo : <img vrai logo> avec repli automatique (onerror) sur le wordmark coloré → jamais cassé.
function _instLogoHtml(label) {
  const color = _instBrandColor(label);
  // Nom de la banque : TOUJOURS affiché (à côté du logo).
  const name = `<span class="br-dtp-logo br-inst-name" style="color:${color}">${label}</span>`;
  if (label === 'DTP') return name;
  // Logo local (MUFG/SEB/ING) prioritaire, sinon Clearbit via le domaine officiel.
  // Logo local prioritaire ; sinon service de favicons OFFICIEL fiable (Clearbit ayant fermé → renvoyait des images cassées).
  const url = _BANK_LOCAL_LOGO[label] || (_BANK_DOMAIN[label] ? `https://www.google.com/s2/favicons?sz=128&domain=${_BANK_DOMAIN[label]}` : null);
  if (!url) return name;
  // Logo + NOM côte à côte : le nom reste toujours visible ; le logo se masque seulement s'il échoue.
  return `<span class="br-bank-logo-wrap"><img class="br-bank-logo" src="${url}" alt="${label}" onerror="this.style.display='none'">${name}</span>`;
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

// URL du PDF servi par DTP (proxy même-origine) → contourne X-Frame-Options des PDF distants
// (ex. ING Think renvoie SAMEORIGIN). On affiche TOUJOURS le PDF via ce proxy.
function _brPdfProxy(u) { return '/api/pdf-proxy?url=' + encodeURIComponent(u || ''); }
// PDF ING Think dérivé de l'URL d'article : /articles/<slug>/ → /downloads/pdf/article/<slug>
function _ingPdfUrl(u) {
  try {
    const m = String(u || '').match(/think\.ing\.com\/(articles|snaps|opinions|bundles)\/([^/?#]+)/i);
    if (!m) return '';
    const t = { articles: 'article', snaps: 'snap', opinions: 'opinion', bundles: 'bundle' }[m[1].toLowerCase()] || 'article';
    return 'https://think.ing.com/downloads/pdf/' + t + '/' + m[2];
  } catch { return ''; }
}
// Rend un PDF via PDF.js sur des <canvas> (FIABLE sur mobile/iOS, contrairement a l'iframe PDF qui reste un
// cadre gris sur WebKit) : page 1 tout de suite, pages suivantes a la volee (IntersectionObserver). Canvas =
// largeur conteneur x devicePixelRatio (cap 2) -> responsive + net. Cap 40 pages (memoire device bornee).
async function _brRenderPdfCanvas(content, data, ttl) {
  if (!window.pdfjsLib) return false;
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc)
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const nPages = Math.min(pdf.numPages, 40);
  if (window._brPdfDoc) { try { window._brPdfDoc.destroy(); } catch (e) {} }
  window._brPdfDoc = pdf;
  const safeTtl = String(ttl).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  content.classList.add('br-rcontent--pdf');
  content.innerHTML =
    '<div class="br-pdf-bar"><span class="br-pdf-bar-lbl">' + safeTtl + '</span>' +
    '<span class="br-pdf-bar-lbl" style="color:#b8860b">' + pdf.numPages + ' page' + (pdf.numPages > 1 ? 's' : '') + '</span></div>' +
    '<div class="br-pdf-canvaswrap" id="br-pdf-canvaswrap"></div>';
  const wrap = content.querySelector('#br-pdf-canvaswrap');
  const renderPage = async (num, cvs) => {
    if (cvs.dataset.done) return;
    cvs.dataset.done = '1';
    const page = await pdf.getPage(num);
    const cssW = wrap.clientWidth || window.innerWidth || 360;
    const vp1 = page.getViewport({ scale: 1 });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = (cssW / vp1.width) * dpr;
    const vp = page.getViewport({ scale });
    cvs.width = Math.floor(vp.width); cvs.height = Math.floor(vp.height);
    await page.render({ canvasContext: cvs.getContext('2d', { alpha: false }), viewport: vp }).promise;
  };
  const io = new IntersectionObserver((ents) => {
    ents.forEach(e => { if (e.isIntersecting) { renderPage(+e.target.dataset.page, e.target).catch(() => {}); io.unobserve(e.target); } });
  }, { root: content, rootMargin: '600px 0px' });
  for (let i = 1; i <= nPages; i++) {
    const cvs = document.createElement('canvas');
    cvs.className = 'br-pdf-canvas'; cvs.dataset.page = i;
    wrap.appendChild(cvs);
    if (i === 1) await renderPage(1, cvs);
    else io.observe(cvs);
  }
  return true;
}
// Embarque un PDF (proxy OU rendu). Renvoie true si affiche, false sinon (→ l'appelant tente le repli suivant).
// MOBILE : rendu PDF.js sur canvas (l'iframe PDF ne s'affiche PAS inline sur iOS/WebKit = cadre gris). DESKTOP : iframe.
// FAST PATH : si les octets ont ete prechauffes (cache blob JS) → reutilisation directe, ZERO fetch = instantane.
async function _brEmbedPdf(item, endpointUrl) {
  const content = document.getElementById('br-rcontent');
  if (!content) return false;
  let buf = null;
  const hit = item && item.id && _brBlobCache.get(item.id);
  if (hit && hit.endpoint === endpointUrl) {
    buf = hit.ab;                                       // octets deja en main (prechauffage) → aucun reseau
  } else {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 55000);   // rendu Puppeteer OU 1er téléchargement d'un PDF natif dont la source est LENTE (MUFG /media ~20-55 s) : sans ça le client abandonne à 30 s AVANT que le serveur ait fini + mis en cache → repli sur le rendu HTML teaser (rapport « minuscule »). Le serveur cache le PDF → les opens suivants sont instantanés.
      const r = await fetch(endpointUrl, { signal: ctrl.signal });
      clearTimeout(to);
      if (!r.ok || !((r.headers.get('content-type') || '').toLowerCase().includes('pdf'))) return false;
      buf = await r.arrayBuffer();
      if (!buf || buf.byteLength < 1000) return false;   // PDF vide / page d'erreur → repli (jamais de cadre blanc)
      if (item && item.id) _brBlobStore(item.id, endpointUrl, buf);
    } catch { return false; }
  }
  if (!document.getElementById('br-rcontent')) return true;   // l'utilisateur a quitté le reader entre-temps
  const ttl = (item.title || 'PDF').replace(/"/g, '');
  // PDF.js CANVAS partout (desktop + mobile) : rendu fiable + scrollbar CUSTOM du desk (le canvas vit dans
  // #br-rcontent, scrollbar 11px stylée), au lieu de la scrollbar NATIVE de la visionneuse iframe de Chrome
  // (flèches, non stylable : « met le scroller comme le desk »). Repli iframe (desktop) si PDF.js indispo.
  if (window.pdfjsLib) { try { if (await _brRenderPdfCanvas(content, buf.slice(0), ttl)) return true; } catch (e) {} }
  if (window.innerWidth <= 768) return false;            // MOBILE : jamais d'iframe (cadre gris sur WebKit) → carte « ouvrir l'original »
  try { if (window._brBlobUrl) URL.revokeObjectURL(window._brBlobUrl); } catch {}   // DESKTOP sans PDF.js → iframe blob same-origin
  const blobUrl = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
  window._brBlobUrl = blobUrl;
  content.classList.add('br-rcontent--pdf');
  content.innerHTML = `<iframe class="br-pdf-frame" src="${blobUrl}#toolbar=0&navpanes=0&zoom=100" title="${ttl}"></iframe>`;
  return true;
}
// Repli PROPRE quand AUCUN PDF n'est affichable : en-tête + titre + aperçu + « Ouvrir le rapport original ↗ »
// (jamais un cadre vide ni un message technique). Les Éclairages IA restent affichés au-dessus, façon pro.
function _brShowExternalCard(item) {
  const content = document.getElementById('br-rcontent'); if (!content) return;
  content.classList.remove('br-rcontent--pdf');
  const _inst = _instBadge(item);
  const tagline = _inst === 'ING' ? 'THINK economic and financial analysis' : (_inst === 'DTP' ? 'Institutional research' : _inst + ' Research');
  const headerHtml = `<div class="br-ing-header">${_instLogoHtml(_inst)}<div class="br-ing-tagline">${tagline}</div></div><div class="br-ing-divider"></div>`;
  const dateStr = item.timestamp ? new Date(item.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '';
  const preview = (item.description || '').trim();
  const safe = (item.url || '').replace(/"/g, '&quot;');
  const typeLbl = _inst === 'DTP' ? 'Research' : _inst;
  content.innerHTML = `<div class="br-document">${headerHtml}
      <div class="br-ing-meta"><span class="br-ing-type">${typeLbl}</span>${dateStr ? `<span class="br-ing-sep">|</span><span class="br-ing-date">${dateStr}</span>` : ''}</div>
      <div class="br-doc-title">${item.title}</div>
      ${preview ? `<div class="br-ing-lead">${preview}</div>` : ''}
      <div class="br-ext-card">
        <div class="br-ext-card-ic">📄</div>
        <div class="br-ext-card-txt">Ce rapport n'a pas pu être affiché en PDF ici. Ouvrez-le sur le site de <strong>${typeLbl}</strong> pour le consulter en entier.</div>
        <a class="br-ext-card-btn" href="${safe}" target="_blank" rel="noopener">Ouvrir le rapport original ↗</a>
      </div></div>`;
}
// VRAI PDF de la banque, BRUT plein cadre. Chaîne ROBUSTE (anticipe toute source qui casse) : (1) PDF natif
// proxifié → (2) repli rendu serveur de la page d'origine (Puppeteer) → (3) carte « ouvrir l'original ».
async function _brShowNativePdf(item, pdfUrl) {
  const content = document.getElementById('br-rcontent');
  if (!content) return;
  content.classList.remove('br-rcontent--pdf');
  content.innerHTML = dtpLoader('Chargement du PDF…');
  const raw = pdfUrl || item.url || '';
  if (raw && await _brEmbedPdf(item, _brPdfProxy(raw))) return;                                       // 1) PDF natif
  const orig = item.url || '';
  if (orig && await _brEmbedPdf(item, '/api/pdf-render?url=' + encodeURIComponent(orig))) return;     // 2) rendu serveur
  _brShowExternalCard(item);                                                                          // 3) repli propre
}

// Rapport SANS PDF natif (MUFG, Lloyds, Natixis…) : rendu serveur (Puppeteer), BRUT plein cadre. 1er affichage =
// génération (~2-5 s) puis mis en cache. Repli carte « ouvrir l'original » si le rendu échoue. Insights conservés.
async function _brShowRenderedPdf(item, renderUrl) {
  const content = document.getElementById('br-rcontent');
  if (!content) return;
  content.classList.remove('br-rcontent--pdf');
  content.innerHTML = dtpLoader('Préparation du PDF…');
  if (renderUrl && await _brEmbedPdf(item, '/api/pdf-render?url=' + encodeURIComponent(renderUrl))) return;
  _brShowExternalCard(item);
}

// Garantit les Éclairages IA (+ tags) à CHAQUE ouverture de rapport Institution, quel que soit le mode
// d'affichage (PDF natif / proxy / rendu / HTML). item.description est souvent VIDE (PDF natifs SEB/ING/
// BlackRock, MUFG…) → on alimente depuis le MEILLEUR contenu dispo : fullContent → HTML déjà fetché →
// corps de l'article récupéré → description. Le 1er ayant > 80 caractères gagne.
function _brEnsureInsights(item, brIns, tagsEl, preHtml) {
  if (!brIns) return;
  const render = src => {
    const t = String(src || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.length <= 80) return false;
    _loadAIInsights({ id: item.id, headline: item.title, description: t }, brIns);
    if (tagsEl) tagsEl.innerHTML = _brTags({ ...item, description: t.slice(0, 4000) }).map(x => `<span class="br-rtag">${x}</span>`).join('');
    return true;
  };
  if (render(item.fullContent) || render(preHtml)) return;   // contenu déjà en main
  // Plus JAMAIS de panneau muet (retour client Natixis) : si aucune source de texte n'aboutit,
  // on affiche un état clair avec un bouton Réessayer au lieu de rien.
  const fail = () => {
    brIns.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;margin:0 0 12px;background:#101014;border:1px solid #26262b;border-radius:6px;font-size:12.5px;color:#8b93a1;">'
      + 'Éclairages IA indisponibles pour ce rapport (contenu non extractible pour le moment).'
      + '<button type="button" id="br-ins-retry" style="margin-left:auto;background:transparent;border:1px solid #3a3f4b;border-radius:4px;color:#e3b23a;font-size:12px;padding:4px 12px;cursor:pointer;">Réessayer</button></div>';
    const rb = document.getElementById('br-ins-retry');
    if (rb) rb.onclick = () => { brIns.innerHTML = dtpLoader('Analyse du rapport…'); _brEnsureInsights(item, brIns, tagsEl, preHtml); };
  };
  // PDF natif / page SPA sans contenu → on récupère le corps (ou le texte dédié insightsText du serveur).
  fetch('/api/bank-research-content?url=' + encodeURIComponent(item.url))
    .then(r => r.json()).then(d => { if (!(render(d && d.insightsText) || render(d && d.html) || render(item.description))) fail(); })
    .catch(() => { if (!render(item.description)) fail(); });
}

function renderBrReader(item) {
  // Masquer la liste, afficher le reader en pleine largeur
  document.getElementById('br-list-view')?.classList.add('hidden');
  document.getElementById('br-reader-view')?.classList.remove('hidden');

  const titleEl = document.getElementById('br-rnav-title');
  const tagsEl  = document.getElementById('br-rtags-scroll');
  const content = document.getElementById('br-rcontent');
  const badge   = document.getElementById('br-inst-badge');

  if (titleEl) titleEl.textContent = _mdStrip(item.title);
  if (badge)   badge.textContent   = _instBadge(item);
  if (tagsEl)  tagsEl.innerHTML    = _brTags(item).map(t => `<span class="br-rtag">${t}</span>`).join('');
  if (content) content.classList.remove('br-rcontent--pdf');

  // ── Éclairages IA (carrousel au-dessus, TOUJOURS : y compris au-dessus d'un PDF, façon pro) ──
  let brIns = document.getElementById('br-ai-insights');
  if (!brIns && content) {
    brIns = document.createElement('div');
    brIns.id = 'br-ai-insights';
    content.parentNode.insertBefore(brIns, content);
  }
  const brBtn = document.getElementById('br-insights-btn');
  if (brBtn) { brBtn.style.display = ''; brBtn.innerHTML = `${_EYE_OFF} Masquer Insights`; brBtn.onclick = () => aiInsToggle(brBtn, 'br-ai-insights'); }

  // ── VRAI PDF de la banque, affiché BRUT (proxifié) : ZÉRO restructuration IA : rapport déjà en .pdf
  //    (BlackRock, Danske…) OU article ING Think (PDF dérivé de l'URL). Insights conservés au-dessus.
  let _realPdf = '';
  if (item && item._pdfUrl) _realPdf = item._pdfUrl;                                   // PDF natif fourni par la source (ex. SEB : attachment.fileName)
  else if (item && (item._pdf || /\.pdf(?:[?#]|$)/i.test(item.url || ''))) _realPdf = item.url;
  else if (item && item._source === 'ing-think') _realPdf = _ingPdfUrl(item.url);
  if (_realPdf) {
    _brShowNativePdf(item, _realPdf);
    if (brIns) { brIns.innerHTML = ''; _brEnsureInsights(item, brIns, tagsEl); }   // insights TOUJOURS présents (PDF natif → fetch du corps)
    return;
  }

  if (content) content.innerHTML = dtpLoader('Chargement de l’article…');
  // On NE pré-charge PAS les insights depuis item (description souvent vide → cacherait un résultat
  // pauvre sous ck=item.id et bloquerait la version riche). _brEnsureInsights (plus bas, sur le contenu
  // récupéré) ou _brFinalizeReader s'en chargent → insights TOUJOURS basés sur le vrai contenu.
  if (brIns) brIns.innerHTML = '';

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
    _brFinalizeReader(item, brIns);
    return;
  }

  fetch('/api/bank-research-content?url=' + encodeURIComponent(item.url))
    .then(r => r.json())
    .then(async data => {
      if (!content) return;
      data = data || {};
      // Éclairages IA + tags GARANTIS depuis le CONTENU du rapport (le corps vit dans le PDF/HTML ;
      // item.description est souvent vide) → carrousel rempli + tags pertinents MÊME en mode PDF brut.
      if (brIns) _brEnsureInsights(item, brIns, tagsEl, data.html);
      // PDF natif (proxifié) puis, à défaut, page rendable → rendu PDF serveur (Puppeteer). NOUVEAU : si
      // AUCUN n'aboutit, on NE tombe PLUS direct sur la carte « ouvrir l'original » → on POURSUIT vers le
      // rendu HTML de l'article ci-dessous (ex. Nordea : render Puppeteer KO mais le TEXTE est dispo →
      // on affiche l'article au lieu d'une carte vide). Carte externe = dernier recours seulement.
      if (data.pdfUrl) {
        content.innerHTML = dtpLoader('Chargement du PDF…');
        if (await _brEmbedPdf(item, _brPdfProxy(data.pdfUrl))) return;
        if (item.url && await _brEmbedPdf(item, '/api/pdf-render?url=' + encodeURIComponent(item.url))) return;
      }
      if (data.renderUrl) {
        content.innerHTML = dtpLoader('Préparation du PDF…');
        if (await _brEmbedPdf(item, '/api/pdf-render?url=' + encodeURIComponent(data.renderUrl))) return;
        // render serveur KO → bascule sur le rendu HTML de l'article (ne pas court-circuiter vers la carte)
      }
      const _inst = _instBadge(item);
      const isIngDoc = _inst === 'ING';
      // En-tête : VRAI logo de la banque (ING, MUFG, Goldman…) avec repli wordmark si indispo.
      const _tagline = _inst === 'ING' ? 'THINK economic and financial analysis'
        : _inst === 'DTP' ? 'Institutional research' : _inst + ' Research';
      const headerHtml = `<div class="br-ing-header">${_instLogoHtml(_inst)}<div class="br-ing-tagline">${_tagline}</div></div><div class="br-ing-divider"></div>`;
      const origLabel = isIngDoc ? 'Lire l\'original sur ING Think →' : 'Lire l\'original →';
      let _noEmbed = false;   // true = site protégé non extractible → carte propre, pas d'iframe vide
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
            <div class="br-doc-body${data.source === 'ai' ? ' br-structured' : ''}">${data.html}</div>

            <div class="br-doc-footer">
              <a href="${item.url}" target="_blank" rel="noopener" class="br-ext-link">${origLabel}</a>
            </div>
          </div>`;
      } else {
        // Extraction impossible (site protégé / anti-bot / login). On N'EMBARQUE PAS l'URL d'origine
        // en iframe : ces sites envoient X-Frame-Options / frame-ancestors → l'iframe reste un CADRE
        // VIDE (« ça ne s'affiche pas »). On affiche une carte PROPRE : en-tête + titre + aperçu +
        // bouton « Ouvrir le rapport original ». (Les Éclairages IA, panneau dédié, résument le rapport.)
        _noEmbed = true;
        const preview = (item.description || '').trim();
        const safe = (item.url || '').replace(/"/g, '&quot;');
        const typeLbl = _inst === 'DTP' ? 'Research' : _inst;
        content.innerHTML = `
          <div class="br-document">
            ${headerHtml}
            <div class="br-ing-meta"><span class="br-ing-type">${typeLbl}</span>${dateStr ? `<span class="br-ing-sep">|</span><span class="br-ing-date">${dateStr}</span>` : ''}</div>
            <div class="br-doc-title">${item.title}</div>
            ${preview ? `<div class="br-ing-lead">${preview}</div>` : ''}
            <div class="br-ext-card">
              <div class="br-ext-card-ic">🔒</div>
              <div class="br-ext-card-txt">Le texte intégral de ce rapport est hébergé par <strong>${typeLbl}</strong> et ne peut pas être intégré ici (le site en interdit l'affichage). Ouvrez le rapport original pour le lire en entier.</div>
              <a class="br-ext-card-btn" href="${safe}" target="_blank" rel="noopener">Ouvrir le rapport original ↗</a>
            </div>
          </div>`;
      }
      _brFinalizeReader(item, brIns, _noEmbed);   // images + insights + (PDF seulement si vrai contenu)
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
      _brFinalizeReader(item, brIns);
    });
}

// ════════════════════════════════════════════════════════════════════════════
// Rapport de banque (onglet Institution) → VRAI PDF généré côté client (jsPDF).
// 0 Mo serveur (anti-OOM Render), affiché en document embarqué comme DTP + téléchargeable.
// Repli HTML automatique si jsPDF indispo ou en cas d'erreur. Institution UNIQUEMENT.
// ════════════════════════════════════════════════════════════════════════════
let _brPdfState = null;   // { url, filename, html }

// Découpe le corps HTML rendu en sections {heading, blocks:[{type:'p'|'li', text}]}.
// Gère le format IA structuré (<strong>SECTION</strong><ul><li>…) ET le HTML brut (<h3>/<p>).
function _brExtractSections(body) {
  if (!body) return [];
  const sections = [];
  let cur = null;
  const ensure = () => { if (!cur) { cur = { heading: '', blocks: [] }; sections.push(cur); } return cur; };
  body.childNodes.forEach(node => {
    if (node.nodeType === 3) { const t = (node.textContent || '').replace(/\s+/g, ' ').trim(); if (t) ensure().blocks.push({ type: 'p', text: t }); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    const txt = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (tag === 'STRONG' || tag === 'B' || /^H[1-5]$/.test(tag)) { if (txt) { cur = { heading: txt, blocks: [] }; sections.push(cur); } }
    else if (tag === 'UL' || tag === 'OL') { node.querySelectorAll('li').forEach(li => { const t = (li.textContent || '').replace(/\s+/g, ' ').trim(); if (t) ensure().blocks.push({ type: 'li', text: t }); }); }
    else if (txt) ensure().blocks.push({ type: 'p', text: txt });
  });
  return sections;
}

function _brHexRgb(hex) {
  const h = String(hex || '#222').replace('#', '');
  return [parseInt(h.slice(0, 2), 16) || 34, parseInt(h.slice(2, 4), 16) || 34, parseInt(h.slice(4, 6), 16) || 34];
}
function _brLoadImg(src) {
  return new Promise(res => {
    if (!src) return res(null);
    const img = new Image();
    img.onload = () => res(img); img.onerror = () => res(null);
    img.src = src;
  });
}
function _brPdfFilename(label, title) {
  const slug = (title || 'rapport').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'rapport';
  return `${label || 'DTP'}-${slug}.pdf`;
}
function _brShortUrl(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }

// Construit le document PDF (A4) avec les primitives jsPDF : en-tête banque + logo, titre,
// sous-titre, sections (titre + puces), pied de page paginé. Pas de html2canvas (net + léger).
async function _brBuildPdf(doc) {
  const jsPDFns = window.jspdf && window.jspdf.jsPDF;
  const pdf = new jsPDFns({ unit: 'mm', format: 'a4', compress: true });
  const PW = 210, PH = 297, M = 18, CW = PW - M * 2, BOT = PH - 16;
  const brand = _brHexRgb(doc.brand);
  let y = M;
  const br = need => { if (y + need > BOT) { pdf.addPage(); y = M; } };

  // ── En-tête : logo + nom banque (gauche), date (droite) ──
  const img = await _brLoadImg(doc.logoUrl);
  let hx = M;
  if (img && img.width) {
    const lw = 13, lh = Math.min(13, lw * (img.height / img.width));
    try { pdf.addImage(img, 'PNG', M, y + 1, lw, lh); hx = M + lw + 4; } catch {}
  }
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(brand[0], brand[1], brand[2]);
  pdf.text(doc.label === 'DTP' ? 'DataTradingPro' : (doc.label + ' Research'), hx, y + 6);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(120, 120, 128);
  if (doc.tagline) pdf.text(doc.tagline, hx, y + 10.5);
  if (doc.date) { pdf.setFontSize(9); pdf.setTextColor(90, 90, 98); pdf.text(doc.date, PW - M, y + 6, { align: 'right' }); }
  y += 16;
  // Filet : segment de marque + fin gris
  pdf.setDrawColor(brand[0], brand[1], brand[2]); pdf.setLineWidth(0.9); pdf.line(M, y, M + 38, y);
  pdf.setDrawColor(214, 214, 218); pdf.setLineWidth(0.2); pdf.line(M + 39, y, PW - M, y);
  y += 7;
  // Meta : TYPE   PAYS
  const meta = [doc.metaType, doc.country].filter(Boolean).join('     ');
  if (meta) { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(140, 140, 148); pdf.text(meta.toUpperCase(), M, y); y += 6; }
  // Titre
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18); pdf.setTextColor(22, 22, 26);
  pdf.splitTextToSize(doc.title || '', CW).forEach(line => { br(9); pdf.text(line, M, y); y += 8; });
  y += 1;
  // Sous-titre (italique)
  if (doc.subtitle) {
    pdf.setFont('helvetica', 'italic'); pdf.setFontSize(11); pdf.setTextColor(95, 95, 104);
    pdf.splitTextToSize(doc.subtitle, CW).forEach(line => { br(6); pdf.text(line, M, y); y += 6; });
    y += 2;
  }
  y += 2;
  // Sections
  (doc.sections || []).forEach(sec => {
    if (sec.heading) {
      br(11); y += 2;
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(brand[0], brand[1], brand[2]);
      pdf.text(sec.heading.toUpperCase(), M, y); y += 6;
    }
    (sec.blocks || []).forEach(b => {
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(42, 42, 48);
      if (b.type === 'li') {
        pdf.splitTextToSize(b.text, CW - 5).forEach((line, i) => {
          br(5.4);
          if (i === 0) { pdf.setTextColor(brand[0], brand[1], brand[2]); pdf.text('•', M, y); pdf.setTextColor(42, 42, 48); }
          pdf.text(line, M + 5, y); y += 5.4;
        });
        y += 1.2;
      } else {
        pdf.splitTextToSize(b.text, CW).forEach(line => { br(5.4); pdf.text(line, M, y); y += 5.4; });
        y += 2.6;
      }
    });
    y += 2;
  });
  // Pieds de page paginés
  const n = pdf.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    pdf.setPage(i);
    pdf.setDrawColor(226, 226, 230); pdf.setLineWidth(0.2); pdf.line(M, PH - 12, PW - M, PH - 12);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(150, 150, 156);
    pdf.text(doc.sourceUrl ? ('Source : ' + _brShortUrl(doc.sourceUrl) + ' · DataTradingPro') : 'DataTradingPro', M, PH - 8);
    pdf.text(i + ' / ' + n, PW - M, PH - 8, { align: 'right' });
  }
  return pdf;
}

// Affiche le rapport courant en mode 'pdf' (iframe embarqué) ou 'text' (HTML d'origine).
function _brPdfShow(mode) {
  const content = document.getElementById('br-rcontent');
  if (!content || !_brPdfState) return;
  content.classList.add('br-rcontent--pdf');
  const bar = (lbl, action) =>
    `<div class="br-pdf-bar"><span class="br-pdf-bar-lbl">📄 Rapport PDF</span><span class="br-pdf-bar-actions">` +
    `<button type="button" class="br-pdf-btn" onclick="_brPdfDownload()">⬇ Télécharger</button>` +
    `<button type="button" class="br-pdf-btn" onclick="_brPdfShow('${action}')">${lbl}</button></span></div>`;
  if (mode === 'text') {
    content.innerHTML = bar('Afficher en PDF', 'pdf') + `<div class="br-pdf-textwrap">${_brPdfState.html}</div>`;
    _brFixImages(content);
  } else {
    content.innerHTML = bar('Afficher en texte', 'text') +
      `<iframe class="br-pdf-frame" src="${_brPdfState.url}#toolbar=0&navpanes=0&${window.innerWidth <= 768 ? 'view=FitH' : 'zoom=100'}" title="Rapport PDF"></iframe>`;
  }
  content.scrollTop = 0;
}
function _brPdfDownload() {
  if (!_brPdfState) return;
  const a = document.createElement('a');
  a.href = _brPdfState.url; a.download = _brPdfState.filename;
  document.body.appendChild(a); a.click(); a.remove();
}
window._brPdfShow = _brPdfShow; window._brPdfDownload = _brPdfDownload;

// Génère le PDF à partir du .br-document déjà rendu, puis l'affiche embarqué. Repli HTML si échec.
async function _brRenderAsPdf(item) {
  const content = document.getElementById('br-rcontent');
  if (!content) return;
  const docEl = content.querySelector('.br-document');
  const jsPDFns = window.jspdf && window.jspdf.jsPDF;
  if (!docEl || !jsPDFns) return;   // pas de lib / pas de doc → on conserve le HTML (repli)
  try {
    const html = content.innerHTML;   // sauvegarde pour le toggle "texte" + repli
    const label = _instBadge(item);
    const data = {
      label, brand: _instBrandColor(label),
      tagline: label === 'ING' ? 'THINK economic and financial analysis' : label === 'DTP' ? 'Institutional research' : label + ' Research',
      logoUrl: _BANK_LOCAL_LOGO[label] || null,
      title: (docEl.querySelector('.br-doc-title')?.textContent || item.title || '').trim(),
      metaType: (docEl.querySelector('.br-ing-type')?.textContent || '').trim(),
      date: (docEl.querySelector('.br-ing-date')?.textContent || '').trim(),
      country: (docEl.querySelector('.br-ing-country')?.textContent || '').trim(),
      subtitle: (docEl.querySelector('.br-ing-lead')?.textContent || '').trim(),
      sections: _brExtractSections(docEl.querySelector('.br-doc-body')),
      sourceUrl: item.url || '',
    };
    if (!data.sections.length && data.subtitle) data.sections = [{ heading: '', blocks: [{ type: 'p', text: data.subtitle }] }];
    if (!data.sections.length) return;   // rien de structuré → on garde le HTML (ex. aperçu vide)
    const pdf = await _brBuildPdf(data);
    const url = URL.createObjectURL(pdf.output('blob'));
    if (_brPdfState && _brPdfState.url) { try { URL.revokeObjectURL(_brPdfState.url); } catch {} }
    _brPdfState = { url, filename: _brPdfFilename(label, data.title), html };
    _brPdfShow('pdf');
  } catch (e) { console.warn('[BR-PDF] génération échouée → repli HTML', e); }
}

// Finalise le lecteur banque (images, insights) PUIS bascule en PDF embarqué.
function _brFinalizeReader(item, brIns, noContent) {
  const content = document.getElementById('br-rcontent');
  if (!content) return;
  _brFixImages(content);
  content.scrollTop = 0;
  const _full = (content.innerText || '').trim();
  // Rapport protégé (pas de vrai contenu) → pas d'insights bidon ni de PDF d'un avertissement :
  // on remplace le « Chargement des résumés… » (qui resterait bloqué) par un message clair.
  if (noContent) {
    if (brIns) brIns.innerHTML = '<div class="ai-ins-empty">Résumé indisponible : le contenu de ce rapport est protégé par la source. Ouvrez le rapport original pour le consulter.</div>';
    return;
  }
  if (brIns && _full.length > 200) _loadAIInsights({ id: item.id, headline: item.title, description: _full }, brIns);
  // Plus de génération jsPDF : un rapport SANS vrai PDF s'affiche en HTML propre (jamais un faux PDF reconstruit).
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
  'FX Daily Recap':            2,
  'FX Daily':                  2,
  'DTP Daily':                 2,
  'Asia Opening Preparation':  3,
  'London Opening Preparation':4,
  'US Opening Preparation':    5,
  'Daily Event Review':        6,
  'Daily Market Recap':        7,
};

// ── Standardisation éditoriale des titres : "[Préfixe de session fixe]: [Sujet dynamique]" ──
// Catalogue exact (réplique DataTradingPro). Le préfixe dépend du type de rapport OU de la
// session du wrap ; le sujet est extrait du titre (fallback si le préfixe est absent).
const REPORT_PREFIX = {
  'Global Economic Weekly':     'Global Economic Weekly',
  'Weekly Market Recap':        'Weekly Market Recap',
  'FX Daily Recap':             'FX Daily Recap',
  'FX Daily':                   'FX Daily',
  // 'DTP Daily' : PAS de préfixe → le headline « DTP Daily US Opening News - <date> » s'affiche tel quel
  // Sessions : nomenclature demandée
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
// Wrapper : le titre renvoyé est TOUJOURS sans markdown brut, quel que soit le chemin de retour
// (y compris le raccourci `aiTitle` des wraps InvestingLive qui contournait arlibCleanTitle).
// Traduction FR : appliquée UNIQUEMENT à l'affichage final du titre (les clés/détection restent EN).
const REPORT_PREFIX_FR = {
  'Global Economic Weekly': 'Hebdo Économique Mondial',
  'Weekly Market Recap': 'Récap Hebdo des Marchés',
  'FX Daily Recap': 'Récap FX Quotidien',
  'FX Daily': 'FX Quotidien',
  'Daily Asia-Pac Opening News': 'Ouverture Asie-Pacifique',
  'London Opening Preparation': 'Préparation Ouverture Londres',
  'New York Opening Preparation': 'Préparation Ouverture New York',
  'Asia-Pac Session Recap': 'Récap Séance Asie-Pacifique',
  'Asia-Pacific Session Recap': 'Récap Séance Asie-Pacifique',
  'Asia Session Recap': 'Récap Séance Asie',
  'London Session Recap': 'Récap Séance Londres',
  'New York Session Recap': 'Récap Séance New York',
  'US Session Recap': 'Récap Séance US',
  'Americas Session Recap': 'Récap Séance Amériques',
  'Daily Event Review': 'Revue Quotidienne des Événements',
  'Daily Market Recap': 'Récap Quotidien des Marchés',
};
const _REPORT_PREFIX_FR_KEYS = Object.keys(REPORT_PREFIX_FR).sort((a, b) => b.length - a.length);
function _reportTitleToFR(title) {
  if (!title) return title;
  for (const en of _REPORT_PREFIX_FR_KEYS) {
    if (title === en) return REPORT_PREFIX_FR[en];
    if (title.startsWith(en + ':') || title.startsWith(en + ' ')) return REPORT_PREFIX_FR[en] + title.slice(en.length);
  }
  return title;
}
// Retire un préfixe de date redondant DANS le titre (« … : La journée du mardi 14 juillet 2026 : … » ou en tête)
// — la date est déjà affichée à part (demande user). N'agit QUE si une année (20xx) précède le « : » → 0 faux positif.
function _stripTitleDateLead(t) {
  return String(t == null ? '' : t)
    .replace(/(^|:\s*)(?:la\s+)?(?:journée|séance|jour)\b[^:]{0,70}?\b20\d{2}\b[^:]{0,15}:\s*/i, '$1')
    .replace(/(^|:\s*)(?:le\s+|ce\s+)?(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b[^:]{0,45}?\b20\d{2}\b[^:]{0,15}:\s*/i, '$1')
    .trim();
}
function standardizeReportTitle(item) { return _stripTitleDateLead(_reportTitleToFR(_mdStrip(_stdReportTitleRaw(item)))); }
function _stdReportTitleRaw(item) {
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
  const wkCutoff = Date.now() - 80 * 24 * 60 * 60 * 1000;   // rapports HEBDO (Recap + GEW) gardés ~11 semaines → « le mois dernier » visible (demande user)
  // Session wraps InvestingLive…
  const wraps = (_sessionWraps || []).filter(i => i.timestamp > cutoff);
  // …+ UN SEUL Weekly Market Recap (le meilleur) : anti-doublon.
  // On rassemble tous les candidats (store /api/weekly-reports + flux temps réel), puis on n'en
  // garde QU'UN : priorité au format riche v2, puis au plus récent.
  const cand = [
    ...(_weeklyReports || []),
    ...(typeof allItems !== 'undefined' ? allItems : []).filter(i => i._reportType === 'Weekly Market Recap'),
  ].filter(i => i && i._reportType === 'Weekly Market Recap' && i.timestamp > wkCutoff);
  // On garde la MEILLEURE version de CHAQUE semaine (plus « une seule, la plus récente ») → l'HISTORIQUE des
  // semaines passées reste visible dans la liste (demande user « raffiche les anciens rapports »). Dédup par
  // semaine (weekEnding, sinon jour du timestamp) : v2 riche prioritaire, puis le plus récent.
  const recaps = _bestPerWeek(cand);
  // …+ Global Economic Weekly, MEILLEUR PAR SEMAINE aussi → visible par tous (endpoint /api/weekly-reports ouvert).
  const gewCand = (_weeklyReports || []).filter(i => i && i._reportType === 'Global Economic Weekly' && i.timestamp > wkCutoff);
  const gews = _bestPerWeek(gewCand);
  const best = recaps[0], bestGew = gews[0];   // (rétro-compat : _wkAnchorTs / autres usages du « meilleur » courant)
  // …+ UN SEUL FX Daily Recap (le plus récent) : rapport analyste QUOTIDIEN façon pro, servi par /api/weekly-reports.
  const bestFxr = (_weeklyReports || [])
    .filter(i => i && i._reportType === 'FX Daily Recap' && i._fxr && i.timestamp > cutoff)
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  // « DTP Daily US Opening News » : volontairement ABSENT de l'onglet Analyst (demande utilisateur) →
  // il vit UNIQUEMENT dans le flux News (Realtime Headline Ticker), déroulé en rapport complet au clic.
  // FX Daily (ING THINK) RETIRÉ de l'onglet Analyst (demande utilisateur) → on n'inclut plus _fxDaily.
  // Les 2 rapports hebdo (Weekly Market Recap + Global Economic Weekly) doivent rester GROUPÉS dans
  // la liste → on les ancre sur le timestamp du plus récent des deux (utilisé par _arlibReportSort).
  _wkAnchorTs = Math.max((best && best.timestamp) || 0, (bestGew && bestGew.timestamp) || 0);
  // Anti-doublon par CONTENU (URL, ou source+jour+titre) et plus seulement par id → un même rapport
  // servi avec un id différent (re-fetch, deux flux distincts) n'apparaît plus deux fois.
  return _dedupeReports([...recaps, ...gews, ...(bestFxr ? [bestFxr] : []), ...wraps])
    .sort(_arlibReportSort);
}
// Meilleure version PAR SEMAINE d'une liste de rapports hebdo (Weekly Recap OU GEW) : dédup par weekEnding
// (sinon jour du timestamp), format riche v2 prioritaire puis le plus récent. Renvoie 1 rapport / semaine,
// toutes les semaines conservées (historique). (demande user : anciens rapports ré-affichés)
function _bestPerWeek(items) {
  const byWk = new Map();
  (items || []).forEach(i => {
    if (!i) return;
    const wk = (i._weekly && (i._weekly.weekEnding || i._weekly.weekRange)) || new Date(i.timestamp || 0).toISOString().slice(0, 10);
    const prev = byWk.get(wk);
    if (!prev) { byWk.set(wk, i); return; }
    const iv = (i._weekly && i._weekly.v >= 2) ? 1 : 0, pv = (prev._weekly && prev._weekly.v >= 2) ? 1 : 0;
    if (iv !== pv ? iv > pv : (i.timestamp || 0) > (prev.timestamp || 0)) byWk.set(wk, i);
  });
  return [...byWk.values()];
}

// Tri façon pro (« comme sur l'image ») : STRICT anti-chronologique : le rapport le plus RÉCENT en
// haut, tous types confondus. EXCEPTION : les 2 rapports hebdo (Weekly Market Recap + Global Economic
// Weekly) restent COLLÉS : ancrés sur le même timestamp (_wkAnchorTs, le + récent des deux) → jamais
// séparés par les recaps de session, et ordonnés Weekly Recap puis Global Economic Weekly.
let _wkAnchorTs = 0;   // défini par getArlibItems juste avant le tri
function _isWeeklyReport(i) { return !!(i && (i._reportType === 'Weekly Market Recap' || i._reportType === 'Global Economic Weekly')); }
// Ancre PAR SEMAINE (fin de journée du samedi de publication) : le Weekly Recap ET le GEW d'une MÊME semaine
// partagent l'ancre (donc restent collés, en tête de leur journée), tandis que CHAQUE semaine passée garde sa
// propre place anti-chronologique. (Avant : une ancre GLOBALE unique remontait toutes les semaines ensemble.)
function _weeklyAnchor(i) { return Math.floor((i.timestamp || 0) / 86400000) * 86400000 + 86399999; }
function _arlibReportSort(a, b) {
  const wa = _isWeeklyReport(a), wb = _isWeeklyReport(b);
  const ka = wa ? _weeklyAnchor(a) : (a.timestamp || 0);
  const kb = wb ? _weeklyAnchor(b) : (b.timestamp || 0);
  if (ka !== kb) return kb - ka;                              // anti-chrono, ancre par semaine
  if (wa && wb) return (a._reportType === 'Weekly Market Recap' ? 0 : 1) - (b._reportType === 'Weekly Market Recap' ? 0 : 1);
  return (b.timestamp || 0) - (a.timestamp || 0);
}

function arlibItemType(item) {
  if (item._reportType === 'Weekly Market Recap' || item._reportType === 'Global Economic Weekly') return 'weekly';
  if (item._reportType === 'FX Daily Recap') return 'fxdaily';   // rapport analyste du jour (façon pro)
  if (item._source === 'ing-think') return 'fxdaily';     // ING Think = FX Daily
  if (item._source === 'investinglive') return 'recap';
  if (item._reportType === 'London Session Recap' || item._reportType === 'US Session Recap') return 'recap';
  if (item._reportType === 'Daily Event Review') return 'briefing';
  if (item.source === 'DTP' || item._briefing) return 'briefing';
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
  [/tariff|trade war|trade deal|import dut/,       'Tariffs'],   // « Trade » générique retiré → « Tariffs » (cohérent avec le feed)
  [/oil|crude|brent|opec|\bwti\b|energy|natural gas/, 'Oil'],
  [/gold|\bxau\b|silver|copper|metal/,             'Gold'],
  [/iran|russia|ukraine|israel|ceasefire|geopolit|war\b|missile|conflict/, 'Geopolitical'],
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
// Canonicalisation + déduplication des tags : empêche DÉFINITIVEMENT les quasi-doublons
// (ex. « Geopolitics » + « Geopolitical » côte à côte) : on garde « Geopolitical ». Dédup insensible à la casse.
function _canonTag(t) {
  t = String(t || '').trim();
  if (/^geopolitic/i.test(t)) return 'Geopolitical';
  return t;
}
function _dedupeTags(arr) {
  const seen = new Set(), out = [];
  for (let t of (arr || [])) { t = _canonTag(t); if (!t) continue; const k = t.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(t); } }
  return out;
}
function _tagsFromText(text, cap = 12) {
  const h = (text || '').toLowerCase();
  const out = [];
  for (const [rx, label] of _ARLIB_TAG_CHECKS) { if (rx.test(h) && out.length < cap) out.push(label); }
  return _dedupeTags(out);
}
function arlibItemTags(item) {
  const tags = _tagsFromText(item.headline + ' ' + (item.description || ''));
  const catCanon = _canonTag(item.category || '').toLowerCase();
  for (const raw of (item.tags || [])) {
    // Un « tag » peut être une LISTE collée « A, B, C » (catégories ING/recherche) → on l'éclate en
    // plusieurs tags distincts (split virgule/point-virgule ; on PRÉSERVE les « / » : EUR/USD, Trade/Tariffs).
    for (const t of String(raw).split(/\s*[,;]\s*/).map(s => s.trim()).filter(Boolean)) {
      if (['High','Medium','FinancialJuice','DTP'].includes(t) || _canonTag(t).toLowerCase() === catCanon) continue;
      if (tags.length < 12) tags.push(t);
    }
  }
  return _dedupeTags(tags).slice(0, 12);
}
// Nettoyage d'affichage des tags de rapport (demande user) : (1) MAJUSCULE initiale (« inflation » → « Inflation »,
// « pétrole » → « Pétrole ») ; (2) on MASQUE certains tags jugés inutiles (« FX Flows », « Energy & Power »,
// « Global News » + variantes FR). Retourne '' si le tag doit disparaître.
const _ARLIB_TAG_HIDE = new Set(['fx flows', 'flux fx', 'energy & power', 'énergie', 'energie', 'global news', 'actualités mondiales', 'actualites mondiales']);
function _arlibTagClean(t) {
  const s = String(t == null ? '' : t).trim();
  if (!s || _ARLIB_TAG_HIDE.has(s.toLowerCase())) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
// Tags du rapport OUVERT (liste complète) + rendu façon DTP : 6 pills max + "+N", puis
// date + badge DTP à droite de la barre.
let _arlibCurrentTags = [];
function _renderArlibTags() {
  const scroll = document.getElementById('arlib-rtags-scroll');
  const tags = _arlibCurrentTags || [];
  if (scroll) {
    // Façon DTP : TOUS les tags dans une rangée scrollable (chevrons ‹ ›), sans troncature "+N".
    scroll.innerHTML = tags.map(_arlibTagClean).filter(Boolean).map(t => `<span class="arlib-rtag">${t}</span>`).join('');
    scroll.scrollLeft = 0;
  }
  // Date retirée de cette rangée (façon DTP : ‹ tags › ; le badge DTP reste dans la barre du haut).
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
// Masque les chevrons s'il n'y a rien à faire défiler ; sinon les affiche (façon DTP)
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
  return _mdStrip((headline || '')
    .replace(/^\s*(?:PRIMER\s*[—–-]|PREVIEW\s*[—–-]|ANALYSIS\s*[—–-])\s*/i, '')
    .replace(/^\s*investingLive\s*/i, '')
    .trim());
}

// ── Render card list ──────────────────────────────────────────────────────────

let _arlibRows = {};   // id -> item : clic délégué sur les lignes du tableau (rendu via innerHTML)
// Skeleton catalogue Analyste : memes colonnes (bookmark/date/titre/institut) que .arlib-table, ~10 lignes.
// Injecte dans #arlib-list tant qu'aucune source n'est chargee -> auto-efface par le renderArlibList() plein.
function _arlibSkel() {
  let rows = '';
  for (let i = 0; i < 10; i++) {
    rows += '<tr class="arl-row arl-skel-row" aria-hidden="true">'
      + '<td class="arl-c-bm"><span class="dtp-skel arl-skel-bm"></span></td>'
      + '<td class="arl-c-date"><span class="dtp-skel"></span></td>'
      + '<td class="arl-c-title"><div class="arl-tw"><span class="dtp-skel arl-skel-ico"></span><span class="dtp-skel arl-skel-ttl"></span></div></td>'
      + '<td class="arl-c-inst"><span class="dtp-skel arl-skel-inst"></span></td></tr>';
  }
  return '<table class="arlib-table"><colgroup>'
    + '<col class="arl-col-bm"><col class="arl-col-date"><col class="arl-col-title"><col class="arl-col-inst"></colgroup>'
    + '<thead><tr><th class="arl-th"></th><th class="arl-th">Date</th><th class="arl-th">Titre</th><th class="arl-th arl-th-c">Institut</th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table>';
}
function renderArlibList() {
  const list = document.getElementById('arlib-list');
  if (!list) return;
  _ensureReadLoaded();   // 1re fois : fusionne l'état « lu » PAR COMPTE (cross-device) puis re-rend

  let items = getArlibItems();
  const _total = items.length;
  if (_arlibType   !== 'all') items = items.filter(i => arlibItemType(i) === _arlibType);
  if (_arlibCat    !== 'all') items = items.filter(i => i.category === _arlibCat);
  if (_arlibSearch)           items = items.filter(i =>
    (i.headline || '').toLowerCase().includes(_arlibSearch) ||
    (i.description || '').toLowerCase().includes(_arlibSearch));

  // Pied (français, texte blanc, façon pro) : « Affichage de N sur M rapports de recherche »
  const _foot = document.getElementById('arlib-foot');
  if (_foot) _foot.textContent = 'Affichage de ' + items.length + ' sur ' + _total + ' rapport' + (_total > 1 ? 's' : '') + ' de recherche';

  if (items.length === 0) {
    // Aucune source encore chargee (fetch session-wraps + weekly-reports en cours) -> SKELETON ;
    // sinon (sources chargees mais liste vide/filtree) -> etat vide existant.
    const _loadingArl = !(_sessionWraps && _sessionWraps.length) && !(_weeklyReports && _weeklyReports.length);
    list.innerHTML = _loadingArl ? _arlibSkel() : '<div class="arlib-empty">Aucun rapport trouvé.<br>Générez des briefings ou attendez la prochaine génération programmée.</div>';
    return;
  }

  // ── Rendu en TABLEAU institutionnel (Date | Titre | Institut), façon terminal pro ──
  _arlibRows = {};
  const _e = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const _GLOBE = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><line x1="2" y1="12" x2="22" y2="12"/></svg>';
  const _BM = '<svg width="12" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>';
  let _rows = '';
  for (const item of items) {
    _arlibRows[item.id] = item;
    const read    = isRead(_reportReadKey(item));
    const dateStr = new Date(item.timestamp).toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit', year:'2-digit' });
    const title   = standardizeReportTitle(item);
    // Recaps hebdo (Weekly Market Recap + Global Economic Weekly) → ligne ROUGE (façon news importantes).
    const _isWeekly = item._reportType === 'Weekly Market Recap' || item._reportType === 'Global Economic Weekly';
    // Logo institut : rapports DTP + session wraps + FX Daily (ING Think) → favicon DTP ; sinon rien.
    const hasLogo = item.source === 'DTP' || item._briefing || isPrimerItem(item) || item._source === 'ing-think' || item._source === 'investinglive';
    const inst    = hasLogo ? '<img class="arl-inst-logo" src="/favicon.svg" alt="DTP" loading="lazy">' : '';
    _rows += `<tr class="arl-row${_isWeekly ? ' arl-row--weekly' : ''}${read ? ' arl-row--read' : ''}" data-id="${_e(item.id)}">`
      + `<td class="arl-c-bm"><span class="arl-bm">${_BM}</span></td>`
      + `<td class="arl-c-date">${_e(dateStr)}</td>`
      + `<td class="arl-c-title"><div class="arl-tw"><span class="arl-ico">${_GLOBE}</span><span class="arl-ttl" title="${_e(title).replace(/"/g, '&quot;')}">${_e(title)}</span></div></td>`
      + `<td class="arl-c-inst">${inst}</td></tr>`;
  }
  list.innerHTML = '<table class="arlib-table"><colgroup>'
    + '<col class="arl-col-bm"><col class="arl-col-date"><col class="arl-col-title"><col class="arl-col-inst"></colgroup>'
    + '<thead><tr><th class="arl-th"></th><th class="arl-th">Date</th><th class="arl-th">Titre</th><th class="arl-th arl-th-c">Institut</th></tr></thead>'
    + '<tbody>' + _rows + '</tbody></table>';
}

// Clic délégué sur une ligne du tableau Analyst → ouvre le rapport (rendu via innerHTML)
document.addEventListener('click', (ev) => {
  const row = ev.target.closest && ev.target.closest('#arlib-list .arl-row');
  if (!row) return;
  const item = _arlibRows[row.dataset.id];
  if (!item) return;
  markRead(_reportReadKey(item));
  row.classList.add('arl-row--read');
  renderArlibReader(item);
  arlibShowReader();
});

// ── Reader ────────────────────────────────────────────────────────────────────

// Charge et affiche les Éclairages IA (cartes) d'un rapport via Gemini
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
    el.innerHTML = `<div class="ai-insights-head"><span class="ai-insights-title"><img class="ai-insights-logo" src="/assets/images/macro-ai-spark.svg" alt="Copilote Macro" width="20" height="20" decoding="sync"> Éclairages IA</span></div><div class="ai-insights-loading">Chargement des résumés…</div>`;
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
    } catch { d = null; }   // échec réseau/serveur/quota → on NE VIDE PAS : on retombe sur le SECOURS extractif ci-dessous (cartes = puces du rapport)
  }
  {
    if (!d || !d.insights || !d.insights.length) {
      // FILET CLIENT : le serveur n'a renvoyé AUCUN insight (IA vide + secours serveur vide) → on NE VIDE
      // PAS le panneau. On fabrique des cartes extractives à partir des PUCES du rapport (item.lines) ou, à
      // défaut, du TEXTE rendu. Ainsi les « Éclairages IA » ne disparaissent JAMAIS quand il y a du contenu
      // (corrige les rapports Analyst au panneau vide, quel que soit le format/le quota IA).
      const _ttl  = String(item.headline || item.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const _cand = (Array.isArray(item.lines) && item.lines.length) ? item.lines : String(text || '').split(/(?<=[.!?])\s+|\n+/);
      const _seen = new Set(), _fb = [];
      for (let s of _cand) {
        s = String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().replace(/\s*(?:…|\.{2,})\s*$/, '').trim();
        if (s.length < 26 || !/[a-z]/i.test(s)) continue;
        const n = s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (_ttl.length > 10 && n.startsWith(_ttl.slice(0, 40))) continue;   // jamais le titre en 1re carte
        if (_seen.has(n)) continue; _seen.add(n);
        _fb.push(s); if (_fb.length >= 8) break;
      }
      if (!_fb.length) { el.innerHTML = ''; return; }   // vraiment aucun contenu → on laisse vide
      d = { insights: _fb.map(t => ({ asset: null, signal: null, text: t })) };
    }
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const mdb = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*+/g, '');   // échappe PUIS rend **gras** + retire tout astérisque résiduel → jamais d'astérisques brutes
    // Cartes : en-tête optionnel (actif + badge signal BUY/SELL/NEUTRAL), comme DataTradingPro.
    const cards = d.insights.map(ins => {
      if (typeof ins === 'string') return `<div class="ai-insights-card"><div class="ai-card-text">${mdb(ins)}</div></div>`;
      const asset = ins.asset || '';
      let sig = String(ins.signal || ins.bias || '').toUpperCase();
      if (sig === 'BULLISH') sig = 'BUY'; else if (sig === 'BEARISH') sig = 'SELL';
      if (!['BUY', 'SELL', 'NEUTRAL'].includes(sig)) sig = '';
      const head = asset
        ? `<div class="ai-card-head"><span class="ai-card-asset">${esc(asset)}</span>${sig ? `<span class="ai-bias ai-bias--${sig.toLowerCase()}">${({BUY:'ACHAT',SELL:'VENTE',NEUTRAL:'NEUTRE'}[sig]||sig)}</span>` : ''}</div>`
        : '';
      return `<div class="ai-insights-card">${head}<div class="ai-card-text">${mdb(ins.text || '')}</div></div>`;
    }).join('');
    const chip = `<img class="ai-insights-logo" src="/assets/images/macro-ai-spark.svg" alt="Copilote Macro" width="20" height="20">`;
    // Cartes en ligne SCROLLABLE (comme l'onglet Analyst) : défilement manuel via les flèches
    el.innerHTML = `<div class="ai-insights-head">
        <span class="ai-insights-title">${chip} Éclairages IA</span>
        <span class="ai-insights-nav">
          <button type="button" onclick="aiInsScroll(this,-1)">‹</button>
          <span class="ai-insights-count"></span>
          <button type="button" onclick="aiInsScroll(this,1)">›</button>
        </span>
      </div>
      <div class="ai-insights-cards">${cards}</div>`;
    const cardsEl = el.querySelector('.ai-insights-cards');
    if (cardsEl) {
      cardsEl.addEventListener('scroll', () => _aiInsCount(cardsEl), { passive: true });
      requestAnimationFrame(() => _aiInsCount(cardsEl));   // pagination "1-N of M" façon DTP
    }
  }
}
// Compteur de pagination "1-3 of 10" : mis à jour selon la position de défilement du carrousel
function _aiInsCount(cardsEl) {
  if (!cardsEl) return;
  const head = cardsEl.previousElementSibling;
  const countEl = head && head.querySelector('.ai-insights-count');
  if (!countEl) return;
  const total = cardsEl.children.length;
  if (!total) { countEl.textContent = ''; return; }
  const first = cardsEl.firstElementChild;
  const step = first ? (first.getBoundingClientRect().width + 12) : 292;   // largeur carte + gap
  const per = Math.max(1, Math.round(cardsEl.clientWidth / step));
  const start = Math.min(total, Math.round(cardsEl.scrollLeft / step) + 1);
  const end = Math.min(total, start + per - 1);
  countEl.textContent = `${start}-${end} sur ${total}`;
}

// Défilement des cartes Éclairages IA via les flèches (scopé au panneau cliqué)
function aiInsScroll(btn, dir) {
  const c = btn?.closest('.ai-insights-head')?.nextElementSibling;
  if (c) c.scrollBy({ left: dir * 290, behavior: 'smooth' });
}

// Icônes œil (propres, style PT)
const _EYE_OFF = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';
const _EYE     = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';

// Afficher / masquer la grille de cartes Éclairages IA (cible paramétrable : Analyst ou Institution)
function aiInsToggle(btn, hostId) {
  const host = document.getElementById(hostId || 'arlib-ai-insights');
  // Cible la rangée de cartes ; NO-OP tant qu'elle n'existe pas (pendant le chargement) → ne hide JAMAIS
  // tout le panneau (sinon les insights, alimentés en async, ne réapparaîtraient plus). Les cartes existent
  // dès que _loadAIInsights a fini (insights nourris par le contenu complet du rapport) → le bouton fonctionne.
  const c = host ? host.querySelector('.ai-insights-cards') : document.getElementById('ai-insights-cards');
  if (!c) return;
  const willHide = c.style.display !== 'none';
  c.style.display = willHide ? 'none' : '';
  btn.innerHTML = willHide ? `${_EYE} Afficher Insights` : `${_EYE_OFF} Masquer Insights`;
}

// ═══════════ WEEKLY MARKET RECAP : rendu riche (copie DataTradingPro) ═══════════
function _wrEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
// **gras** → <strong> (jamais d'astérisques brutes), PUIS on retire tout astérisque résiduel
// (marqueur non apparié d'un ancien rapport en cache) → plus aucun ** ne peut apparaître.
function _wrInline(t){
  var s = String(t == null ? '' : t)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');   // décode les entités pré-échappées → fini le « S&amp;P » brut affiché
  s = s.replace(/^\s*\*\*\s*sous-th[eè]me\s*:?\s*\*\*\s*:?\s*/i, '')
       .replace(/^\s*sous-th[eè]me\s*:\s*/i, '');   // retire le placeholder « Sous-thème : » laissé LITTÉRALEMENT par l'IA (bug) → puce nette
  return _wrEsc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*+/g, '');
}
function _wrParas(t){
  return String(t||'').split(/\n{2,}|\n/).map(p=>p.trim()).filter(Boolean)
    .map(p=>`<p class="wr-p">${_wrInline(p)}</p>`).join('');
}
// Colore le TAG D'INTERPRÉTATION en fin de puce (« → dovish », « → beat hawkish », « → inline »… façon
// référence Eliott) : lecture instantanée. hawkish/beat = ambre · dovish/baisse = bleu · neutre = or discret.
function _wrTagColorize(html){
  return String(html).replace(/\s(?:→|-&gt;|-&amp;gt;)\s*([^<]{1,60})$/, function(_m, tag){
    var low = tag.toLowerCase();
    // PRIORITÉ : les mots explicites dovish/hawkish priment sur les mots directionnels ambigus
    // (« dovish forte » = dove, pas hawk à cause de « fort »).
    var cls = /dov|assoupl/.test(low) ? 'wr-tag--dove'
            : /hawk|resserr/.test(low) ? 'wr-tag--hawk'
            : /\bbaisse|\bmiss\b|faible|d[ée]c[ée]l|en\s+dessous|surprise\s+à\s+la\s+baisse/.test(low) ? 'wr-tag--dove'
            : /\bhausse|beat|\bfort|solide|au-dessus|surprise\s+à\s+la\s+hausse/.test(low) ? 'wr-tag--hawk'
            : 'wr-tag--neut';
    return ' <span class="wr-tag ' + cls + '">→ ' + tag.trim() + '</span>';
  });
}

const _WR_ORDER = ['USD','EUR','JPY','GBP','CHF','AUD','CAD','NZD'];
const _WR_COLOR = { USD:'#e3b23a', EUR:'#dc2626', JPY:'#06b6d4', GBP:'#22c55e', AUD:'#2563eb', CHF:'#eab308', CAD:'#a855f7', NZD:'#ec4899' };
// Biais fondamental FR (5 niveaux) → classe sémantique DTP (vert→rouge) pour le badge par devise (v34).
function _wrBiasCls(b){ b = String(b||'').toLowerCase(); if (/tr[eè]s\s+hauss/.test(b)) return 'vbull'; if (/hauss/.test(b)) return 'bull'; if (/tr[eè]s\s+baiss/.test(b)) return 'vbear'; if (/baiss/.test(b)) return 'bear'; return 'neu'; }
// GEW : noms de jour/mois EN→FR (le serveur date en anglais « Monday 22 June ») → plus clair pour le public FR.
const _GEW_DOW_FR = { Monday:'Lundi', Tuesday:'Mardi', Wednesday:'Mercredi', Thursday:'Jeudi', Friday:'Vendredi', Saturday:'Samedi', Sunday:'Dimanche' };
const _GEW_MON_FR = { January:'janvier', February:'février', March:'mars', April:'avril', May:'mai', June:'juin', July:'juillet', August:'août', September:'septembre', October:'octobre', November:'novembre', December:'décembre' };
function _gewDayFr(s){ return String(s||'').replace(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/g, m=>_GEW_DOW_FR[m]||m).replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/g, m=>_GEW_MON_FR[m]||m); }
function _gewWeekFr(s){ return _gewDayFr(String(s||'')).replace(/^\s*Week of\b/i, 'Semaine du').replace(/^\s*Week ahead\b/i, 'Semaine à venir'); }
let _wrStrengthData = null;     // données de force (TW) chargées 1 seule fois pour tout le rapport
let _wrChartObserver = null;

// Rapport complet, lu de haut en bas (PAS de badges) : Éclairages IA → Résumé → Points Macro Clés
// → Currency Analysis (chaque devise à la suite : analyse + courbe ISOLÉE + drivers).
// ── Section Banques Centrales NIVEAU INSTITUTIONNEL (Weekly Recap v18) : 4 majeures en bloc complet
//    (Fed/BCE/BoE/BoJ) + 4 breves (BoC/RBA/RBNZ/SNB). Donnees = w.centralBanks enrichi cote serveur
//    (bias5 + scenario proba MARCHE + prochaine reunion + changed/factors/fxImpact + propos). ──
const _WR_CB_BIAS_CLS = { 'Très hawkish': 'vhawk', 'Hawkish': 'hawk', 'Neutre': 'neu', 'Dovish': 'dov', 'Très dovish': 'vdov' };
const _WR_CB_MAJORS = { USD: 1, EUR: 1, GBP: 1, JPY: 1 };
function _wrCbNextFr(next, nextDays) {
  if (!next) return 'à confirmer';
  try { const d = new Date(next + 'T00:00:00'); const s = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); return s + (nextDays != null ? ` (dans ${nextDays} j)` : ''); } catch { return next; }
}
function _wrCbMoveLbl(move) { return move === 'HIKE' ? 'trajectoire ~6 mois : penche vers une hausse' : move === 'CUT' ? 'trajectoire ~6 mois : penche vers une baisse' : 'trajectoire ~6 mois : stable'; }
// Étiquette honnête de la SOURCE des probas : marché (rateprobability) vs estimation maison DTP (ex. SNB/RBNZ non cotés).
function _wrCbSrc(source) { return (source && source !== 'market') ? '<span class="wr-cb-src" title="Estimation maison DTP : ce taux n\'est pas coté sur le marché des probabilités">est. maison</span>' : ''; }
function _wrCbProbaBar(sc) {
  if (!sc) return '';
  const h = Math.round(sc.hike || 0), o = Math.round(sc.hold || 0), c = Math.round(sc.cut || 0);
  return `<div class="wr-cb-proba">
      <span class="wr-cb-prob"><i class="wr-cb-dot wr-cb-dot--hike"></i>Hausse <b>${h}%</b></span>
      <span class="wr-cb-prob"><i class="wr-cb-dot wr-cb-dot--hold"></i>Maintien <b>${o}%</b></span>
      <span class="wr-cb-prob"><i class="wr-cb-dot wr-cb-dot--cut"></i>Baisse <b>${c}%</b></span>
    </div>
    <div class="wr-cb-bar"><i class="wr-cb-bar--hike" style="width:${h}%"></i><i class="wr-cb-bar--hold" style="width:${o}%"></i><i class="wr-cb-bar--cut" style="width:${c}%"></i></div>`;
}
// Attente pour la PROCHAINE réunion (mot + proba dominante) depuis le scénario marché, sinon la trajectoire.
function _wrCbCall(c) {
  const sc = c.scenario;
  if (sc) {
    const hi = Math.round(sc.hike || 0), ho = Math.round(sc.hold || 0), cu = Math.round(sc.cut || 0);
    const top = Math.max(hi, ho, cu);
    const word = top === hi ? 'hausse' : top === cu ? 'baisse' : 'maintien';
    return `${word} attendu (${top}%)`;
  }
  return c.move === 'HIKE' ? 'penche vers une hausse' : c.move === 'CUT' ? 'penche vers une baisse' : 'maintien attendu';
}
// Section Banques Centrales EN LISTE (demande user) : par banque, du + important au meeting le + proche —
// décision de la semaine (+ phrase du discours), attente prochaine réunion (hausse/baisse/maintien) + guidance, propos.
// Banques Centrales EN LISTE À PUCES (demande user : cohérence avec les autres parties) : même titre
// (wr-macro-heading) et mêmes puces (wr-bullet) que les Points Macro. 1 puce/banque : biais + prochaine
// réunion (hausse/baisse/maintien) + guidance + propos, en ligne. Ordre serveur (important -> meeting proche).
function _wrCbSection(cbs) {
  // Section BC : ORDRE CHRONOLOGIQUE (réunion la plus proche d'abord). On retire les probas ESTIMATION MAISON
  // (non cotées). Le MASQUAGE des réunions à > 2 semaines a été ANNULÉ (demande user « finalement annule ça,
  // remet-le ») → on garde TOUTES les banques, même celles dont le meeting est lointain.
  const list = (cbs || []).filter(c => c && c.bank && !(c.source && c.source !== 'market'))
    .slice().sort((a, b) => (a.nextDays == null ? 9999 : a.nextDays) - (b.nextDays == null ? 9999 : b.nextDays));
  if (!list.length) return '';
  // STRUCTURE PROPRE façon chronologie (demande user) : deux colonnes — nom + badge à GAUCHE, contenu à
  // DROITE (prochaine réunion · guidance · citation). Banques INTERVENUES (avec propos) = ligne complète ;
  // les autres = juste nom + prochaine réunion (l'ordre serveur met les intervenues en tête).
  let h = `<div class="wr-macro-heading">Banques Centrales &amp; Politique Monétaire</div><div class="wr-cb">`;
  list.forEach(c => {
    const bcls = _WR_CB_BIAS_CLS[c.bias5] || 'neu';
    const nextFr = _wrCbNextFr(c.next, c.nextDays);
    const q = (c.quotes && c.quotes.length) ? c.quotes[0] : null;
    const ctx = q ? (c.guidance || c.decision || c.narrative) : '';   // 1 ligne de contexte, uniquement si la banque s'est exprimée
    const attr = q ? [q.date, q.speaker].filter(Boolean).map(_wrEsc).join(' — ') : '';   // date EN TÊTE (demande user : « lundi 05 juillet — Breeden : … »)
    h += `<div class="wr-cb-row">`
      + `<div class="wr-cb-name"><strong>${_wrEsc(c.bank)}</strong> <span class="wr-cb-tag wr-cb-tag--${bcls}">${_wrEsc(c.bias5 || 'Neutre')}</span>${_wrCbSrc(c.source)}</div>`
      + `<div class="wr-cb-body">`
      +   `<div class="wr-cb-next">Prochaine réunion <b>${_wrEsc(nextFr)}</b> · ${_wrEsc(_wrCbCall(c))}</div>`
      +   (ctx ? `<div class="wr-cb-guid">${_wrInline(ctx)}</div>` : '')
      +   (q ? `<div class="wr-cb-quote-line">${attr ? `<b>${attr} :</b> ` : ''}« ${_wrEsc(q.quote)} »</div>` : '')
      + `</div></div>`;
  });
  return h + `</div>`;
}
// ── Section Calendrier économique du Weekly Recap (v18) : À VENIR (majeurs, + proche d'abord) puis
//    CETTE SEMAINE (passés). Réutilise les styles gew-* + drapeau/devise à gauche façon calendrier. ──
const _WR_CAL_ISO = { USD: 'us', EUR: 'eu', GBP: 'gb', JPY: 'jp', CHF: 'ch', CAD: 'ca', AUD: 'au', NZD: 'nz', CNY: 'cn' };
function _wrCalFlag(ccy) { const c = String(ccy || '').toUpperCase(); const iso = _WR_CAL_ISO[c]; return (iso ? `<img class="wr-cal-flag" src="https://flagcdn.com/w20/${iso}.png" alt="" width="18" height="13">` : '') + (c ? `<span class="wr-cal-ccy">${_wrEsc(c)}</span>` : ''); }
function _wrCalImpCls(i) { const u = String(i || '').toUpperCase(); return u === 'HIGH' ? 'high' : (u === 'MED' || u === 'MEDIUM') ? 'med' : 'low'; }
function _wrCalImpLbl(i) { const u = String(i || '').toUpperCase(); return u === 'HIGH' ? 'FORT' : (u === 'MED' || u === 'MEDIUM') ? 'MOYEN' : ''; }
function _wrCalDays(days, showActual) {
  return (days || []).map(d => {
    const evs = (d.events || []).map(e => {
      const nums = [];
      if (showActual && e.actual) nums.push(`<span class="gew-cons gew-cons--actual"><i>Réel</i><b>${_wrEsc(e.actual)}</b></span>`);
      if (e.forecast) nums.push(`<span class="gew-cons"><i>Consensus</i><b>${_wrEsc(e.forecast)}</b></span>`);
      if (e.previous) nums.push(`<span class="gew-cons"><i>Précédent</i><b>${_wrEsc(e.previous)}</b></span>`);
      return `<div class="gew-ev gew-ev--${_wrCalImpCls(e.impact)}"><div class="gew-ev-top">`
        + `<span class="gew-ev-time">${_wrEsc(e.time || '')}</span>`
        + `<span class="wr-cal-flagcell">${_wrCalFlag(e.ccy)}</span>`
        + `<span class="gew-ev-ttl">${_wrEsc(e.title)}</span>`
        + (e.impact ? `<span class="gew-imp gew-imp--${_wrCalImpCls(e.impact)}">${_wrEsc(_wrCalImpLbl(e.impact))}</span>` : '')
        + `</div>${nums.length ? `<div class="gew-ev-cons">${nums.join('')}</div>` : ''}</div>`;
    }).join('');
    return evs ? `<div class="gew-day"><div class="gew-day-h">${_wrEsc(d.dayLabel)}</div>${evs}</div>` : '';
  }).join('');
}
function _wrCalSection(cal) {
  if (!cal || (!(cal.upcoming || []).length && !(cal.past || []).length)) return '';
  let h = `<div class="wr-section-title">Calendrier économique</div>`
    + `<div class="wr-cb-intro">Les prochains rendez-vous majeurs (à venir, du plus proche au plus éloigné), puis les données déjà publiées de la semaine.</div>`;
  if ((cal.upcoming || []).length) h += `<div class="wr-cal-sub">À venir</div>` + _wrCalDays(cal.upcoming, false);
  if ((cal.past || []).length) h += `<div class="wr-cal-sub">Cette semaine (publié)</div>` + _wrCalDays(cal.past, true);
  return h;
}
// Drapeau pour le calendrier du Global Economic Weekly : mappe le NOM DE PAYS (ou la devise) -> ISO2 flagcdn.
const _GEW_CTRY_ISO = { 'united states': 'us', 'united kingdom': 'gb', 'euro area': 'eu', eurozone: 'eu', 'euro zone': 'eu', germany: 'de', france: 'fr', italy: 'it', spain: 'es', netherlands: 'nl', switzerland: 'ch', swiss: 'ch', japan: 'jp', canada: 'ca', australia: 'au', 'new zealand': 'nz', china: 'cn', britain: 'gb' };
const _GEW_CCY_ISO = { USD: 'us', EUR: 'eu', GBP: 'gb', JPY: 'jp', CHF: 'ch', CAD: 'ca', AUD: 'au', NZD: 'nz', CNY: 'cn' };
function _gewFlag(country, ccy) {
  const s = String(country || '').toLowerCase().trim();
  let iso = ({ us: 'us', uk: 'gb', eu: 'eu' })[s] || null;                 // codes courts exacts
  if (!iso) for (const k in _GEW_CTRY_ISO) { if (s === k || s.includes(k)) { iso = _GEW_CTRY_ISO[k]; break; } }
  if (!iso && ccy) iso = _GEW_CCY_ISO[String(ccy).toUpperCase()] || null;   // repli devise
  return iso ? `<img class="gew-flag" src="https://flagcdn.com/w20/${iso}.png" alt="" width="18" height="13">` : '';
}
function _renderWeeklyRecap(item) {
  const w = item._weekly || {};
  const titleEl    = document.getElementById('arlib-rnav-title');
  const tagsScroll = document.getElementById('arlib-rtags-scroll');
  const content    = document.getElementById('arlib-rcontent');
  const navRight   = document.querySelector('#arlib-reader-view .arlib-rnav-right');
  if (!content) return;
  document.getElementById('arlib-ai-insights')?.remove();

  const _range = w.weekRange || (w.weekEnding ? `Week Ending: ${w.weekEnding}` : '');
  // strip markdown (**gras**, *, `, _) du titre → jamais d'astérisques brutes affichées
  const _wrTitle = _mdStrip(w.gew ? _reportTitleToFR(String(w.title || 'Global Economic Weekly')) : standardizeReportTitle({ _reportType: 'Weekly Market Recap', headline: w.title }));
  // Barre de navigation : titre seul (le "Week Ending: …" reste sous le titre dans le corps,
  // via .wr-doc-week : l'afficher aussi ici cassait la mise en page).
  if (titleEl) titleEl.textContent = _wrTitle;
  if (navRight) navRight.innerHTML = `<button class="arlib-hide-insights" onclick="aiInsToggle(this)">${_EYE_OFF} Masquer Insights</button><span class="arlib-dtp-badge">DTP</span>`;
  if (tagsScroll) tagsScroll.innerHTML = '';   // pas de badges : rapport lu de haut en bas
  // La période (semaine) va dans le créneau date en haut-droite, comme tous les autres rapports →
  // on peut retirer le gros bloc titre du corps sans perdre l'info de période.
  const _rdateEl = document.getElementById('arlib-rdate');
  if (_rdateEl) _rdateEl.textContent = w.gew ? _gewWeekFr(w.weekRange || '') : (w.weekEnding ? ('Week Ending: ' + w.weekEnding) : _range);

  // Éclairages IA (composant Institution, alimenté par les insights Gemini du recap)
  const chip = `<img class="ai-insights-logo" src="/assets/images/macro-ai-spark.svg" alt="Copilote Macro" width="20" height="20">`;
  // Cartes : insights thématiques (texte) PUIS paires/instruments avec badge de biais (SELL/BUY/NEUTRAL)
  // _wrInline (pas _wrEsc) → le markdown **gras** de l'IA est rendu en <strong>, jamais affiché brut.
  const textCards = (w.insights || []).map(t => `<div class="ai-insights-card">${_wrInline(typeof t === 'string' ? t : (t.text || ''))}</div>`);
  const pairCards = (w.pairs || []).map(p => {
    const b = String(p.bias || 'NEUTRAL').toUpperCase();
    const cls = b === 'BUY' ? 'buy' : b === 'SELL' ? 'sell' : 'neutral';
    return `<div class="ai-insights-card ai-ins-pair">
      <div class="ai-ins-pair-head"><span class="ai-ins-pair-name">${_wrEsc(p.pair)}</span><span class="ai-ins-bias ai-ins-bias--${cls}">${_wrEsc({BUY:'ACHAT',SELL:'VENTE',NEUTRAL:'NEUTRE'}[b]||b)}</span></div>
      <div class="ai-ins-pair-text">${_wrInline(p.text || '')}</div>
    </div>`;
  });
  const allCards = [...textCards, ...pairCards];
  const insightsHtml = allCards.length ? `
    <div id="arlib-ai-insights">
      <div class="ai-insights-head">
        <span class="ai-insights-title">${chip} Éclairages IA</span>
        <span class="ai-insights-nav">
          <button type="button" onclick="aiInsScroll(this,-1)">‹</button>
          <span class="ai-insights-count">${allCards.length} éclairages</span>
          <button type="button" onclick="aiInsScroll(this,1)">›</button>
        </span>
      </div>
      <div class="ai-insights-cards">${allCards.join('')}</div>
    </div>` : '';

  let body = '';
  const isGew = !!w.gew;   // Global Economic Weekly = « Bilan de la semaine écoulée » rétrospectif (façon pro)
  // Bloc titre RETIRÉ du corps : le titre reste dans la barre de nav (en haut) et la période dans le
  // créneau date (haut-droite) → le rapport s'ouvre directement sur son contenu, sans titre répété.
  if (isGew) {
    // ── GLOBAL ECONOMIC WEEKLY (Bilan de la semaine écoulée) : rendu CLARIFIÉ : les temps forts d'abord,
    //    puis la synthèse, puis le calendrier complet avec résultats. Libellés + dates en français.
    const _IMP_LBL = { HIGH: 'FORT', MED: 'MOYEN', MEDIUM: 'MOYEN', LOW: 'FAIBLE' };
    const _impCls = i => { const u = String(i || '').toUpperCase(); return u === 'HIGH' ? 'high' : (u === 'MED' || u === 'MEDIUM') ? 'med' : 'low'; };
    const _impLbl = i => _IMP_LBL[String(i || '').toUpperCase()] || (i ? String(i).toUpperCase() : '');
    // 0) TEMPS FORTS DE LA SEMAINE : événements à FORT impact, en cartes scannables. CLASSÉS PAR IMPORTANCE
    //    RÉELLE (décision de taux > inflation > croissance/emploi > le reste), PAS par ordre chronologique —
    //    sinon un mardi chargé (sondages de confiance, données Chine) évince la décision BoC, le CPI ou le PPI
    //    du mercredi (demande user « je vois pas le CAD, le CPI, le PPI »). À importance égale : chronologique.
    const _gewKeyRank = t => {
      const s = String(t || '').toLowerCase();
      if (/rate decision|interest rate|rate statement|monetary policy report|\bfomc\b|cash rate|\bocr\b|bank rate|official rate|refi|deposit rate/.test(s)) return 6;   // décisions de taux
      if (/\bcpi\b|\bppi\b|\bpce\b|inflation|consumer price|producer price/.test(s)) return 5;                                                                          // inflation
      if (/\bgdp\b|gross domestic|growth rate/.test(s)) return 4;                                                                                                        // croissance
      if (/payroll|non[-\s]?farm|\bnfp\b|unemployment|jobless|employment change|\bjobs\b|earnings|wage/.test(s)) return 3;                                                // emploi
      if (/retail sales|\bpmi\b|\bism\b|industrial production|trade balance|balance of trade|durable goods|imports|exports/.test(s)) return 2;                            // activité/commerce
      return 1;                                                                                                                                                          // confiance/sentiment/secondaire
    };
    const _keyEvents = [];
    (w.days || []).forEach((d, di) => (d.events || []).forEach(e => { if (String(e.impact || '').toUpperCase() === 'HIGH') _keyEvents.push({ e, day: d.day, di }); }));
    _keyEvents.sort((a, b) => (_gewKeyRank(b.e.title) - _gewKeyRank(a.e.title)) || (a.di - b.di));   // importance décroissante, puis chronologique
    if (_keyEvents.length) {
      body += `<div class="wr-section-title">Temps forts de la semaine écoulée</div>`;
      body += `<div class="gew-key-grid">`;
      _keyEvents.slice(0, 9).forEach(({ e, day }) => {
        body += `<div class="gew-key">`
          + `<div class="gew-key-h"><span class="gew-key-day">${_wrEsc(_gewDayFr(day))}</span><span class="gew-imp gew-imp--high">FORT</span></div>`
          + `<div class="gew-key-ttl">${e.country ? `<b>${_wrEsc(e.country)}</b> ` : ''}${_wrEsc(e.title)}</div>`
          + ((e.actual || e.forecast || e.previous) ? `<div class="gew-key-nums">${e.actual ? `Réel <b>${_wrEsc(e.actual)}</b>` : ''}${(e.actual && (e.forecast || e.previous)) ? ' · ' : ''}${e.forecast ? `Consensus <b>${_wrEsc(e.forecast)}</b>` : ''}${(e.forecast && e.previous) ? ' · ' : ''}${e.previous ? `Précédent <b>${_wrEsc(e.previous)}</b>` : ''}</div>` : '')
          + (e.comment ? `<div class="gew-key-cmt">${_wrEsc(e.comment)}</div>` : '')
          + `</div>`;
      });
      body += `</div>`;
    }
    // 1) SYNTHÈSE — style « Points Macro Clés » (demande user) : puces thématiques (Banques Centrales, Inflation
    //    & Croissance, Croissance & Emploi, Commerce, Marchés) = sous-titres blancs (wr-macro-heading) + puces à
    //    libellé gras (wr-bullet), COMME le Récap. Repli sur le pavé texte (highlights) si la synthèse structurée manque.
    if (Array.isArray(w.synthese) && w.synthese.length) {
      body += `<div class="wr-section-title">Synthèse de la semaine</div>`;
      w.synthese.forEach((s, si) => {
        body += (si ? `<div class="wr-sep"></div>` : '') + `<div class="wr-macro-heading">${_wrEsc(s.heading)}</div>`;
        (s.bullets || []).forEach(b => { body += `<div class="wr-bullet">${_wrInline(b)}</div>`; });
      });
    } else if (w.highlights) {
      body += `<div class="wr-section-title">Synthèse de la semaine</div>`;
      body += `<div class="wr-text">${_wrParas(w.highlights)}</div>`;
    }
    // (Section « Bilan États-Unis » retirée le 18/07 — demande user ; le contenu US est désormais
    //  fondu dans la Synthèse, parmi les données éco majeures toutes régions.)
    // 2) CALENDRIER ÉCONOMIQUE complet, jour par jour (FORT mis en avant, FAIBLE estompé)
    // CALENDRIER : on garde les news IMPORTANTES = FORT (High) + les DISCOURS de banque centrale + les indicateurs
    // du PDF « Learning Economics News » (inflation, emploi, croissance, consommation, activité, commerce, immobilier,
    // confiance…) même en MOYEN. Le reste (holidays, adjudications, budget, obligations, enquêtes mineures) est
    // retiré. Jours sans event gardé = sautés. (demande user : « importantes, y compris les discours et celles du pdf »)
    const _GEW_SPEECH_RX = /\b(speech|speaks|testif|testimony|remarks|press\s+conference)\b|\bminutes\b/i;
    const _GEW_PDF_RX = /rate decision|interest rate|monetary policy|\bfomc\b|refi|\bcpi\b|\bppi\b|\bpce\b|inflation|consumer price|producer price|\bgdp\b|\bpib\b|growth rate|non[-\s]?farm|\bnfp\b|payroll|unemployment|jobless|\bemployment\b|\bjobs\b|hourly earnings|\bwage|retail sales|\bpmi\b|\bism\b|industrial production|factory orders|durable goods|trade balance|balance of trade|\bimports\b|\bexports\b|current account|consumer confidence|consumer sentiment|business confidence|\bzew\b|\bifo\b|housing starts|building permits|home sales|new home/i;
    const _gewKeep = e => { const t = e && e.title || ''; return String(e && e.impact || '').toUpperCase() === 'HIGH' || _GEW_SPEECH_RX.test(t) || _GEW_PDF_RX.test(t); };
    const _gewHiDays = (Array.isArray(w.days) ? w.days : [])
      .map(d => ({ d: d, evs: (d.events || []).filter(_gewKeep) }))
      .filter(x => x.evs.length);
    if (_gewHiDays.length) {
      body += `<div class="wr-section-title">Calendrier économique <span style="color:#6b7280;font-size:11px;font-weight:400;letter-spacing:0;">· heure de Paris · importants, discours & indicateurs clés</span></div>`;
      _gewHiDays.forEach(({ d, evs }) => {
        // Structure deux-colonnes façon chronologie : jour (rail or, gauche) · événements (droite).
        body += `<div class="gew-day"><div class="gew-day-h">${_wrEsc(_gewDayFr(d.day))}${d.date ? `<span class="gew-day-date">${_wrEsc(_gewDayFr(d.date))}</span>` : ''}</div><div class="gew-day-evs">`;
        evs.forEach(e => {
          const _actCls = (typeof deviationClass === 'function') ? deviationClass(e.actual, e.forecast) : '';   // surprise : vert si > consensus, rouge si <
          body += `<div class="gew-ev gew-ev--${_impCls(e.impact)}"><div class="gew-ev-top">`
            + `<span class="gew-ev-time">${_wrEsc(e.time || '')}</span>`
            + `<span class="gew-ev-ttl">${_gewFlag(e.country, e.ccy)}${e.country ? `<b>${_wrEsc(e.country)}</b> ` : ''}${_wrEsc(e.title)}</span>`
            + (e.impact ? `<span class="gew-imp gew-imp--${_impCls(e.impact)}">${_wrEsc(_impLbl(e.impact))}</span>` : '')
            + `</div>`;
          if (e.actual || e.forecast || e.previous) {
            body += `<div class="gew-ev-cons">`
              + (e.actual ? `<span class="gew-cons gew-cons--actual"><i>Réel</i><b class="${_actCls}">${_wrEsc(e.actual)}</b></span>` : '')
              + (e.forecast ? `<span class="gew-cons"><i>Consensus</i><b>${_wrEsc(e.forecast)}</b></span>` : '')
              + (e.previous ? `<span class="gew-cons"><i>Précédent</i><b>${_wrEsc(e.previous)}</b></span>` : '')
              + `</div>`;
          }
          if (e.comment) body += `<div class="gew-ev-cmt">${_wrEsc(e.comment)}</div>`;   // analyse Econoday-style
          // PROPOS RÉELS du discours (minés dans le flux news du même jour, serveur) — traduits FR à l'affichage.
          (e.quotes || []).forEach(q => { body += `<div class="gew-ev-quote">« <span class="gew-ev-quote-txt">${_wrEsc(q)}</span> »</div>`; });
          body += `</div>`;
        });
        body += `</div></div>`;   // /gew-day-evs + /gew-day
      });
    }
  } else {
    // ── WEEKLY MARKET RECAP : résumé + Force des Devises + Points Macro Clés + analyse par devise (rétrospectif) ──
    if (w.summary) body += `<div class="wr-text wr-summary">${_wrParas(w.summary)}</div>`;
    // v27 — CHRONOLOGIE GÉOPOLITIQUE (façon référence Eliott) : jour par jour + « État en fin de semaine ».
    // Quand présente, elle REMPLACE le thème macro « Géopolitique » (dédup plus bas).
    const _gt = (w.geoTimeline && Array.isArray(w.geoTimeline.jours) && w.geoTimeline.jours.length) ? w.geoTimeline : null;
    if (_gt) {
      body += `<div class="wr-section-title">Chronologie de la semaine${_gt.titre ? ` <span class="wr-gt-topic">· ${_wrEsc(_gt.titre)}</span>` : ''}</div>`;
      body += `<div class="wr-gt">`;
      _gt.jours.forEach(j => {
        body += `<div class="wr-gt-day"><div class="wr-gt-dayname">${_wrEsc(j.jour)}</div><div class="wr-gt-points">`;
        (j.points || []).forEach(p => { body += `<div class="wr-gt-pt">${_wrInline(p)}</div>`; });
        body += `</div></div>`;
      });
      if (Array.isArray(_gt.etatFin) && _gt.etatFin.length) {
        body += `<div class="wr-gt-end"><div class="wr-gt-end-h">État en fin de semaine</div>`;
        _gt.etatFin.forEach(p => { body += `<div class="wr-gt-pt wr-gt-pt--end">${_wrInline(p)}</div>`; });
        body += `</div>`;
      }
      body += `</div>`;
    }
    // Vue d'ensemble de la force des devises (les 8) : AVANT les Points Macro Clés (demandé).
    // FIGÉE sur la semaine du rapport (badge à droite) : un recap récapitule UNE semaine, donc le chart
    // ne dérive jamais (snapshot serveur). Rouvert plus tard → toujours les données de CETTE semaine-là.
    body += `<div class="wr-cs-head"><div class="wr-section-title">Force des Devises</div>`
      + (w.weekRange ? `<span class="wr-cs-week">${_wrEsc(w.weekRange)}</span>` : '') + `</div>`;
    body += `<div class="wr-chart wr-chart--all" id="wr-cs-all">${window.dtpLoader ? window.dtpLoader('Force des devises…', { small: true }) : '<div class="wr-chart-loading">Chargement…</div>'}</div>`;
    // Points Macro Clés : ORDRE CANONIQUE (demande user) — Géopolitique, [Banques Centrales & Politique
    // Monétaire = section dédiée #2], Inflation & Croissance, Performance Cross-Asset, Commerce International
    // & Tarifs, Technologie & Innovation. La section CB (riche, par banque) est INJECTÉE juste après le thème
    // Géopolitique (ou en tête si aucun thème Géo), jamais dupliquée (elle n'est pas un thème macro).
    let _macro = (w.macro && w.macro.length) ? w.macro : [];
    if (_gt) _macro = _macro.filter(s => !/g[ée]opolit/i.test((s && s.heading) || ''));   // v27 : la chronologie remplace le thème « Géopolitique » (pas de doublon)
    const _hasCb = !!(w.centralBanks && w.centralBanks.length);
    if (_macro.length || _hasCb) {
      body += `<div class="wr-section-title">Points Macro Clés</div>`;
      // Ligne séparatrice entre CHAQUE partie (Géopolitique, BC, Inflation & Croissance, Cross-Asset,
      // Commerce & Tarifs, Techno…) → le bloc respire (demande user). Jamais avant la toute première.
      let _cbDone = false, _firstPart = true;
      const _partSep = () => { const s = _firstPart ? '' : '<div class="wr-sep"></div>'; _firstPart = false; return s; };
      const _emitCb = () => { if (!_cbDone && _hasCb) { body += _partSep() + _wrCbSection(w.centralBanks); _cbDone = true; } };
      const _geoIdx = _macro.findIndex(s => /g[ée]opolit/i.test((s && s.heading) || ''));
      if (_geoIdx < 0) _emitCb();   // aucun thème Géopolitique → Banques Centrales en tête du bloc
      _macro.forEach((s, i) => {
        body += _partSep() + `<div class="wr-macro-heading">${_wrEsc(s.heading)}</div>`;
        (s.bullets||[]).forEach(b => { body += `<div class="wr-bullet">${_wrInline(b)}</div>`; });
        if (i === _geoIdx) _emitCb();   // ── Banques Centrales & Politique Monétaire = section dédiée, en #2 (juste après Géopolitique) ──
      });
      _emitCb();   // filet de sécurité (n'émet jamais deux fois : _cbDone)
    }
    // Calendrier économique RETIRÉ du Weekly Market Recap (demande user) : il vit dans le Global Economic Weekly.
    const ccys = _WR_ORDER.filter(c => w.currencies && w.currencies[c]);
    if (ccys.length) {
      body += `<div class="wr-section-title">Analyse par devise</div>`;
      ccys.forEach(c => {
        const cd = (w.currencies[c] && typeof w.currencies[c] === 'object') ? w.currencies[c] : { analysis: w.currencies[c] || '' };
        const thesis  = cd.thesis || '';
        const exec    = cd.execSummary || cd.analysis || '';                       // 1) Résumé exécutif (rétro-compat: analysis)
        const drivers = Array.isArray(cd.drivers) ? cd.drivers : [];              // 4) Principaux moteurs {name,why} | ancien {heading,bullets}
        const cats    = Array.isArray(cd.catalysts) ? cd.catalysts : [];          // 6) Catalyseurs
        body += `<div class="wr-ccy-block">`;
        // Accroche « qui claque » à côté du code devise.
        body += `<div class="wr-ccy-title" style="color:${_WR_COLOR[c]||'#fff'}">${c}${thesis ? ` <span class="wr-ccy-thesis">— ${_wrEsc(thesis)}</span>` : ''}</div>`;
        // 1) Résumé exécutif
        if (exec) body += `<div class="wr-text">${_wrParas(exec)}</div>`;
        // Mini-courbe de force de la devise (figée sur la semaine du rapport).
        body += `<div class="wr-chart" data-wr-chart="${c}">${window.dtpLoader ? window.dtpLoader('Force ' + c + '…', { small: true }) : '<div class="wr-chart-loading">Chargement…</div>'}</div>`;
        // 2) Politique monétaire
        if (cd.monetaryPolicy) body += `<div class="wr-macro-heading">Politique monétaire</div><div class="wr-text">${_wrParas(cd.monetaryPolicy)}</div>`;
        // 3) Inflation
        if (cd.inflation) body += `<div class="wr-macro-heading">Inflation</div><div class="wr-text">${_wrParas(cd.inflation)}</div>`;
        // 4) Principaux moteurs — nouveau format {name, why} ; rétro-compat ancien {heading, bullets/detail}.
        if (drivers.length) {
          body += `<div class="wr-macro-heading">Principaux moteurs</div>`;
          drivers.forEach(d => {
            if (d && d.name) body += `<div class="wr-bullet"><strong>${_wrEsc(d.name)} :</strong> ${_wrInline(d.why || '')}</div>`;
            else if (d && d.heading) {   // ancien format
              body += `<div class="wr-bullet"><strong>${_wrEsc(d.heading)}</strong></div>`;
              if (Array.isArray(d.bullets)) d.bullets.forEach(b => { body += `<div class="wr-bullet">${_wrTagColorize(_wrInline(b))}</div>`; });
              else if (d.detail) body += `<div class="wr-bullet">${_wrTagColorize(_wrInline(d.detail))}</div>`;
            }
          });
        }
        // 5) Biais fondamental (badge sémantique DTP)
        if (cd.bias) {
          body += `<div class="wr-macro-heading">Biais fondamental <span class="wr-bias-badge wr-bias--${_wrBiasCls(cd.bias)}">${_wrEsc(cd.bias)}</span></div>`;
          if (cd.biasRationale) body += `<div class="wr-text">${_wrParas(cd.biasRationale)}</div>`;
        }
        // 6) Catalyseurs de la semaine (donnée · publié vs attendu → interprétation → impact)
        if (cats.length) {
          body += `<div class="wr-macro-heading">Catalyseurs de la semaine</div>`;
          cats.forEach(x => {
            const nums = [x.actual ? `publié <b>${_wrEsc(x.actual)}</b>` : '', x.consensus ? `attendu ${_wrEsc(x.consensus)}` : ''].filter(Boolean).join(' · ');
            let line = `<strong>${_wrEsc(x.data)}</strong>`;
            if (nums) line += ` : ${nums}`;
            if (x.interpretation) line += ` → ${_wrInline(x.interpretation)}`;
            if (x.impact) line += ` <span class="wr-cat-impact">→ ${_wrInline(x.impact)}</span>`;
            body += `<div class="wr-bullet wr-cat">${line}</div>`;
          });
        }
        // 7) Conclusion
        if (cd.conclusion) body += `<div class="wr-macro-heading">Conclusion</div><div class="wr-text">${_wrParas(cd.conclusion)}</div>`;
        body += `</div>`;
      });
    }
  }

  content.innerHTML = `<div class="wr">${insightsHtml}<div class="wr-body">${body}</div></div>`;
  if (window._dtpTranslateQuotes) window._dtpTranslateQuotes(content, '.gew-ev-quote-txt');   // propos de discours (souvent EN) → FR (cache serveur)
  content.scrollTop = 0;
  if (isGew) return;   // GEW : pas de courbes de force par devise

  // Force des devises : FIGÉE sur la semaine du rapport si le snapshot serveur (w.cs) est présent → le
  // chart ne dérive PLUS (rouvert le mois prochain, il montre toujours CETTE semaine). Sinon repli live
  // (?period=week) pour les anciens rapports sans snapshot. Vue d'ensemble + mini-courbes partagent la donnée.
  const _csFrozen = (w.cs && w.cs.currencies && w.cs.series) ? w.cs : null;
  if (_csFrozen) {
    _wrStrengthData = _csFrozen;
    _wrBuildCsAll(_csFrozen);
    _wrLazyCharts(content);
  } else {
    // GARDE-FOU : le repli live (?period=week = semaine COURANTE) n'est légitime QUE si le rapport
    // couvre la semaine en cours. Pour une semaine révolue sans snapshot, on n'affiche PLUS JAMAIS la
    // mauvaise semaine : message d'attente : le backfill serveur (_maybeBackfillRecapCs) fournit w.cs
    // au prochain chargement (recalcul figé de LA semaine du rapport).
    const _covMon = (() => { try { const a = String(w.weekEnding || '').split('.').map(Number); if (a.length !== 3 || !a[0] || !a[1] || !a[2]) return 0; return Date.UTC(a[2], a[1] - 1, a[0]) - 4 * 86400000; } catch { return 0; } })();
    const _monNow = (() => { const m = new Date(); const dw = m.getUTCDay(); m.setUTCDate(m.getUTCDate() - (dw === 0 ? 6 : dw - 1)); m.setUTCHours(0, 0, 0, 0); return m.getTime(); })();
    if (_covMon && _covMon !== _monNow) {
      _wrStrengthData = null;
      content.querySelectorAll('[data-wr-chart], #wr-cs-all').forEach(el => el.innerHTML = '<div class="wr-chart-loading">Force des devises de la semaine du rapport en cours de reconstruction : rouvre le rapport dans quelques minutes.</div>');
    } else {
      _wrStrengthData = null;
      fetch('/api/currency-strength?period=week').then(r=>r.json()).then(d => {
        _wrStrengthData = (d && d.currencies) ? d : null;
        _wrBuildCsAll(_wrStrengthData);
        _wrLazyCharts(content);
      }).catch(() => {
        content.querySelectorAll('[data-wr-chart], #wr-cs-all').forEach(el => el.innerHTML = '<div class="wr-chart-loading">Force des devises indisponible.</div>');
      });
    }
  }
}

// ═══════════ FX DAILY RECAP : rendu riche (structure la référence exacte) ═══════════
// Executive Summary → Top Headlines → Regional Analysis (cartes pays + sous-sections) → Central Bank
// Focus → Key Economic Data (table rowspan) → Analyst Comments → Corporate News → Looking Ahead (table).
function _renderFXDailyRecap(item) {
  const w = item._fxr || {};
  const titleEl    = document.getElementById('arlib-rnav-title');
  const tagsScroll = document.getElementById('arlib-rtags-scroll');
  const content    = document.getElementById('arlib-rcontent');
  const navRight   = document.querySelector('#arlib-reader-view .arlib-rnav-right');
  if (!content) return;
  document.getElementById('arlib-ai-insights')?.remove();

  if (titleEl) titleEl.textContent = _stripTitleDateLead(_mdStrip(w.title || 'FX Daily Recap'));
  if (navRight) navRight.innerHTML = `<button class="arlib-hide-insights" onclick="aiInsToggle(this)">${_EYE_OFF} Masquer Insights</button><span class="arlib-dtp-badge">DTP</span>`;
  if (tagsScroll) tagsScroll.innerHTML = (w.tags || []).flatMap(t => String(t).split(/\s*[,;]\s*/)).map(s => s.trim()).map(_arlibTagClean).filter(Boolean).map(t => `<span class="arlib-rtag">${_wrEsc(t)}</span>`).join('');
  const _rdateEl = document.getElementById('arlib-rdate');
  if (_rdateEl) _rdateEl.textContent = w.dateLabel || '';

  // Éclairages IA (réutilise le composant Institution) : cartes thématiques + paires avec badge de biais.
  const chip = `<img class="ai-insights-logo" src="/assets/images/macro-ai-spark.svg" alt="Copilote Macro" width="20" height="20">`;
  const textCards = (w.insights || []).map(t => `<div class="ai-insights-card">${_wrInline(typeof t === 'string' ? t : (t.text || ''))}</div>`);
  const pairCards = (w.pairs || []).map(p => {
    const b = String(p.bias || 'NEUTRAL').toUpperCase();
    const cls = b === 'BUY' ? 'buy' : b === 'SELL' ? 'sell' : 'neutral';
    return `<div class="ai-insights-card ai-ins-pair">
      <div class="ai-ins-pair-head"><span class="ai-ins-pair-name">${_wrEsc(p.pair)}</span><span class="ai-ins-bias ai-ins-bias--${cls}">${_wrEsc({BUY:'ACHAT',SELL:'VENTE',NEUTRAL:'NEUTRE'}[b]||b)}</span></div>
      <div class="ai-ins-pair-text">${_wrInline(p.text || '')}</div>
    </div>`;
  });
  const allCards = [...textCards, ...pairCards];
  const insightsHtml = allCards.length ? `
    <div id="arlib-ai-insights">
      <div class="ai-insights-head">
        <span class="ai-insights-title">${chip} Éclairages IA</span>
        <span class="ai-insights-nav">
          <button type="button" onclick="aiInsScroll(this,-1)">‹</button>
          <span class="ai-insights-count">${allCards.length} éclairages</span>
          <button type="button" onclick="aiInsScroll(this,1)">›</button>
        </span>
      </div>
      <div class="ai-insights-cards">${allCards.join('')}</div>
    </div>` : '';

  const _sec = t => `<div class="fxdr-section">${_wrEsc(t)}</div>`;
  let body = '';

  // ── Executive Summary ──
  if (w.summary) body += _sec('Synthèse') + `<div class="fxdr-exec">${_wrParas(w.summary)}</div>`;

  // ── Top Headlines ──
  if ((w.headlines || []).length) {
    body += _sec('Titres principaux') + '<div class="fxdr-grid">';
    w.headlines.forEach(h => {
      body += `<div class="fxdr-card"><div class="fxdr-card-title">${_wrInline(h.title || '')}</div>${h.text ? `<div class="fxdr-card-text">${_wrInline(h.text)}</div>` : ''}</div>`;
    });
    body += '</div>';
  }

  // ── Analyse par session (Asie · Londres · New York — cartes + sous-sections groupées) ──
  if ((w.regions || []).length) {
    body += _sec('Analyse par session') + '<div class="fxdr-grid">';
    w.regions.forEach(r => {
      body += `<div class="fxdr-card fxdr-region">`;
      body += `<div class="fxdr-region-head"><span class="fxdr-region-name">${_wrEsc(r.name || '')}</span>${r.code ? `<span class="fxdr-ccy">${_wrEsc(r.code)}</span>` : ''}</div>`;
      if (r.summary) body += `<div class="fxdr-card-text">${_wrInline(r.summary)}</div>`;
      (r.groups || []).forEach(g => {
        body += `<div class="fxdr-grp-title">${_wrEsc(g.title || '')}</div>`;
        (g.items || []).forEach(it => {
          body += `<div class="fxdr-sub"><div class="fxdr-sub-h">${_wrInline(it.heading || '')}</div>${it.text ? `<div class="fxdr-sub-t">${_wrInline(it.text)}</div>` : ''}</div>`;
        });
      });
      body += `</div>`;
    });
    body += '</div>';
  }

  // ── Central Bank Focus ──
  if ((w.centralBanks || []).length) {
    body += _sec('Focus banques centrales') + '<div class="fxdr-grid">';
    w.centralBanks.forEach(c => {
      body += `<div class="fxdr-card fxdr-cb"><div class="fxdr-card-title">${_wrEsc(c.name || '')}</div><div class="fxdr-card-text">${_wrInline(c.text || '')}</div></div>`;
    });
    body += '</div>';
  }

  // ── Key Economic Data (table avec regroupement rowspan par publication) ──
  if ((w.econData || []).length) {
    body += _sec('Données économiques clés') + '<div class="fxdr-tablewrap"><table class="fxdr-table"><thead><tr>'
      + '<th>Publication</th><th>Période</th><th>Indicateur</th><th class="num">Réel</th><th class="num">Attendu</th><th class="num">Précédent</th>'
      + '</tr></thead><tbody>';
    w.econData.forEach(r => {
      const ms = (r.metrics && r.metrics.length) ? r.metrics : [{ metric: '', actual: '', expected: '', previous: '' }];
      ms.forEach((m, idx) => {
        body += '<tr>';
        if (idx === 0) body += `<td rowspan="${ms.length}" class="fxdr-rel">${_wrEsc(r.release || '')}</td><td rowspan="${ms.length}" class="fxdr-per">${_wrEsc(r.period || '')}</td>`;
        body += `<td>${_wrEsc(m.metric || '')}</td><td class="num">${_wrEsc(m.actual || '')}</td><td class="num dim">${_wrEsc(m.expected || '')}</td><td class="num dim">${_wrEsc(m.previous || '')}</td></tr>`;
      });
    });
    body += '</tbody></table></div>';
  }

  // ── Analyst Comments ──
  if ((w.comments || []).length) {
    body += _sec("Commentaires d'analystes") + '<div class="fxdr-grid">';
    w.comments.forEach(c => {
      body += `<div class="fxdr-card fxdr-comment"><div class="fxdr-card-title">${_wrEsc(c.author || '')}</div><div class="fxdr-card-text">${_wrInline(c.text || '')}</div></div>`;
    });
    body += '</div>';
  }

  // ── Corporate News (badge ticker) ──
  if ((w.corporate || []).length) {
    body += _sec('Actualité des entreprises') + '<div class="fxdr-grid">';
    w.corporate.forEach(c => {
      body += `<div class="fxdr-card fxdr-corp"><div class="fxdr-corp-head">${c.ticker ? `<span class="fxdr-ticker">${_wrEsc(c.ticker)}</span>` : ''}<span class="fxdr-card-title">${_wrEsc(c.name || '')}</span></div><div class="fxdr-card-text">${_wrInline(c.text || '')}</div></div>`;
    });
    body += '</div>';
  }

  // ── Looking Ahead — MÊME identité que l'onglet Calendrier (demande user 16/07 « comme le calendrier
  //    économique ») : séparateurs de jours, heure, drapeau rond + devise, points d'impact ●●●.
  //    Réutilise les briques RÉELLES du calendrier (CAL_FLAG / calImpDots / cal-day-sep, charts.js).
  //    Anciens rapports (sans ts/ccy) : ligne sans heure/drapeau, rien ne casse.
  if ((w.lookahead || []).length) {
    const _flag = c => (typeof CAL_FLAG === 'function' && c) ? CAL_FLAG(c) : '';
    const _dots = i => (typeof calImpDots === 'function') ? calImpDots(i) : _wrEsc(i || '');
    // Cellules de VALEURS identiques au calendrier (réel coloré vs prévision via calActualCell ;
    // high/prévision en cv-forecast, low/précédent en cv-prev ; vide = tiret cv-empty).
    const _vf = v => v ? `<span class="cv-forecast">${_wrEsc(v)}</span>` : '<span class="cv-empty">—</span>';
    const _vp = v => v ? `<span class="cv-prev">${_wrEsc(v)}</span>` : '<span class="cv-empty">—</span>';
    const _va = e => (typeof calActualCell === 'function') ? calActualCell(e.actual || '', e.forecast || '', e.low || '', e.event || '') : _vf(e.actual);
    let rows = '', lastDay = null;
    w.lookahead.forEach(e => {
      const d = e.ts ? new Date(e.ts) : null;
      const dayLbl = d ? d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' }) : '';
      if (dayLbl && dayLbl !== lastDay) {
        lastDay = dayLbl;
        rows += `<tr class="cal-day-sep"><td colspan="10">${_wrEsc(dayLbl.charAt(0).toUpperCase() + dayLbl.slice(1))}</td></tr>`;
      }
      const hhmm = d ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }) : '—';
      const catBc = /banque centrale/i.test(e.category || '') ? ' <span class="fxdr-cal-cat">· Banque centrale</span>' : '';
      rows += `<tr class="cal-row"><td class="cth-time">${_wrEsc(hhmm)}</td><td class="cth-flag">${_flag(e.ccy)}</td><td class="cth-curr">${_wrEsc(e.ccy || '—')}</td><td class="cth-imp">${_dots(e.importance)}</td><td class="cth-event">${_wrEsc(e.event || '')}${catBc}</td>`
        + `<td class="cth-val">${_va(e)}</td><td class="cth-val">${_vf(e.high)}</td><td class="cth-val">${_vf(e.forecast)}</td><td class="cth-val">${_vp(e.low)}</td><td class="cth-val">${_vp(e.previous)}</td></tr>`;
    });
    body += _sec('À surveiller') + `<div class="fxdr-callike"><div class="fxdr-tablewrap"><table class="cal-table"><thead><tr>`
      + '<th class="cth-time">Heure</th><th class="cth-flag"></th><th class="cth-curr">Devise</th><th class="cth-imp">Imp.</th><th class="cth-event">Événement</th>'
      + '<th class="cth-val">Réel</th><th class="cth-val">High</th><th class="cth-val">Prévision</th><th class="cth-val">Low</th><th class="cth-val">Précédent</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  // ── Commentaires marquants (notable comments) : tout en bas du rapport ──
  if (w.notableCommentsHtml) body += _sec('Commentaires marquants') + `<div class="fxdr-notable">${w.notableCommentsHtml}</div>`;

  content.innerHTML = `<div class="fxdr">${insightsHtml}<div class="fxdr-body">${body}</div></div>`;
  content.scrollTop = 0;
}

// Construit la vue d'ensemble Force des Devises (toutes devises) figée dans #wr-cs-all.
function _wrBuildCsAll(data) {
  const host = document.getElementById('wr-cs-all'); if (!host) return;
  if (!data || !data.currencies || typeof buildStrengthChart !== 'function') { host.innerHTML = '<div class="wr-chart-loading">Force des devises indisponible.</div>'; return; }
  host.innerHTML = '';
  try { buildStrengthChart('wr-cs-all', data, { isolated: true }); } catch { host.innerHTML = '<div class="wr-chart-loading">Force des devises indisponible.</div>'; }
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

// ── « Point Marché · Ouverture US » (DTP Daily) : rapport quotidien de midi, rendu en SECTIONS (puces / paragraphes / tableau de données) ──
function _renderDTPDaily(item) {
  const w = item._dtpd || {};
  const titleEl    = document.getElementById('arlib-rnav-title');
  const tagsScroll = document.getElementById('arlib-rtags-scroll');
  const content    = document.getElementById('arlib-rcontent');
  const navRight   = document.querySelector('#arlib-reader-view .arlib-rnav-right');
  if (!content) return;
  document.getElementById('arlib-ai-insights')?.remove();
  if (titleEl) titleEl.textContent = _mdStrip(w.reportName || w.title || 'DTP Daily US Opening News');
  if (navRight) navRight.innerHTML = `<span class="arlib-dtp-badge">DTP</span>`;
  if (tagsScroll) tagsScroll.innerHTML = (w.tags || []).flatMap(t => String(t).split(/\s*[,;]\s*/)).map(s => s.trim()).map(_arlibTagClean).filter(Boolean).map(t => `<span class="arlib-rtag">${_wrEsc(t)}</span>`).join('');
  const _rdateEl = document.getElementById('arlib-rdate');
  if (_rdateEl) _rdateEl.textContent = w.dateLabel || '';

  const _sec = t => `<div class="fxdr-section">${_wrEsc(t)}</div>`;
  let body = '';
  if (w.title) body += `<div class="dtpd-lead">${_wrInline(w.title)}</div>`;
  if (w.summary) body += _sec('Synthèse') + `<div class="fxdr-exec">${_wrParas(w.summary)}</div>`;
  (w.sections || []).forEach(s => {
    if (!s || !s.title) return;
    if (s.kind === 'data' && (s.data || []).length) {
      body += _sec(s.title) + `<div class="fxdr-tablewrap"><table class="fxdr-table"><thead><tr><th>Devise</th><th>Publication</th><th class="num">Réel</th><th class="num">Att.</th><th class="num">Préc.</th></tr></thead><tbody>`;
      s.data.forEach(r => { body += `<tr><td class="fxdr-ccy">${_wrEsc(r.ccy || '—')}</td><td>${_wrEsc(r.release)}</td><td class="num">${_wrEsc(r.actual || '')}</td><td class="num">${_wrEsc(r.expected || '')}</td><td class="num">${_wrEsc(r.previous || '')}</td></tr>`; });
      body += `</tbody></table></div>`;
    } else if (s.kind === 'paras' && (s.paras || []).length) {
      body += _sec(s.title) + `<div class="dtpd-paras">${s.paras.map(p => `<p>${_wrInline(p)}</p>`).join('')}</div>`;
    } else if ((s.items || []).length) {
      body += _sec(s.title) + `<ul class="dtpd-bullets">${s.items.map(it => `<li>${_wrInline(it)}</li>`).join('')}</ul>`;
    }
  });
  content.innerHTML = body || '<div class="fxdr-exec">Rapport en cours de génération…</div>';
}

// FILET UNIVERSEL (demande user : Éclairages IA dans TOUS les rapports Analyste). Après le rendu de n'importe
// quel rapport (DTP Daily, FX Daily, Weekly, Récap Séance, briefing…), si le panneau « Éclairages IA » est resté
// VIDE (insights propres absents, IA en quota, description trop courte au 1er appel…), on le reconstruit à partir
// des PUCES RÉELLEMENT RENDUES du rapport → les Éclairages IA n'y manquent JAMAIS quand il y a du contenu.
function _ensureArlibInsights(item) {
  if (!item) return;
  let attempts = 0;
  const tryFill = () => {
    try {
      if (_currentArlibItem !== item) return;              // l'utilisateur a changé de rapport → on abandonne ce filet
      let el = document.getElementById('arlib-ai-insights') || document.getElementById('br-ai-insights');
      if (el && el.querySelector('.ai-insights-card')) return;   // Éclairages IA déjà présents → terminé
      const content = document.getElementById('arlib-rcontent');
      let lines = content ? [...content.querySelectorAll('.arlib-rbullet > span:not(.arlib-rbullet-dot), .arlib-rbullet-sub > span:not(.arlib-rbullet-dot)')]
        .map(s => (s.textContent || '').replace(/\s+/g, ' ').trim()).filter(t => t.length > 8) : [];
      if (!lines.length && content) lines = [...content.querySelectorAll('li, p')]
        .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim()).filter(t => t.length > 20);
      lines = lines.slice(0, 40);
      if (lines.length && content) {   // contenu prêt → on (re)fabrique les Éclairages IA à partir des puces réelles (secours garanti)
        if (!el) {   // rapport DTP/FX/Weekly SANS insights bakés (échec IA génération) → le conteneur n'existe pas : on le CRÉE en tête du rapport
          el = document.createElement('div'); el.id = 'arlib-ai-insights';
          content.insertBefore(el, content.firstChild);
        }
        _loadAIInsights({ ...item, id: item.id, headline: item.headline || item.title || '', lines, description: lines.join('. ') }, el);
        return;
      }
      // Contenu pas encore rendu (source async : Récap Séance InvestingLive, ING Think…) → on ré-essaie
      // jusqu'à ~8 s, le temps que le contenu du rapport se charge, PUIS on remplit.
      if (++attempts < 9) setTimeout(tryFill, 900);
    } catch {}
  };
  setTimeout(tryFill, 1200);
}
function renderArlibReader(item) {
  _currentArlibItem = item;   // keep ref for insights button
  _ensureArlibInsights(item);   // filet : garantit les Éclairages IA après le rendu, quel que soit le type de rapport
  if (item && item._dtpd)   { _renderDTPDaily(item); return; }      // ← « Point Marché · Ouverture US »
  if (item && item._fxr)    { _renderFXDailyRecap(item); return; }  // ← rendu riche FX Daily Recap (façon pro)
  if (item && item._weekly) { _renderWeeklyRecap(item); return; }   // ← rendu riche Weekly Recap
  document.getElementById('arlib-insights-panel')?.remove(); // reset any previous insights
  const titleEl    = document.getElementById('arlib-rnav-title');
  const tagsScroll = document.getElementById('arlib-rtags-scroll');
  const content    = document.getElementById('arlib-rcontent');
  if (!content) return;

  // ── Éclairages IA : cartes générées par IA, placées AU-DESSUS du contenu ──
  let insightsEl = document.getElementById('arlib-ai-insights');
  if (!insightsEl) {
    insightsEl = document.createElement('div');
    insightsEl.id = 'arlib-ai-insights';
    content.parentNode.insertBefore(insightsEl, content);
  }
  insightsEl.innerHTML = '';
  // Les sources à contenu ASYNCHRONE (session wraps InvestingLive, ING Think) rechargent les
  // insights APRÈS le chargement du contenu (avec le vrai texte complet). On NE les charge PAS
  // ici : sinon double requête + le panneau se VIDE pendant le chargement = les Éclairages IA
  // "disparaissent". On laisse un placeholder « analyse… » jusqu'à ce que le contenu soit prêt.
  const _asyncSrc = item && (item._source === 'investinglive' || item._source === 'ing-think');
  if (_asyncSrc) {
    insightsEl.innerHTML = `<div class="ai-insights-head"><span class="ai-insights-title"><img class="ai-insights-logo" src="/assets/images/macro-ai-spark.svg" alt="Copilote Macro" width="20" height="20"> Éclairages IA</span> <span class="ai-insights-load">· analyse…</span></div>`;
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
  _renderArlibTags();   // pills façon DTP (6 max + "+N") + date & badge DTP à droite

  // ── Build content HTML ──
  let html = '';

  // Récupère les PUCES réellement rendues du rapport (texte propre, sans la pastille) → servent
  // de base aux Éclairages IA : 1 carte par puce = plusieurs petites cases, jamais un gros bloc.
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

    const fixLinks = s => (s || '').replace(/<a /g, '<a target="_blank" rel="noopener" style="color:#e3b23a;text-decoration:none;" ');
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

    // Découpe robuste en phrases : protège décimales (88.50) et abréviations (U.S., Mr., e.g.…)
    // par un caractère sentinelle AVANT de couper sur « ponctuation + espace + Majuscule », puis restaure.
    const _splitSentences = (s) => {
      const P = '';
      const prot = String(s)
        .replace(/(\d)\.(\d)/g, '$1' + P + '$2')
        .replace(/\b(U\.S|U\.K|E\.U|e\.g|i\.e|Mr|Mrs|Ms|Dr|Prof|Sen|Gov|Pres|vs|etc|No|Inc|Corp|Ltd|Co|a\.m|p\.m|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec|approx|St)\./gi, m => m.replace(/\./g, P));
      return prot.split(/(?<=[.!?])\s+(?=[A-Z"'(])/).map(x => x.replace(new RegExp(P, 'g'), '.').trim()).filter(Boolean);
    };
    // Puces : un paragraphe LONG (multi-phrases) est découpé en 1 puce par phrase → « tout en
    // puces » façon recap la référence (fini les pavés). Les courts gardent leur HTML riche (liens/gras).
    const _emitBullets = (richHtml, plainText) => {
      const txt = (plainText || '').replace(/\s+/g, ' ').trim();
      const parts = (txt.length > 230) ? _splitSentences(txt) : [txt];
      if (parts.length < 2) {
        if (txt.length > 4) { html += `<div class="arlib-rbullet"><span class="arlib-rbullet-dot"></span><span>${richHtml}</span></div>`; bulletCount++; }
        return;
      }
      parts.forEach(s => {
        if (s.length < 8) return;
        html += `<div class="arlib-rbullet"><span class="arlib-rbullet-dot"></span><span>${_emphasize(s)}</span></div>`; bulletCount++;
      });
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
        if (t.length > 15 && !_isSrcLine(t)) _emitBullets(t, t);
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
        // Titre de sous-article embarqué (<p> entièrement en GRAS, court, sans ponctuation finale) → SECTION MAJUSCULES
        const _onlyBold = el.children.length === 1 && /^(strong|b)$/i.test(el.children[0].tagName || '') && el.children[0].textContent.trim() === text;
        if (_onlyBold && text.length <= 90 && !/[.!?]$/.test(text)) {
          html += `<hr class="arlib-rdivider"><div class="arlib-rsection">${text.toUpperCase()}</div>`;
          return;
        }
        const t = fixLinks(el.innerHTML.trim());
        if (text.length > 5) _emitBullets(t, text);             // pavé multi-phrases → 1 puce par phrase
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
          bulletCount++;
        } else {
          _emitBullets(_emphasize(text), text);              // li long multi-phrases → découpé en puces (jamais de pavé)
        }
      } else if (tag === 'blockquote') {
        const t = el.textContent.trim();
        if (t) html += `<div class="arlib-rbullet-sub"><span class="arlib-rbullet-dot"></span><span>${t}</span></div>`;
      } else if (tag === 'hr') {
        html += `<hr class="arlib-rdivider">`;
      } else if ((tag === 'strong' || tag === 'b') && !el.closest('p, li')) {
        const t = el.textContent.trim();
        if (_skipAuthor(t, true)) return;                    // en-tête "Authors" / nom d'auteur en gras → ignoré
        if (/^lead$/i.test(t)) return;                       // « LEAD » = bloc synthèse/intro (façon pro) → PAS de titre ni séparateur : les puces suivantes restent en tête, juste après les Éclairages IA
        // ≥2 (et non >3) : « FX », « US », « UK », « EU », « USD »… sont des EN-TÊTES légitimes de 2-3 car.
        // Le seuil >3 faisait DISPARAÎTRE le titre « FX » (2 car) → ses puces se collaient à la rubrique précédente.
        if (t.length >= 2) html += `<hr class="arlib-rdivider"><div class="arlib-rsection">${t.toUpperCase()}</div>`;
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

    // (Section SOURCES retirée : prenait trop de place)

    return html;
  }

  // ── InvestingLive session wraps ────────────────────────────────────────────────
  if (item._source === 'investinglive') {
    // Bloc de TITRE retiré du corps (demande utilisateur) : le titre du rapport est déjà affiché dans
    // la barre de navigation du lecteur (arlib-rnav-title = standardizeReportTitle « London Session
    // Recap: … ») et la date dans la barre de tags → ce bloc arlib-rhead faisait DOUBLON. Le corps
    // démarre directement sur les puces LEAD (synthèse) façon pro.
    const _header = '';
    content.innerHTML = dtpLoader('Chargement du résumé de session…');

    fetch('/api/session-wrap-content?url=' + encodeURIComponent(item.url))
      .then(r => r.json())
      .then(data => {
        if (!content) return;
        if (data.html && data.html.length > 80) {
          content.innerHTML = _parseHtmlToArlib(data.html, _header);
          try {   // section « Commentaires marquants » du jour (notable comments), tout en bas du session wrap
            const _ncDay = new Date(item.timestamp).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
            fetch('/api/notable-comments?day=' + _ncDay).then(r => r.json()).then(nc => {
              if (nc && nc.html && content && content.isConnected) content.innerHTML += `<div class="arlib-notable"><div class="arlib-notable-h">Commentaires marquants</div><div class="fxdr-notable">${nc.html}</div></div>`;
            }).catch(() => {});
          } catch {}
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
        // En-tête INTELLIGENT (même structure que les session recaps) : type orange → TITRE réel
        // du rapport → sous-titre institution + date (+ description si présente).
        const _esc6 = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const _full0 = standardizeReportTitle(item);
        const _m0 = _full0.match(/^([^:]{2,40}):\s*(.+)$/);   // "FX Daily: Sujet…" → type + titre
        const metaBar = '<div class="arlib-rhead">'
          + '<div class="arlib-rtype">' + _esc6(_m0 ? _m0[1] : 'Bank Research') + '</div>'
          + '<div class="arlib-rtitle">' + _esc6(_m0 ? _m0[2] : _full0) + '</div>'
          + '<div class="arlib-rsub">ING : THINK economic and financial analysis : ' + dateStr + '</div>'
          + (item.description ? '<div class="arlib-rsub">' + _esc6(item.description) + '</div>' : '')
          + '</div>';
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

  if (item._briefing || item.source === 'DTP') {
    const bullets = parsePrimerBullets(item.description);
    if (!bullets.length) {
      html = `<div class="arlib-rno-content">Aucun contenu : régénérez le rapport.</div>`;
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
      html = `<div class="arlib-rno-content">Aucun contenu détaillé disponible.</div>`;
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
  commodities:  '#e3b23a',
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

  if (sub) sub.textContent = report.generatedAt ? `Généré le ${report.generatedAt}` : '';
  if (cnt && report.newsCount) cnt.textContent = `${report.newsCount} titres analysés`;

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
  if (body) body.innerHTML = dtpLoader('Génération du rapport Ouverture Londres…');
  try {
    const url = '/api/london-prep' + (force ? '?force=1' : '');
    const data = await fetch(url).then(r => r.json());
    if (data.error) throw new Error(data.error);
    renderLondonPrep(data);
  } catch (e) {
    if (body) body.innerHTML = `<div class="prep-loading"><span>⚠ Impossible de charger le rapport : ${e.message}</span></div>`;
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

// ── TAXONOMIE UNIQUE des alertes (refonte 16/07, demande user « plus clair et simple ») ─────────
// UNE seule fonction de classement (_npKind) alimente TOUT : le badge affiché sur l'item, le toggle
// du panneau Filtre ET les onglets — mêmes clés, mêmes mots partout. (Avant : 3 logiques divergentes
// → l'utilisateur ne pouvait pas prédire où atterrissait une news ; + 3 catégories mortes retirées.)
// Ordre de test : rapports d'abord, puis CONTENU (risque / données éco), puis temps réel, puis reste.
const NP_KINDS = [
  { key: 'flash',       label: 'Flash Marché', cls: 'squawk'  },   // news temps réel (FinancialJuice)
  { key: 'risk',        label: 'Risque',       cls: 'risk'    },   // géopolitique / risque / énergie / sanctions
  { key: 'eco',         label: 'Données éco',  cls: 'cal'     },   // statistiques & calendrier économique
  { key: 'analyst',     label: 'Analystes',    cls: 'analyst' },   // rapports & notes d'analystes (desk)
  { key: 'institution', label: 'Institution',  cls: 'analyst' },   // recherche institutionnelle (banques)
  { key: 'news',        label: 'News',         cls: 'news'    },   // tout le reste
];
const _NP_KIND_BY_KEY = Object.fromEntries(NP_KINDS.map(k => [k.key, k]));
function _npKind(item) {
  if (item._reportNotif === 'institution' || item._source === 'ing-think') return _NP_KIND_BY_KEY.institution;
  if (item._reportNotif === 'analyst' || item._source === 'investinglive'
    || item._briefing || item.source === 'DTP') return _NP_KIND_BY_KEY.analyst;
  const c = (item.category || '').toLowerCase();
  if (/research|institution/.test(c)) return _NP_KIND_BY_KEY.institution;
  if (/geopolit|risk|energy|sanction|war/.test(c)) return _NP_KIND_BY_KEY.risk;
  if (/data|calendar|cpi|pmi|nfp|gdp|inflation|economic/.test(c)) return _NP_KIND_BY_KEY.eco;
  if (item.source === 'FinancialJuice' || (item.id || '').startsWith('fj-')) return _NP_KIND_BY_KEY.flash;
  return _NP_KIND_BY_KEY.news;
}
// Filtres par catégorie (panneau « Filtre ») : mêmes clés que les badges — couper « Flash Marché »
// coupe exactement les items badgés « Flash Marché ». Seules les clés CONNUES sont retenues
// (migration : les anciennes clés bias/posts/admin/ticker/calendar/research sont ignorées).
let _npCatFilters = {};
try {
  const raw = JSON.parse(localStorage.getItem('np_cat_filters') || '{}');
  for (const k in raw) if (_NP_KIND_BY_KEY[k] && raw[k] === false) _npCatFilters[k] = false;
} catch {}
function _npCatOn(key) { return _npCatFilters[key] !== false; }

// ── Config PERSISTANTE PAR COMPTE (KV serveur notifcfg:<userId>, modèle symrecent) ──────────────
// Source de vérité = /api/notif-config (suit la reconnexion, même sur un autre appareil) ;
// localStorage np_* = simple cache instantané. Le fil et l'onglet actif restent volatils.
async function _npCfgLoad() {
  try {
    const r = await fetch('/api/notif-config');
    const j = await r.json();
    if (!j || !j.cfg) return;   // aucune préférence serveur → on garde localStorage / défauts
    _npEnabled = j.cfg.enabled !== false;
    _npVolume  = j.cfg.volume || 'fort';
    _npChime   = j.cfg.chime || 'chime';
    _npPush    = j.cfg.push !== false;
    _npCatFilters = {};
    (j.cfg.catsOff || []).forEach(k => { if (_NP_KIND_BY_KEY[k]) _npCatFilters[k] = false; });
    try {
      localStorage.setItem('np_enabled', JSON.stringify(_npEnabled));
      localStorage.setItem('np_volume', _npVolume);
      localStorage.setItem('np_chime', _npChime);
      localStorage.setItem('np_push', JSON.stringify(_npPush));
      localStorage.setItem('np_cat_filters', JSON.stringify(_npCatFilters));
    } catch {}
    _npSyncUI();
  } catch {}
}
let _npCfgSaveT = null;
function _npCfgSave() {
  clearTimeout(_npCfgSaveT);
  _npCfgSaveT = setTimeout(() => {
    const catsOff = Object.keys(_npCatFilters).filter(k => _npCatFilters[k] === false);
    fetch('/api/notif-config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: _npEnabled, volume: _npVolume, chime: _npChime, push: _npPush, catsOff }),
    }).catch(() => {});
  }, 800);
}
// Retire toute attribution de source résiduelle de la description
function _npStripSrc(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')                                  // tags HTML éventuels
    .replace(/\b(?:written|reported|posted)\s+by\s+[^.]*?(?:at\s+[\w.]+)?\.?/gi, '')
    .replace(/\s*(?:source|via)\s*:\s*[^|.\n]+/gi, '')
    .replace(/\s{2,}/g, ' ').trim();
}

// ── DOM refs (deferred : DOM might not be ready yet) ──────────
function _npEl(id) { return document.getElementById(id); }

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  _npSyncUI();
  _npCfgLoad();   // config par compte (serveur) → écrase le cache localStorage puis re-synchronise l'UI
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
    _npCfgSave();
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
      .filter(i => !(i._briefing || i.source === 'DTP' || isPrimerItem(i)))   // pas de primers/rapports
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
  _npCfgSave();
  if (!_npEnabled) _npStopVoice();   // OFF = silence immédiat (coupe aussi la voix du squawk)
  _npSyncUI();
}

// ── Volume cycle: fort → doux → mute → fort ──────────────────
function npCycleVolume() {
  const cycle = { fort: 'doux', doux: 'mute', mute: 'fort' };
  _npVolume = cycle[_npVolume] || 'fort';
  localStorage.setItem('np_volume', _npVolume);
  _npCfgSave();
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
        _npCfgSave();
        _npSyncUI();
      });
    }
  } else {
    _npPush = false;
    localStorage.setItem('np_push', JSON.stringify(_npPush));
    _npCfgSave();
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
  // Une ligne par TYPE d'alerte (mêmes libellés que les badges du fil → couper « Flash Marché »
  // coupe exactement les items badgés « Flash Marché »).
  grid.innerHTML = NP_KINDS.map(c => `
    <div class="np-filter-row" data-cat="${c.key}">
      <span class="np-filter-lbl"><span class="np-origin np-origin--${c.cls}">${c.label}</span></span>
      <span class="np-filter-toggle ${_npCatOn(c.key) ? 'on' : 'off'}">${_npCatOn(c.key) ? 'ON' : 'OFF'}</span>
    </div>`).join('');
  grid.querySelectorAll('.np-filter-row').forEach(row => {
    row.addEventListener('click', () => {
      const k = row.dataset.cat;
      _npCatFilters[k] = !_npCatOn(k);
      try { localStorage.setItem('np_cat_filters', JSON.stringify(_npCatFilters)); } catch {}
      _npCfgSave();
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
    if (item._briefing || item.source === 'DTP' || isPrimerItem(item)) return;   // pas de primers en notif
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

  // Web Push notification (only for high priority items) : JAMAIS de son OS : on force silent:true
  // (le carillon interne est la SEULE source de son), et on ne crée RIEN si le son est coupé.
  const muted = (typeof _npGlobalMute === 'function' && _npGlobalMute());
  if (_npPush && !muted && 'Notification' in window && Notification.permission === 'granted') {
    const hi = items.find(i => i.priority === 'high' || i.urgent);
    if (hi) {
      new Notification('DataTradingPro', {
        body:   hi.headline,
        icon:   '/favicon.png',
        tag:    'dtp-' + hi.id,
        silent: true,   // pas de son OS : seul le carillon interne (respectant Muet) sonne
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

  // Onglets et Filtre dérivent de la MÊME taxonomie (_npKind) que le badge de l'item : ce que
  // l'utilisateur lit sur l'item = ce qu'il coupe dans le Filtre = ce que trie l'onglet.
  const filtered = _npItems.filter(item => {
    const kind = _npKind(item);
    if (!_npCatOn(kind.key)) return false;           // filtre par type (panneau Filtre)
    if (_npFilter === 'analyst')  return kind.key === 'analyst' || kind.key === 'institution';
    if (_npFilter === 'risk')     return kind.key === 'risk';
    if (_npFilter === 'breaking') return item.priority === 'high' || item.urgent;   // urgence = facette transverse
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
  // Fondu léger UNIQUEMENT sur les notifications apparues depuis le dernier rendu (même esprit que le fil
  // de news) : jamais au changement de filtre ni sur ce qui a déjà été affiché. IDs marqués sur TOUT
  // _npItems (insensible aux filtres) ; dtp-fade-in se termine à opacity 1 (fill both), donc sans risque.
  const _npSeen = _npRenderList._seen || (_npRenderList._seen = new Set());
  const _npFresh = _npSeen.size ? _npItems.filter(i => i.id && !_npSeen.has(i.id)).map(i => i.id) : [];
  _npItems.forEach(i => { if (i.id) _npSeen.add(i.id); });
  filtered.slice(0, 80).forEach(item => {
    const el = document.createElement('div');
    el.className = 'np-item' + (item._new ? ' np-item--unread' : '');
    if (_npFresh.includes(item.id)) el.classList.add('dtp-fade-in');   // nouvel item depuis le dernier rendu → fondu discret

    const iconClass = item.urgent ? 'np-icon--breaking' : item.priority === 'high' ? 'np-icon--high' : '';
    const iconSymbol = item.urgent ? '!' : 'i';
    const ago = _npTimeAgo(item.timestamp);
    const desc = _npStripSrc(item.description).slice(0, 140);
    const org = _npKind(item);   // badge = même taxonomie que Filtre et onglets

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
  // Descriptions (aperçus 140 car.) = source anglaise → FR en place, même mécanique que les puces
  // d'article (cache serveur par texte + cache session → coût quasi nul aux réouvertures).
  if (window._dtpTranslateQuotes) window._dtpTranslateQuotes(list, '.np-item-desc');
}

function _npTimeAgo(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60)  return 'il y a ' + diff + 's';
  if (diff < 3600) return 'il y a ' + Math.floor(diff / 60) + 'min';
  if (diff < 86400) return 'il y a ' + Math.floor(diff / 3600) + 'h';
  return 'il y a ' + Math.floor(diff / 86400) + 'j';
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

// ── Sound engine (Web Audio API : no audio files needed) ──────
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
    // AudioContext might be blocked before user interaction : silent fail
  }
}

// ═══════════════════════════════════════════════════════════════
// LIVE SQUAWK  (sqwk-) : flux de commentaire de marché mot-par-mot
// ═══════════════════════════════════════════════════════════════
const _sqwkMessages = [];           // { id, ts, text }
let   _sqwkAuto       = false;
let   _sqwkAutoTimer  = null;       // tick toutes les 10s
let   _sqwkStreamTimer = null;      // sous-intervalle mot-par-mot (150ms)

const _sqwkProcessed = new Set();   // IDs de news déjà diffusées (anti-doublon)
let   _sqwkLive       = false;       // Flash Marché LIVE = audio/voix (bouton play) : indépendant du texte auto
let   _sqwkStarted    = false;       // flux déjà amorcé (évite de re-marquer l'existant à chaque toggle)

function _sqwkTime() { return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function _sqwkEsc(s)  { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Une VRAIE news exploitable pour le squawk (pas de rapport/primer/bruit)
function _sqwkUsable(it) {
  if (!it || !it.headline) return false;
  if (it._briefing || it.source === 'DTP' || (typeof isPrimerItem === 'function' && isPrimerItem(it))) return false;
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

// Voix "salle de marché" (Web Speech API, gratuite) : synchronisée avec l'écriture
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
  // Flash Marché FinancialJuice : on PRIORISE les flashes FJ ; à défaut, autre news réelle.
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
  // Bouton play = Flash Marché LIVE (audio) : carré rouge si live, triangle vert sinon
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
// Bouton play = Flash Marché LIVE = AUDIO/voix (indépendant du texte auto)
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
// CHAT SUPPORT  (chat-) : conversation persistante avec le support
// ═══════════════════════════════════════════════════════════════
let _chatPollTimer = null;
let _chatLiveTimer = null;    // rafraîchissement live tant que le panneau est ouvert
let _chatSig = '';            // signature du dernier rendu (évite les re-rendus/scrolls inutiles)
let _chatThreadUser = null;   // (mode support) userId du thread ouvert
let _chatThreadName = '';
let _chatInboxCache = null;   // cache de la boîte de réception (rendu instantané)
const _chatMsgCache = {};     // cache des messages par thread (clé = userId ou 'client')
// Cache LOCALSTORAGE (survit au reload) → l'historique s'affiche INSTANTANÉMENT, la MAJ se fait en fond.
function _chatLSGet(k){ try { return JSON.parse(localStorage.getItem('dtp_chat_' + k) || 'null'); } catch { return null; } }
function _chatLSSet(k, v){ try { localStorage.setItem('dtp_chat_' + k, JSON.stringify(v)); } catch {} }
function _chatPersistMsgs(){ _chatLSSet('msgs', _chatMsgCache); }   // sauve le cache messages (best-effort)
// Hydratation immédiate depuis le stockage local (dès le chargement du script) → zéro spinner au reload.
try {
  const _lsInbox = _chatLSGet('inbox'); if (_lsInbox && (_lsInbox.threads || _lsInbox.users)) _chatInboxCache = _lsInbox;
  const _lsMsgs = _chatLSGet('msgs'); if (_lsMsgs && typeof _lsMsgs === 'object') Object.assign(_chatMsgCache, _lsMsgs);
} catch {}
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
  else { _chatClientHead(); _chatLoad(); _chatMarkWelcomeSeen(); }   // côté client : en-tête support + conversation ; 1re ouverture → vide le plancher du badge bienvenue
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
        _chatUpdateHeadPresence(d);   // MAJ « En ligne / Hors ligne depuis X » (re-rendu depuis lastSeen → le compteur s'incrémente)
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
          _chatLSSet('inbox', _chatInboxData);
          _chatSetBadge((_chatInboxData.threads||[]).filter(t=>(t.unread||0)>0).length);
          _chatRenderInbox();
        }
      }
    } else {
      const d = await (await fetch('/api/chat')).json();
      const msgs = d.messages||[]; _chatMsgCache.client = msgs; _chatPersistMsgs();
      const sig = _sigMsgs(msgs);
      if (sig !== _chatSig){ _chatSig = sig; _chatRender(msgs); _chatSetBadge(0); }
      _chatSetTyping(d.typing, 'Support DataTradingPro');   // le support tape ?
    }
  } catch {}
}

// ── MODE SUPPORT (admin) ──────────────────────────────────────
// ── Présence de l'interlocuteur (support) : « En ligne » / « Hors ligne depuis X » ──
// Durée courte relative FR (min → h → j → date). Le live tick (4s) re-rend depuis lastSeen → « depuis
// 10 min » s'incrémente tout seul même sans nouvel event serveur.
// Duree RELATIVE compacte de la derniere presence (demande user : « depuis 5 h », « depuis 2 j »).
function _chatSince(ts){
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  const m = Math.floor(s / 60); if (m < 1) return "moins d'1 min"; if (m < 60) return m + ' min';
  const h = Math.floor(m / 60); if (h < 24) return h + ' h';
  const j = Math.floor(h / 24); if (j < 7) return j + ' j';
  const w = Math.floor(j / 7);  if (w < 5) return w + ' sem';
  const mo = Math.floor(j / 30); if (mo < 12) return mo + ' mois';
  const an = Math.floor(j / 365); return an + ' an' + (an > 1 ? 's' : '');
}
// Date + HEURE absolues de la derniere deconnexion (info-bulle au survol) : « aujourd'hui à 14h30 »,
// « hier à 9h05 », « le 12/07 à 14h30 », « le 12/07/25 à 14h30 » (annee si autre annee).
function _chatAbsWhen(ts){
  const d = new Date(ts), now = new Date();
  const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
  if (d.toDateString() === now.toDateString()) return "aujourd'hui à " + hm;
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'hier à ' + hm;
  const opt = (d.getFullYear() === now.getFullYear()) ? { day: '2-digit', month: '2-digit' } : { day: '2-digit', month: '2-digit', year: '2-digit' };
  return 'le ' + d.toLocaleDateString('fr-FR', opt) + ' à ' + hm;
}
function _chatSeenText(online, lastSeen){
  if (online) return { cls: 'is-online', text: 'En ligne', title: '' };
  if (!lastSeen) return { cls: 'is-offline', text: 'Hors ligne', title: '' };
  let abs = ''; try { abs = _chatAbsWhen(lastSeen); } catch {}
  return { cls: 'is-offline', text: 'Hors ligne depuis ' + _chatSince(lastSeen), title: abs ? ('Vu ' + abs) : '' };   // relatif visible « depuis 5 h » ; date+heure exactes au survol (repli = dernier message)
}
function _chatHeadPresenceHtml(pres){
  const p = _chatSeenText(!!pres.online, pres.lastSeen || null);
  return `<span class="chat-head-st ${p.cls}"${p.title ? ` title="${_chatEsc(p.title)}"` : ''}>${_chatEsc(p.text)}</span>`;   // « Vous répondez en tant que support » = ligne SEPAREE (_chatApplyPresence → #chat-head-role2)
}
// Présence connue INSTANTANÉMENT depuis l'inbox (users + threads déjà chargés) → l'en-tête s'affiche sans attendre le fetch.
function _chatUserPresence(userId){
  const uid = String(userId);
  const t = ((_chatInboxData && _chatInboxData.threads) || []).find(x => String(x.user_id) === uid);   // le thread porte le repli lastSeen = dernier message
  const u = ((_chatInboxData && _chatInboxData.users)   || []).find(x => String(x.id) === uid);
  if (!t && !u) return null;
  return { online: !!((t && t.online) || (u && u.online)), lastSeen: (t && t.lastSeen) || (u && u.lastSeen) || null };
}
// Applique la présence À L'EN-TÊTE : (1) pastille verte/grise À CÔTÉ DU NOM (statut d'un coup d'œil) +
// (2) texte détaillé « En ligne / Hors ligne depuis X » dans la sous-ligne. Le nom est (re)posé en texte
// pur ailleurs → on ré-ajoute la pastille ici à chaque MAJ.
function _chatApplyPresence(pres){
  const online = !!(pres && pres.online), lastSeen = pres ? pres.lastSeen : null;
  const n = document.getElementById('chat-head-name');
  if (n) {
    let dot = n.querySelector('.chat-name-dot');
    if (!dot) { dot = document.createElement('span'); n.appendChild(dot); }
    dot.className = 'chat-name-dot ' + (online ? 'is-online' : 'is-offline');
    dot.title = online ? 'En ligne' : (lastSeen ? 'Hors ligne' : 'Hors ligne');
  }
  const s = document.getElementById('chat-head-sub');
  if (s) s.innerHTML = _chatHeadPresenceHtml({ online, lastSeen });
  const r = document.getElementById('chat-head-role2');   // « Vous répondez en tant que support » = ligne PROPRE, dediee, sous la presence
  if (r) { r.textContent = 'Vous répondez en tant que support'; r.style.display = ''; }
}
function _chatUpdateHeadPresence(d){
  if (!_chatThreadUser || !d) return;
  _chatApplyPresence({ online: d.online, lastSeen: d.lastSeen });
}
function _chatHead(name, sub, showBack, showInput, presence){
  const n = document.getElementById('chat-head-name'); if (n) n.textContent = name;   // nom PUR d'abord (efface l'ancienne pastille)
  const s = document.getElementById('chat-head-sub');
  const r = document.getElementById('chat-head-role2');
  if (presence) { _chatApplyPresence(presence); }        // pastille à côté du nom + présence + ligne rôle dédiée
  else { if (s) s.textContent = sub; if (r) { r.textContent = ''; r.style.display = 'none'; } }   // inbox / autre → sous-ligne simple, pas de pastille ni ligne rôle
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
  if (_chatInboxCache){ _chatInboxData = _chatInboxCache; _chatRenderInbox(true); }   // entrée dans l'inbox → toujours en HAUT (dernière conversation)
  else if (list) list.innerHTML = (window.dtpLoader ? window.dtpLoader('Chargement…') : '<div class="chat-empty">Chargement…</div>');
  // Chargement TOLÉRANT aux pannes : on ne remplace JAMAIS la liste par du vide sur une erreur
  // réseau / 500 / auth (cold-start Render, latence Supabase…). On garde la dernière liste connue.
  // → fini le faux bug « Aucun utilisateur » dû à un simple hoquet de chargement.
  Promise.all([
    fetch('/api/admin/chat').then(r => r.ok ? r.json() : Promise.reject(r.status)).then(d => Array.isArray(d.threads) ? d.threads : null).catch(() => null),
    fetch('/api/support/users').then(r => r.ok ? r.json() : Promise.reject(r.status)).then(d => Array.isArray(d.users) ? d.users : null).catch(() => null),
  ]).then(([threads, users])=>{
    if (threads === null && users === null) {            // les DEUX ont échoué → on NE blanchit pas
      if (!_chatInboxCache && list) list.innerHTML = `<div class="chat-empty">Chargement impossible : <button type="button" class="chat-retry-btn" onclick="_chatInbox()">réessayer</button></div>`;
      return;
    }
    _chatInboxData = {
      threads: threads !== null ? threads : (_chatInboxData.threads || []),   // garde l'ancien si échec partiel
      users:   users   !== null ? users   : (_chatInboxData.users   || []),
    };
    _chatInboxCache = _chatInboxData;
    _chatLSSet('inbox', _chatInboxData);   // persiste → affichage instantané au prochain reload
    _chatSetBadge((_chatInboxData.threads || []).filter(t => (t.unread || 0) > 0).length);
    _chatRenderInbox(true);   // 1er chargement/entrée → en HAUT
  });
}
// Recherche d'un utilisateur (par nom/email) : filtre le rendu sans perdre la saisie.
function _chatSearchUsers(q){ _chatInboxQuery = (q || '').toLowerCase().trim(); _chatRenderInbox(true); }   // nouveaux résultats → en haut

// resetScroll=true → on remet la liste EN HAUT (entrée dans l'inbox : ouverture du panneau, « Retour à
// la liste », recherche). Le refresh live (4 s) passe FALSE → on garde la position de défilement du
// support (fini le « je reviens et je suis au milieu de la liste » ET fini le saut en haut toutes les 4 s).
function _chatRenderInbox(resetScroll){
  const list = document.getElementById('chat-list'); if (!list) return;
  if (_chatThreadUser) return;   // on n'écrase pas une conversation ouverte
  const _prevTop = list.scrollTop;
  const threads = (_chatInboxData && _chatInboxData.threads) || [];
  const users   = (_chatInboxData && _chatInboxData.users)   || [];
  // Compteur "en ligne" épuré à droite de la barre de recherche
  const onlineN = users.filter(u => u.online).length;
  const ocEl = document.getElementById('chat-online-n');
  if (ocEl) {
    const _onTxt = String(onlineN);
    if (ocEl.textContent && ocEl.textContent !== _onTxt && window._dtpFlash) window._dtpFlash(ocEl);   // flash discret : le nombre d'utilisateurs en ligne change vraiment
    ocEl.textContent = _onTxt;
  }
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
  // TRI : les VRAIES conversations d'abord, la plus RÉCEMMENT active en tête (fini « la dernière
  // discussion ne remonte pas quand je reviens dans l'inbox »). Puis les autres users : en ligne, puis A→Z.
  const _tms = v => { const t = v ? new Date(v).getTime() : 0; return isNaN(t) ? 0 : t; };
  entries.sort((a, b) => {
    if (a.hasThread !== b.hasThread) return a.hasThread ? -1 : 1;
    if (a.hasThread) return _tms(b.lastAt) - _tms(a.lastAt);
    return ((b.online ? 1 : 0) - (a.online ? 1 : 0)) || String(a.name || '').localeCompare(String(b.name || ''));
  });
  const q = _chatInboxQuery;
  const filtered = q ? entries.filter(e => (e.name + ' ' + e.email).toLowerCase().includes(q)) : entries;
  if (!filtered.length){ list.innerHTML = `<div class="chat-empty">${q ? 'Aucun utilisateur trouvé.' : 'Aucun client pour le moment.'}</div>`; list.scrollTop = 0; return; }
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
  list.scrollTop = resetScroll ? 0 : _prevTop;   // entrée/back/recherche → haut ; refresh live → position gardée
}

// Optimiste : marque un thread comme lu DANS LE CACHE LOCAL + recalcule le badge tout de suite.
// (Le serveur est la source de vérité : via GET/POST : mais ceci évite que la pastille « traîne »
//  le temps d'un aller-retour ou d'un cache serveur de 5 min. Fini « j'ai répondu mais la notif reste ».)
function _chatMarkThreadRead(uid, lastText){
  const ts = (_chatInboxData && _chatInboxData.threads) || [];
  const t = ts.find(x => String(x.user_id) === String(uid));
  if (t) {
    t.unread = 0;
    // lastText fourni (ex. je viens de répondre) → on met à jour l'aperçu + l'horodatage pour que
    // la conversation REMONTE en tête de l'inbox tout de suite (le tri par récence fait le reste).
    if (lastText != null) {
      let p = String(lastText);
      if (/^data:image\//.test(p)) p = '📷 Image';
      else if (/^data:/.test(p))   p = '📎 Pièce jointe';
      else p = p.slice(0, 120);
      t.last = p; t.lastAt = new Date().toISOString();
    }
  }
  if (typeof _chatSetBadge === 'function') _chatSetBadge(ts.filter(x => (x.unread || 0) > 0).length);
  _chatInboxCache = _chatInboxData;
  try { _chatLSSet('inbox', _chatInboxData); } catch {}
}
function _chatOpenThread(userId, name){
  _chatThreadUser = userId; _chatThreadName = name;
  const sb = document.getElementById('chat-search-bar'); if (sb) sb.style.display = 'none';   // pas de recherche dans une conv
  _chatHead(name, 'Vous répondez en tant que support', true, true, _chatUserPresence(userId) || { online: false, lastSeen: null });
  const list = document.getElementById('chat-list');
  const cached = _chatMsgCache[userId];
  if (cached){ _chatSig = _sigMsgs(cached); _chatRender(cached); }   // instantané
  else { _chatSig=''; if (list) list.innerHTML = (window.dtpLoader ? window.dtpLoader('Chargement…') : '<div class="chat-empty">Chargement…</div>'); }
  fetch('/api/admin/chat/'+encodeURIComponent(userId)).then(r=>r.json()).then(d=>{
    const msgs = d.messages||[];
    _chatMsgCache[userId] = msgs;
    _chatPersistMsgs();
    const sig = _sigMsgs(msgs);
    if (sig !== _chatSig){ _chatSig = sig; _chatRender(msgs); }   // côté support : 'support'=droite, 'user'=gauche
    _chatUpdateHeadPresence(d);    // présence FRAÎCHE (online/lastSeen) dans l'en-tête
    _chatMarkThreadRead(userId);   // lu → badge à jour TOUT DE SUITE (indépendant du cache serveur)
    _chatPollUnread();             // la conversation vient d'être lue → MAJ immédiate du badge
  }).catch(()=>{ /* échec transitoire : on garde le loader ; le live tick (4s) réessaie tout seul */ });
}

function _chatRender(messages){
  const list = document.getElementById('chat-list'); if(!list) return;
  if(!messages || !messages.length){
    list.innerHTML = '<div class="chat-empty">Vous êtes connecté au support DataTradingPro.<br>Nos spécialistes sont prêts : comment pouvons-nous vous aider ?</div>';
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
    // Menu ⋯ (modifier / supprimer) : SÉPARÉ des réactions, côté support uniquement
    const menu = support
      ? `<div class="chat-msg-menu"><button class="chat-menu-btn" type="button" title="Options" onclick="_chatToggleMenu(this)">⋯</button></div>`
      : '';
    html += `<div class="chat-row ${mine?'chat-row--me':'chat-row--them'}" data-mid="${mid}">`
      + (mine?'':`<div class="chat-av${avThemIsPhoto?' has-photo':''}">${avThem}</div>`)
      + `<div class="chat-bubble-wrap">`
      + `<div class="chat-bubble-row">`
      + `<div class="chat-bubble${isImg?' chat-bubble--img':''}">${inner}${_chatPickerHtml(mid)}${_chatReactionsHtml(m, myId, mid)}</div>`
      + menu
      + `</div>`
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
function _chatPickerHtml(mid){ return ''; }   // réactions retirées du chat (demande utilisateur)
// Pastilles des réactions POSÉES (façon LinkedIn) : sous la bulle ; surlignées si J'AI réagi.
function _chatReactionsHtml(m, myId, mid){ return ''; }   // réactions retirées du chat (demande utilisateur)

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

// Réagir à un message (toggle) : INSTANTANÉ (optimiste, MAJ ciblée) puis persistance serveur.
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

// Admin : supprimer un message : confirmation INLINE dans le message (plus de fenêtre native)
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
// Admin : modifier le texte d'un message : édition INLINE dans la bulle (plus de fenêtre native)
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

// Lightbox image (dans le panneau chat) : clic sur le fond pour revenir au chat
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
    _chatMsgCache.client = msgs; _chatPersistMsgs();
    const sig = _sigMsgs(msgs);
    if (sig !== _chatSig){ _chatSig = sig; _chatRender(msgs); }
    _chatSetBadge(0);   // ouvert → réponses lues
  }).catch(()=>{ /* échec transitoire : on garde le loader ; le rafraîchissement live (4s) réessaie tout seul */ });
}

// Envoi générique (texte OU data URL d'une pièce jointe) vers le bon endpoint
function _chatPost(text){
  if (!text) return;
  if (_chatIsSupport() && _chatThreadUser){
    const _uid = _chatThreadUser;
    return fetch('/api/admin/chat/'+encodeURIComponent(_uid),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})})
      .then(r=>r.json()).then(()=>{ _chatMarkThreadRead(_uid, text); _chatOpenThread(_uid,_chatThreadName); }).catch(()=>{});   // répondre = lu + remonte la conv en tête
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
  // Juste les vignettes (chacune avec sa croix) : envoi avec Entrée, annulation via la croix.
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
  const _c=document.getElementById('chat-btn'); if(_c) _c.classList.toggle('tb-alert', n>0);   // anime l'icône messages tant qu'il y a du non-lu
}
// Le badge reflète EN PERMANENCE les messages non lus et ne se vide QUE lorsque la
// conversation est ouverte (côté support) / lue (côté client). On ne le coupe donc PAS
// quand le panneau est ouvert : tant que la conversation n'est pas ouverte, la notif reste.
let _chatSeen = true;          // plancher badge « bienvenue » : true par défaut → pas de badge tant qu'on ne sait pas
let _chatSeenFetched = false;
// 1re ouverture du chat (client) → on retient « vu » (KV durable) et on retire le plancher du badge.
function _chatMarkWelcomeSeen(){
  if (_chatSeen) return;
  _chatSeen = true;
  try { fetch('/api/chat-seen', { method:'POST' }); } catch {}
  _chatPollUnread();
}
function _chatPollUnread(){
  if (_chatIsSupport()){
    // côté support : nombre de PERSONNES qui ont écrit (threads avec au moins 1 message non lu)
    fetch('/api/admin/chat').then(r=>r.json())
      .then(d=>_chatSetBadge((d.threads||[]).filter(t=>(t.unread||0)>0).length))
      .catch(()=>{});
    return;
  }
  // Plancher durable (KV) : message de bienvenue reçu mais chat JAMAIS ouvert → la notif s'affiche même si le
  // compteur DB chatUnread est indisponible (blackout egress). Le compteur DB prime quand il est dispo.
  if (!_chatSeenFetched){
    _chatSeenFetched = true;
    fetch('/api/chat-seen').then(r=>r.json()).then(d=>{ _chatSeen = !!d.seen; _chatPollUnread(); }).catch(()=>{});
  }
  fetch('/api/chat/unread').then(r=>r.json())
    .then(d=>_chatSetBadge((d.unread||0) || (_chatSeen ? 0 : 1)))
    .catch(()=>_chatSetBadge(_chatSeen ? 0 : 1));   // fetch KO (blackout) → on garde au moins le plancher
}
// ── Notif chat INSTANTANEE : le serveur pousse chat_new/chat_typing sur le WS deja ouvert (news) -> badge +
//    conversation mis a jour TOUT DE SUITE, sans polling ni rafraichissement. Le poll 8s reste en filet. ──
function _chatOnPush(msg){
  var isSupport = (typeof _chatIsSupport === 'function') && _chatIsSupport();
  var forMe = (isSupport && msg && msg.sender === 'user') || (!isSupport && msg && msg.sender === 'support');
  if (!forMe) return;
  try { _chatPollUnread(); } catch(e){}                                    // badge instantane
  var panelOpen = !!(document.getElementById('chat-panel') && document.getElementById('chat-panel').classList.contains('open'));
  if (panelOpen) { try { _chatLiveTick(); } catch(e){} }                   // conversation ouverte -> le message apparait tout de suite
  if (!panelOpen || document.visibilityState === 'hidden') { try { _chatNotify(); } catch(e){} }   // sinon -> attirer l'attention
}
function _chatOnTypingPush(msg){
  var isSupport = (typeof _chatIsSupport === 'function') && _chatIsSupport();
  var forMe = (isSupport && msg && msg.sender === 'user') || (!isSupport && msg && msg.sender === 'support');
  if (!forMe) return;
  var panelOpen = !!(document.getElementById('chat-panel') && document.getElementById('chat-panel').classList.contains('open'));
  if (panelOpen) { try { _chatLiveTick(); } catch(e){} }                   // « en train d'écrire » sans attendre le poll
}
var _chatTitleOrig = null, _chatTitleT = null;
function _chatNotify(){
  try { var AC = window.AudioContext || window.webkitAudioContext; if (AC){ var a = new AC(); var o = a.createOscillator(), g = a.createGain(); o.connect(g); g.connect(a.destination); o.type='sine'; o.frequency.value = 880; g.gain.setValueAtTime(0.0001, a.currentTime); g.gain.exponentialRampToValueAtTime(0.06, a.currentTime+0.02); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime+0.28); o.start(); o.stop(a.currentTime+0.3); } } catch(e){}
  try {
    if (document.visibilityState === 'visible') return;
    if (_chatTitleOrig === null) _chatTitleOrig = document.title;
    var on = false; clearInterval(_chatTitleT);
    _chatTitleT = setInterval(function(){ document.title = on ? _chatTitleOrig : '💬 Nouveau message : DataTradingPro'; on = !on; }, 1100);
    var stop = function(){ if (document.visibilityState === 'visible'){ clearInterval(_chatTitleT); if (_chatTitleOrig !== null){ document.title = _chatTitleOrig; } document.removeEventListener('visibilitychange', stop); } };
    document.addEventListener('visibilitychange', stop);
  } catch(e){}
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


/* ── Dropdown custom DTP : remplace les <select> natifs par un menu stylé (panneau en portail -> aucun clipping). ── */
(function(){
  let _openDD = null;
  function _close(){ if(!_openDD) return; _openDD.classList.remove('open'); var p=_openDD._panel; if(p&&p.parentNode) p.parentNode.removeChild(p); _openDD=null; }
  document.addEventListener('mousedown', function(e){ if(_openDD && !_openDD.contains(e.target) && !(_openDD._panel&&_openDD._panel.contains(e.target))) _close(); });
  document.addEventListener('keydown', function(e){ if(e.key==='Escape') _close(); });
  // Fermer sur scroll EXTÉRIEUR seulement : un scroll DANS le panneau (molette ou glisser la
  // scrollbar) ne doit pas fermer le menu. En phase capture, e.target = l'élément réellement scrollé.
  window.addEventListener('scroll', function(e){
    if(!_openDD) return;
    var p=_openDD._panel, t=e.target;
    if(p && t && t.nodeType===1 && (t===p || p.contains(t))) return;   // scroll interne au panneau → garder ouvert
    _close();
  }, true);
  window.addEventListener('resize', _close);
  function _flag(flags,v){ return flags[v] ? '<span class="dtpsel-flag">'+flags[v]+'</span>' : ''; }
  function _renderBtn(sel,dd,flags){ var o=sel.options[sel.selectedIndex]||sel.options[0]; if(!o) return; dd._lbl.innerHTML=_flag(flags,o.value)+'<span>'+o.text+'</span>'; }
  function _open(sel,dd,flags){
    _close();
    var panel=document.createElement('div'); panel.className='dtpsel-panel'; dd._panel=panel;
    Array.prototype.forEach.call(sel.options,function(o){
      var it=document.createElement('div'); it.className='dtpsel-item'+(o.selected?' sel':'');
      it.innerHTML=_flag(flags,o.value)+'<span>'+o.text+'</span>';
      it.addEventListener('click',function(ev){ ev.stopPropagation(); sel.value=o.value; _renderBtn(sel,dd,flags); _close(); sel.dispatchEvent(new Event('change',{bubbles:true})); });
      panel.appendChild(it);
    });
    var r=dd._btn.getBoundingClientRect();
    panel.style.position='fixed'; panel.style.left=r.left+'px'; panel.style.top=(r.bottom+5)+'px'; panel.style.minWidth=r.width+'px';
    document.body.appendChild(panel);
    var ph=panel.getBoundingClientRect().height;
    if(r.bottom+5+ph>window.innerHeight && r.top-5-ph>0) panel.style.top=(r.top-5-ph)+'px';
    dd.classList.add('open'); _openDD=dd;
  }
  window.enhanceSelect=function(sel,flags){
    flags=flags||{};
    if(!sel||sel.dataset.enhanced||sel.multiple) return; sel.dataset.enhanced='1';
    sel.classList.add('dtpsel-native');
    var dd=document.createElement('div'); dd.className='dtpsel';
    var btn=document.createElement('div'); btn.className='dtpsel-btn'; btn.tabIndex=0; btn.setAttribute('role','button');
    var lbl=document.createElement('span'); lbl.className='dtpsel-lbl';
    var caret=document.createElement('span'); caret.className='dtpsel-caret';
    caret.innerHTML='<svg width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    btn.appendChild(lbl); btn.appendChild(caret); dd._btn=btn; dd._lbl=lbl;
    btn.addEventListener('click',function(e){ e.stopPropagation(); if(_openDD===dd)_close(); else _open(sel,dd,flags); });
    btn.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){e.preventDefault(); if(_openDD===dd)_close(); else _open(sel,dd,flags);} });
    dd.appendChild(btn);
    sel.parentNode.insertBefore(dd,sel.nextSibling);
    _renderBtn(sel,dd,flags);
    sel.addEventListener('change',function(){ _renderBtn(sel,dd,flags); });
    try{ new MutationObserver(function(){ _renderBtn(sel,dd,flags); if(_openDD===dd) _open(sel,dd,flags); }).observe(sel,{childList:true}); }catch(_){}
    return dd;
  };
  window.enhanceAllSelects=function(root){ (root||document).querySelectorAll('select:not([data-enhanced]):not([data-no-enhance])').forEach(function(s){ window.enhanceSelect(s); }); };
  function _init(){
    window.enhanceAllSelects(document);
    try{ new MutationObserver(function(muts){ for(var i=0;i<muts.length;i++){ var a=muts[i].addedNodes; for(var j=0;j<a.length;j++){ var n=a[j]; if(n.nodeType!==1) continue; if(n.tagName==='SELECT'){ window.enhanceSelect(n); continue; } if(n.classList&&n.classList.contains('news-item')) continue; /* le fil (~200 .news-item par rendu/depeche) n'a AUCUN <select> -> on evite un querySelectorAll inutile par item */ if(n.querySelectorAll) n.querySelectorAll('select:not([data-enhanced])').forEach(function(s){ window.enhanceSelect(s); }); } } }).observe(document.body,{childList:true,subtree:true}); }catch(_){}
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',_init); else _init();
})();


// (Bloc anti-clic-droit / anti-F12 retiré : protection cosmétique sans valeur de sécurité, qui
//  dégradait l'UX : la vraie protection du code repose sur l'architecture serveur, cf. audit sécurité.)

// ═══════════════════ JOURNAL DE TRADING : privé, persistant PAR COMPTE (KV Supabase) ═══════════════════
// Bouton topbar (à gauche de la recherche, façon pro) → vue plein écran. Saisie INLINE (jamais de
// dialog natif), suppression avec confirmation inline, stats calculées sur les données réelles.
(function () {
  let _jrList = null;        // entrées chargées (null = pas encore fetché)
  let _jrCustom = false;     // false = gabarit DTP (options par défaut) ; true = journal PERSO importé (options de l'utilisateur uniquement, jamais mélangées au DTP)
  let _jrEdit = null;        // id en cours d'édition (null = mode ajout)
  let _jrDelPending = null;  // id en attente de confirmation de suppression
  const _jrSel = new Set();  // ids des lignes cochées (sélection multiple façon Notion → suppression groupée)
  let _jrSaveT = null;       // debounce de sauvegarde serveur
  let _jrStartCap = null;    // capital de départ du compte (pour la courbe $ Capital auto : start + cumul $PNL)
  const JR_PAIRS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'USD/CAD', 'AUD/USD', 'NZD/USD', 'EUR/GBP', 'EUR/JPY', 'GBP/JPY', 'XAU/USD', 'BTC/USD', 'US500', 'WTI'];
  const _esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // Taille de pip : JPY = 0.01 ; métaux/indices/crypto/énergie = 1 ; FX standard = 0.0001
  function _jrPipSize(pair) { const p = String(pair || ''); if (/JPY/.test(p)) return 0.01; if (/XAU|XAG|BTC|ETH|US500|US30|NAS|SPX|WTI|BRENT|OIL/i.test(p)) return 1; return 0.0001; }
  function _jrPips(e) {
    if (e.entry == null || e.exit == null) return null;
    const d = (e.exit - e.entry) * (e.dir === 'SELL' ? -1 : 1);
    return +(d / _jrPipSize(e.pair)).toFixed(1);
  }
  function _jrWin(e) {   // résultat d'un trade clôturé : P&L manuel prioritaire, sinon pips
    if (e.pl != null) return e.pl > 0 ? 1 : e.pl < 0 ? -1 : 0;
    const p = _jrPips(e);
    return p == null ? null : (p > 0 ? 1 : p < 0 ? -1 : 0);
  }
  // Résultat UNIFIÉ d'un trade (cascade) : colonne R → P&L/pips (_jrWin) → colonne Résultat (Profit/TP/BE/SL/Loss).
  // → le taux de réussite n'affiche plus jamais « — » pour un journal importé qui n'a que le $PNL ou le Résultat.
  function _jrOutcome(e) {
    const r = parseFloat(e.r); if (isFinite(r)) return r > 0 ? 1 : r < 0 ? -1 : 0;
    const w = _jrWin(e); if (w != null) return w;
    const res = String(e.result || '');
    if (/^(profit|tp|win|gagn)/i.test(res)) return 1;
    if (/^(loss|sl|perdu|perte)/i.test(res)) return -1;
    if (/^(be|break)/i.test(res)) return 0;
    return null;
  }
  function _jrStatus(msg) { const el = document.getElementById('jr-status'); if (el) el.textContent = msg || ''; }
  // Sauvegarde FIABLE : débounce 600 ms + flag dirty ; échec → retry auto (12 s) ; fermeture d'onglet /
  // passage en arrière-plan → flush immédiat via sendBeacon (zéro perte d'édition, donnée précieuse).
  let _jrDirty = false, _jrRetryT = null;
  function _jrPayload() { const p = { entries: _jrList || [], custom: _jrCustom, cols: _jrColsToStore() }; if (_jrStartCap != null && isFinite(_jrStartCap)) p.startCap = _jrStartCap; return p; }
  function _jrSave() {
    clearTimeout(_jrSaveT); clearTimeout(_jrRetryT);
    _jrDirty = true;
    _jrStatus('Sauvegarde…');
    _jrSaveT = setTimeout(() => {
      fetch('/api/journal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(_jrPayload()) })
        .then(r => r.json()).then(j => {
          if (j && j.ok) { _jrDirty = false; _jrStatus('Enregistré ✓'); }
          else { _jrStatus('Erreur de sauvegarde : nouvel essai…'); _jrRetryT = setTimeout(_jrSave, 12000); }
        })
        .catch(() => { _jrStatus('Hors-ligne : nouvel essai automatique…'); _jrRetryT = setTimeout(_jrSave, 12000); });
    }, 600);
  }
  function _jrFlushBeacon() {
    if (!_jrDirty || !_jrList) return;
    try {
      const blob = new Blob([JSON.stringify(_jrPayload())], { type: 'application/json' });
      if (navigator.sendBeacon && navigator.sendBeacon('/api/journal', blob)) _jrDirty = false;
    } catch (e) {}
  }
  window.addEventListener('pagehide', _jrFlushBeacon);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') _jrFlushBeacon(); });
  // Purge des captures d'un trade supprimé (clé KV jrimg:<user>:<id> vidée) → zéro image orpheline en base.
  function _jrPurgeImgs(ids) {
    (ids || []).forEach(id => { try { fetch('/api/journal/img', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trade: id, images: [] }) }).catch(() => {}); } catch (e) {} });
  }
  function _jrFmtDate(ts) { try { const d = new Date(ts); const p = n => String(n).padStart(2, '0'); return p(d.getDate()) + '/' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); } catch (e) { return ''; } }
  function _jrNum(v) { return v == null ? '—' : String(v).replace('.', ','); }

  function _jrRenderStats() {
    const host = document.getElementById('jr-stats'); if (!host) return;
    const L = _jrList || [];
    const rs = L.map(e => e.r).filter(r => r != null && r !== '' && isFinite(Number(r))).map(Number);
    const totR = rs.reduce((a, b) => a + b, 0);
    const totD = L.reduce((a, e) => a + (Number(e.pl) || 0), 0);
    // Taux de réussite UNIFIÉ (R → P&L/pips → Résultat), BE exclus du dénominateur (norme trading).
    const outs = L.map(_jrOutcome).filter(o => o != null);
    const oW = outs.filter(o => o > 0).length, oL = outs.filter(o => o < 0).length;
    const wr = (oW + oL) ? Math.round(oW / (oW + oL) * 100) : null;
    const cls = v => v > 0 ? 'jr-pos' : v < 0 ? 'jr-neg' : '';
    host.innerHTML =
      '<span class="jr-stat"><i>Trades</i><b>' + L.length + '</b></span>'
      + '<span class="jr-stat"><i>Taux de réussite</i><b>' + (wr == null ? '—' : wr + '%') + '</b></span>'
      + '<span class="jr-stat"><i>Total R</i><b class="' + cls(totR) + '">' + (totR >= 0 ? '+' : '') + (Math.round(totR * 100) / 100).toString().replace('.', ',') + '</b></span>'
      + '<span class="jr-stat"><i>Total $</i><b class="' + cls(totD) + '">' + (totD >= 0 ? '+' : '') + Math.round(totD).toLocaleString('fr-FR') + ' $</b></span>';
  }

  // ═══ TRADE LOG : GRILLE ÉDITABLE FAÇON NOTION (colonnes/propriétés de l'utilisateur) ═══
  const _JR_DIR_DISP = { BUY: 'Long', SELL: 'Short' };
  const _JR_COLDEF = [
    { k: 'pair',    label: 'Paires',         type: 'title',    w: 94 },
    { k: 'ts',      label: 'Date',           type: 'date',     w: 120 },
    { k: 'result',  label: 'Résultat',       type: 'select',   w: 86 },
    { k: 'day',     label: 'Jour',           type: 'day',      w: 100 },
    { k: 'session', label: 'Session',        type: 'select',   w: 92 },
    { k: 'dir',     label: 'Direction',      type: 'select',   w: 92, disp: _JR_DIR_DISP },
    { k: 'fonda',   label: 'Force Fonda',    type: 'progress', w: 128, max: 100 },
    { k: 'conf',    label: 'Confluence',     type: 'multi',    w: 172 },
    { k: 'tf',      label: 'Unité de Temps', type: 'multi',    w: 128 },
    { k: 'setup',   label: 'Setup',          type: 'multi',    w: 172 },
    { k: 'entryT',  label: 'Entrée',         type: 'multi',    w: 144 },
    { k: 'sl',      label: 'SL',             type: 'multi',    w: 124 },
    { k: 'grade',   label: 'Note',           type: 'ring',     w: 74, max: 5 },
    { k: 'rr',      label: 'Objectif RR',    type: 'num',      w: 88 },
    { k: 'risk',    label: 'Risque %',       type: 'num',      w: 80, suffix: ' %' },
    { k: 'r',       label: 'R PNL',          type: 'num',      w: 80, signed: true },
    { k: 'pnlPct',  label: '% PNL',          type: 'num',      w: 82, suffix: ' %', signed: true },
    { k: 'pl',      label: '$PNL',           type: 'money',    w: 106, signed: true },
    { k: 'equity',  label: '$ Capital',      type: 'money',    w: 124 },
    { k: 'err',     label: 'ERREUR',         type: 'multi',    w: 132 },
    { k: 'account', label: 'Compte',         type: 'select',   w: 124 },
  ];
  // ── COLONNES PERSONNALISABLES (façon Notion), PAR COMPTE : ajout / suppr / renommer / masquer / réordonner ──
  const _JR_BUILTIN = {}; _JR_COLDEF.forEach(c => { _JR_BUILTIN[c.k] = c; });
  const _JR_CELLTYPES = ['title', 'date', 'day', 'select', 'multi', 'num', 'money', 'progress', 'ring', 'text'];
  let _jrCols = null;   // colonnes actives du compte (null = pas encore chargé)
  function _jrDefaultCols() { return _JR_COLDEF.map(c => ({ ...c, builtin: true, hidden: false })); }
  function _jrColsFromStore(stored) {
    if (!Array.isArray(stored) || !stored.length) return _jrDefaultCols();
    const seen = new Set(), cols = [];
    for (const s of stored) {
      const k = String((s && s.k) || '').slice(0, 32); if (!k || seen.has(k)) continue; seen.add(k);
      if (s.builtin !== false && _JR_BUILTIN[k]) cols.push({ ..._JR_BUILTIN[k], builtin: true, label: String(s.label || _JR_BUILTIN[k].label).slice(0, 40), hidden: !!s.hidden });
      else { const type = _JR_CELLTYPES.includes(s.type) ? s.type : 'text'; cols.push({ k, label: String(s.label || k).slice(0, 40), type, builtin: false, hidden: !!s.hidden, w: Math.max(70, Math.min(280, +s.w || 130)) }); }
    }
    if (!cols.some(c => c.k === 'pair')) cols.unshift({ ..._JR_BUILTIN.pair, builtin: true, hidden: false });
    return cols;
  }
  function _jrColsToStore() { return (_jrCols || []).map(c => c.builtin ? { k: c.k, builtin: true, label: c.label, hidden: !!c.hidden } : { k: c.k, builtin: false, label: c.label, type: c.type, hidden: !!c.hidden, w: c.w }); }
  function _jrGet(e, col) { return col.builtin ? e[col.k] : (e.props && e.props[col.k]); }
  function _jrSet(e, col, v) { if (col.builtin) e[col.k] = v; else { e.props = e.props || {}; e.props[col.k] = v; } }
  function _jrColsVisible() { return (_jrCols || _jrDefaultCols()).filter(c => !c.hidden); }

  // Gabarit d'options PAR DÉFAUT du DTP : proposé tant qu'aucun import perso n'a personnalisé le journal.
  // Dès qu'un compte importe (_jrCustom=true), on n'affiche QUE ses options (pas de mélange avec le DTP).
  const _JR_DTP_DEFAULTS = {
    result:  ['Profit', 'TP', 'BE', 'SL', 'Loss'],
    session: ['London', 'New York', 'Asia', 'Sydney'],
    dir:     ['BUY', 'SELL'],
    conf:    ['Trend', 'Structure', 'Support/Résistance', 'Fibonacci', 'Order Block', 'Liquidité', 'Divergence', 'News'],
    tf:      ['M5', 'M15', 'M30', 'H1', 'H4', 'Daily', 'Weekly'],
    setup:   ['Breakout', 'Reversal', 'Continuation', 'Pullback', 'Range'],
    entryT:  ['Break', 'Retest', 'Rejet', 'Pullback'],
    sl:      ['Serré', 'Normal', 'Large', 'Structure'],
    err:     ['FOMO', 'Sur-risque', 'Entrée anticipée', 'SL trop serré', 'Revenge trade', 'Hors plan'],
    account: ['Main Account', 'Démo', 'Funded'],
  };
  const _JR_STRUCT = { result: 1, dir: 1 };   // colonnes structurelles : options de base toujours proposées
  const _JR_CHIPS = [
    { bg: 'rgba(127,179,255,.15)', fg: '#a8ccff', bd: 'rgba(127,179,255,.32)' },
    { bg: 'rgba(255,196,120,.15)', fg: '#ffd093', bd: 'rgba(255,196,120,.32)' },
    { bg: 'rgba(120,230,170,.14)', fg: '#8ef0bd', bd: 'rgba(120,230,170,.30)' },
    { bg: 'rgba(255,140,180,.15)', fg: '#ffa6c6', bd: 'rgba(255,140,180,.32)' },
    { bg: 'rgba(186,140,255,.15)', fg: '#ccaaff', bd: 'rgba(186,140,255,.32)' },
    { bg: 'rgba(255,168,120,.15)', fg: '#ffba93', bd: 'rgba(255,168,120,.32)' },
    { bg: 'rgba(120,224,224,.14)', fg: '#8fe6e6', bd: 'rgba(120,224,224,.30)' },
    { bg: 'rgba(206,220,130,.14)', fg: '#dde88f', bd: 'rgba(206,220,130,.30)' },
    { bg: 'rgba(165,170,190,.14)', fg: '#c2c6d6', bd: 'rgba(165,170,190,.30)' },
  ];
  const _JR_SEMCOL = {
    result:  { profit: '#00e676', tp: '#00cc99', be: '#ffb300', sl: '#ff8f00', loss: '#ff3d00' },
    dir:     { buy: '#00e676', long: '#00e676', sell: '#ff3d00', short: '#ff3d00' },
    session: { london: '#7fb3ff', 'new york': '#ffb27f', us: '#ffb27f', asia: '#c5a3ff', sydney: '#8fe6e6' },
  };
  function _jrHash(s) { let h = 0; s = String(s || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
  function _jrHexChip(hex) {
    const n = hex.replace('#', ''), r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16), lt = c => Math.round(c + (255 - c) * 0.58);
    return { bg: 'rgba(' + r + ',' + g + ',' + b + ',.19)', fg: 'rgb(' + lt(r) + ',' + lt(g) + ',' + lt(b) + ')', bd: 'rgba(' + r + ',' + g + ',' + b + ',.42)' };
  }
  function _jrChip(colKey, value) {
    const sem = _JR_SEMCOL[colKey] && _JR_SEMCOL[colKey][String(value).toLowerCase()];
    return sem ? _jrHexChip(sem) : _JR_CHIPS[_jrHash(colKey + '|' + value) % _JR_CHIPS.length];
  }
  function _jrChipHtml(text, c) { return '<span class="jr-chip" style="background:' + c.bg + ';color:' + c.fg + ';border-color:' + c.bd + '">' + _esc(text) + '</span>'; }
  function _jrOptions(col) {
    const set = new Map(), add = v => { v = String(v == null ? '' : v).trim(); if (v) { const k = v.toLowerCase(); if (!set.has(k)) set.set(k, v); } };
    if (col.builtin && (_JR_STRUCT[col.k] || !_jrCustom)) (_JR_DTP_DEFAULTS[col.k] || []).forEach(add);   // gabarit DTP (colonnes builtin uniquement)
    for (const e of (_jrList || [])) { const v = _jrGet(e, col); if (Array.isArray(v)) v.forEach(add); else add(v); }   // + valeurs réelles (perso / colonnes custom)
    return Array.from(set.values());
  }
  const _JR_MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const _JR_DAYS_EN = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  function _jrFmtDateFr(ts) { try { const d = new Date(ts); return d.getDate() + ' ' + _JR_MONTHS_FR[d.getMonth()] + ' ' + d.getFullYear(); } catch (e) { return '—'; } }
  function _jrDayEn(ts) { try { return _JR_DAYS_EN[new Date(ts).getDay()]; } catch (e) { return ''; } }
  function _jrTsToInput(ts) { try { const d = new Date(ts), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); } catch (e) { return ''; } }
  function _jrFmtNum(v, signed) { if (v == null || v === '') return ''; const n = Number(v); if (!isFinite(n)) return _esc(String(v)); const s = (Math.round(n * 100) / 100).toString().replace('.', ','); return (signed && n > 0 ? '+' : '') + s; }
  function _jrRingHtml(val, max) {
    const f = Math.max(0, Math.min(1, val / (max || 5))), R = 8.5, C = 2 * Math.PI * R, c = f >= 0.8 ? '#00e676' : f >= 0.5 ? '#ffb300' : '#e3b23a';
    return '<span class="jr-ring"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="' + R + '" fill="none" stroke="#26262c" stroke-width="2.6"/><circle cx="12" cy="12" r="' + R + '" fill="none" stroke="' + c + '" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="' + (f * C).toFixed(2) + ' ' + C.toFixed(2) + '" transform="rotate(-90 12 12)"/></svg><b>' + _jrFmtNum(val) + '</b></span>';
  }
  function _jrCell(e, col) {
    const v = _jrGet(e, col);
    switch (col.type) {
      case 'title': return '<span class="jr-cv-title">' + (e.pair ? _esc(e.pair) : '<i class="jr-ph">Sans titre</i>') + '</span><button class="jrd-open" data-open="' + _esc(e.id) + '" title="Ouvrir le trade"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.5h4v4M13.5 2.5l-5.5 5.5M6.5 13.5h-4v-4M2.5 13.5l5.5-5.5"/></svg><span>OUVRIR</span></button>';
      case 'text': return (v == null || v === '') ? '<i class="jr-ph">—</i>' : '<span class="jr-cv-text">' + _esc(v) + '</span>';
      case 'date': { const ts = col.builtin ? e.ts : v; return ts ? '<span class="jr-cv-date">' + _jrFmtDateFr(ts) + '</span>' : '<i class="jr-ph">—</i>'; }
      case 'day': { const d = e.ts ? _jrDayEn(e.ts) : ''; return d ? _jrChipHtml(d, _JR_CHIPS[8]) : '<i class="jr-ph">—</i>'; }
      case 'select': { if (v == null || v === '') return '<i class="jr-ph">—</i>'; return _jrChipHtml((col.disp && col.disp[v]) || v, _jrChip(col.k, v)); }
      case 'multi': { const arr = Array.isArray(v) ? v : (v ? [v] : []); return arr.length ? arr.map(x => _jrChipHtml(x, _jrChip(col.k, x))).join('') : '<i class="jr-ph">—</i>'; }
      case 'num': { if (v == null || v === '') return '<i class="jr-ph">—</i>'; const n = Number(v), cls = col.signed ? (n > 0 ? 'jr-pos' : n < 0 ? 'jr-neg' : '') : ''; return '<span class="jr-cv-num ' + cls + '">' + _jrFmtNum(v, col.signed) + (col.suffix || '') + '</span>'; }
      case 'money': { if (v == null || v === '') return '<i class="jr-ph">—</i>'; const n = Number(v), cls = col.signed ? (n > 0 ? 'jr-pos' : n < 0 ? 'jr-neg' : '') : ''; return '<span class="jr-cv-num ' + cls + '">' + (col.signed && n > 0 ? '+' : '') + n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' $</span>'; }
      case 'progress': { if (v == null || v === '') return '<i class="jr-ph">—</i>'; const pct = Math.max(0, Math.min(100, Number(v) / (col.max || 100) * 100)), bc = pct >= 87.5 ? '#00e676' : pct >= 62.5 ? '#ffb300' : '#e3b23a'; return '<div class="jr-prog"><div class="jr-prog-t"><i style="width:' + pct + '%;background:' + bc + '"></i></div><span class="jr-prog-l">' + _jrFmtNum(v) + ' %</span></div>'; }
      case 'ring': return (v == null || v === '') ? '<i class="jr-ph">—</i>' : _jrRingHtml(Number(v), col.max || 5);
    }
    return '';
  }
  function _jrPaint(td, e, col) { td.innerHTML = _jrCell(e, col); }
  function _jrRenderToolbar() {
    const host = document.getElementById('jr-toolbar'); if (!host) return;
    host.innerHTML =
      '<button type="button" class="jr-tb-btn jr-tb-btn--add" id="jr-add">+ Nouveau</button>'
      + '<button type="button" class="jr-tb-btn" id="jr-import" title="Importer un export Notion (.zip ou CSV) ou un CSV exporté d’Excel : tes colonnes deviennent TON journal">&#8593; Importer (Notion / CSV)</button>'
      + '<input type="file" id="jr-import-file" accept=".zip,.csv,.tsv,.txt,application/zip,application/x-zip-compressed,text/csv,text/tab-separated-values" style="display:none">'
      + '<button type="button" class="jr-tb-btn" id="jr-props" title="Afficher / masquer des propriétés">&#9881; Propriétés</button>'
      + '<button type="button" class="jr-tb-btn" id="jr-export" title="Télécharger ton journal en CSV (ré-importable ici, lisible dans Excel)">&#8595; Exporter (CSV)</button>'
      + '<span class="jr-tb-spacer"></span>'
      + '<span class="jr-tb-mode ' + (_jrCustom ? 'jr-tb-mode--perso' : '') + '">' + (_jrCustom ? '● Journal perso' : '○ Gabarit DTP') + '</span>';
    const add = document.getElementById('jr-add'); if (add) add.onclick = _jrAddRow;
    const pr = document.getElementById('jr-props'); if (pr) pr.onclick = () => _jrPropsMenu(pr);
    const imp = document.getElementById('jr-import'), f = document.getElementById('jr-import-file');
    if (imp && f) { imp.onclick = () => f.click(); f.onchange = ev => _jrImportFile(ev); }
    const ex = document.getElementById('jr-export'); if (ex) ex.onclick = _jrExportCsv;
  }
  // Export CSV (round-trip avec l'import : mêmes libellés d'en-têtes → ré-importable tel quel).
  // Anti lock-in + sauvegarde personnelle : délimiteur ';' (Excel FR), BOM UTF-8, dates lisibles.
  function _jrExportCsv() {
    const L = _jrList || [];
    if (!L.length) { _jrStatus('Rien à exporter : le journal est vide.'); return; }
    const cols = _jrColsVisible().filter(c => c.k !== 'day');   // Jour = dérivé de la date, inutile en CSV
    const esc = v => { const s = String(v == null ? '' : v); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const fmtVal = (e, c) => {
      let v = _jrGet(e, c);
      if (c.k === 'ts') { try { const d = new Date(e.ts); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); } catch (er) { return ''; } }
      if (Array.isArray(v)) return v.join(', ');
      return v == null ? '' : v;
    };
    const lines = [cols.map(c => esc(c.label)).join(';')];
    for (const e of L) lines.push(cols.map(c => esc(fmtVal(e, c))).join(';'));
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const name = 'journal-dtp-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '.csv';
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    _jrStatus(L.length + ' trade(s) exporté(s) → ' + name);
  }
  function _jrAddRow() {
    if (!_jrList) _jrList = [];
    const e = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: Date.now(), pair: '', dir: 'BUY', lots: null, entry: null, exit: null, pl: null, note: '', result: '', session: '', grade: '', account: '', fonda: null, rr: null, risk: null, r: null, pnlPct: null, equity: null, conf: [], entryT: [], err: [], setup: [], tf: [], sl: [], props: {} };
    _jrList.unshift(e); _jrRender();
    setTimeout(() => { const td = document.querySelector('#jr-grid tbody tr[data-id="' + e.id + '"] td[data-k="pair"]'); if (td) _jrEditCell(td); }, 30);
  }

  function _jrRenderGrid() {
    const tbl = document.getElementById('jr-grid'); if (!tbl) return;
    const cols = _jrColsVisible();
    const L = (_jrList || []).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const allOn = L.length && L.every(e => _jrSel.has(e.id));
    const span = cols.length + 2;   // colonne de sélection (gauche) + colonnes + colonne actions (droite)
    const head = '<thead><tr>'
      + '<th class="jr-th-sel"><span class="jr-selall' + (allOn ? ' jr-rowsel--on' : '') + '" title="Tout sélectionner"></span></th>'
      + cols.map(c => '<th class="jr-th" draggable="true" data-k="' + _esc(c.k) + '" style="min-width:' + (c.w || 110) + 'px"><span class="jr-th-lbl">' + _esc(c.label) + '</span><b class="jr-th-caret">▾</b></th>').join('') + '<th class="jr-th-addcol" id="jr-addcol" title="Ajouter une propriété">+</th></tr></thead>';
    if (!L.length) {
      tbl.innerHTML = head + '<tbody><tr><td class="jr-empty" colspan="' + span + '">'
        + '<div class="jr-empty-wrap">'
        + '<div class="jr-empty-ic"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h7M9 11h5"/></svg></div>'
        + '<div class="jr-empty-title">Ton journal est prêt</div>'
        + '<div class="jr-empty-sub">Consigne ton premier trade ou importe ton journal existant : statistiques, courbe de performance et tableau de bord se construisent automatiquement.</div>'
        + '<div class="jr-empty-actions">'
        + '<button type="button" class="jr-tb-btn jr-tb-btn--add jr-addrow">+ Ajouter un trade</button>'
        + '<button type="button" class="jr-tb-btn" id="jr-empty-import" title="Importer un export Notion (.zip ou CSV) ou un CSV exporté d’Excel : tes colonnes deviennent ton journal">&#8593; Importer (Notion / CSV)</button>'
        + '</div></div></td></tr></tbody>';
      const ei = document.getElementById('jr-empty-import');
      if (ei) ei.onclick = () => { const f = document.getElementById('jr-import-file'); if (f) f.click(); };
      _jrUpdateSelBar(); return;
    }
    tbl.innerHTML = head + '<tbody>' + L.map(e =>
      '<tr data-id="' + _esc(e.id) + '"' + (_jrSel.has(e.id) ? ' class="jr-row--sel"' : '') + '>'
      + '<td class="jr-c-sel"><span class="jr-rowsel' + (_jrSel.has(e.id) ? ' jr-rowsel--on' : '') + '" data-id="' + _esc(e.id) + '" title="Sélectionner"></span></td>'
      + cols.map(c => '<td class="jr-c jr-c--' + c.type + '" data-k="' + c.k + '">' + _jrCell(e, c) + '</td>').join('')
      + '<td class="jr-c-act">' + (_jrDelPending === e.id ? '<button class="jr-rowdel jr-rowdel--c" data-act="del">Suppr. ?</button>' : '<button class="jr-rowdel" data-act="del" title="Supprimer">&#10005;</button>') + '</td>'
      + '</tr>').join('')
      // Ligne « + Nouveau trade » sous la dernière ligne (façon Notion) → crée un trade et ouvre l'édition de la paire.
      + '<tr class="jr-addrow"><td class="jr-addrow-cell" colspan="' + span + '"><span class="jr-addrow-ic">+</span> Nouveau trade</td></tr>'
      + '</tbody>';
    _jrUpdateSelBar();
  }

  // ── Sélection multiple façon Notion : cases à gauche → barre flottante « N sélectionné(s) · Supprimer » ──
  function _jrToggleSel(id) { if (!id) return; if (_jrSel.has(id)) _jrSel.delete(id); else _jrSel.add(id); _jrSyncSel(); }
  function _jrToggleSelAll() {
    const ids = (_jrList || []).map(x => x.id);
    const allOn = ids.length && ids.every(i => _jrSel.has(i));
    _jrSel.clear(); if (!allOn) ids.forEach(i => _jrSel.add(i));
    _jrSyncSel();
  }
  function _jrSyncSel() {   // reflète l'état des cases + lignes + barre SANS re-render complet (snappy)
    const live = new Set((_jrList || []).map(x => x.id));
    [..._jrSel].forEach(id => { if (!live.has(id)) _jrSel.delete(id); });   // purge les ids supprimés
    document.querySelectorAll('#jr-grid .jr-rowsel').forEach(s => s.classList.toggle('jr-rowsel--on', _jrSel.has(s.dataset.id)));
    document.querySelectorAll('#jr-grid tr[data-id]').forEach(tr => tr.classList.toggle('jr-row--sel', _jrSel.has(tr.dataset.id)));
    const ids = (_jrList || []).map(x => x.id), allOn = ids.length && ids.every(i => _jrSel.has(i));
    const sa = document.querySelector('#jr-grid .jr-selall'); if (sa) sa.classList.toggle('jr-rowsel--on', !!allOn);
    _jrUpdateSelBar();
  }
  function _jrUpdateSelBar() {
    let bar = document.getElementById('jr-selbar');
    const n = _jrSel.size;
    if (!n) { if (bar) bar.remove(); return; }
    if (!bar) { bar = document.createElement('div'); bar.id = 'jr-selbar'; document.body.appendChild(bar); }
    bar.innerHTML = '<span class="jr-selbar-n">' + n + ' ligne' + (n > 1 ? 's' : '') + ' sélectionnée' + (n > 1 ? 's' : '') + '</span>'
      + '<button class="jr-selbar-del" data-act="seldel">Supprimer</button>'
      + '<button class="jr-selbar-x" data-act="selclear" title="Désélectionner">✕</button>';
  }
  function _jrDelSelected() {
    if (!_jrSel.size || !_jrList) return;
    const _ids = Array.from(_jrSel);
    _jrList = _jrList.filter(x => !_jrSel.has(x.id));
    _jrSel.clear(); _jrRender(); _jrSave();
    _jrPurgeImgs(_ids);
  }

  // ── Éditeurs de cellule (popover façon Notion) ──
  let _jrPop = null, _jrPopOut = null;
  let _jrDragK = null, _jrDragEndTs = 0;   // glisser-déposer des colonnes
  function _jrPopEsc(ev) { if (ev.key === 'Escape') _jrClosePop(); }
  function _jrClosePop() { if (_jrPop) { _jrPop.remove(); _jrPop = null; } if (_jrPopOut) { document.removeEventListener('mousedown', _jrPopOut, true); document.removeEventListener('keydown', _jrPopEsc, true); _jrPopOut = null; } }
  function _jrOpenPop(anchor, html) {
    _jrClosePop();
    const p = document.createElement('div'); p.className = 'jr-pop'; p.innerHTML = html; document.body.appendChild(p);
    const r = anchor.getBoundingClientRect();
    p.style.minWidth = Math.max(r.width, 198) + 'px';
    let left = r.left, top = r.bottom + 4;
    if (left + p.offsetWidth > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - p.offsetWidth);
    if (top + p.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - p.offsetHeight - 4);
    p.style.left = left + 'px'; p.style.top = top + 'px';
    _jrPop = p;
    _jrPopOut = ev => { if (_jrPop && !_jrPop.contains(ev.target) && !anchor.contains(ev.target)) _jrClosePop(); };
    setTimeout(() => { document.addEventListener('mousedown', _jrPopOut, true); document.addEventListener('keydown', _jrPopEsc, true); }, 0);
    return p;
  }
  function _jrEditCell(td) {
    const tr = td.closest('tr'), id = tr && tr.dataset.id, k = td.dataset.k;
    const col = (_jrCols || _jrDefaultCols()).find(c => c.k === k), e = (_jrList || []).find(x => x.id === id);
    if (!col || !e || col.type === 'day') return;
    if (col.type === 'select') return _jrEditSelect(td, e, col);
    if (col.type === 'multi') return _jrEditMulti(td, e, col);
    if (col.type === 'date') return _jrEditDate(td, e, col);
    return _jrEditText(td, e, col);
  }
  function _jrEditText(td, e, col, after) {
    const isNum = ['num', 'money', 'progress', 'ring'].includes(col.type), cur = _jrGet(e, col);
    const raw = isNum ? (cur == null ? '' : String(cur).replace('.', ',')) : (cur == null ? '' : String(cur));
    const inp = document.createElement('input'); inp.className = 'jr-cell-input'; inp.value = raw;
    td.innerHTML = ''; td.appendChild(inp); inp.focus(); inp.select();
    const done = save => {
      if (save) {
        if (isNum) _jrSet(e, col, _jrParseNum(inp.value));
        else if (col.type === 'title') _jrSet(e, col, inp.value.toUpperCase().replace(/[^A-Z0-9/.\-]/g, '').slice(0, 12));
        else _jrSet(e, col, inp.value.slice(0, 160));
        _jrSave();
      }
      _jrPaint(td, e, col); _jrRenderStats(); if (after) after();
    };
    inp.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); done(true); } else if (ev.key === 'Escape') { ev.preventDefault(); done(false); } };
    inp.onblur = () => done(true);
  }
  function _jrEditDate(td, e, col, after) {
    const cur = _jrGet(e, col);
    const inp = document.createElement('input'); inp.type = 'date'; inp.className = 'jr-cell-input'; inp.value = cur ? _jrTsToInput(cur) : '';
    td.innerHTML = ''; td.appendChild(inp); inp.focus();
    const done = save => { if (save && inp.value) { const a = inp.value.split('-').map(Number); _jrSet(e, col, Date.UTC(a[0], a[1] - 1, a[2], 12, 0, 0)); _jrSave(); if (col.k === 'ts') _jrRenderGrid(); } _jrPaint(td, e, col); if (after) after(); };
    inp.onchange = () => done(true);
    inp.onkeydown = ev => { if (ev.key === 'Escape') done(false); };
    inp.onblur = () => { if (!inp.value) done(false); };
  }
  function _jrEditSelect(td, e, col, after) {
    const pop = _jrOpenPop(td, '<input class="jr-pop-search" placeholder="Rechercher / créer…"><div class="jr-pop-opts"></div>');
    const search = pop.querySelector('.jr-pop-search'), box = pop.querySelector('.jr-pop-opts');
    const set = v => { _jrSet(e, col, v); _jrSave(); _jrClosePop(); _jrPaint(td, e, col); if (after) after(); };
    const paint = filter => {
      const f = (filter || '').trim().toLowerCase(), cur = _jrGet(e, col);
      let h = _jrOptions(col).filter(o => o.toLowerCase().includes(f)).map(o => '<button class="jr-pop-opt" data-v="' + _esc(o) + '">' + _jrChipHtml((col.disp && col.disp[o]) || o, _jrChip(col.k, o)) + (String(cur) === o ? '<span class="jr-pop-ck">✓</span>' : '') + '</button>').join('');
      if (f && !_jrOptions(col).some(o => o.toLowerCase() === f)) h += '<button class="jr-pop-opt jr-pop-new" data-v="' + _esc(filter.trim()) + '">+ Créer « ' + _esc(filter.trim()) + ' »</button>';
      h += '<button class="jr-pop-opt jr-pop-clear" data-v="">— Vider —</button>';
      box.innerHTML = h;
    };
    box.addEventListener('click', ev => { const b = ev.target.closest('.jr-pop-opt'); if (b) set(b.dataset.v); });
    if (search) { search.oninput = () => paint(search.value); search.focus(); }
    paint('');
  }
  function _jrEditMulti(td, e, col, after) {
    let arr = _jrGet(e, col);
    if (!Array.isArray(arr)) { arr = arr ? [String(arr)] : []; _jrSet(e, col, arr); }
    const pop = _jrOpenPop(td, '<div class="jr-pop-multi"></div>'), wrap = pop.querySelector('.jr-pop-multi');
    let _f = '';
    const addVal = v => { v = String(v).trim().slice(0, 30); if (v && !arr.some(a => a.toLowerCase() === v.toLowerCase())) { arr.push(v); _jrSave(); _jrPaint(td, e, col); if (after) after(); } paint(''); };
    const rmVal = v => { const i = arr.findIndex(a => a === v); if (i >= 0) { arr.splice(i, 1); _jrSave(); _jrPaint(td, e, col); if (after) after(); } paint(_f); };
    const paint = filter => {
      _f = filter || ''; const f = _f.trim().toLowerCase();
      const avail = _jrOptions(col).filter(o => !arr.some(a => a.toLowerCase() === o.toLowerCase()) && o.toLowerCase().includes(f));
      let h = '<div class="jr-pop-chips">' + (arr.length ? arr.map(x => { const c = _jrChip(col.k, x); return '<span class="jr-chip" style="background:' + c.bg + ';color:' + c.fg + ';border-color:' + c.bd + '">' + _esc(x) + ' <b class="jr-chip-x" data-rm="' + _esc(x) + '">×</b></span>'; }).join('') : '<i class="jr-ph">Aucune</i>') + '</div>';
      h += '<input class="jr-pop-search" placeholder="Ajouter / créer…">';
      h += '<div class="jr-pop-opts">' + avail.map(o => '<button class="jr-pop-opt" data-add="' + _esc(o) + '">' + _jrChipHtml(o, _jrChip(col.k, o)) + '</button>').join('');
      if (f && !_jrOptions(col).some(o => o.toLowerCase() === f) && !arr.some(a => a.toLowerCase() === f)) h += '<button class="jr-pop-opt jr-pop-new" data-add="' + _esc(_f.trim()) + '">+ Créer « ' + _esc(_f.trim()) + ' »</button>';
      h += '</div>';
      wrap.innerHTML = h;
      const s = wrap.querySelector('.jr-pop-search'); if (s) { s.value = _f; s.focus(); s.oninput = () => paint(s.value); s.onkeydown = ev => { if (ev.key === 'Enter' && s.value.trim()) { ev.preventDefault(); addVal(s.value.trim()); } }; }
    };
    wrap.addEventListener('click', ev => { const a = ev.target.closest('[data-add]'), r = ev.target.closest('[data-rm]'); if (a) addVal(a.dataset.add); else if (r) rmVal(r.dataset.rm); });
    paint('');
  }

  // ── Gestion des colonnes (façon Notion) : ajouter / renommer / masquer / déplacer / supprimer ──
  function _jrAddColMenu(anchor) {
    const types = [['text', 'Texte'], ['select', 'Sélecteur'], ['multi', 'Multi-tags'], ['num', 'Nombre'], ['date', 'Date']];
    const pop = _jrOpenPop(anchor, '<div class="jr-pop-ttl">Nouvelle propriété</div><input class="jr-pop-search" id="jr-nc-name" maxlength="40" placeholder="Nom de la propriété…"><div class="jr-pop-opts">' + types.map(t => '<button class="jr-pop-opt jr-nc-type" data-t="' + t[0] + '"><span class="jr-nc-ic">' + (t[0] === 'multi' ? '☰' : t[0] === 'select' ? '◉' : t[0] === 'num' ? '#' : t[0] === 'date' ? '🗓' : 'T') + '</span> ' + t[1] + '</button>').join('') + '</div>');
    const name = pop.querySelector('#jr-nc-name'); if (name) name.focus();
    pop.querySelectorAll('.jr-nc-type').forEach(b => b.onclick = () => {
      const label = ((name && name.value) || '').trim().slice(0, 40) || 'Propriété';
      const base = label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '') || 'col';
      if (!_jrCols) _jrCols = _jrDefaultCols();
      let k = 'c_' + base, i = 1; while (_jrCols.some(c => c.k === k)) k = 'c_' + base + (++i);
      _jrCols.push({ k, label, type: b.dataset.t, builtin: false, hidden: false, w: 130 });
      _jrClosePop(); _jrRenderGrid(); _jrSave();
    });
  }
  function _jrColMenu(anchor) {
    if (!_jrCols) _jrCols = _jrDefaultCols();
    const k = anchor.dataset.k, col = _jrCols.find(c => c.k === k); if (!col) return;
    const pop = _jrOpenPop(anchor,
      '<input class="jr-pop-search" id="jr-cm-name" maxlength="40" value="' + _esc(col.label) + '" placeholder="Renommer…">'
      + '<div class="jr-pop-opts">'
      + '<button class="jr-pop-opt" data-a="left">&#8592; Déplacer à gauche</button>'
      + '<button class="jr-pop-opt" data-a="right">&#8594; Déplacer à droite</button>'
      + '<button class="jr-pop-opt" data-a="hide">&#8856; Masquer</button>'
      + (col.builtin ? '' : '<button class="jr-pop-opt jr-pop-del" data-a="del">&#128465; Supprimer la propriété</button>')
      + '</div>');
    const name = pop.querySelector('#jr-cm-name');
    const rename = () => { const v = ((name && name.value) || '').trim().slice(0, 40); if (v && v !== col.label) { col.label = v; _jrRenderGrid(); _jrSave(); } };
    if (name) { name.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); rename(); _jrClosePop(); } }; name.onblur = rename; }
    pop.querySelectorAll('.jr-pop-opt').forEach(b => b.onclick = () => {
      const a = b.dataset.a, idx = _jrCols.indexOf(col);
      if (a === 'left' && idx > 0) { _jrCols.splice(idx, 1); _jrCols.splice(idx - 1, 0, col); }
      else if (a === 'right' && idx < _jrCols.length - 1) { _jrCols.splice(idx, 1); _jrCols.splice(idx + 1, 0, col); }
      else if (a === 'hide') col.hidden = true;
      else if (a === 'del') { _jrCols.splice(idx, 1); if (!col.builtin) (_jrList || []).forEach(e => { if (e.props) delete e.props[col.k]; }); }
      _jrClosePop(); _jrRenderGrid(); _jrSave();
    });
  }
  function _jrPropsMenu(anchor) {
    if (!_jrCols) _jrCols = _jrDefaultCols();
    const pop = _jrOpenPop(anchor, '<div class="jr-pop-ttl">Propriétés affichées</div><div class="jr-pop-opts">' + _jrCols.map(c => '<button class="jr-pop-opt jr-prop-tog" data-k="' + _esc(c.k) + '"><span class="jr-prop-eye">' + (c.hidden ? '○' : '●') + '</span> ' + _esc(c.label) + '</button>').join('') + '</div>');
    pop.querySelectorAll('.jr-prop-tog').forEach(b => b.onclick = () => { const c = _jrCols.find(x => x.k === b.dataset.k); if (c) { c.hidden = !c.hidden; b.querySelector('.jr-prop-eye').textContent = c.hidden ? '○' : '●'; _jrRenderGrid(); _jrSave(); } });
  }

  // ═══════════════════ VOLET DÉTAIL (façon page Notion) ═══════════════════
  // Clic sur ⤢ OUVRIR d'une ligne → un volet glisse depuis la droite : titre éditable, TOUTES les
  // propriétés (réutilise les mêmes éditeurs que la grille via le 4e arg `after`) + sections d'analyse
  // écrites (Fonda Bias, Technical, Entry, Management, Close, Erreur). Poignée gauche pour ÉLARGIR +
  // bouton plein-largeur. Volet, largeur et état « élargi » = VOLATILS (reset au reload, comme les splitters).
  const _JR_SECT_DEF = [
    { k: 'fondaBias',  label: 'BIAIS FONDAMENTAL' },
    { k: 'technical',  label: 'ANALYSE TECHNIQUE' },
    { k: 'entry',      label: 'ENTRÉE' },
    { k: 'management', label: 'GESTION' },
    { k: 'close',      label: 'CLÔTURE' },
    { k: 'erreur',     label: 'ERREUR' },
  ];
  const _JR_PROP_IC = { title: 'T', date: '◷', day: '◷', select: '◉', multi: '☰', num: '#', money: '$', progress: '▦', ring: '◍', text: 'T' };
  let _jrDetailId = null, _jrdWidth = 0, _jrdExpanded = false;   // largeur + état élargi = volatils

  function _jrApplyWidth(pan) {
    if (window.innerWidth <= 768) { pan.style.width = ''; return; }   // mobile : plein écran (CSS)
    const maxW = Math.floor(window.innerWidth * 0.96);
    if (_jrdExpanded) { pan.style.width = Math.floor(window.innerWidth * 0.92) + 'px'; return; }
    pan.style.width = Math.max(380, Math.min(maxW, _jrdWidth || Math.min(560, maxW))) + 'px';
  }
  function _jrToggleExpand() { _jrdExpanded = !_jrdExpanded; const pan = document.getElementById('jr-detail'); if (pan) _jrApplyWidth(pan); }
  function _jrdInitResize(handle, pan) {
    if (!handle) return;
    let startX = 0, startW = 0, dragging = false;
    const move = ev => { if (!dragging) return; const dx = startX - ev.clientX; const maxW = Math.floor(window.innerWidth * 0.96); const w = Math.max(380, Math.min(maxW, startW + dx)); _jrdWidth = w; _jrdExpanded = false; pan.style.width = w + 'px'; ev.preventDefault(); };
    const up = () => { dragging = false; document.body.classList.remove('jrd-resizing'); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    handle.addEventListener('mousedown', ev => { dragging = true; startX = ev.clientX; startW = pan.getBoundingClientRect().width; document.body.classList.add('jrd-resizing'); document.addEventListener('mousemove', move); document.addEventListener('mouseup', up); ev.preventDefault(); });
  }
  function _jrDetailEls() {
    let ov = document.getElementById('jrd-overlay'), pan = document.getElementById('jr-detail');
    if (pan) return { ov, pan };
    ov = document.createElement('div'); ov.id = 'jrd-overlay'; ov.onclick = _jrCloseDetail;
    pan = document.createElement('aside'); pan.id = 'jr-detail'; pan.setAttribute('role', 'dialog');
    pan.innerHTML =
      '<div class="jrd-resize" id="jrd-resize" title="Glisser pour élargir"></div>'
      + '<div class="jrd-head">'
      +   '<button class="jrd-ic" id="jrd-close" title="Fermer · Échap"><svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8h8M8 4.5 11.5 8 8 11.5"/></svg></button>'
      +   '<button class="jrd-ic" id="jrd-expand" title="Élargir / réduire"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.5h4v4M13.5 2.5l-5.5 5.5M6.5 13.5h-4v-4M2.5 13.5l5.5-5.5"/></svg></button>'
      +   '<span class="jrd-head-lbl">Trade</span>'
      + '</div>'
      + '<div class="jrd-body" id="jrd-body"></div>';
    document.body.appendChild(ov); document.body.appendChild(pan);
    pan.querySelector('#jrd-close').onclick = _jrCloseDetail;
    pan.querySelector('#jrd-expand').onclick = _jrToggleExpand;
    _jrdInitResize(pan.querySelector('#jrd-resize'), pan);
    return { ov, pan };
  }
  function _jrdEsc(ev) { if (ev.key === 'Escape' && !document.querySelector('.jr-pop')) { ev.preventDefault(); _jrCloseDetail(); } }
  function _jrOpenDetail(id) {
    const e = (_jrList || []).find(x => x.id === id); if (!e) return;
    _jrDetailId = id;
    const { ov, pan } = _jrDetailEls();
    _jrApplyWidth(pan);
    ov.classList.add('show'); pan.classList.add('show');
    _jrRenderDetailBody(e);
    document.addEventListener('keydown', _jrdEsc, true);
  }
  function _jrCloseDetail() {
    const ov = document.getElementById('jrd-overlay'), pan = document.getElementById('jr-detail');
    if (ov) ov.classList.remove('show'); if (pan) pan.classList.remove('show');
    document.removeEventListener('keydown', _jrdEsc, true);
    _jrClosePop();
    if (_jrDetailId) { _jrRenderGrid(); _jrRenderStats(); }   // synchronise la grille avec les modifs du volet
    _jrDetailId = null;
  }
  function _jrEditDetailTitle(el, e) {
    const inp = document.createElement('input'); inp.className = 'jrd-title-input'; inp.value = e.pair || ''; inp.maxLength = 12;
    el.innerHTML = ''; el.appendChild(inp); inp.focus(); inp.select();
    const done = save => {
      if (save) { e.pair = inp.value.toUpperCase().replace(/[^A-Z0-9/.\-]/g, '').slice(0, 12); _jrSave(); }
      el.innerHTML = e.pair ? _esc(e.pair) : '<i class="jr-ph">Sans titre</i>'; _jrDetailSync(e);
    };
    inp.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); done(true); } else if (ev.key === 'Escape') { ev.preventDefault(); done(false); } };
    inp.onblur = () => done(true);
  }
  function _jrDetailSync(e) {   // met à jour le titre + le jour (dérivé de la date) + les stats SANS reconstruire (préserve les popovers ouverts)
    if (_jrDetailId !== e.id) return;
    const body = document.getElementById('jrd-body'); if (!body) return;
    const tEl = body.querySelector('#jrd-title'); if (tEl && !tEl.querySelector('input')) tEl.innerHTML = e.pair ? _esc(e.pair) : '<i class="jr-ph">Sans titre</i>';
    const dayV = body.querySelector('.jrd-prop-v[data-k="day"]'), dayCol = (_jrCols || _jrDefaultCols()).find(c => c.k === 'day');
    if (dayV && dayCol) dayV.innerHTML = _jrCell(e, dayCol);
    _jrRenderStats();
  }
  function _jrRenderDetailBody(e) {
    const body = document.getElementById('jrd-body'); if (!body) return;
    const cols = (_jrCols || _jrDefaultCols());
    let h = '<div class="jrd-titlewrap"><div class="jrd-title" id="jrd-title" title="Renommer">' + (e.pair ? _esc(e.pair) : '<i class="jr-ph">Sans titre</i>') + '</div></div>';
    h += '<div class="jrd-props">';
    for (const col of cols) {
      if (col.k === 'pair') continue;
      const ro = col.type === 'day';
      h += '<div class="jrd-prop">'
        + '<div class="jrd-prop-k"><span class="jrd-prop-ic">' + (_JR_PROP_IC[col.type] || '•') + '</span>' + _esc(col.label) + '</div>'
        + '<div class="jrd-prop-v' + (ro ? ' jrd-prop-v--ro' : '') + '" data-k="' + _esc(col.k) + '">' + _jrCell(e, col) + '</div>'
        + '</div>';
    }
    h += '</div>';
    h += '<div class="jrd-sections">';
    for (const s of _JR_SECT_DEF) {
      const val = (e.sections && e.sections[s.k]) || '';
      h += '<div class="jrd-sect"><div class="jrd-sect-h">' + s.label + '</div>'
        + '<textarea class="jrd-sect-ta" data-sk="' + s.k + '" placeholder="Ajoute ton analyse…" rows="2">' + _esc(val) + '</textarea></div>';
    }
    h += '</div>';
    // 2 blocs images (captures de graphiques) sous les sections : chargés à la demande (clé KV séparée, anti-egress).
    h += '<div class="jrd-imgs"><div class="jrd-imgs-h">Captures / images</div><div class="jrd-imgrow">'
      + '<div class="jrd-imgblock" data-slot="0"></div><div class="jrd-imgblock" data-slot="1"></div>'
      + '</div></div>';
    body.innerHTML = h;
    body.scrollTop = 0;
    const tEl = body.querySelector('#jrd-title'); if (tEl) tEl.onclick = () => _jrEditDetailTitle(tEl, e);
    body.querySelectorAll('.jrd-prop-v').forEach(v => {
      if (v.classList.contains('jrd-prop-v--ro')) return;
      v.onclick = () => {
        if (v.querySelector('.jr-cell-input')) return;
        const col = cols.find(c => c.k === v.dataset.k); if (!col) return;
        const after = () => _jrDetailSync(e);
        if (col.type === 'select') _jrEditSelect(v, e, col, after);
        else if (col.type === 'multi') _jrEditMulti(v, e, col, after);
        else if (col.type === 'date') _jrEditDate(v, e, col, after);
        else _jrEditText(v, e, col, after);
      };
    });
    body.querySelectorAll('.jrd-sect-ta').forEach(ta => {
      const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(640, ta.scrollHeight + 2) + 'px'; };
      grow(); ta.addEventListener('input', grow);
      ta.addEventListener('blur', () => {
        const v = ta.value.trim(); e.sections = e.sections || {};
        if (v) e.sections[ta.dataset.sk] = v.slice(0, 4000); else delete e.sections[ta.dataset.sk];
        if (!Object.keys(e.sections).length) delete e.sections;
        _jrSave();
      });
    });
    body.querySelectorAll('.jrd-imgblock').forEach(blk => {
      blk.onclick = ev => {
        const slot = +blk.dataset.slot;
        if (ev.target.closest('.jrd-img-del')) { ev.stopPropagation(); _jrSetImage(e.id, slot, null); return; }
        const cur = _jrImgs[e.id] && _jrImgs[e.id][slot];
        if (cur) { _jrImgLightbox(cur); return; }   // image présente → agrandir (✕ pour la retirer)
        _jrPickImage(e.id, slot);
      };
    });
    _jrLoadImages(e.id);
  }

  // ── Images du trade (captures de graphiques) : compressées côté client, stockées dans une clé KV SÉPARÉE
  //    par trade (jrimg:<user>:<id>), chargées À LA DEMANDE à l'ouverture du détail → n'alourdit JAMAIS la
  //    lecture de la liste du journal (anti-egress, cf. l'incident base64 du chat). 2 emplacements / trade.
  const _jrImgs = {};   // tradeId -> [dataUrl|null, dataUrl|null] (cache mémoire)
  function _jrRenderImgBlock(slot, dataUrl) {
    const blk = document.querySelector('#jrd-body .jrd-imgblock[data-slot="' + slot + '"]'); if (!blk) return;
    blk.classList.toggle('jrd-imgblock--filled', !!dataUrl);
    blk.innerHTML = dataUrl
      ? '<img class="jrd-img" src="' + dataUrl + '" alt="capture"><button type="button" class="jrd-img-del" data-slot="' + slot + '" title="Retirer">✕</button>'
      : '<div class="jrd-img-add"><span class="jrd-img-ic">+</span><span class="jrd-img-lbl">Ajouter une image</span></div>';
  }
  async function _jrLoadImages(id) {
    let imgs = _jrImgs[id];
    if (!imgs) {
      try { const d = await fetch('/api/journal/img?trade=' + encodeURIComponent(id)).then(r => r.json()); imgs = (d && Array.isArray(d.images)) ? d.images : []; }
      catch { imgs = []; }
      _jrImgs[id] = imgs;
    }
    if (_jrDetailId !== id) return;   // l'utilisateur a quitté le détail entre-temps
    _jrRenderImgBlock(0, imgs[0] || null); _jrRenderImgBlock(1, imgs[1] || null);
  }
  function _jrImgLightbox(src) {
    const ov = document.createElement('div'); ov.className = 'jrd-lightbox';
    const img = document.createElement('img'); img.src = src; ov.appendChild(img);
    ov.onclick = () => ov.remove();
    document.addEventListener('keydown', function esc(k) { if (k.key === 'Escape') { ov.remove(); document.removeEventListener('keydown', esc, true); } }, true);
    document.body.appendChild(ov);
  }
  function _jrPickImage(id, slot) {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) _jrCompressImage(f, durl => { if (durl) _jrSetImage(id, slot, durl); }); };
    inp.click();
  }
  function _jrSetImage(id, slot, dataUrl) {
    const imgs = _jrImgs[id] = _jrImgs[id] || [];
    imgs[slot] = dataUrl || null;
    if (_jrDetailId === id) _jrRenderImgBlock(slot, dataUrl || null);
    fetch('/api/journal/img', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trade: id, images: [imgs[0] || null, imgs[1] || null] }) }).catch(() => {});
  }
  // Compression client (canvas → JPEG ≤1280px, q0.72) → ~50-250 Ko/image : léger pour le KV + l'affichage.
  function _jrCompressImage(file, cb) {
    if (!file || !/^image\//.test(file.type)) { cb(null); return; }
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1280; let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        if (!w || !h) { cb(null); return; }
        if (w > MAX || h > MAX) { const s = MAX / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
        try { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(img, 0, 0, w, h); cb(cv.toDataURL('image/jpeg', 0.72)); }
        catch { cb(null); }
      };
      img.onerror = () => cb(null); img.src = rd.result;
    };
    rd.onerror = () => cb(null); rd.readAsDataURL(file);
  }

  function _jrRender() { _jrRenderStats(); _jrRenderToolbar(); _jrRenderGrid(); if (_jrTab === 'dash') _jrRenderDashboard(); }

  // Délégation grille : clic cellule → édition inline ; bouton suppression de ligne (confirm INLINE).
  document.addEventListener('click', ev => {
    // ── Sélection multiple (cases à gauche + barre flottante) : AVANT l'ouverture/édition de ligne ──
    const selall = ev.target.closest && ev.target.closest('#jr-grid .jr-selall');
    if (selall) { ev.stopPropagation(); _jrToggleSelAll(); return; }
    const rowsel = ev.target.closest && ev.target.closest('#jr-grid .jr-rowsel');
    if (rowsel) { ev.stopPropagation(); _jrToggleSel(rowsel.dataset.id); return; }
    const selDel = ev.target.closest && ev.target.closest('#jr-selbar [data-act="seldel"]');
    if (selDel) {   // confirmation INLINE (pas de dialog natif) : 1er clic arme, 2e clic supprime
      ev.stopPropagation();
      if (selDel.classList.contains('jr-selbar-del--c')) { _jrDelSelected(); }
      else { selDel.classList.add('jr-selbar-del--c'); selDel.textContent = 'Confirmer la suppression ?'; setTimeout(() => { if (selDel.isConnected) { selDel.classList.remove('jr-selbar-del--c'); selDel.textContent = 'Supprimer'; } }, 3500); }
      return;
    }
    const selClear = ev.target.closest && ev.target.closest('#jr-selbar [data-act="selclear"]');
    if (selClear) { ev.stopPropagation(); _jrSel.clear(); _jrSyncSel(); return; }
    const op = ev.target.closest && ev.target.closest('.jrd-open');
    if (op) { ev.stopPropagation(); _jrOpenDetail(op.dataset.open); return; }   // ⤢ OUVRIR → volet détail (façon page Notion)
    const arow = ev.target.closest && ev.target.closest('.jr-addrow');
    if (arow) { ev.stopPropagation(); _jrAddRow(); return; }                    // ligne « + Nouveau trade » sous la grille
    const del = ev.target.closest && ev.target.closest('.jr-rowdel');
    if (del) {
      const tr = del.closest('tr'), id = tr && tr.dataset.id; if (!id || !_jrList) return;
      if (_jrDelPending === id) { _jrList = _jrList.filter(x => x.id !== id); _jrDelPending = null; _jrRender(); _jrSave(); _jrPurgeImgs([id]); }
      else { _jrDelPending = id; _jrRenderGrid(); setTimeout(() => { if (_jrDelPending === id) { _jrDelPending = null; _jrRenderGrid(); } }, 3500); }
      return;
    }
    const addcol = ev.target.closest && ev.target.closest('#jr-addcol');
    if (addcol) { _jrAddColMenu(addcol); return; }
    const th = ev.target.closest && ev.target.closest('#jr-grid th.jr-th');
    if (th) { if (Date.now() - _jrDragEndTs > 200) _jrColMenu(th); return; }   // ignore le clic juste après un glisser-déposer
    const td = ev.target.closest && ev.target.closest('#jr-grid td.jr-c');
    if (td) { if (!td.querySelector('.jr-cell-input')) _jrEditCell(td); return; }
    if (_jrDelPending && !(ev.target.closest && ev.target.closest('.jr-pop'))) { _jrDelPending = null; _jrRenderGrid(); }
  });

  // ── Glisser-déposer des colonnes (réordonner les en-têtes à la souris, façon Notion) ──
  function _jrDragClean() {
    _jrDragK = null;
    document.querySelectorAll('#jr-grid th.jr-th--dragging, #jr-grid th.jr-th--drop-l, #jr-grid th.jr-th--drop-r')
      .forEach(x => x.classList.remove('jr-th--dragging', 'jr-th--drop-l', 'jr-th--drop-r'));
  }
  function _jrMoveCol(fromK, toK, after) {
    if (!_jrCols || fromK === toK) return;
    const fromIdx = _jrCols.findIndex(c => c.k === fromK); if (fromIdx < 0) return;
    const col = _jrCols.splice(fromIdx, 1)[0];
    let toIdx = _jrCols.findIndex(c => c.k === toK);
    if (toIdx < 0) { _jrCols.splice(fromIdx, 0, col); return; }
    if (after) toIdx += 1;
    _jrCols.splice(toIdx, 0, col);
    _jrRenderGrid(); _jrSave();
  }
  document.addEventListener('dragstart', ev => {
    const th = ev.target.closest && ev.target.closest('#jr-grid th.jr-th'); if (!th) return;
    _jrDragK = th.dataset.k; _jrClosePop();
    try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', _jrDragK); } catch (e) {}
    th.classList.add('jr-th--dragging');
  });
  document.addEventListener('dragover', ev => {
    if (!_jrDragK) return;
    const th = ev.target.closest && ev.target.closest('#jr-grid th.jr-th'); if (!th) return;
    ev.preventDefault(); try { ev.dataTransfer.dropEffect = 'move'; } catch (e) {}
    document.querySelectorAll('#jr-grid th.jr-th--drop-l, #jr-grid th.jr-th--drop-r').forEach(x => x.classList.remove('jr-th--drop-l', 'jr-th--drop-r'));
    if (th.dataset.k === _jrDragK) return;
    const r = th.getBoundingClientRect();
    th.classList.add(ev.clientX > r.left + r.width / 2 ? 'jr-th--drop-r' : 'jr-th--drop-l');
  });
  document.addEventListener('drop', ev => {
    if (!_jrDragK) return;
    const th = ev.target.closest && ev.target.closest('#jr-grid th.jr-th');
    if (th && th.dataset.k !== _jrDragK) {
      ev.preventDefault();
      const r = th.getBoundingClientRect();
      _jrMoveCol(_jrDragK, th.dataset.k, ev.clientX > r.left + r.width / 2);
    }
    _jrDragEndTs = Date.now(); _jrDragClean();
  });
  document.addEventListener('dragend', () => { _jrDragEndTs = Date.now(); _jrDragClean(); });

  // ── Import Excel/CSV ou export Notion (CSV) : détection auto délimiteur + colonnes ──────────
  function _jrCsvRows(text) {
    text = String(text || '').replace(/^﻿/, '');   // retire le BOM
    const fl = (text.split(/\r?\n/)[0] || '');
    // délimiteur : Excel FR = ';', Notion/standard = ',', export tableur = tab
    const tab = fl.split('\t').length, semi = fl.split(';').length, com = fl.split(',').length;
    const delim = (tab > semi && tab > com) ? '\t' : (semi > com ? ';' : ',');
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.length && r.some(x => String(x).trim() !== ''));
  }
  function _jrNorm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, ''); }
  function _jrParseNum(v) {
    let s = String(v == null ? '' : v).replace(/[^\d.,\-]/g, '').trim();
    if (!s) return null;
    if (s.indexOf(',') > -1 && s.indexOf('.') === -1) s = s.replace(',', '.');   // décimale française "1,2345"
    else s = s.replace(/,/g, '');                                                // séparateurs de milliers
    const n = parseFloat(s); return isFinite(n) ? n : null;
  }
  // Dates : gère le format Notion FRANÇAIS « 6 janvier 2026 » (Date.parse() ne sait pas) + ISO/standard en repli.
  const _JR_FRMONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
  function _jrParseDate(v) {
    const s = String(v == null ? '' : v).trim(); if (!s) return null;
    const n = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const m = n.match(/(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})/);
    if (m) { let mo = _JR_FRMONTHS.indexOf(m[2]); if (mo < 0) mo = _JR_FRMONTHS.findIndex(x => x.slice(0, 3) === m[2].slice(0, 3)); if (mo >= 0) return Date.UTC(+m[3], mo, +m[1], 12, 0, 0); }
    const p = Date.parse(s); return isNaN(p) ? null : p;
  }
  const _JR_COLS = {
    date:  ['date', 'time', 'datetime', 'jour', 'opentime', 'opened', 'dateouverture', 'datedouverture', 'closetime', 'closedate'],
    pair:  ['pair', 'pairs', 'paire', 'paires', 'symbol', 'symbole', 'instrument', 'instruments', 'ticker', 'marche', 'market', 'actif', 'actifs', 'asset', 'assets', 'trade', 'trades', 'devise', 'devises', 'currency', 'currencypair', 'cross', 'produit', 'valeur', 'titre', 'underlying', 'contrat', 'contract'],
    dir:   ['dir', 'direction', 'sens', 'side', 'position', 'buysell', 'longshort', 'ordertype', 'action'],
    lots:  ['lots', 'lot', 'size', 'volume', 'taille', 'quantity', 'qty', 'quantite', 'units', 'lotsize'],
    entry: ['openprice', 'entryprice', 'prixentree', 'prixdentree', 'priceopen'],   // PRIX d'entrée (pas les tags Entry)
    exit:  ['exit', 'sortie', 'close', 'closeprice', 'prixsortie', 'prixdesortie', 'exitprice', 'priceclose'],
    note:  ['note', 'notes', 'comment', 'commentaire', 'remarque', 'description', 'journal', 'raison'],
    // ── champs riches (journal Notion) ──
    result:  ['result', 'resultat', 'outcome', 'issue'],
    session: ['session', 'seance', 'marketsession'],
    fonda:   ['fonda', 'fondastrength', 'fondastrengh', 'fondamental', 'fundamental', 'fundamentalstrength'],
    conf:    ['confluence', 'confluences', 'confs', 'confluance'],
    tf:      ['timeframe', 'tf', 'unitetemps', 'temporalite'],
    setup:   ['setup', 'setups', 'pattern', 'configuration'],
    entryT:  ['entry', 'entree', 'entrytype', 'typeentree'],   // TAGS Entry (Retest/Fibo/Break/Reject)
    sl:      ['sl', 'stoploss', 'stop'],
    grade:   ['grade', 'rating', 'score', 'qualite'],
    rr:      ['rrtarget', 'rr', 'riskreward', 'rrcible', 'targetrr', 'reward'],
    risk:    ['risk', 'risque', 'riskpct', 'risquepct'],
    err:     ['erreur', 'erreurs', 'error', 'errors', 'mistake'],
    account: ['account', 'compte', 'broker', 'courtier'],
    equity:  ['equity', 'equityusd', 'balance', 'solde', 'capital'],
  };
  const _JR_TAG_COLS = ['conf', 'entryT', 'err'];   // colonnes multi-valeurs (tags)
  function _jrMapHeader(headers) {
    const norm = headers.map(_jrNorm), raw = headers.map(h => String(h || '').toLowerCase()), idx = {};
    for (const key in _JR_COLS) {
      const aliases = _JR_COLS[key]; let f = norm.findIndex(h => aliases.includes(h));
      if (f < 0) f = norm.findIndex(h => h && aliases.some(a => h.indexOf(a) > -1));
      idx[key] = f;
    }
    // PNL : le % et le $ sont effacés par la normalisation → on distingue R / % / $ via le header BRUT.
    const r = raw.findIndex(h => /\br\s*pnl\b|rpnl|\brmultiple\b/.test(h));
    const pct = raw.findIndex(h => /%/.test(h) && /pnl|profit/.test(h));
    const dol = raw.findIndex(h => /\$/.test(h) && /pnl|profit/.test(h));
    idx.r = r;
    idx.pnlPct = pct;
    idx.pl = dol >= 0 ? dol : norm.findIndex(h => ['pl', 'pnl', 'profit', 'gain', 'profitloss', 'net', 'netpl', 'pleur', 'gainperte'].includes(h));
    return idx;
  }
  // Repli : devine la colonne « paire » d'après ses VALEURS (EURUSD, EUR/USD, XAUUSD, GBPJPY, US30…)
  // → l'import marche même si la colonne porte un nom inattendu (« Trade », « Devise », « Setup A »…).
  function _jrGuessPairCol(rows) {
    const head = rows[0] || []; let best = -1, bestScore = 0;
    const looksPair = v => /^[A-Za-z]{3}[\/\-_ ]?[A-Za-z]{3}$/.test(v) || /^(XAU|XAG|WTI|BRENT|US30|US100|US500|NAS100|NAS|SPX|GER40|UK100|GER|BTC|ETH|XRP|SOL|DXY)[\/\-]?[A-Za-z0-9]*$/i.test(v);
    for (let c = 0; c < head.length; c++) {
      let hit = 0, tot = 0;
      for (let r = 1; r < rows.length; r++) {
        const v = String((rows[r] || [])[c] || '').trim(); if (!v) continue;
        tot++; if (looksPair(v)) hit++;
      }
      const score = tot ? hit / tot : 0;
      if (tot >= 1 && score >= 0.5 && score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }
  // Ingestion d'un texte CSV/TSV (export Notion ou Excel) → trades du journal. Renvoie le nb ajouté.
  function _jrIngestCsvText(text) {
    const rows = _jrCsvRows(text);
    if (rows.length < 2) { _jrStatus('Fichier vide ou illisible (' + rows.length + ' ligne lue)'); return 0; }
    const idx = _jrMapHeader(rows[0]);
    if (idx.pair < 0) idx.pair = _jrGuessPairCol(rows);   // repli heuristique sur les valeurs (EURUSD, XAU/USD…)
    let pairNote = '';
    if (idx.pair < 0) {
      // DERNIER REPLI : 1re colonne NON déjà mappée (en Notion = le TITRE de la page, qui contient presque
      // toujours l'instrument). → l'import ne renvoie plus JAMAIS « rien » quand les titres sont descriptifs
      // (« Trade #1 », « Long EU 12 jan »…) ; l'utilisateur voit ses trades et corrige la colonne « Pairs » ensuite.
      const claimed = new Set(Object.keys(idx).filter(k => idx[k] >= 0).map(k => idx[k]));
      const f = (rows[0] || []).findIndex((_, i) => !claimed.has(i));
      idx.pair = f >= 0 ? f : 0;
      pairNote = ' · paire lue depuis « ' + ((rows[0] || [])[idx.pair] || ('colonne ' + (idx.pair + 1))) + ' »';
    }
    console.log('[Journal import]', rows.length, 'lignes · colonnes :', rows[0], '· mapping :', idx, pairNote);
    // ── JOURNAL À L'IMAGE DU FICHIER (demande user 03/07) : les colonnes NON reconnues ne sont PLUS
    //    jetées : chacune devient une propriété personnalisée (type deviné : nombre / sélecteur /
    //    multi-tags / texte) et ses valeurs sont importées. Chaque abonné retrouve SON journal,
    //    pas le gabarit DTP. Cap 16 nouvelles colonnes (le serveur borne les props à 24/entrée). ──
    const _claimed = new Set(Object.keys(idx).filter(k => idx[k] >= 0).map(k => idx[k]));
    const _customCols = [];
    if (!_jrCols) _jrCols = _jrDefaultCols();
    (rows[0] || []).forEach((h, i) => {
      if (_claimed.has(i) || _customCols.length >= 16) return;
      const label = String(h || '').trim().slice(0, 40);
      if (!label) return;
      const vals = [];
      for (let r = 1; r < rows.length && vals.length < 120; r++) { const v = String((rows[r] || [])[i] || '').trim(); if (v) vals.push(v); }
      if (!vals.length) return;   // colonne entièrement vide → ignorée
      // Type deviné sur les valeurs réelles du fichier
      const numOk    = vals.filter(v => _jrParseNum(v) != null).length;
      const distinct = new Set(vals.map(v => v.toLowerCase())).size;
      const multiish = vals.filter(v => /[,;|]/.test(v)).length / vals.length > 0.3;
      let type = 'text';
      if (numOk / vals.length >= 0.8) type = 'num';
      else if (multiish && distinct <= 60) type = 'multi';
      else if (distinct <= 12 && vals.length >= 4 && vals.every(v => v.length <= 28)) type = 'select';
      // Clé unique : même génération que l'ajout manuel de colonne
      const base = _jrNorm(label).replace(/[^a-z0-9]/g, '').slice(0, 12) || 'col';
      let k = 'c_' + base, n = 1; while (_jrCols.some(c => c.k === k)) k = 'c_' + base + (++n);
      _jrCols.push({ k, label, type, builtin: false, hidden: false, w: 130 });
      _customCols.push({ fileIdx: i, k, type });
    });
    // Déduplication : signature (minute + paire + direction + $PNL + R) → ré-importer le même fichier
    // (usage naturel : Notion/Excel reste la source) n'ajoute AUCUN doublon, on compte les ignorés.
    const _sigOf = e => [Math.round((e.ts || 0) / 60000), e.pair, e.dir, e.pl == null ? '' : e.pl, e.r == null ? '' : e.r].join('|');
    const _have = new Set((_jrList || []).map(_sigOf));
    let added = 0, skipped = 0;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r], get = k => idx[k] >= 0 ? String(row[idx[k]] || '').trim() : '';
      const pair = get('pair').toUpperCase().replace(/[^A-Z0-9/.\-]/g, '').slice(0, 12);
      if (pair.length < 2) continue;
      const dir = /sell|short|vente|sld|sale/.test(_jrNorm(get('dir'))) ? 'SELL' : 'BUY';
      let ts = _jrParseDate(get('date')); if (ts == null) ts = Date.now();   // dates FR Notion (« 6 janvier 2026 ») + ISO
      const tag = k => idx[k] >= 0 ? String(row[idx[k]] || '').split(/[,;|]+/).map(s => s.trim()).filter(Boolean).slice(0, 12) : [];
      const _ent = ({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + r,
        ts, pair, dir,
        lots: _jrParseNum(get('lots')), entry: _jrParseNum(get('entry')), exit: _jrParseNum(get('exit')),
        pl: _jrParseNum(get('pl')), note: get('note').slice(0, 300),
        // champs riches du journal Notion → sélecteurs simples (result/session/grade/account) + multi-tags (conf/entryT/err/setup/tf/sl)
        result: get('result').slice(0, 12), session: get('session').slice(0, 24),
        grade: get('grade').slice(0, 8), account: get('account').slice(0, 32),
        fonda: _jrParseNum(get('fonda')), rr: _jrParseNum(get('rr')), risk: _jrParseNum(get('risk')),
        r: _jrParseNum(get('r')), pnlPct: _jrParseNum(get('pnlPct')), equity: _jrParseNum(get('equity')),
        conf: tag('conf'), entryT: tag('entryT'), err: tag('err'), setup: tag('setup'), tf: tag('tf'), sl: tag('sl'),
        // Valeurs des colonnes personnalisées créées depuis les en-têtes du fichier
        props: (() => {
          if (!_customCols.length) return undefined;
          const p = {};
          _customCols.forEach(cc => {
            const raw = String(row[cc.fileIdx] || '').trim(); if (!raw) return;
            if (cc.type === 'multi') { const a = raw.split(/[,;|]+/).map(s => s.trim()).filter(Boolean).slice(0, 12); if (a.length) p[cc.k] = a; }
            else p[cc.k] = raw.slice(0, 200);
          });
          return Object.keys(p).length ? p : undefined;
        })(),
      });
      if (_have.has(_sigOf(_ent))) { skipped++; continue; }
      _have.add(_sigOf(_ent));
      _jrList.unshift(_ent);
      added++;
    }
    if (_jrList.length > 500) _jrList = _jrList.slice(0, 500);
    if (added) {
      _jrCustom = true;          // import = journal PERSO (remplace le gabarit DTP, sans jamais mélanger les options)
      // Le gabarit s'efface devant le fichier : les colonnes builtin ABSENTES de l'import sont masquées
      // (réactivables via ⚙ Propriétés). pair/date/day restent (essentielles / dérivées de la date).
      const _keep = { pair: 1, date: 1, day: 1 };
      _jrCols.forEach(c => { if (c.builtin && !_keep[c.k] && !(idx[c.k] >= 0)) c.hidden = true; });
    }
    _jrEdit = null; _jrRender();
    const _ccNote = _customCols.length ? ' · ' + _customCols.length + ' propriété(s) créée(s) depuis tes colonnes' : '';
    const _dupNote = skipped ? ' · ' + skipped + ' doublon(s) ignoré(s)' : '';
    const _capNote = (_jrList.length >= 500) ? ' · cap 500 atteint : les plus anciens au-delà sont retirés' : '';
    if (added) { _jrSave(); _jrStatus(added + ' trade(s) importé(s) ✓' + _dupNote + _capNote + pairNote + _ccNote + ' : journal personnalisé'); }
    else if (skipped) {
      // Rien de neuf : tout le fichier est déjà dans le journal → on retire les colonnes créées en anticipation.
      _customCols.forEach(cc => { const ix = _jrCols.findIndex(c => c.k === cc.k); if (ix >= 0) _jrCols.splice(ix, 1); });
      _jrStatus('Aucun nouveau trade : les ' + skipped + ' ligne(s) du fichier sont déjà dans ton journal.');
      return 0;
    }
    else {
      // Import raté → on retire les colonnes personnalisées créées en anticipation (aucune valeur importée)
      _customCols.forEach(cc => { const ix = _jrCols.findIndex(c => c.k === cc.k); if (ix >= 0) _jrCols.splice(ix, 1); });
      _jrStatus('Import impossible : aucune colonne « Paire » reconnue dans le fichier (' + (rows.length - 1) + ' ligne(s) lue(s)). Vérifie que ton export contient bien une colonne paire/symbole.');
    }
    return added;
  }

  // Parse le central directory d'un ZIP (Uint8Array) → { dv, entries }.  (0 dépendance.)
  function _jrZipParse(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), n = u8.byteLength;
    let eocd = -1;
    for (let i = n - 22; i >= 0 && i >= n - 22 - 65536; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('ZIP invalide (EOCD introuvable)');
    const cdCount = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const entries = [];
    for (let k = 0; k < cdCount && off + 46 <= n; k++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true), cSize = dv.getUint32(off + 20, true), uSize = dv.getUint32(off + 24, true);
      const nameLen = dv.getUint16(off + 28, true), extLen = dv.getUint16(off + 30, true), cmtLen = dv.getUint16(off + 32, true), lhOff = dv.getUint32(off + 42, true);
      const name = new TextDecoder('utf-8').decode(u8.subarray(off + 46, off + 46 + nameLen));
      entries.push({ name, method, cSize, uSize, lhOff });
      off += 46 + nameLen + extLen + cmtLen;
    }
    return { dv, entries };
  }
  // Extrait UNE entrée (STORED ou DEFLATE brut) → Uint8Array à buffer PROPRE (réutilisable en récursion).
  async function _jrZipExtract(u8, dv, e) {
    if (dv.getUint32(e.lhOff, true) !== 0x04034b50) throw new Error('en-tête local ZIP invalide');
    const lNameLen = dv.getUint16(e.lhOff + 26, true), lExtLen = dv.getUint16(e.lhOff + 28, true);
    const dataStart = e.lhOff + 30 + lNameLen + lExtLen;
    const comp = u8.subarray(dataStart, dataStart + e.cSize);
    if (e.method === 0) return comp.slice();                              // STORED (copie → buffer isolé)
    if (e.method === 8) {                                                 // DEFLATE
      if (typeof DecompressionStream === 'undefined') throw new Error('décompression non supportée par ce navigateur');
      const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new Error('compression ZIP non supportée (méthode ' + e.method + ')');
  }
  // Collecte TOUS les CSV d'un ZIP en DESCENDANT dans les sous-zips « ExportBlock-…-Part-N.zip » : un export
  // Notion volumineux est MULTI-PARTIES → le .zip racine ne contient QUE des sous-zips, les CSV sont dedans.
  async function _jrZipCollectCsvs(u8, depth, out) {
    let parsed; try { parsed = _jrZipParse(u8); } catch (err) { console.warn('[Journal import] zip illisible (prof. ' + depth + ') :', err && err.message); return out; }
    const { dv, entries } = parsed;
    if (depth === 0) console.log('[Journal import] contenu du .zip :', entries.map(e => e.name + ' (' + e.uSize + 'o)'));
    for (const e of entries) if (/\.csv$/i.test(e.name)) out.push({ u8, dv, e });
    if (depth < 4) {
      const zips = entries.filter(e => /\.zip$/i.test(e.name))
        .sort((a, b) => (((a.name.match(/part-?(\d+)/i) || [])[1]) | 0) - (((b.name.match(/part-?(\d+)/i) || [])[1]) | 0));
      for (const z of zips) {
        try { const inner = await _jrZipExtract(u8, dv, z); await _jrZipCollectCsvs(inner, depth + 1, out); }
        catch (err) { console.warn('[Journal import] sous-zip', z.name, 'ignoré :', err && err.message); }
      }
    }
    return out;
  }
  // Dézippe un export Notion (.zip), 0 dépendance, sous-zips compris. Renvoie le texte du MEILLEUR CSV (priorité
  // au « _all.csv » de Notion qui contient TOUTES les lignes, sinon le plus gros : tous niveaux confondus).
  async function _jrUnzipBestCsv(buf) {
    const cands = await _jrZipCollectCsvs(new Uint8Array(buf), 0, []);
    if (!cands.length) throw new Error('aucun .csv trouvé (ni dans les sous-zips Notion) : exporte ton journal en « Markdown & CSV ».');
    cands.sort((a, b) => (/_all\.csv$/i.test(b.e.name) - /_all\.csv$/i.test(a.e.name)) || (b.e.uSize - a.e.uSize));
    const best = cands[0];
    console.log('[Journal import] CSV retenu :', best.e.name, '(' + best.e.uSize + 'o, méthode ' + best.e.method + ') · ' + cands.length + ' CSV trouvé(s)');
    const out = await _jrZipExtract(best.u8, best.dv, best.e);
    return new TextDecoder('utf-8').decode(out).replace(/^﻿/, '');   // strip BOM
  }

  function _jrImportFile(ev) {
    const file = ev.target.files && ev.target.files[0]; if (!file) return;
    if (!_jrList) _jrList = [];
    const isZip = /\.zip$/i.test(file.name) || /zip/i.test(file.type || '');
    if (isZip) {
      _jrStatus('Lecture de l\'export Notion (.zip)…');
      const reader = new FileReader();
      reader.onload = async function (e) {
        try {
          const text = await _jrUnzipBestCsv(e.target.result);
          _jrIngestCsvText(text);
        } catch (err) { _jrStatus('Import impossible : le fichier .zip semble endommagé ou non standard : ré-exporte depuis Notion (Exporter → CSV) et réessaie.'); try { console.warn('[Journal] import zip:', err && err.message || err); } catch (_) {} }
      };
      reader.onerror = function () { _jrStatus('Lecture du fichier impossible'); };
      reader.readAsArrayBuffer(file);
      ev.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = function (e) {
      try { _jrIngestCsvText(e.target.result); }
      catch (err) { _jrStatus('Échec de l\'import (' + (err && err.message || err) + ')'); }
    };
    reader.readAsText(file);
    ev.target.value = '';
  }

  // ═══ DASHBOARD DE STATS (Performance Dashboard 3.0, identité HUD) : CSS/SVG, 0 dépendance ═══
  let _jrTab = 'log';
  function _jrSetTab(t) {
    _jrTab = (t === 'dash') ? 'dash' : 'log';
    const log = document.getElementById('jr-log-view'), dash = document.getElementById('jr-dashboard');
    if (log) log.classList.toggle('hidden', _jrTab === 'dash');
    if (dash) dash.classList.toggle('hidden', _jrTab !== 'dash');
    document.querySelectorAll('.jr-tab').forEach(b => b.classList.toggle('jr-tab--active', b.dataset.jt === _jrTab));
    if (_jrTab === 'dash') _jrRenderDashboard();
  }
  window._jrTabClick = _jrSetTab;
  const _JR_RES = ['Profit', 'TP', 'BE', 'SL', 'Loss'];
  const _RES_COL = { Profit: '#00e676', TP: '#00cc99', BE: '#ffb300', SL: '#ff8f00', Loss: '#ff3d00' };
  const _jrArr = v => Array.isArray(v) ? v.filter(Boolean) : (v ? String(v).split(/[,;|]+/).map(s => s.trim()).filter(Boolean) : []);
  const _jrN = v => { const n = parseFloat(v); return isFinite(n) ? n : null; };
  const _jrResOf = e => { if (e.result && _JR_RES.includes(e.result)) return e.result; const w = _jrWin(e); return w == null ? null : (w > 0 ? 'Profit' : w < 0 ? 'Loss' : 'BE'); };
  const _jrRof = e => _jrN(e.r);
  const _JRD = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
  const _jrDayOf = e => { try { const d = new Date(e.ts).getDay(); return (d >= 1 && d <= 5) ? _JRD[d - 1] : null; } catch (er) { return null; } };
  function _jrRing(val, label, color, sub) {
    return '<div class="jrd-ring"><div class="jrd-ring-c" style="border-color:' + color + '"><span class="jrd-ring-v" style="color:' + color + '">' + val + '</span></div><div class="jrd-ring-l">' + _esc(label) + '</div>' + (sub ? '<div class="jrd-ring-s">' + _esc(sub) + '</div>' : '') + '</div>';
  }
  function _jrBars(title, map, opt) {
    opt = opt || {};
    let rows = Object.entries(map).filter(([, v]) => opt.keepZero || v);
    if (opt.order) rows.sort((a, b) => opt.order.indexOf(a[0]) - opt.order.indexOf(b[0]));
    else rows.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    rows = rows.slice(0, opt.max || 18);
    const max = Math.max(1, ...rows.map(([, v]) => Math.abs(v)));
    const body = rows.map(([k, v]) => {
      const w = Math.round(Math.abs(v) / max * 100);
      const c = (opt.colors && opt.colors[k]) || (v < 0 ? '#ff3d00' : opt.color || '#e3b23a');
      const vt = opt.fmt ? opt.fmt(v) : (v >= 0 ? '+' : '') + (Math.round(v * 100) / 100).toString().replace('.', ',');
      return '<div class="jrd-bar"><span class="jrd-bar-k" title="' + _esc(k) + '">' + _esc(k) + '</span><span class="jrd-bar-t"><i style="width:' + w + '%;background:' + c + '"></i></span><span class="jrd-bar-v">' + vt + '</span></div>';
    }).join('') || '<div class="jrd-empty">—</div>';
    return '<div class="jrd-card"><div class="jrd-card-h">' + _esc(title) + '</div><div class="jrd-bars">' + body + '</div></div>';
  }
  // ── amCharts 5 : courbe de performance (toggle % / $PNL / $Equity) + donut de répartition ──
  let _jrEqMode = 'pct', _jrEqSeriesRef = null;
  const _JR_EQMODE_LBL = { pct: '% cumulé', pl: '$ PNL', equity: '$ Capital' };
  function _jrEqData(L, mode) {
    // $ Capital AUTO : si AUCUNE equity n'est saisie mais qu'un capital de départ est défini →
    // courbe reconstituée = capital initial + cumul des $PNL (l'image la plus parlante d'un journal,
    // sans exiger la saisie manuelle de l'equity à chaque trade).
    if (mode === 'equity' && !L.some(e => _jrN(e.equity) != null) && _jrN(_jrStartCap) != null && Number(_jrStartCap) > 0) {
      const arr = L.filter(e => _jrN(e.pl) != null).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
      const fmtD = n => (n > 0 ? '+' : '') + (Math.round(n * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' $';
      let eq = Number(_jrStartCap); const out = [];
      for (const e of arr) {
        const prev = eq; eq += (_jrN(e.pl) || 0);
        const dt = new Date(e.ts);
        out.push({ t: e.ts, v: eq, dateLbl: dt.getDate() + ' ' + (_JR_MONTHS_FR[dt.getMonth()] || '') + ' ' + dt.getFullYear(), vLbl: (Math.round(eq * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' $', varLbl: 'Variation : ' + fmtD(eq - prev) });
      }
      return out;
    }
    const ok = e => mode === 'equity' ? _jrN(e.equity) != null : mode === 'pl' ? _jrN(e.pl) != null : _jrN(e.pnlPct) != null;
    const arr = L.filter(ok).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const unit = mode === 'pct' ? ' %' : ' $';
    // Libellés PRÉ-FORMATÉS (français) injectés dans chaque point → le tooltip les affiche tels quels.
    // (On NE passe PLUS par les formats amCharts "+#;-#" qui rendaient un texte cassé du type "+4,92;-4,92".)
    const fmt = n => (n > 0 ? '+' : '') + (Math.round(n * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + unit;
    let cum = 0; const out = [];
    for (const e of arr) {
      let y; if (mode === 'equity') y = _jrN(e.equity); else if (mode === 'pl') { cum += (_jrN(e.pl) || 0); y = cum; } else { cum += (_jrN(e.pnlPct) || 0); y = cum; }
      if (y == null) continue;
      const d = out.length ? +(y - out[out.length - 1].v).toFixed(2) : 0;
      const dt = new Date(e.ts);
      out.push({ t: e.ts, v: y, dateLbl: dt.getDate() + ' ' + (_JR_MONTHS_FR[dt.getMonth()] || '') + ' ' + dt.getFullYear(), vLbl: fmt(y), varLbl: 'Variation : ' + fmt(d) });
    }
    return out;
  }
  function _jrDisposeRoot(id) { try { if (typeof am5 === 'undefined') return; const ex = am5.registry.rootElements.find(r => r && r.dom && r.dom.id === id); if (ex) ex.dispose(); } catch (e) {} }
  function _jrBuildEquityChart(L) {
    const id = 'jr-eq-chart', el = document.getElementById(id); if (!el || typeof am5 === 'undefined' || typeof am5xy === 'undefined') return;
    _jrDisposeRoot(id);
    const root = am5.Root.new(id); root.setThemes([am5themes_Animated.new(root)]); if (root._logo) root._logo.set('forceHidden', true);
    _dtpChartPremium(el, 790);   // chargement premium : overlay shimmer pendant appear(650,60) -> reveal en fondu (re-build au rendu dashboard)
    const chart = root.container.children.push(am5xy.XYChart.new(root, { panX: false, panY: false, wheelX: 'none', wheelY: 'none', paddingLeft: 0, paddingRight: 2, paddingTop: 10, paddingBottom: 2 }));
    const xr = am5xy.AxisRendererX.new(root, { minGridDistance: 66 });
    xr.grid.template.setAll({ stroke: am5.color(0x2b2b31), strokeOpacity: 0.16, strokeDasharray: [2, 4] });
    xr.labels.template.setAll({ fill: am5.color(0x6b7280), fontSize: 9.5 });
    // extraMin/Max = 0 → la courbe va jusqu'aux DEUX bords (à droite, pile contre l'axe Y) : demandé.
    const xAxis = chart.xAxes.push(am5xy.DateAxis.new(root, { baseInterval: { timeUnit: 'day', count: 1 }, renderer: xr, extraMin: 0, extraMax: 0 }));
    xAxis.set('dateFormats', { day: 'dd MMM', week: 'dd MMM', month: 'MMM yy' });
    xAxis.set('periodChangeDateFormats', { day: 'dd MMM', month: 'MMM yy' });
    const yr = am5xy.AxisRendererY.new(root, { opposite: true, minWidth: 50 });
    yr.grid.template.setAll({ stroke: am5.color(0x2b2b31), strokeOpacity: 0.16, strokeDasharray: [2, 4] });
    yr.labels.template.setAll({ fill: am5.color(0x94a3b8), fontSize: 9 });
    yr.labels.template.adapters.add('text', t => t == null ? t : String(t).replace('.', ','));
    const yAxis = chart.yAxes.push(am5xy.ValueAxis.new(root, { renderer: yr, maxDeviation: 0.12 }));
    const z = yAxis.createAxisRange(yAxis.makeDataItem({ value: 0 })); z.get('grid').setAll({ stroke: am5.color(0xffffff), strokeOpacity: 0.3, strokeWidth: 1 }); if (z.get('label')) z.get('label').set('visible', false);
    // Tooltip clair (date • valeur cumulée • variation), libellés pré-formatés en français (zéro format amCharts cassé).
    const _eqTip = am5.Tooltip.new(root, { getFillFromSprite: false, autoTextColor: false, labelText: '[#8a8a92 fontSize:10px]{dateLbl}[/]\n[bold #e3b23a fontSize:14px]{vLbl}[/]\n[#9aa0aa fontSize:10px]{varLbl}[/]' });
    _eqTip.get('background').setAll({ fill: am5.color(0x141417), stroke: am5.color(0x33333a), strokeWidth: 1, fillOpacity: 0.98, cornerRadius: 6 });
    if (_eqTip.label) _eqTip.label.setAll({ fill: am5.color(0xe6e6ea), paddingTop: 5, paddingBottom: 5, paddingLeft: 9, paddingRight: 9 });
    const series = chart.series.push(am5xy.LineSeries.new(root, { xAxis, yAxis, valueXField: 't', valueYField: 'v', stroke: am5.color(0xe3b23a), fill: am5.color(0xe3b23a), tooltip: _eqTip }));
    series.strokes.template.setAll({ strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' });   // ligne plus nette et lisse
    series.fills.template.setAll({ visible: true, fillGradient: am5.LinearGradient.new(root, { rotation: 90, stops: [{ color: am5.color(0xe3b23a), opacity: 0.42 }, { color: am5.color(0xcfa233), opacity: 0.10 }, { color: am5.color(0xe3b23a), opacity: 0 }] }) });
    series.data.setAll(_jrEqData(L, _jrEqMode));
    // Curseur enrichi : trait orange pointillé qui suit la souris/le drag, accroché aux points (snapToSeries)
    // → le tooltip riche (date + valeur + Δ) s'affiche pile sur la donnée survolée.
    const _eqCursor = chart.set('cursor', am5xy.XYCursor.new(root, { behavior: 'none', xAxis, yAxis, snapToSeries: [series] }));
    _eqCursor.lineX.setAll({ stroke: am5.color(0xe3b23a), strokeOpacity: 0.5, strokeWidth: 1, strokeDasharray: [2, 3] });
    _eqCursor.lineY.set('visible', false);
    _jrEqSeriesRef = series; series.appear(650); chart.appear(650, 60);
  }
  window._jrEqSwitch = function (m) {
    if (!_JR_EQMODE_LBL[m]) return; _jrEqMode = m;
    document.querySelectorAll('.jrd-eqtoggle button').forEach(b => b.classList.toggle('active', b.dataset.m === m));
    if (_jrEqSeriesRef) _jrEqSeriesRef.data.setAll(_jrEqData(_jrList || [], m));   // libellés (unité comprise) déjà inclus dans chaque point
  };
  function _jrBuildResultDonut(resMap) {
    const id = 'jr-result-donut', el = document.getElementById(id); if (!el || typeof am5percent === 'undefined') return;
    _jrDisposeRoot(id);
    const root = am5.Root.new(id); root.setThemes([am5themes_Animated.new(root)]); if (root._logo) root._logo.set('forceHidden', true);
    _dtpChartPremium(el, 680);   // chargement premium : overlay shimmer pendant appear(600) -> reveal en fondu (re-build au rendu dashboard)
    const chart = root.container.children.push(am5percent.PieChart.new(root, { innerRadius: am5.percent(64), paddingTop: 2, paddingBottom: 2 }));
    const series = chart.series.push(am5percent.PieSeries.new(root, { valueField: 'v', categoryField: 'k', alignLabels: false }));
    series.labels.template.set('forceHidden', true); series.ticks.template.set('forceHidden', true);
    series.slices.template.setAll({ strokeWidth: 2, stroke: am5.color(0x0c0c0e), templateField: 'st' });
    const data = _JR_RES.filter(k => resMap[k]).map(k => ({ k, v: resMap[k], st: { fill: am5.color(parseInt(_RES_COL[k].slice(1), 16)) } }));
    series.data.setAll(data);
    const total = data.reduce((a, b) => a + b.v, 0);
    series.children.push(am5.Label.new(root, { text: "[bold #ffffff fontSize:17px]" + total + "[/]\n[#8a8a92 fontSize:8.5px]TRADES", textAlign: 'center', centerX: am5.p50, centerY: am5.p50, populateText: false }));
    series.appear(600);
  }
  function _jrResultLegend(resMap) { return '<div class="jrd-legend">' + _JR_RES.filter(k => resMap[k]).map(k => '<span class="jrd-leg"><i style="background:' + _RES_COL[k] + '"></i>' + k + ' <b>' + resMap[k] + '</b></span>').join('') + '</div>'; }
  function _jrRenderDashboard() {
    const host = document.getElementById('jr-dashboard'); if (!host) return;
    const L = _jrList || [];
    if (!L.length) { host.innerHTML = '<div class="jrd-empty-big">Aucune statistique pour le moment : ajoute ton premier trade ou importe ton journal (Notion .zip / CSV) depuis « Trades ».</div>'; return; }
    const sum = a => a.reduce((x, y) => x + y, 0);
    const rs = L.map(_jrRof).filter(r => r != null), wins = rs.filter(r => r > 0), losses = rs.filter(r => r < 0);
    const totR = sum(rs), totD = sum(L.map(e => _jrN(e.pl) || 0));
    const avgW = wins.length ? sum(wins) / wins.length : 0, avgL = losses.length ? sum(losses) / losses.length : 0;
    const longN = L.filter(e => e.dir !== 'SELL').length, shortN = L.length - longN;
    const resMap = {}; _JR_RES.forEach(r => resMap[r] = 0); L.forEach(e => { const r = _jrResOf(e); if (r) resMap[r]++; });
    // Barres : R si la colonne existe ; SINON repli ±1 par résultat unifié → les cartes OPTIMISATION ne sont
    // plus vides pour un journal importé sans colonne R (unité homogène à l'intérieur d'une même vue).
    const hasR = rs.length > 0;
    const valR = e => { const r = _jrRof(e); if (r != null) return r; return hasR ? 0 : (_jrOutcome(e) || 0); };
    // ── Stats PRO (calculées en mémoire, zéro endpoint) ──
    const outsD = L.map(_jrOutcome).filter(o => o != null);
    const oWD = outsD.filter(o => o > 0).length, oLD = outsD.filter(o => o < 0).length;
    const wrD = (oWD + oLD) ? Math.round(oWD / (oWD + oLD) * 100) : null;   // taux unifié, BE exclus
    const gD = sum(L.map(e => _jrN(e.pl)).filter(v => v != null && v > 0));
    const pD = Math.abs(sum(L.map(e => _jrN(e.pl)).filter(v => v != null && v < 0)));
    const gRs = sum(wins), pRs = Math.abs(sum(losses));
    const pf = pD > 0 ? gD / pD : (pRs > 0 ? gRs / pRs : null);             // profit factor ($ prioritaire, sinon R)
    const expR = (rs.length && (oWD + oLD)) ? (oWD / (oWD + oLD)) * avgW + (oLD / (oWD + oLD)) * avgL : null;   // espérance par trade, en R
    const chron = L.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const ddInD = L.some(e => _jrN(e.pl) != null);
    let _cum = 0, _peak = 0, maxDD = 0;
    for (const e of chron) { const v = ddInD ? (_jrN(e.pl) || 0) : (_jrRof(e) || 0); _cum += v; if (_cum > _peak) _peak = _cum; const d = _peak - _cum; if (d > maxDD) maxDD = d; }
    let _stk = 0, worstStreak = 0;
    for (const e of chron) { const o = _jrOutcome(e); if (o == null) continue; if (o < 0) { _stk++; if (_stk > worstStreak) worstStreak = _stk; } else if (o > 0) _stk = 0; }
    const grp = keyFn => { const m = {}; for (const e of L) for (const k of _jrArr(keyFn(e))) m[k] = (m[k] || 0) + valR(e); return m; };
    const setupM = grp(e => e.setup), confM = grp(e => e.conf), gradeM = grp(e => e.grade), entryM = grp(e => e.entryT);
    const slM = grp(e => e.sl), errM = grp(e => e.err), sessM = grp(e => e.session), dayM = grp(_jrDayOf), pairM = grp(e => e.pair);
    const fondaM = {}; L.forEach(e => { const f = _jrN(e.fonda); if (f != null) { const k = f >= 87.5 ? '100 %' : f >= 62.5 ? '75 %' : '50 %'; fondaM[k] = (fondaM[k] || 0) + valR(e); } });
    const rrA = (() => { const a = L.map(e => _jrN(e.rr)).filter(x => x != null); return a.length ? sum(a) / a.length : 0; })();
    const fR = v => (v >= 0 ? '+' : '') + (Math.round(v * 100) / 100).toString().replace('.', ',');
    // Montant COMPACT et insécable (k$/M$) → tient dans l'anneau sans passer à la ligne (le « $ » ne saute plus)
    const _jrMoneyShort = v => { const n = Math.round(v), a = Math.abs(n), s = n > 0 ? '+' : n < 0 ? '-' : ''; if (a >= 1e6) return s + (a / 1e6).toFixed(1).replace('.', ',') + ' M$'; if (a >= 1000) return s + (a / 1000).toFixed(1).replace('.', ',') + ' k$'; return s + a + ' $'; };
    host.innerHTML =
      '<div class="jrd-sec"><div class="jrd-sec-h">PERFORMANCE PILOTE</div><div class="jrd-rings">'
        + _jrRing(fR(totR), 'Total R', totR >= 0 ? '#00e676' : '#ff3d00')
        + _jrRing(_jrMoneyShort(totD), 'Total $', totD >= 0 ? '#00e676' : '#ff3d00')
        + _jrRing(String(L.length), 'Trades', '#e3b23a')
        + _jrRing((wrD == null ? '—' : wrD + ' %'), 'Taux de réussite', '#00cc99', (oWD + oLD) ? (oWD + ' G / ' + oLD + ' P, BE exclus') : '')
      + '</div><div class="jrd-row jrd-row--charts">'
        + '<div class="jrd-card jrd-card--donut"><div class="jrd-card-h">Répartition des résultats</div><div id="jr-result-donut" class="jr-chart-am jr-chart-am--donut"></div>' + _jrResultLegend(resMap) + '</div>'
        + '<div class="jrd-card jrd-card--eq"><div class="jrd-card-h">Courbe de performance<span class="jrd-eqtoggle">'
          + '<button data-m="pct" class="active" onclick="_jrEqSwitch(\'pct\')">% cumulé</button>'
          + '<button data-m="pl" onclick="_jrEqSwitch(\'pl\')">$ PNL</button>'
          + '<button data-m="equity" onclick="_jrEqSwitch(\'equity\')">$ Capital</button>'
        + '</span></div>'
        + (L.some(e => _jrN(e.equity) != null) ? '' : '<div style="padding:2px 12px 0;font-size:11px;color:#8b93a1;">Capital de départ&nbsp;: <input id="jr-startcap" type="number" min="0" step="100" placeholder="10000" value="' + (_jrStartCap != null ? _jrStartCap : '') + '" style="width:88px;background:#0d0e11;border:1px solid #26262b;border-radius:4px;color:#e6e6ea;padding:2px 6px;font-size:11px;"> $ <span style="color:#6b7280;">→ active la courbe «&nbsp;$ Capital&nbsp;» sans saisir l\'equity par trade</span></div>')
        + '<div id="jr-eq-chart" class="jr-chart-am jr-chart-am--eq"></div></div>'
      + '</div></div>'
      + '<div class="jrd-sec"><div class="jrd-sec-h">PERFORMANCE CLÉ</div><div class="jrd-rings">'
        + _jrRing(fR(avgW), 'R moy. gagnant', '#00e676') + _jrRing(fR(avgL), 'R moy. perdant', '#ff3d00')
        + _jrRing(longN + ' / ' + shortN, 'Long / Short', '#3aa0ff')
        + _jrRing((Math.round(rrA * 100) / 100).toString().replace('.', ','), 'RR cible moyen', '#a78bfa')
      + '</div><div class="jrd-rings" style="margin-top:10px;">'
        + _jrRing(pf == null ? '—' : (Math.round(pf * 100) / 100).toString().replace('.', ','), 'Profit factor', pf != null && pf >= 1 ? '#00e676' : '#ff8f00', 'gains / pertes')
        + _jrRing(expR == null ? '—' : fR(expR), 'Espérance / trade', expR != null && expR >= 0 ? '#00cc99' : '#ff3d00', 'en R')
        + _jrRing(maxDD > 0 ? '−' + (ddInD ? _jrMoneyShort(maxDD).replace(/^\+/, '') : fR(maxDD).replace(/^\+/, '') + ' R') : '0', 'Max drawdown', '#ff8f00', 'depuis un plus haut')
        + _jrRing(String(worstStreak), 'Série perdante max', worstStreak >= 4 ? '#ff3d00' : '#e3b23a', 'trades d\'affilée')
      + '</div></div>'
      + '<div class="jrd-sec"><div class="jrd-sec-h">OPTIMISATION</div><div class="jrd-grid">'
        + _jrBars('Setup', setupM) + _jrBars('Confluence', confM) + _jrBars('Entrée', entryM) + _jrBars('SL', slM)
        + _jrBars('Note', gradeM) + _jrBars('Fonda', fondaM) + _jrBars('Erreur', errM)
      + '</div></div>'
      + '<div class="jrd-sec"><div class="jrd-sec-h">RECONNAISSANCE DE SCHÉMAS</div><div class="jrd-grid">'
        + _jrBars('Jour', dayM, { order: _JRD }) + _jrBars('Session', sessM) + _jrBars('Paires', pairM, { max: 14 })
      + '</div></div>';
    setTimeout(() => { try { _jrBuildResultDonut(resMap); _jrBuildEquityChart(L); } catch (e) {} }, 12);   // amCharts après insertion DOM
    const capIn = document.getElementById('jr-startcap');
    if (capIn) capIn.onchange = () => { const v = parseFloat(capIn.value); _jrStartCap = (isFinite(v) && v > 0) ? v : null; _jrSave(); try { _jrBuildEquityChart(L); } catch (e) {} };
  }

  window.loadJournalView = function () {
    if (_jrList) { _jrRender(); return; }   // déjà chargé → re-render instantané (les données vivent en mémoire + serveur)
    _jrStatus('Chargement…');
    fetch('/api/journal').then(r => r.json())
      .then(j => { _jrList = Array.isArray(j.entries) ? j.entries : []; _jrCustom = !!j.custom; _jrCols = _jrColsFromStore(j.cols); _jrStartCap = (j.startCap != null && isFinite(j.startCap) && j.startCap > 0) ? Number(j.startCap) : null; _jrStatus(''); _jrRender(); })
      .catch(() => { _jrList = []; _jrStatus('Hors-ligne'); _jrRender(); });
  };
})();

// ═══════════════════ TOAST + GATING ADMIN (Journal / Calculatrice) ═══════════════════
function _dtpToast(msg, kind) {
  let host = document.getElementById('dtp-toast-host');
  if (!host) { host = document.createElement('div'); host.id = 'dtp-toast-host'; document.body.appendChild(host); }
  const t = document.createElement('div');
  t.className = 'dtp-toast' + (kind ? ' dtp-toast--' + kind : '');
  t.innerHTML = '<span class="dtp-toast-ic">🛠️</span><span>' + String(msg || '').replace(/</g, '&lt;') + '</span>';
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 280); }, 4200);
}

// ── Détection d'un nouveau déploiement → bannière « Recharger » en 1 clic ─────────────────────
// Une session restée ouverte garde l'ancien app.js en mémoire ; ce watcher compare la version
// chargée à /api/version et propose un rechargement dès qu'un déploiement est détecté → fini le
// « c'est pas à jour ». (Non intrusif : l'utilisateur recharge quand il veut.)
(function _dtpVersionWatch() {
  const src = (document.querySelector('script[src*="/js/app.js"]') || {}).src || '';
  const myVer = (src.match(/[?&]v=([0-9A-Za-z]+)/) || [])[1] || '';
  if (!myVer) return;
  // Application INSTALLÉE (PWA « Installer » ou app desktop .exe/.app qui embarque Chromium) : on affiche
  // un message plus explicite (« nouvelle icône incluse ») + un rechargement FORCÉ (vide les caches).
  const _isApp = (() => {
    try {
      return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true
        || /Electron|DataTradingPro/i.test(navigator.userAgent || '')
        || (window.location.search || '').indexOf('app=1') !== -1;
    } catch { return false; }
  })();
  let shown = false;
  // Rechargement PROPRE : on vide d'abord tout Cache Storage (service worker / wrapper desktop) puis on
  // recharge → l'app installée récupère VRAIMENT la dernière version (fini le « bloqué sur l'ancienne »).
  async function _hardReload() {
    try { if (window.caches && caches.keys) { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); } } catch {}
    try { location.reload(); } catch { location.href = location.pathname + '?u=' + Date.now(); }
  }
  function banner() {
    if (shown || document.getElementById('dtp-update-banner')) return;
    shown = true;
    const b = document.createElement('div');
    b.id = 'dtp-update-banner';
    b.className = 'dtp-update-banner' + (_isApp ? ' dtp-update-banner--app' : '');
    if (_isApp) {
      b.innerHTML =
        '<span class="dub-ic">✨</span>'
        + '<span class="dub-body"><b class="dub-title">Mise à jour de DataTradingPro</b>'
        + '<span class="dub-txt">Une nouvelle version est prête (nouvelle icône incluse). Mets à jour pour en profiter.</span></span>'
        + '<button type="button" class="dub-btn">Mettre à jour</button>'
        + '<button type="button" class="dub-x" title="Plus tard" aria-label="Plus tard">&times;</button>';
    } else {
      b.innerHTML =
        '<span class="dub-ic">🔄</span><span class="dub-txt">Nouvelle version disponible</span>'
        + '<button type="button" class="dub-btn">Recharger</button>'
        + '<button type="button" class="dub-x" title="Plus tard" aria-label="Plus tard">&times;</button>';
    }
    b.querySelector('.dub-btn').addEventListener('click', _hardReload);
    b.querySelector('.dub-x').addEventListener('click', () => { b.classList.remove('show'); setTimeout(() => b.remove(), 250); });
    document.body.appendChild(b);
    requestAnimationFrame(() => b.classList.add('show'));
  }
  async function check() {
    if (shown) return;
    try {
      const r = await fetch('/api/version', { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      if (d && d.v && d.v !== myVer) banner();
    } catch {}
  }
  setTimeout(check, 5000);         // 1er contrôle ~5 s après le LANCEMENT (l'app installée voit la MAJ dès l'ouverture)
  setInterval(check, 90 * 1000);   // puis toutes les 90 s
})();

// Journal de trading + Calculatrice = PUBLICS (tous les comptes connectés).
window._dtpGateTool = function (view) {
  if (view === 'journal') _dtpJournalBadgeSeen();        // 1er clic sur le journal → le badge NEW disparaît (persistant par compte)
  if (window.activateView) window.activateView(view);    // Journal + Calculatrice ouverts à TOUS les utilisateurs connectés
};
// Badge « NEW » du journal : annonce affichée une seule fois par compte, retirée dès le 1er clic (flag KV durable).
function _dtpJournalBadgeSeen() {
  const b = document.getElementById('journal-new-badge'); if (b) b.style.display = 'none';
  try { fetch('/api/journal-new-seen', { method: 'POST' }); } catch {}
}
window._dtpJournalBadgeInit = function () {
  try {
    fetch('/api/journal-new-seen').then(r => r.json()).then(d => {
      const b = document.getElementById('journal-new-badge');
      if (b && d && d.seen === false) b.style.display = '';
    }).catch(() => {});
  } catch {}
};

// ═══════════════════ CALCULATRICE DE TAILLE DE POSITION (façon Myfxbook) ═══════════════════
(function () {
  let _rates = null;          // symbole "EUR/USD" → dernier cours
  let _riskMode = 'pct';      // 'pct' | 'amount'
  const ACCTS = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];
  function _cStatus(m) { const el = document.getElementById('calc-status'); if (el) el.textContent = m || ''; }
  function _num(id) { const x = parseFloat((document.getElementById(id) || {}).value); return isFinite(x) ? x : null; }
  // Résout un taux FROM→TO à partir des paires dispo : direct, inverse, ou triangulation via USD.
  function _rate(from, to) {
    if (from === to) return 1;
    const r = _rates || {};
    if (r[from + '/' + to]) return r[from + '/' + to];
    if (r[to + '/' + from]) return 1 / r[to + '/' + from];
    const fu = (from === 'USD') ? 1 : (r[from + '/USD'] ? r[from + '/USD'] : (r['USD/' + from] ? 1 / r['USD/' + from] : null));
    const ut = (to === 'USD') ? 1 : (r['USD/' + to] ? r['USD/' + to] : (r[to + '/USD'] ? 1 / r[to + '/USD'] : null));
    if (fu != null && ut != null) return fu * ut;
    return null;
  }
  function _calcCompute() {
    const acct = (document.getElementById('calc-acct') || {}).value || 'USD';
    const balance = _num('calc-balance'), risk = _num('calc-risk'), sl = _num('calc-sl');
    const sym = (document.getElementById('calc-pair') || {}).value || '';
    const res = document.getElementById('calc-results'); if (!res) return;
    if (!_rates) { res.innerHTML = '<div class="calc-empty">Cours indisponibles : réessayez.</div>'; return; }
    if (balance == null || balance <= 0 || risk == null || risk <= 0 || sl == null || sl <= 0 || !sym) { res.innerHTML = '<div class="calc-empty">Renseignez un solde, un risque et un stop-loss supérieurs à zéro, puis choisissez une paire.</div>'; return; }
    const m = sym.split('/'); if (m.length !== 2) { res.innerHTML = '<div class="calc-empty">Paire invalide.</div>'; return; }
    const base = m[0], quote = m[1];
    const price = _rates[sym];
    if (!price) { res.innerHTML = '<div class="calc-empty">Cours indisponible pour ' + sym + '.</div>'; return; }
    const riskMoney = _riskMode === 'pct' ? balance * (risk / 100) : risk;
    const pipSize = quote === 'JPY' ? 0.01 : 0.0001;
    const contract = 100000;                                  // 1 lot standard
    const pipValQuote = pipSize * contract;                   // valeur d'un pip (1 lot) en devise de cotation
    const qToAcct = _rate(quote, acct);
    if (qToAcct == null) { res.innerHTML = '<div class="calc-empty">Conversion ' + quote + '→' + acct + ' indisponible.</div>'; return; }
    const pipValAcct = pipValQuote * qToAcct;                 // valeur d'un pip (1 lot) dans la devise du compte
    const lots = riskMoney / (sl * pipValAcct);
    const units = lots * contract;
    const notionalBase = units;                               // unités de la devise de base
    const fmt = (v, d) => (v == null || !isFinite(v)) ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
    const cur = acct === 'JPY' ? '¥' : acct === 'EUR' ? '€' : acct === 'GBP' ? '£' : (acct === 'USD' || acct === 'CAD' || acct === 'AUD' || acct === 'NZD') ? '$' : acct + ' ';
    try { sessionStorage.setItem('dtp_calc_setup', JSON.stringify({ acct: acct, balance: balance, risk: risk, sl: sl, sym: sym, mode: _riskMode })); } catch (_) {}   // dernier réglage : SESSION uniquement (volatil, jamais localStorage)
    res.innerHTML =
      '<div class="calc-card calc-card--hero"><span class="calc-k">Taille de position</span><span class="calc-v">' + fmt(lots, 2) + ' <em>lots</em></span>'
      + '<span class="calc-sub">' + fmt(lots * 10, 1) + ' mini · ' + fmt(lots * 100, 0) + ' micro · ' + fmt(units, 0) + ' unités</span>'
      + '<button type="button" class="calc-copy" data-copy="' + lots.toFixed(2) + '" title="Copier la taille en lots">Copier</button></div>'
      + '<div class="calc-grid">'
      + '<div class="calc-card"><span class="calc-k">Risque</span><span class="calc-v">' + cur + fmt(riskMoney, 2) + '</span><span class="calc-sub">' + (_riskMode === 'pct' ? String(risk).replace('.', ',') + ' % du solde' : 'montant fixe') + '</span></div>'
      + '<div class="calc-card"><span class="calc-k">Valeur du pip</span><span class="calc-v">' + cur + fmt(pipValAcct * lots, 2) + '</span><span class="calc-sub">' + cur + fmt(pipValAcct, 2) + ' / lot</span></div>'
      + '<div class="calc-card"><span class="calc-k">Stop-loss</span><span class="calc-v">' + fmt(sl, 0) + ' <em>pips</em></span><span class="calc-sub">perte max ≈ ' + cur + fmt(sl * pipValAcct * lots, 2) + '</span></div>'
      + '<div class="calc-card"><span class="calc-k">Notionnel</span><span class="calc-v">' + fmt(notionalBase, 0) + ' ' + base + '</span><span class="calc-sub">cours ' + sym + ' : ' + fmt(price, quote === 'JPY' ? 3 : 5) + '</span></div>'
      + '</div>';
  }
  function _wire() {
    const go = document.getElementById('calc-go'); if (go) go.onclick = _calcCompute;
    // Copier la taille calculée : délégation câblée UNE fois (le innerHTML de #calc-results est régénéré à chaque calcul)
    const resHost = document.getElementById('calc-results');
    if (resHost && !resHost.dataset.copyWired) {
      resHost.dataset.copyWired = '1';
      resHost.addEventListener('click', (e) => {
        const b = e.target && e.target.closest ? e.target.closest('.calc-copy') : null; if (!b) return;
        const txt = b.getAttribute('data-copy') || '';
        const done = () => { b.classList.add('ok'); b.textContent = 'Copié ✓'; setTimeout(() => { b.classList.remove('ok'); b.textContent = 'Copier'; }, 1400); };
        const fallback = () => { try { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); } catch (_) {} };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done).catch(fallback); else fallback();
      });
    }
    ['calc-acct', 'calc-balance', 'calc-risk', 'calc-sl', 'calc-pair'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('change', _calcCompute); });
    const bal = document.getElementById('calc-balance'); if (bal) bal.addEventListener('input', () => {});
    const mode = document.getElementById('calc-risk-mode');
    if (mode) mode.onclick = () => {
      _riskMode = _riskMode === 'pct' ? 'amount' : 'pct';
      const unit = document.getElementById('calc-risk-unit'); const rk = document.getElementById('calc-risk');
      if (_riskMode === 'pct') { mode.textContent = '%'; if (unit) unit.textContent = '%'; if (rk) { rk.value = '1'; rk.setAttribute('max', '100'); } }
      else { mode.textContent = (document.getElementById('calc-acct') || {}).value || '$'; if (unit) unit.textContent = 'montant'; if (rk) { rk.value = '100'; rk.removeAttribute('max'); } }
      _calcCompute();
    };
  }
  window.loadCalculatorView = function () {
    _wire();
    if (_rates) { _calcCompute(); return; }
    _cStatus('Chargement des cours…');
    const res0 = document.getElementById('calc-results');
    if (res0) res0.innerHTML = (window.dtpLoader ? window.dtpLoader('Chargement des cours en direct…') : '');
    fetch('/api/fxlist').then(r => r.json()).then(d => {
      _rates = {};
      (d && d.pairs || []).forEach(p => { if (p && p.symbol && isFinite(p.last)) _rates[p.symbol] = p.last; });
      const sel = document.getElementById('calc-pair');
      if (sel) {
        const syms = Object.keys(_rates).sort();
        sel.innerHTML = (syms.length ? syms : ['EUR/USD']).map(s => '<option' + (s === 'EUR/USD' ? ' selected' : '') + '>' + s + '</option>').join('');
      }
      // Restauration du dernier réglage de la SESSION (sessionStorage volatil : jamais localStorage) :
      // faite ICI, une fois les cours et les options de paires chargés (jamais pendant le fetch).
      try {
        const s = JSON.parse(sessionStorage.getItem('dtp_calc_setup') || 'null');
        if (s) {
          const set = (id, v) => { const el = document.getElementById(id); if (el && v != null && v !== '') el.value = v; };
          set('calc-acct', s.acct);
          if (s.mode === 'amount' && _riskMode === 'pct') { const mb = document.getElementById('calc-risk-mode'); if (mb && mb.onclick) mb.onclick(); }
          set('calc-balance', s.balance); set('calc-risk', s.risk); set('calc-sl', s.sl);
          if (sel && s.sym && _rates[s.sym]) sel.value = s.sym;
          const ac = document.getElementById('calc-acct');
          if (ac) ac.dispatchEvent(new Event('change', { bubbles: true }));   // resynchronise le libellé du dropdown custom (dtpsel)
          if (sel) sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } catch (_) {}
      _cStatus(''); _calcCompute();
    }).catch(() => { _cStatus('Cours indisponibles'); const res = document.getElementById('calc-results'); if (res) res.innerHTML = '<div class="calc-empty">Impossible de charger les cours en direct.<button type="button" class="jr-btn" onclick="window.loadCalculatorView()">Réessayer</button></div>'; });
  };
})();

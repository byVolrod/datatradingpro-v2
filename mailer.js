/**
 * mailer.js — Envoi d'emails transactionnels (Gmail SMTP → Mailjet → Resend)
 * Emails professionnels en français : bienvenue, renouvellement, reset MDP, essai, réengagement.
 *
 * SÉCURITÉ / OPTIMISATION :
 *  - Échappement HTML de TOUTES les valeurs dynamiques (nom, email, MDP) → anti-injection.
 *  - Validation de l'adresse destinataire avant tout envoi.
 *  - Timeouts réseau (Mailjet/Resend) → jamais de requête qui pend.
 *  - Transport Gmail mutualisé (pool) → throughput.
 *  - Anti-doublon court (12 s) → pas de double envoi accidentel.
 *  - Chaîne de repli réelle : Gmail (le plus délivrable pour un expéditeur @gmail.com) → Mailjet → Resend.
 *  - Séparation build / send : chaque email a un build*() (renvoie {subject, html}) réutilisé par
 *    le send*() ET par la galerie de prévisualisation (/api/emails/preview).
 */
'use strict';

// ⚠️ Render n'a PAS d'IPv6 sortant → on force la résolution DNS en IPv4 (sinon Gmail/SMTP tente l'IPv6
// et échoue en ENETUNREACH → repli silencieux sur Mailjet non délivré). 'family:4' seul ne suffit pas.
const dns = require('dns');
try { dns.setDefaultResultOrder('ipv4first'); } catch {}
function _ipv4Lookup(host, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  return dns.lookup(host, Object.assign({}, opts, { family: 4 }), cb);
}
const crypto = require('crypto');

const RESEND_API_KEY     = process.env.RESEND_API_KEY || '';
const MAILJET_API_KEY    = process.env.MAILJET_API_KEY || '';
const MAILJET_SECRET_KEY = process.env.MAILJET_SECRET_KEY || '';
const GMAIL_USER         = process.env.GMAIL_USER || '';
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''); // les MDP d'app Gmail ont des espaces
// ── API Gmail (OAuth2, HTTPS port 443) — SEUL moyen d'envoyer DEPUIS le compte Google sur Render
// (le SMTP 465/587 est bloqué par Render free-tier). Envoi aligné DMARC → boîte de réception.
const GMAIL_OAUTH_CLIENT_ID     = process.env.GMAIL_OAUTH_CLIENT_ID || '';
const GMAIL_OAUTH_CLIENT_SECRET = process.env.GMAIL_OAUTH_CLIENT_SECRET || '';
const GMAIL_OAUTH_REFRESH_TOKEN = process.env.GMAIL_OAUTH_REFRESH_TOKEN || '';
const APP_URL            = process.env.APP_URL || 'https://desk.datatradingpro.com';
const SUPPORT_EMAIL      = process.env.SUPPORT_EMAIL || 'contact@datatradingpro.com';
// Lien de paiement/renouvellement Whop (page DTP). Configurable via WHOP_RENEW_URL.
const WHOP_RENEW_URL     = process.env.WHOP_RENEW_URL || 'https://whop.com/joined/justonetrader/products/jot-dtp/';
// Expéditeur. On IGNORE l'ancienne valeur volrod.dev (migration) → adresse de contact dédiée.
const _envFrom = process.env.EMAIL_FROM || '';
const EMAIL_FROM = (_envFrom && !/volrod\.dev/i.test(_envFrom))
  ? _envFrom
  : `DataTradingPro <${SUPPORT_EMAIL}>`;

// ── Helpers sécurité ──────────────────────────────────────────────────────────
// Échappe le HTML : empêche qu'un nom/MDP contenant <, >, &, " ne casse le rendu ou n'injecte du code.
function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// Adresse email valide (anti-envoi vers des valeurs cassées)
const _EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function _validEmail(e) { return typeof e === 'string' && _EMAIL_RE.test(e.trim()); }
// Signal de timeout (no-op si le runtime ne supporte pas AbortSignal.timeout)
const _sig = ms => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(ms) : undefined;

function _parseFrom() {
  const m = EMAIL_FROM.match(/^(.*?)\s*<(.+)>$/);
  return m ? { name: m[1].trim() || 'DataTradingPro', email: m[2].trim() } : { name: 'DataTradingPro', email: EMAIL_FROM };
}

let _gmailTransport = null;
function _getGmailTransport() {
  if (_gmailTransport) return _gmailTransport;
  const nodemailer = require('nodemailer');
  // ⚠️ Render free-tier : le port 465 (SSL implicite) TIME-OUT → on utilise le 587 (STARTTLS),
  // généralement ouvert là où le 465 est filtré. Variable GMAIL_SMTP_PORT pour override si besoin.
  const port = parseInt(process.env.GMAIL_SMTP_PORT || '587', 10);
  _gmailTransport = nodemailer.createTransport({
    host: 'smtp.gmail.com', port, secure: port === 465, requireTLS: port !== 465,
    family: 4, lookup: _ipv4Lookup,   // ⚠️ FORCE IPv4 (DNS) : Render n'a pas d'IPv6 → sans ça, ENETUNREACH.
    pool: true, maxConnections: 3, maxMessages: 50,   // mutualise les connexions → meilleur débit
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    connectionTimeout: 12000, greetingTimeout: 9000, socketTimeout: 15000,   // échec rapide → repli propre si souci
  });
  return _gmailTransport;
}

// ── MONITORING EMAIL : auto-test (système de vérification) + compteurs ──
const _mailStats = { sent: 0, failed: 0, byProvider: {}, gmailVerified: null, gmailError: null, lastVerifyAt: null, apiVerified: null, apiError: null };
// Teste l'API Gmail (canal principal) en récupérant un access_token. Si OK → les emails partiront
// vraiment du compte Google → boîte de réception. Teste aussi le SMTP en secours (souvent KO sur Render).
async function verifyGmail() {
  _mailStats.lastVerifyAt = Date.now();
  // 1) API Gmail (canal principal, HTTPS) — le seul qui marche sur Render.
  if (_GMAIL_API_READY) {
    try {
      await _gmailAccessToken();
      _mailStats.apiVerified = true; _mailStats.apiError = null;
      console.log('[Mailer] ✅ API Gmail vérifiée (OAuth OK, HTTPS) : les emails partiront du compte Google → boîte de réception.');
    } catch (e) {
      _mailStats.apiVerified = false; _mailStats.apiError = String(e.message).slice(0, 160);
      console.error('[Mailer] ❌ API Gmail KO:', _mailStats.apiError, 'vérifier GMAIL_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN.');
    }
  } else {
    _mailStats.apiVerified = false; _mailStats.apiError = 'API Gmail non configurée (3 env vars OAuth manquantes)';
    console.warn('[Mailer] ⚠️ API Gmail non configurée → ajoute GMAIL_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN pour livrer en boîte de réception.');
  }
  // 2) SMTP (secours) — généralement bloqué par Render, on teste sans bruit.
  if (GMAIL_USER && GMAIL_APP_PASSWORD) {
    try { await _getGmailTransport().verify(); _mailStats.gmailVerified = true; _mailStats.gmailError = null; }
    catch (e) { _mailStats.gmailVerified = false; _mailStats.gmailError = String(e.message).slice(0, 120); }
  }
  return _mailStats.apiVerified === true;
}
// Santé email (pour l'admin) : API Gmail OK ?, SMTP ?, compteurs envoyés/échoués, par fournisseur.
function getMailHealth() {
  return {
    ovh:     { configured: !!(process.env.OVH_SMTP_USER && process.env.OVH_SMTP_PASS), host: process.env.OVH_SMTP_HOST || 'ssl0.ovh.net' },   // ← canal PRINCIPAL (était absent du health)
    gmailApi: { configured: _GMAIL_API_READY, verified: _mailStats.apiVerified, error: _mailStats.apiError },
    gmail:   { configured: !!(GMAIL_USER && GMAIL_APP_PASSWORD), verified: _mailStats.gmailVerified, error: _mailStats.gmailError, lastCheck: _mailStats.lastVerifyAt },
    mailjet: !!(MAILJET_API_KEY && MAILJET_SECRET_KEY),
    sent: _mailStats.sent, failed: _mailStats.failed, byProvider: _mailStats.byProvider,
    lastProvider: _mailStats.lastProvider || null, lastError: _mailStats.lastError || null,   // dernier canal gagnant / dernière erreur (visibilité)
  };
}

// ── API GMAIL (OAuth2 / HTTPS 443) — canal PRINCIPAL sur Render (SMTP bloqué) ─────────────────
// Envoie via gmail.googleapis.com : l'email part DU compte Google authentifié → SPF/DKIM/DMARC
// alignés → boîte de réception. Utilise uniquement le port 443 (jamais bloqué par Render).
const _GMAIL_API_READY = !!(GMAIL_OAUTH_CLIENT_ID && GMAIL_OAUTH_CLIENT_SECRET && GMAIL_OAUTH_REFRESH_TOKEN);
let _gmApiToken = { value: '', exp: 0 };
// Échange le refresh_token contre un access_token (caché ~50 min).
async function _gmailAccessToken() {
  if (_gmApiToken.value && Date.now() < _gmApiToken.exp) return _gmApiToken.value;
  const body = new URLSearchParams({
    client_id: GMAIL_OAUTH_CLIENT_ID, client_secret: GMAIL_OAUTH_CLIENT_SECRET,
    refresh_token: GMAIL_OAUTH_REFRESH_TOKEN, grant_type: 'refresh_token',
  });
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(), signal: ctrl.signal,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error(`OAuth ${r.status}: ${(j.error_description || j.error || '').slice(0, 120)}`);
    _gmApiToken = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 - 120000 };
    return _gmApiToken.value;
  } finally { clearTimeout(t); }
}
// Version TEXTE BRUT d'un HTML — un email multipart (texte + HTML) score BIEN mieux en
// délivrabilité qu'un HTML seul (un mail HTML-only est un signal de spam classique).
function _htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
// Construit un message MIME RFC822 (multipart/alternative texte+HTML) encodé en base64url (API Gmail).
// Avec `att` (images inline cid:) → multipart/related englobant l'alternative + les images en base64.
function _buildRaw(to, subject, html, att) {
  const fromHeader = `DataTradingPro <${GMAIL_USER || SUPPORT_EMAIL}>`;
  const subjEnc = '=?UTF-8?B?' + Buffer.from(subject, 'utf8').toString('base64') + '?=';   // sujet UTF-8 (accents/emojis)
  const text = _htmlToText(html);
  const boundary = 'dtp_' + Date.now().toString(36) + Math.floor(Date.now() % 1e6).toString(36);
  const _b64wrap = buf => buf.toString('base64').match(/.{1,76}/g).join('\r\n');   // lignes MIME ≤ 76 chars
  const alt = [
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    Buffer.from(text, 'utf8').toString('base64'), '',
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    Buffer.from(html, 'utf8').toString('base64'), '',
    `--${boundary}--`,
  ];
  let lines;
  const _bccLine = (typeof _bccFor === 'function' && _bccFor(to)) ? [`Bcc: ${_bccFor(to)}`] : [];   // copie admin (Cci) aussi sur le canal API Gmail
  if (att && att.length) {
    const rel = 'rel_' + boundary;
    lines = [
      `From: ${fromHeader}`, `To: ${to}`, ..._bccLine, `Reply-To: ${SUPPORT_EMAIL}`,
      `Subject: ${subjEnc}`, 'MIME-Version: 1.0',
      `Content-Type: multipart/related; boundary="${rel}"`, '',
      `--${rel}`, `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
      ...alt,
    ];
    for (const a of att) {
      lines.push('', `--${rel}`,
        `Content-Type: ${a.contentType || 'image/png'}; name="${a.filename || 'image.png'}"`,
        'Content-Transfer-Encoding: base64',
        `Content-ID: <${a.cid}>`,
        `Content-Disposition: inline; filename="${a.filename || 'image.png'}"`, '',
        _b64wrap(Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content)));
    }
    lines.push('', `--${rel}--`);
  } else {
    lines = [
      `From: ${fromHeader}`, `To: ${to}`, ..._bccLine, `Reply-To: ${SUPPORT_EMAIL}`,
      `Subject: ${subjEnc}`, 'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
      ...alt,
    ];
  }
  return Buffer.from(lines.join('\r\n'), 'utf8')
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function _sendGmailApi(to, subject, html, att) {
  const token = await _gmailAccessToken();
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: _buildRaw(to, subject, html, att) }), signal: ctrl.signal,
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`Gmail API ${r.status}: ${txt.slice(0, 200)}`);
    }
    console.log(`[Mailer] ✅ (API Gmail) "${subject}" → ${to}`);
    return true;
  } finally { clearTimeout(t); }
}

// ── Envois par fournisseur (chacun renvoie true/false ; une exception → on tente le suivant) ──
// Gmail SMTP : l'email part des serveurs Google AUTHENTIFIÉS comme l'expéditeur @gmail.com →
// SPF/DKIM alignés → délivrabilité FIABLE vers les boîtes Gmail. (Un From @gmail.com routé via un
// ESP tiers comme Mailjet n'est PAS aligné → Gmail le jette avant même les spams : c'est ce qui
// faisait que des clients ne recevaient « rien ».)
async function _sendGmail(to, subject, html, att) {
  const from = _parseFrom();
  const fromHeader = `${from.name || 'DataTradingPro'} <${GMAIL_USER}>`;   // expéditeur = compte authentifié (alignement garanti)
  await _getGmailTransport().sendMail({ from: fromHeader, replyTo: SUPPORT_EMAIL, to, bcc: _bccFor(to), subject, html, text: _htmlToText(html), attachments: (att && att.length) ? att : undefined });
  console.log(`[Mailer] ✅ (Gmail) "${subject}" → ${to}`);
  return true;
}
async function _sendMailjet(to, subject, html) {
  const from = _parseFrom();
  const auth = Buffer.from(`${MAILJET_API_KEY}:${MAILJET_SECRET_KEY}`).toString('base64');
  const textPart = html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const r = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ Messages: [{
      From: { Email: from.email, Name: from.name },
      To: [{ Email: to }],
      Subject: subject,
      HTMLPart: html,
      TextPart: textPart,
      ReplyTo: { Email: SUPPORT_EMAIL },
      TrackOpens: 'disabled',     // pas de pixel de suivi → meilleure délivrabilité
      TrackClicks: 'disabled',    // pas de réécriture des liens → moins de spam
    }] }),
    signal: _sig(15000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    console.error(`[Mailer] Mailjet échec (${r.status}) → ${to}:`, t.slice(0, 400));
    return false;
  }
  console.log(`[Mailer] ✅ (Mailjet) "${subject}" → ${to}`);
  return true;
}
async function _sendResend(to, subject, html) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html }),
    signal: _sig(15000),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    console.error(`[Mailer] Resend échec (${r.status}) → ${to}:`, txt.slice(0, 300));
    return false;
  }
  console.log(`[Mailer] ✅ (Resend) "${subject}" → ${to}`);
  return true;
}

// Anti-doublon : même (destinataire + objet) à < 12 s = double-clic / double-fire → ignoré.
const _recentSends = new Map();
function _isDuplicate(to, subject) {
  const key = `${to}|${subject}`;
  const now = Date.now();
  for (const [k, t] of _recentSends) if (now - t > 60000) _recentSends.delete(k);   // purge > 60 s
  const prev = _recentSends.get(key);
  _recentSends.set(key, now);
  return prev && (now - prev < 12000);
}

// ── COPIE ADMIN — DÉSACTIVÉE (28/07 : « juste le journal du panel admin, pas de copie mail »).
// La traçabilité passe par Campagne > Journal (email_log). Réactivable ponctuellement en posant
// MAIL_ADMIN_COPY=<adresse> dans l'env, sans toucher au code.
const _ADMIN_COPY = (() => { const v = String(process.env.MAIL_ADMIN_COPY || '').toLowerCase().trim(); return (v === 'off' || v === '0') ? '' : v; })();
function _bccFor(to) { return (_ADMIN_COPY && String(to).toLowerCase().trim() !== _ADMIN_COPY) ? _ADMIN_COPY : undefined; }

// ── Envoi bas niveau : valide, dé-doublonne, puis essaie les fournisseurs DANS L'ORDRE ──
// Ordre = API Gmail (HTTPS, depuis le compte Google, aligné DMARC → boîte de réception) →
//         Gmail SMTP (secours, même compte). 100% Google : Mailjet/Resend désactivés par défaut.
// ── SMTP OVH — envoi DEPUIS contact@datatradingpro.com (aligné SPF/DKIM du domaine → boîte de réception) ──
let _ovhTransport = null;
function _getOvhTransport() {
  if (_ovhTransport) return _ovhTransport;
  const nodemailer = require('nodemailer');
  const host = process.env.OVH_SMTP_HOST || 'ssl0.ovh.net';
  const port = parseInt(process.env.OVH_SMTP_PORT || '465', 10);
  _ovhTransport = nodemailer.createTransport({
    host, port, secure: port === 465, requireTLS: port !== 465,
    auth: { user: process.env.OVH_SMTP_USER, pass: process.env.OVH_SMTP_PASS },
  });
  return _ovhTransport;
}
async function _sendOvhSmtp(to, subject, html, att) {
  if (!process.env.OVH_SMTP_USER || !process.env.OVH_SMTP_PASS) return false;
  const from = process.env.EMAIL_FROM || process.env.OVH_SMTP_USER;   // ex. "DataTradingPro <contact@datatradingpro.com>"
  await _getOvhTransport().sendMail({ from, replyTo: SUPPORT_EMAIL, to, bcc: _bccFor(to), subject, html, text: _htmlToText(html),   // texte+HTML (multipart) = meilleure délivrabilité ; Cci = copie admin
    attachments: (att && att.length) ? att : undefined,   // images INLINE (cid:) — affichage garanti Outlook (pas de fetch distant)
    headers: { 'List-Unsubscribe': '<mailto:' + SUPPORT_EMAIL + '?subject=Unsubscribe>' } });   // mail-tester / bonnes pratiques
  return true;
}

/* Domaines RÉSERVÉS aux tests par les RFC 2606 / 6761 : ils ne peuvent PAS exister sur Internet.
   Un envoi vers l'un d'eux ne peut donc que rebondir — et chaque rebond abîme la réputation
   d'expédition du domaine, donc la délivrabilité des mails aux VRAIS clients.
   Constaté le 18/08 : un compte de test resté en production (« Test STF »,
   test-stf-…@test.local, créé le 12/08) a reçu un vrai e-mail de bienvenue. */
const _DOMAINES_TEST = /@(?:[^@]*\.)?(?:local|localhost|test|invalid|example|internal)$|@example\.(?:com|net|org)$/i;

async function _send(to, subject, html, attachments) {
  if (!_validEmail(to)) { console.warn('[Mailer] destinataire invalide : email ignoré:', to); return false; }
  if (_DOMAINES_TEST.test(String(to).trim())) {
    console.warn('[Mailer] domaine de test réservé (RFC 2606/6761) : envoi ANNULÉ →', to);
    return false;
  }
  // (28/07, demande user) Le tiret cadratin « — » est BANNI des mails : normalisé en tiret simple
  // au POINT DE SORTIE UNIQUE → couvre les gabarits statiques ET les contenus générés par l'IA.
  // ⚠️ ÉLARGI le 12/08 : le filtre ne voyait que le caractère LITTÉRAL. Un gabarit qui écrit
  // `&mdash;` — la forme la plus naturelle en HTML — passait au travers et le tiret ressortait dans
  // la boîte de réception. On normalise donc AUSSI les formes entité (nommée et numérique), et le
  // demi-cadratin « – », qui produit exactement le même effet visuel. Une seule expression, au même
  // endroit : aucun gabarit futur ne peut rouvrir la brèche.
  const _tirets = s => String(s || '')
    .replace(/&(?:mdash|ndash);|&#(?:8212|8211|151|150);/gi, '-')   // entités → caractère, pour un seul traitement ensuite
    .replace(/\s*[—–]\s*/g, ' - ');
  subject = _tirets(subject);
  html = _tirets(html).replace(/ -\s*([,;.!?])/g, '$1');
  if (_isDuplicate(to, subject)) { console.warn(`[Mailer] doublon ignoré (<12s) → ${to}: "${subject}"`); return false; }
  const chain = [];
  if (process.env.OVH_SMTP_USER && process.env.OVH_SMTP_PASS) chain.push(['OVH SMTP', _sendOvhSmtp]);  // ← PRINCIPAL : DEPUIS contact@datatradingpro.com (aligné SPF/DKIM domaine → inbox)
  if (_GMAIL_API_READY)                      chain.push(['API Gmail', _sendGmailApi]);   // secours (port 443, depuis le compte Google)
  if (GMAIL_USER && GMAIL_APP_PASSWORD)      chain.push(['Gmail',   _sendGmail]);        // secours (même compte ; SMTP bloqué Render mais gardé si débloqué)
  // Mailjet/Resend RETIRÉS (demande : 100% Google). Un From @gmail.com routé via un tiers
  // tombe en spam → inutile. Réactivables sans code via MAIL_ALLOW_THIRDPARTY=1 si besoin.
  if (process.env.MAIL_ALLOW_THIRDPARTY === '1') {
    if (MAILJET_API_KEY && MAILJET_SECRET_KEY) chain.push(['Mailjet', _sendMailjet]);
    if (RESEND_API_KEY)                        chain.push(['Resend',  _sendResend]);
  }
  if (!chain.length) {
    console.warn('[Mailer] Aucun fournisseur configuré (GMAIL_*, MAILJET_* ou RESEND_API_KEY) : email non envoyé:', subject);
    return false;
  }
  const errors = [];
  for (const [nom, fn] of chain) {
    try { if (await fn(to, subject, html, attachments)) { _mailStats.sent++; _mailStats.byProvider[nom] = (_mailStats.byProvider[nom] || 0) + 1; _mailStats.lastProvider = nom; console.log(`[Mailer] ✅ ${nom} → ${to} : "${subject}"`); return nom; } }   // succès → log + renvoie le canal gagnant (visibilité)
    catch (e) { console.error(`[Mailer] ${nom} erreur:`, e.message); errors.push(`${nom}: ${e.message}`); }   // échec → fournisseur suivant
  }
  _mailStats.failed++;
  _mailStats.lastError = errors.join(' | ');
  console.error(`[Mailer] ❌ Tous les fournisseurs ont échoué → ${to}: "${subject}"`);
  return false;
}

// Envoi de test (bouton admin) : renvoie le canal utilisé pour preuve de bout en bout.
async function sendTest(to) {
  const html = _layout('Test d\'envoi', `
    ${_H1}✅ Test d'envoi DataTradingPro</p>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.6;">Si tu lis cet email <b>dans ta boîte de réception</b> (pas les spams),
    l'envoi fonctionne parfaitement. 🎉</p>
    <p style="color:${TOK.grisDoux};font-size:13px;">Email automatique de vérification, tu peux l'ignorer.</p>`);
  const provider = await _send(to, 'DataTradingPro : test d\'envoi ✅', html);   // string (canal) si OK, false sinon
  return { ok: !!provider, provider: provider || null, lastError: _mailStats.lastError || null };
}

// ── ANCIENNETÉ de l'échéance → formulation adaptée ────────────────────────────
// Les mails de cycle de vie partent normalement à J+0/J+2. Mais le RATTRAPAGE admin les envoie
// à des comptes échus depuis des semaines : « votre essai vient de prendre fin » sonnerait alors
// faux, voire négligent. On dérive le délai de `expiresAt` (aucun paramètre à passer : les envois
// automatiques ET le rattrapage en profitent) et on formule en conséquence.
function _delai(expiresAt) {
  const t = expiresAt ? new Date(expiresAt).getTime() : NaN;
  if (!Number.isFinite(t)) return { jours: 0, recent: true, quand: '', tardif: false };
  const jours = Math.max(0, Math.floor((Date.now() - t) / 86400000));
  if (jours <= 2) return { jours, recent: true, quand: '', tardif: false };
  let quand;
  if (jours < 14) quand = `il y a ${jours} jours`;
  else if (jours < 60) quand = `il y a ${Math.round(jours / 7)} semaines`;
  else quand = `il y a ${Math.round(jours / 30)} mois`;
  return { jours, recent: false, quand, tardif: jours >= 7 };
}
// ══════════════════════════════════════════════════════════════════════════════
//  CHARTE VISUELLE COMMUNE DES MAILS — SOURCE UNIQUE (23/08)
//  Tous les gabarits (transactionnel ET campagne) piochent ICI. Les divergences
//  passées (deux gris quasi identiques, deux ors, trois rouges, deux rayons de
//  coins) venaient de styles recopiés mail par mail : ne JAMAIS redéfinir ces
//  valeurs en dur dans un template.
//  OR DES MAILS = #f3c344 (doré du favicon/logo DTP, choix user 2026-07-11 : le
//  #e3b23a du desk paraissait orange en mail). Le desk garde #e3b23a.
// ══════════════════════════════════════════════════════════════════════════════
const TOK = {
  or:       '#f3c344',                                              // or signature (CTA, accents, libellés)
  orSombre: '#b8860b',                                              // or sombre (bordures ghost, dégradé)
  orDeg:    'linear-gradient(100deg,#f0d27a,#cfa233 55%,#b8860b)',  // dégradé wordmark + bandeau haut
  orFond:   'rgba(243,195,68,0.07)',                                // fond des encadrés or
  orFilet:  'rgba(243,195,68,0.28)',                                // bordure des encadrés or
  fond:     '#0d0e11',                                              // fond de page (token desk)
  panneau:  '#16171b',                                              // carte principale (token desk)
  encart:   '#101014',                                              // encarts internes (identifiants, citations…)
  filet:    '#232429',                                              // bordure principale (token desk)
  filet2:   '#1f1f24',                                              // séparateurs de lignes
  blanc:    '#ffffff',
  texte:    '#c8ccd4',                                              // corps de texte
  gris:     '#9aa3b2',                                              // texte secondaire
  grisDoux: '#8b93a1',                                              // annotations
  grisPied: '#6f6f79',                                              // pieds de page
  vert:     '#22c55e',                                              // charte DTP : positif / risk-on
  rouge:    '#ef4444',                                              // charte DTP : négatif / risk-off
  ambre:    '#ffb300',                                              // charte DTP : neutre / attention
};
// H1 de mail — LA graisse/taille unique des titres (19px/800 blanc resserré), même
// grammaire dans les deux familles. Balise OUVRANTE (à fermer par </p>) pour pouvoir
// être injectée telle quelle dans les gabarits existants.
const _H1 = `<p style="margin:0 0 14px;font-size:19px;font-weight:800;color:${TOK.blanc};letter-spacing:-0.01em;">`;
// Libellé de SECTION — filet or à gauche + capitales or (grammaire de bandeau du desk).
function _secTitle(t) {
  return `<p style="margin:22px 0 8px;padding-left:9px;border-left:2px solid ${TOK.or};color:${TOK.or};font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;">${t}</p>`;
}
// ENCADRÉ OR — la mise en avant de l'essentiel (astuce, annonce, question à retenir).
function _goldBox(inner) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${TOK.orFond};border:1px solid ${TOK.orFilet};border-radius:8px;margin:18px 0;">
    <tr><td style="padding:14px 16px;color:#e6e6ea;font-size:13.5px;line-height:1.65;">${inner}</td></tr></table>`;
}
// ENCART SOMBRE — bloc interne (identifiants, citation, aide au démarrage). `gold` = liseré or.
function _encart(inner, gold) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${TOK.encart};border:1px solid ${TOK.filet};${gold ? `border-left:3px solid ${TOK.or};` : ''}border-radius:8px;margin:18px 0;">
    <tr><td style="padding:14px 18px;">${inner}</td></tr></table>`;
}

// Encart d'excuse — UNIQUEMENT sur les envois nettement en retard (≥ 7 j). Reconnaître le retard
// vaut mieux que d'écrire un message au présent des semaines après les faits.
function _noteRetard(d) {
  if (!d.tardif) return '';
  return _encart(`<div style="color:${TOK.gris};font-size:13px;line-height:1.6;">Ce message vous parvient avec du retard : votre accès s'est en réalité interrompu <strong style="color:#cbd5e1;">${d.quand}</strong> et nous aurions dû vous prévenir aussitôt. Toutes nos excuses.</div>`, true);
}

// ── SQUELETTE COMMUN des deux gabarits (transactionnel + campagne) ────────────
//  UNE seule carte pour toute la maison : bandeau or dégradé, wordmark or, sous-titre
//  capitales, corps, pied. Seuls le pied interne et la ligne sous la carte varient.
function _shell(title, bodyHtml, footInner, under) {
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>${_esc(title)}</title>
<style>@media (max-width:480px){ .dtp-pad{padding:20px 16px !important;} .dtp-wrap{padding:24px 8px !important;} }</style></head>
<body style="margin:0;padding:0;background:${TOK.fond};font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="dtp-wrap" style="background:${TOK.fond};padding:30px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${TOK.panneau};border:1px solid ${TOK.filet};border-radius:10px;overflow:hidden;">
        <tr><td bgcolor="#f3c344" height="3" style="height:3px;line-height:3px;font-size:0;background:${TOK.orDeg};mso-line-height-rule:exactly;">&nbsp;</td></tr>
        <tr><td style="padding:24px 34px 16px;border-bottom:1px solid ${TOK.filet};">
          <div style="font-size:22px;font-weight:700;letter-spacing:-0.01em;color:${TOK.or};background:${TOK.orDeg};-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;">DataTradingPro</div>
          <div style="font-size:11px;font-weight:600;color:#9a9aa4;margin-top:6px;letter-spacing:.09em;text-transform:uppercase;">Terminal macro &amp; forex</div>
        </td></tr>
        <tr><td class="dtp-pad" style="padding:26px 34px;color:${TOK.texte};font-size:15px;line-height:1.66;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:18px 34px;border-top:1px solid ${TOK.filet};color:${TOK.grisPied};font-size:12px;line-height:1.6;">
          ${footInner}
        </td></tr>
      </table>
      <div style="color:#565660;font-size:11px;margin-top:14px;line-height:1.7;max-width:600px;">${under}</div>
    </td></tr>
  </table>
</body></html>`;
}

// ── Gabarit TRANSACTIONNEL (bienvenue, MDP, cycle de vie) — même carte que la campagne,
//    pied « support + ne pas répondre » (pas de désinscription : ces envois sont contractuels).
//    opts.repondable : SUPPRIME la ligne « ne pas y répondre » quand le corps INVITE à répondre
//    (réengagement : « réponds simplement à ce mail ») — les deux phrases se contredisaient.
function _layout(title, bodyHtml, opts) {
  return _shell(title, bodyHtml,
    `DataTradingPro · Terminal de news &amp; d'analyse en temps réel.<br>
          Besoin d'aide&nbsp;? <a href="mailto:${SUPPORT_EMAIL}" style="color:${TOK.or};text-decoration:none;">${SUPPORT_EMAIL}</a>`,
    (opts && opts.repondable)
      ? `Vous pouvez répondre directement à cet email : nous lisons tout.`
      : `Cet email vous est envoyé automatiquement, merci de ne pas y répondre directement.`);
}

// Bouton PRINCIPAL — même or plein, mêmes coins et même « bulletproofing » Outlook que la
// campagne (_campaignBtn) : UN seul style de CTA dans toute la maison.
function _button(label, url) { return _campaignBtn(label, url); }

function _credBox(rows) {
  // Échappe la valeur ; si c'est un email, on la pré-emballe dans un <a> blanc : ça empêche
  // les clients (Gmail) de la re-transformer en lien bleu illisible sur fond sombre.
  const fmt = v => {
    const raw = String(v == null ? '' : v).trim();
    const s = _esc(raw);
    return _EMAIL_RE.test(raw)
      ? `<a href="mailto:${s}" style="color:${TOK.blanc};text-decoration:none;">${s}</a>`
      : s;
  };
  const items = rows.map(([k, v]) =>
    `<tr><td style="padding:6px 0;color:${TOK.gris};font-size:13px;width:130px;">${_esc(k)}</td>
         <td style="padding:6px 0;color:${TOK.blanc};font-size:14px;font-weight:600;font-family:monospace;">${fmt(v)}</td></tr>`
  ).join('');
  return _encart(`<table role="presentation" cellpadding="0" cellspacing="0" width="100%">${items}</table>`);
}

// Astuce anti-spam. RÈGLE (retour user 24/08 : « uniquement pour les templates qu'il faut, ça prend
// beaucoup de place ») : elle ne sert qu'au PREMIER contact, le seul moment où le lecteur peut mettre
// l'expéditeur en contacts avant de rater la suite. Elle vit donc dans le SEUL mail de bienvenue, et
// sous forme d'UNE LIGNE discrète : l'encadré or de six lignes qu'elle occupait dans onze templates
// mangeait autant de place que le message lui-même.
function _spamNote() {
  const sender = _esc(_parseFrom().email);
  return `<p style="margin:0 0 12px;font-size:12.5px;color:${TOK.grisPied};">Pour ne rater aucun message, ajoutez <strong style="color:#9aa3b2;">${sender}</strong> à vos contacts.</p>`;
}

// ══════════════════════════════════════════════════════════════════════════════
//  CATALOGUE DES EMAILS — chaque build*() renvoie {subject, html} (réutilisé par send*() + preview)
// ══════════════════════════════════════════════════════════════════════════════

// ── 1) Email de bienvenue (création de compte) ────────────────────────────────
function buildWelcome({ to, name, password, expiresAt }) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher client');
  const end = expiresAt ? new Date(expiresAt).toLocaleDateString('fr-FR') : 'Illimité';
  // Avec mot de passe (création) → on affiche les identifiants. SANS mot de passe (accueil d'un compte EXISTANT :
  // on ne stocke pas le mdp en clair et on ne réinitialise pas celui d'un compte actif) → on invite à se connecter
  // avec « Mot de passe oublié » au besoin. Email NON destructif.
  const creds = password
    ? `${_credBox([['Email', to], ['Mot de passe', password], ['Abonnement', `valide jusqu'au ${end}`]])}
    <p style="margin:0 0 4px;font-size:13px;color:#9aa3b2;">Par sécurité, nous vous recommandons de changer votre mot de passe après votre première connexion.</p>`
    : `${_credBox([['Email', to], ['Abonnement', `valide jusqu'au ${end}`]])}
    <p style="margin:0 0 4px;font-size:13px;color:#9aa3b2;">Connectez-vous avec l'email ci-dessus. Si vous n'avez pas (ou plus) votre mot de passe, cliquez sur « Mot de passe oublié » sur la page de connexion, ou répondez simplement à ce message, on vous aide.</p>`;
  const body = `
    ${_H1}Bienvenue, ${prenom} 👋</p>
    <p style="margin:0 0 14px;">Votre accès à <strong style="color:#fff;">DataTradingPro</strong> est activé : votre desk est prêt. Le flux de news en temps réel, le calendrier économique et les analyses institutionnelles vous attendent.</p>
    <p style="margin:0 0 6px;color:#9aa3b2;font-size:13px;">Vos identifiants de connexion :</p>
    ${creds}
    ${_button('Ouvrir mon desk', APP_URL)}
    ${_spamNote()}
    <p style="margin:0;font-size:13px;">Bienvenue parmi nous,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  // repondable si le corps invite à répondre (branche sans mot de passe : « répondez simplement à ce message »)
  return { subject: 'Bienvenue sur DataTradingPro : votre accès est activé', html: _layout('Bienvenue', body, { repondable: !password }) };
}
async function sendWelcome(d) { const m = buildWelcome(d); return _send(d.to, m.subject, m.html); }

// ── 2) Email de renouvellement échoué (abonnement non renouvelé) ──────────────
function buildRenewalFailed({ name }) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher client');
  const body = `
    ${_H1}Renouvellement de votre abonnement</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Le renouvellement de votre abonnement <strong style="color:#fff;">DataTradingPro</strong> n'a pas pu aboutir, et votre accès est pour l'instant <strong style="color:${TOK.rouge};">suspendu</strong>. Votre desk, lui, reste en place : dispositions, journal, réglages, rien n'a bougé.</p>
    <p style="margin:0 0 14px;">Un clic suffit pour reprendre le fil des marchés :</p>
    ${_button('Renouveler mon abonnement', WHOP_RENEW_URL)}
    <p style="margin:0;font-size:13px;">Nous restons à votre disposition,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: 'DataTradingPro : échec du renouvellement de votre abonnement', html: _layout('Renouvellement', body) };
}
async function sendRenewalFailed(d) { const m = buildRenewalFailed(d); return _send(d.to, m.subject, m.html); }

// ── 2a-bis) Email « abonnement expiré » (l'admin a marqué le compte expiré) ───
function buildExpired({ name, expiresAt }) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher client');
  const end = expiresAt ? new Date(expiresAt).toLocaleDateString('fr-FR') : null;
  const d = _delai(expiresAt);
  const body = `
    ${_H1}Votre abonnement a expiré</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Votre période d'abonnement à <strong style="color:#fff;">DataTradingPro</strong>${end ? ` est arrivée à échéance le <strong style="color:#fff;">${end}</strong>${d.recent ? '' : `, ${d.quand}`}` : ' a expiré'}. Votre accès au terminal est ${d.recent ? 'désormais' : 'depuis'} <strong style="color:${TOK.rouge};">suspendu</strong>.</p>
    ${_noteRetard(d)}
    <p style="margin:0 0 14px;">Votre desk vous attend, intact : news, calendrier économique, force des devises, analyses institutionnelles. Un clic et vous reprenez le fil :</p>
    ${_button('Renouveler mon abonnement', WHOP_RENEW_URL)}
    <p style="margin:0;font-size:13px;">À très vite,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: 'DataTradingPro : votre abonnement a expiré', html: _layout('Abonnement expiré', body) };
}
async function sendExpired(d) { const m = buildExpired(d); return _send(d.to, m.subject, m.html); }

// ── 2a-ter) RELANCE J+7 : une semaine après l'expiration, toujours pas renouvelé ──
//    Second (et dernier) rappel automatique — au-delà, ce sont les mails JALONS (win-back) qui
//    prennent le relais. Ton sobre : on montre ce qui a continué d'avancer, on ne supplie pas.
function buildExpiredFollowup({ name, expiresAt }) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher client');
  const end = expiresAt ? new Date(expiresAt).toLocaleDateString('fr-FR') : null;
  const body = `
    ${_H1}Le terminal a continué sans vous cette semaine</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Votre abonnement a expiré il y a une semaine${end ? ` (le <strong style="color:#fff;">${end}</strong>)` : ''} et votre accès est toujours suspendu. Pendant ce temps, le desk a continué de tourner : news en temps réel, calendrier, biais hebdomadaires, recherche bancaire.</p>
    <p style="margin:0 0 14px;">Si c'est un oubli, tout se réactive en un clic : votre compte, vos réglages et votre journal sont intacts :</p>
    ${_button('Réactiver mon accès', WHOP_RENEW_URL)}
    <p style="margin:0 0 14px;font-size:13px;color:#9aa3b2;">Si vous avez choisi d'arrêter, aucun souci : ce message est notre dernier rappel automatique.</p>
    <p style="margin:0;font-size:13px;">À bientôt peut-être,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: 'DataTradingPro : votre accès est toujours suspendu', html: _layout('Toujours suspendu', body) };
}
async function sendExpiredFollowup(d) { const m = buildExpiredFollowup(d); return _send(d.to, m.subject, m.html); }

// ── 2a-quater) MAILS JALONS (win-back) : 1 mois · 3 mois · 6 mois · 1 an après le départ ──
//    « Ça fait X que vous nous avez quittés — voici ce que le terminal est devenu. »
//    Un seul gabarit, copy et nouveautés ADAPTÉES au jalon (plus le départ est ancien, plus on
//    raconte le chemin parcouru). Informatif, jamais insistant (règle DTP : cadence sobre).
const _WINBACK = {
  1:  { titre: 'Un mois déjà : le desk a continué d\'avancer',
        intro: 'il y a un mois, votre accès à DataTradingPro s\'est arrêté. En un mois, le terminal a déjà bougé :',
        nouveautes: ['📰 Le fil s\'est enrichi : impact marché décrypté sur les statistiques majeures + graphe de réaction à la minute quand le marché a bougé', '🏦 Chaque publication porte désormais sa lecture banque centrale (ton mesuré, propos datés, prochaine réunion pricée)', '🧩 Six nouveaux widgets d\'analyse dans Mon Desk (Courbe des taux US, Corrélations entre paires, Volatilité par heure…)'] },
  3:  { titre: 'Ça fait 3 mois que vous nous avez quittés',
        intro: 'trois mois ont passé depuis la fin de votre accès, et le terminal d\'aujourd\'hui n\'est plus celui que vous avez connu :',
        nouveautes: ['🧩 Mon Desk : une quarantaine de widgets à composer, chaque carte affiche son verdict et la fraîcheur de sa donnée', '🧭 Radar de Biais recalculé en continu sur les données publiées', '🏦 Recherche bancaire : ~20 institutions réunies, résumées par l\'IA', '💻 L\'application desktop Windows/macOS se met à jour toute seule, en silence'] },
  6:  { titre: '6 mois : le terminal n\'est plus le même',
        intro: 'six mois que votre accès s\'est arrêté. Depuis, DataTradingPro a changé de dimension :',
        nouveautes: ['🧩 Mon Desk : une quarantaine de widgets avec verdict sur chaque carte + application desktop', '🧭 Biais et force des devises en temps réel, ancrés sur les vraies publications', '🏦 Recherche institutionnelle complète avec analyses IA', '📮 Des synthèses quotidiennes et hebdomadaires rédigées par le desk'] },
  12: { titre: 'Un an déjà : venez revoir ce que DataTradingPro est devenu',
        intro: 'cela fait un an que nous ne vous avons pas vu. En un an, le terminal a été repensé de fond en comble :',
        nouveautes: ['🖥️ Un desk complet : news temps réel, calendrier, biais, force des devises, COT, saisonnalité', '🧩 Mon Desk : une quarantaine de widgets, chacun avec sa ligne de verdict + application desktop native', '🏦 La recherche des grandes banques, résumée et exploitable en un clic', '🤖 Un copilote IA macro qui répond avec le contexte du moment'] },
};
function buildWinback({ name, months }) {
  const m = _WINBACK[months] || _WINBACK[3];
  const prenom = _esc((name || '').split(' ')[0] || 'cher trader');
  const feats = m.nouveautes.map(n => `<tr><td style="padding:5px 0;color:#cbd5e1;font-size:14px;line-height:1.6;">${n}</td></tr>`).join('');
  const body = `
    ${_H1}${m.titre}</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">${prenom}, ${m.intro}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 12px;">${feats}</table>
    <p style="margin:0 0 14px;">Votre desk existe toujours : réglages, dispositions et journal compris. Un clic et vous retrouvez tout :</p>
    ${_button('Retrouver mon desk', WHOP_RENEW_URL)}
    <p style="margin:0 0 14px;font-size:13px;color:#9aa3b2;">Sans engagement, résiliable à tout moment. Et si vous préférez ne plus recevoir ces nouvelles, répondez simplement à ce mail.</p>
    <p style="margin:0;font-size:13px;">Au plaisir de vous revoir,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  const subj = { 1: 'Un mois sans vous : le desk a continué d\'avancer', 3: 'Ça fait 3 mois : voyez ce que DataTradingPro est devenu', 6: '6 mois après : le terminal n\'est plus le même', 12: 'Un an déjà : DataTradingPro a bien changé' };
  // repondable : le corps propose « répondez simplement à ce mail » pour ne plus recevoir ces nouvelles
  return { subject: subj[months] || subj[3], html: _layout('Des nouvelles du desk', body, { repondable: true }) };
}
async function sendWinback(d) { const m = buildWinback(d); return _send(d.to, m.subject, m.html); }

// ── 2a-quinquies) TÉMOIGNAGE (campagne, VALIDATION MANUELLE UNIQUEMENT — jamais d'envoi auto) ──
//    Raconte JustOneTrader + le développement du terminal, appuyé par un VRAI avis Whop.
//    `angle` (optionnel, IA) : 2-3 phrases adaptées AU commentaire pour que le récit colle à ce
//    que le membre a réellement dit ; sinon repli neutre.
/* ══ TÉMOIGNAGE : CINQ GABARITS, PAS UN SEUL (28/08, demande user) ═══════════════════════════════
   AVANT : un gabarit unique, le MÊME objet et la MÊME accroche chaque mois — et côté serveur
   `reviews[0]`, donc le MÊME avis à chaque envoi. Un abonné non-membre recevait douze fois par an
   rigoureusement le même e-mail. Le seul élément variable était l'angle IA, invisible sous une
   accroche identique.
   MÊME PATRON QUE MINDSET (`MINDSET_CONCEPTS` / `pickMindsetConcept`) : une liste de variantes
   portant chacune sa clé, et un choix qui ÉCARTE d'abord celles déjà servies. Chaque variante
   change ce qui se voit : l'objet, l'accroche, la façon d'amener la citation et la phrase de
   clôture. La citation, elle, reste la parole du membre — on ne la réécrit jamais. */
const TEMOIGN_VARIANTES = [
  { key: 'retient',
    subject: "Ce qu'un membre retient de DataTradingPro",
    titre: "Ce qu'un membre retient de DataTradingPro",
    intro: "Derrière DataTradingPro, il y a <strong style=\"color:#fff;\">JustOneTrader</strong> : un trader qui construisait son propre outil de suivi macro, et qui a fini par en faire un terminal complet. News en temps réel, calendrier, biais des devises, recherche des grandes banques. Le desk évolue chaque semaine, guidé par ce que les membres en font vraiment.",
    avant: "", cta: 'Découvrir le terminal',
    defaut: "C'est exactement pour ça que le terminal existe : réunir sur un seul écran ce qu'un trader macro passait sa journée à chercher sur dix sources." },
  { key: 'dix-sources',
    subject: "Dix onglets ouverts, ou un seul écran",
    titre: "Dix onglets, ou un seul écran",
    intro: "Un trader macro passe l'essentiel de sa préparation à rassembler : le calendrier ici, les news là, les notes de banques ailleurs, et le biais de chaque devise reconstitué de tête. DataTradingPro réunit tout ça au même endroit, mis à jour en continu.",
    avant: "Un membre le résume mieux que nous :", cta: 'Voir le desk en entier',
    defaut: "Le temps gagné sur la collecte, c'est du temps rendu à la décision." },
  { key: 'pourquoi-restent',
    subject: "Pourquoi les membres restent",
    titre: "Pourquoi les membres restent",
    intro: "On peut décrire un produit longtemps. Ce qui compte vraiment, c'est ce qu'en disent celles et ceux qui l'ouvrent tous les matins avant la séance.",
    avant: "Cet avis, vérifié par Whop, est arrivé tel quel :", cta: 'Essayer le terminal',
    defaut: "Ce qui revient le plus souvent : ne plus avoir à chercher l'information avant de pouvoir l'utiliser." },
  { key: 'note-cinq',
    subject: "Cinq étoiles, et la raison derrière",
    titre: "La note, et la raison derrière",
    intro: "Une note seule ne dit pas grand-chose. Ce qui l'accompagne, en revanche, dit précisément à quoi sert le desk au quotidien.",
    avant: "", cta: 'Rejoindre le desk',
    defaut: "Une note se donne en une seconde ; ce qui la motive se lit en une phrase." },
  { key: 'objection',
    subject: "« Encore un outil de plus ? »",
    titre: "« Encore un outil de plus ? »",
    intro: "C'est la question la plus légitime qu'on nous pose, et on la comprend : personne n'a besoin d'un abonnement supplémentaire. La vraie question n'est pas d'ajouter un outil, c'est d'en retirer neuf.",
    avant: "Un membre y a répondu à sa façon :", cta: 'Voir ce que ça remplace',
    defaut: "Le desk ne s'ajoute pas à votre routine : il en remplace la partie la plus fastidieuse." },
];
/* Choix de la variante : d'abord celles JAMAIS servies, puis on recycle la plus ancienne. Copie
   fidèle de la logique de `pickMindsetConcept` — même comportement, mêmes surprises en moins. */
function pickTemoignVariante(recentKeys) {
  recentKeys = Array.isArray(recentKeys) ? recentKeys : [];
  const fresh = TEMOIGN_VARIANTES.filter(v => !recentKeys.includes(v.key));
  const pool = fresh.length ? fresh : TEMOIGN_VARIANTES;
  return pool[0] || TEMOIGN_VARIANTES[0];
}
function buildTemoignage({ name, review, angle, varianteKey, recentKeys } = {}) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher trader');
  const r = review || {};
  const V = (varianteKey && TEMOIGN_VARIANTES.find(v => v.key === varianteKey)) || pickTemoignVariante(recentKeys);
  const stars = Math.max(1, Math.min(5, Number(r.stars) || 5));
  const quote = _esc(String(r.description || '').trim()).replace(/\n+/g, '<br>');
  const etoiles = '★'.repeat(stars) + '☆'.repeat(5 - stars);
  const lien = angle && String(angle).trim() ? _esc(String(angle).trim()) : V.defaut;
  // Le titre de l'avis, quand il existe, donne un 2e élément variable propre à CET avis.
  const titreAvis = _esc(String(r.title || '').trim());
  const body = `
    ${_H1}${_esc(V.titre)}</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">${V.intro}</p>
    ${V.avant ? `<p style="margin:0 0 14px;">${_esc(V.avant)}</p>` : ''}
    ${_encart(`<div style="color:${TOK.or};font-size:14px;letter-spacing:2px;margin-bottom:8px;">${etoiles}</div>
        ${titreAvis ? `<div style="color:#fff;font-size:14px;font-weight:600;margin-bottom:6px;">${titreAvis}</div>` : ''}
        <div style="color:#e2e8f0;font-size:15px;line-height:1.65;font-style:italic;">« ${quote} »</div>
        <div style="color:${TOK.grisDoux};font-size:12.5px;margin-top:10px;">Membre DataTradingPro · avis vérifié Whop</div>`, true)}
    <p style="margin:0 0 14px;">${lien}</p>
    ${_button(V.cta, WHOP_RENEW_URL)}
    <p style="margin:0;font-size:13px;">À très vite sur le desk,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: V.subject, html: _layout('Témoignage', body), varianteKey: V.key };
}
async function sendTemoignage(d) { d = d || {}; const m = buildTemoignage(d); if (!m) return false; const ok = await _send(d.to, m.subject, m.html); return ok ? { ok: true, varianteKey: m.varianteKey } : false; }

// ── « Mot de passe oublié » demandé par un compte SANS abonnement actif (suspendu/expiré) ─────
//    SÉCURITÉ : on NE réinitialise PAS le mot de passe (réservé aux comptes actifs). On explique
//    l'abonnement inactif + CTA de réactivation, façon pro. (Aucun mot de passe n'est régénéré.)
function buildForgotNoSub({ name }) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher client');
  const body = `
    ${_H1}Réinitialisation impossible : abonnement inactif</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Vous venez de demander la réinitialisation de votre mot de passe DataTradingPro. Or votre <strong style="color:#fff;">abonnement n'est pas actif</strong> : votre accès au terminal est actuellement <strong style="color:${TOK.rouge};">suspendu</strong>.</p>
    <p style="margin:0 0 14px;">Pour des raisons de sécurité, nous ne réinitialisons le mot de passe que pour les comptes disposant d'un <strong style="color:#fff;">abonnement actif</strong>. Dès que le vôtre sera réactivé, vous pourrez de nouveau vous connecter (et réinitialiser votre mot de passe si besoin).</p>
    ${_button('Réactiver mon abonnement', WHOP_RENEW_URL)}
    <p style="margin:0;font-size:13px;">À très vite sur le terminal,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: 'DataTradingPro : réinitialisation impossible : abonnement inactif', html: _layout('Abonnement inactif', body) };
}
async function sendForgotNoSub(d) { const m = buildForgotNoSub(d); return _send(d.to, m.subject, m.html); }

// ── 2b) Email de réactivation (compte remis en actif) ────────────────────────
function buildReactivated({ name, expiresAt }) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher client');
  const end = expiresAt ? new Date(expiresAt).toLocaleDateString('fr-FR') : null;
  const body = `
    ${_H1}Votre desk vous attend, ${prenom} ✅</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Votre abonnement à <strong style="color:#fff;">DataTradingPro</strong> est de nouveau <strong style="color:${TOK.vert};">actif</strong>, et tout est resté en place : vos dispositions, votre journal, vos réglages. Vous reprenez exactement là où vous vous étiez arrêté.${end ? ` Votre accès court jusqu'au <strong style="color:#fff;">${end}</strong>.` : ''}</p>
    <p style="margin:0 0 14px;">Le desk a continué de travailler pendant votre absence : chaque publication porte désormais sa lecture banque centrale, et chaque widget de Mon Desk affiche son verdict.</p>
    ${_button('Retrouver mon desk', APP_URL)}
    <p style="margin:0;font-size:13px;">Heureux de vous retrouver,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: 'DataTradingPro : votre accès est réactivé', html: _layout('Réactivation', body) };
}
async function sendReactivated(d) { const m = buildReactivated(d); return _send(d.to, m.subject, m.html); }

// ── 2c) Email de renouvellement réussi (paiement Whop renouvelé) ──────────────
function buildRenewed({ name, expiresAt }) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher client');
  const end = expiresAt ? new Date(expiresAt).toLocaleDateString('fr-FR') : null;
  const body = `
    ${_H1}Merci de votre confiance ✅</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Votre abonnement à <strong style="color:#fff;">DataTradingPro</strong> a bien été <strong style="color:${TOK.vert};">renouvelé</strong>${end ? ` jusqu'au <strong style="color:#fff;">${end}</strong>` : ''}. Rien ne bouge de votre côté : vos dispositions, votre journal et vos réglages restent en place, et votre desk continue de travailler pour vous, séance après séance.</p>
    ${_button('Ouvrir mon desk', APP_URL)}
    <p style="margin:0;font-size:13px;">Au plaisir de vous accompagner,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: 'DataTradingPro : votre abonnement est renouvelé', html: _layout('Renouvellement', body) };
}
async function sendRenewed(d) { const m = buildRenewed(d); return _send(d.to, m.subject, m.html); }

// ── 2d) Geste commercial : +1 mois offert (maintenance) ───────────────────────
function buildGestureMonth({ name, expiresAt }) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher client');
  const end = expiresAt ? new Date(expiresAt).toLocaleDateString('fr-FR') : null;
  const body = `
    ${_H1}1 mois offert 🎁</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Pour la récente période de <strong style="color:#fff;">maintenance</strong>, et pour vous remercier de votre patience, nous ajoutons <strong style="color:${TOK.vert};">1 mois supplémentaire</strong> à votre abonnement DataTradingPro. C'est notre façon de prendre soin de ceux qui nous font confiance.</p>
    ${end ? `<p style="margin:0 0 14px;">Votre accès est désormais valable jusqu'au <strong style="color:#fff;">${end}</strong>.</p>` : ''}
    ${_button('Ouvrir mon desk', APP_URL)}
    <p style="margin:0;font-size:13px;">Merci de votre confiance,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: 'DataTradingPro : 1 mois offert pour la maintenance 🎁', html: _layout('Geste commercial', body) };
}
async function sendGestureMonth(d) { const m = buildGestureMonth(d); return _send(d.to, m.subject, m.html); }

// ── Annonce « de nouveau en ligne » (membres existants) ───────────────────────
function buildLaunchLive({ name } = {}) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher trader');
  const body = `
    ${_H1}C'est de nouveau en ligne 🚀</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Bonne nouvelle : <strong style="color:#fff;">DataTradingPro est de nouveau en ligne</strong>, avec une <strong style="color:#fff;">interface entièrement repensée</strong>.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 12px;">
      <tr><td style="padding:6px 0;color:#cbd5e1;font-size:14px;line-height:1.55;">🎨 <strong style="color:#fff;">Nouvelle identité visuelle</strong> : design premium, plus lisible, pensé pour le trading.</td></tr>
      <tr><td style="padding:6px 0;color:#cbd5e1;font-size:14px;line-height:1.55;">🇫🇷 <strong style="color:#fff;">100% en français</strong> : chaque widget, chaque libellé.</td></tr>
      <tr><td style="padding:6px 0;color:#cbd5e1;font-size:14px;line-height:1.55;">⚡ <strong style="color:#fff;">Terminal plus clair</strong> : biais du marché, calendrier, fil de news priorisé, force des devises, COT, Semaine à Venir, taux & Copilote Macro IA.</td></tr>
    </table>
    <p style="margin:0 0 14px;">Vos <strong style="color:#fff;">identifiants restent les mêmes</strong> : connectez-vous, tout se charge en temps réel.</p>
    ${_button('Accéder à mon terminal →', APP_URL)}
    <p style="margin:14px 0 0;font-size:13px;">À très vite sur le desk,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: 'DataTradingPro est de nouveau en ligne, nouvelle interface 🚀', html: _layout('De nouveau en ligne', body) };
}
async function sendLaunchLive(d) { const m = buildLaunchLive(d || {}); return _send(d.to, m.subject, m.html); }

// ── 3) Email de réinitialisation de mot de passe ──────────────────────────────
function buildPasswordReset({ to, name, password }) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher client');
  const body = `
    ${_H1}Réinitialisation de votre mot de passe</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Votre mot de passe DataTradingPro a été réinitialisé. Voici votre nouveau mot de passe :</p>
    ${_credBox([['Email', to], ['Nouveau mot de passe', password || '-']])}
    <p style="margin:0 0 4px;font-size:13px;color:#9aa3b2;">Pour votre sécurité, pensez à le modifier depuis votre profil après connexion. Si vous n'êtes pas à l'origine de cette demande, contactez-nous immédiatement.</p>
    ${_button('Me connecter', APP_URL)}
    <p style="margin:0;font-size:13px;">L'équipe DataTradingPro</p>`;
  return { subject: 'DataTradingPro : votre mot de passe a été réinitialisé', html: _layout('Réinitialisation', body) };
}
async function sendPasswordReset(d) { const m = buildPasswordReset(d); return _send(d.to, m.subject, m.html); }

// ── 4) Fin d'essai gratuit (1 semaine) → passer à l'abonnement MENSUEL ────────
//    Envoyé LE JOUR où l'essai a expiré. Sans prix : invite à prendre l'abonnement
//    mensuel via la page Whop.
function buildTrialUpsell({ name, expiresAt }) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher trader');
  const end = expiresAt ? new Date(expiresAt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : null;
  const d = _delai(expiresAt);
  const body = `
    ${_H1}Votre essai gratuit est terminé ⏳</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Votre <strong style="color:#fff;">semaine d'accès offert</strong> à DataTradingPro ${d.recent ? 'vient de prendre fin' : `a pris fin ${d.quand}`}${end ? ` (échéance du <strong style="color:#f3c344;">${end}</strong>)` : ''}. Vous avez pu tester en conditions réelles le flux de news en temps réel, le calendrier économique et nos analyses institutionnelles.</p>
    ${_noteRetard(d)}
    <p style="margin:0 0 14px;">Pour <strong style="color:#fff;">retrouver votre accès</strong> et continuer à trader avec les données qui font bouger les marchés, passez dès maintenant à l'<strong style="color:#fff;">abonnement mensuel</strong>, sans engagement et résiliable à tout moment :</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:18px 0;">
      <tr><td style="padding:6px 0;color:#cbd5e1;font-size:14px;">📰 News &amp; squawk en temps réel, avec la lecture banque centrale sur chaque publication</td></tr>
      <tr><td style="padding:6px 0;color:#cbd5e1;font-size:14px;">📅 Calendrier économique, résultats live et graphe de réaction à la minute</td></tr>
      <tr><td style="padding:6px 0;color:#cbd5e1;font-size:14px;">🏦 Recherche des grandes banques &amp; Récap Quotidien / Récap Hebdo</td></tr>
      <tr><td style="padding:6px 0;color:#cbd5e1;font-size:14px;">📊 Mon Desk : une quarantaine de widgets, verdict et fraîcheur affichés sur chaque carte</td></tr>
    </table>
    ${_button('Activer mon abonnement mensuel', WHOP_RENEW_URL)}
    <p style="margin:0 0 14px;font-size:13px;color:#9aa3b2;">Abonnement mensuel sans engagement : votre accès est réactivé immédiatement après l'inscription.</p>
    <p style="margin:0;font-size:13px;">À très vite sur le terminal,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: 'Votre essai DataTradingPro est terminé : réactivez votre accès', html: _layout('Fin d\'essai', body) };
}
async function sendTrialUpsell(d) { const m = buildTrialUpsell(d); return _send(d.to, m.subject, m.html); }

// ── 5) Réengagement : utilisateur inactif depuis ~7 jours (marketing, "reviens !") ──
//    Ton direct (tutoiement), centré sur NOS fonctionnalités réelles. But : recliquer
//    et reprendre l'habitude d'ouvrir le terminal pendant les sessions.
function _buildReengagement(name, days) {
  const prenom = _esc((name || '').split(' ')[0] || 'trader');
  const d = days || 7;
  // STRUCTURE COMMUNE (23/08, retour user « je vois pas de cohérence ») : H1 standard,
  // paragraphe, sections _secTitle + lignes « → », UN encadré or (l'essentiel : l'invitation
  // à répondre), UN seul CTA or en clôture. Le tutoiement (voix historique du mail) reste.
  const body = `
    ${_H1}Ton desk t'attend, ${prenom}</p>
    <p style="margin:0 0 14px;">Il y a ${d} jours, tu as activé ton accès à <strong style="color:#fff;">DataTradingPro</strong>. Depuis, on ne t'a pas revu. Le terminal est dense, c'est vrai : voici par où commencer.</p>
    ${_secTitle('Pour démarrer en 5 minutes')}
    <p style="margin:0 0 8px;color:#cbd5e1;font-size:14px;">Pendant la session de Londres (9h–10h), ouvre&nbsp;:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 6px;">
      <tr><td style="padding:5px 0;color:#cbd5e1;font-size:14px;">→ <strong style="color:#fff;">Recherche bancaire</strong> <span style="color:${TOK.gris};">(Goldman Sachs, HSBC, ING, MUFG…)</span></td></tr>
      <tr><td style="padding:5px 0;color:#cbd5e1;font-size:14px;">→ <strong style="color:#fff;">Calendrier économique</strong> <span style="color:${TOK.gris};">(résultats live + lecture banque centrale au clic)</span></td></tr>
      <tr><td style="padding:5px 0;color:#cbd5e1;font-size:14px;">→ <strong style="color:#fff;">Force des devises · COT · Sentiment des particuliers</strong> <span style="color:${TOK.gris};">(qui mène, qui décroche)</span></td></tr>
    </table>
    ${_secTitle('Et le reste de ton desk')}
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr><td style="padding:5px 0;color:#cbd5e1;font-size:13.5px;">📊 <strong style="color:#fff;">Liste FX</strong> : la vue d'ensemble du Forex (force, biais, momentum 1M/3M/12M)</td></tr>
      <tr><td style="padding:5px 0;color:#cbd5e1;font-size:13.5px;">⚡ <strong style="color:#fff;">Le fil d'actualité</strong> : les news qui bougent les marchés, avec leur impact décrypté en direct</td></tr>
      <tr><td style="padding:5px 0;color:#cbd5e1;font-size:13.5px;">📝 <strong style="color:#fff;">Récap Quotidien &amp; Récap Hebdo</strong> : le marché résumé, à ta place</td></tr>
      <tr><td style="padding:5px 0;color:#cbd5e1;font-size:13.5px;">🧩 <strong style="color:#fff;">Mon Desk</strong> : une quarantaine de widgets, chaque carte affiche son verdict</td></tr>
    </table>
    ${_goldBox(`☕ Dix minutes de session de Londres suffisent pour voir ce que le desk t'apporte. Et si quelque chose ne t'a pas plu, <strong style="color:#fff;">réponds simplement à ce mail</strong> : on lit tout.`)}
    ${_button('Revenir sur mon desk', APP_URL)}
    <p style="margin:14px 0 0;font-size:13px;">On se revoit sur le desk,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: `${prenom}, ton desk DataTradingPro t'attend 👀`, html: _layout('On se revoit ?', body, { repondable: true }) };
}
function buildReengagement({ name, days }) { return _buildReengagement(name, days); }
async function sendReengagement(d) { const m = _buildReengagement(d.name, d.days); return _send(d.to, m.subject, m.html); }

// ── 5b) ANNONCE PRODUIT : DataTradingPro v2 officiellement finalisée (broadcast à tous les clients) ──
//    Email marketing : annonce la finalisation de la v2 + pousse à l'adhésion (CTA → page Whop).
//    Réutilise STRICTEMENT le gabarit commun (layout/bouton/note anti-spam) + la même chaîne d'envoi
//    que la bienvenue. Lien d'inscription = WHOP_RENEW_URL (même page que renouvellement/essai).
function buildAnnouncementV2({ name } = {}) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher trader');
  const feats = [
    ['📰', 'News priorisée', "le flux filtré : que l'important, classé par impact, résumé et expliqué par l'IA en un clic."],
    ['🧭', 'Biais du marché', 'le biais directionnel des 8 grandes devises, recalculé en continu sur les fondamentaux publiés.'],
    ['⚡', 'Force des devises en temps réel', "qui mène, qui décroche, d'un coup d'œil."],
    ['📅', 'Calendrier macro', 'les publications qui bougent les marchés : consensus, précédent et résultat dès la sortie, avec la lecture banque centrale.'],
    ['🤖', 'Assistant IA macro', "posez votre question en français, l'IA répond avec le contexte marché du moment."],
    ['🏦', 'Rapports de banques', 'Goldman, ING, MUFG, Danske… la recherche institutionnelle réunie, lisible en PDF.'],
  ].map(([ico, t, d]) =>
    `<tr><td style="padding:7px 0;color:#cbd5e1;font-size:14px;line-height:1.55;">${ico} <strong style="color:#fff;">${t}</strong> : ${d}</td></tr>`
  ).join('');
  const body = `
    ${_H1}C'est officiel : la v2 est finalisée 🚀</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Ça y est. Après des mois de développement et d'écoute, <strong style="color:#fff;">la version 2 de DataTradingPro est officiellement finalisée.</strong></p>
    <p style="margin:0 0 14px;">Ce n'est plus une promesse : c'est le terminal le plus abouti qu'on ait livré. Tout ce qu'un trader macro attend, réuni et <strong style="color:#fff;">connecté sur un seul écran</strong>.</p>
    ${_secTitle('Ce que réunit votre desk')}
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 12px;">${feats}</table>
    <p style="margin:0 0 14px;color:#9aa3b2;font-size:13px;">+ Mon Desk (une quarantaine de widgets à composer), Sentiment de Risque, saisonnalité, taux des banques centrales, journal de trading…</p>
    <p style="margin:14px 0 4px;">Arrêtez de deviner les mouvements. <strong style="color:#fff;">Commencez à les comprendre.</strong></p>
    ${_button('Rejoindre DataTradingPro →', WHOP_RENEW_URL)}
    <p style="margin:0 0 14px;font-size:13px;color:#9aa3b2;">Accès complet immédiat · sans engagement, résiliable en un clic.</p>
    ${_goldBox(`⏳ Le terminal est complet et déjà en ligne. Chaque session que vous manquez, c'est une longueur d'avance en moins : <strong style="color:#fff;">rejoignez le lancement maintenant.</strong>`)}
    <p style="margin:14px 0 0;font-size:13px;">À très vite sur le terminal,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>
    <p style="margin:14px 0 0;font-size:11px;color:#6b7280;">Vous recevez cet email en tant que membre DataTradingPro. <a href="mailto:${SUPPORT_EMAIL}?subject=Desabonnement" style="color:#6b7280;text-decoration:underline;">Se désabonner</a>.</p>`;
  return { subject: "C'est officiel : DataTradingPro v2 est finalisé 🚀", html: _layout('DataTradingPro v2', body) };
}
async function sendAnnouncementV2(d) { const m = buildAnnouncementV2(d || {}); return _send(d.to, m.subject, m.html); }

// ══════════════════════════════════════════════════════════════════════════════
//  CAMPAGNE HEBDO — mail d'introduction (1er de la sequence) + desinscription reelle
// ══════════════════════════════════════════════════════════════════════════════
const LANDING_URL   = process.env.LANDING_URL || 'https://datatradingpro.com';
// ⚠️ SÉCURITÉ (07/08, demande user) : le repli était le LITTÉRAL 'dtp-unsub-v1' — écrit dans le code,
// donc quiconque a vu le dépôt pouvait FORGER des liens de désinscription (et des jetons de tracking,
// même secret) pour n'importe quelle adresse, et désabonner toute l'audience en une boucle. Si aucune
// des deux variables d'environnement n'est posée, on tire désormais un secret ALÉATOIRE au démarrage :
// la forge devient impossible. Coût assumé dans ce cas — et seulement dans ce cas — les liens des
// mails déjà envoyés meurent au redémarrage suivant ; c'est le prix d'un secret qui n'existe plus en
// clair nulle part. En production SESSION_SECRET est posé : rien ne change, les anciens liens vivent.
const _UNSUB_SECRET = process.env.UNSUB_SECRET || process.env.SESSION_SECRET
  || (() => { console.error('[Sécurité] UNSUB_SECRET/SESSION_SECRET absents → secret de désinscription ALÉATOIRE (les liens ne survivront pas au redémarrage). Posez UNSUB_SECRET dans l\'environnement.'); return crypto.randomBytes(32).toString('hex'); })();
// Jeton HMAC lie a l'email : empeche qu'un tiers desabonne quelqu'un d'autre en devinant l'URL.
// server.js verifie le meme jeton (mailer.unsubToken) avant de supprimer.
function unsubToken(email) {
  return crypto.createHmac('sha256', _UNSUB_SECRET).update(String(email || '').toLowerCase().trim()).digest('hex').slice(0, 16);
}
function unsubUrl(email) {
  const e = String(email || '').toLowerCase().trim();
  return `${APP_URL}/api/unsubscribe?e=${encodeURIComponent(e)}&t=${unsubToken(e)}`;
}

// ── Tracking ouvertures / clics — jeton HMAC lié à (campagne, email) ───────────
// Empêche de forger une ouverture/un clic pour un e-mail arbitraire (le serveur revérifie mailer.trackToken).
function trackToken(campaign, email) {
  return crypto.createHmac('sha256', _UNSUB_SECRET).update('trk:' + String(campaign || '') + ':' + String(email || '').toLowerCase().trim()).digest('hex').slice(0, 16);
}
function trackOpenUrl(campaign, email) {
  const e = String(email || '').toLowerCase().trim();
  return `${APP_URL}/api/track/open?c=${encodeURIComponent(campaign || '')}&e=${encodeURIComponent(e)}&t=${trackToken(campaign, e)}`;
}
// Enrobe une URL cible → passe par le tracker (302 vers la vraie URL après enregistrement du clic).
function trackClickUrl(campaign, email, target) {
  const e = String(email || '').toLowerCase().trim();
  return `${APP_URL}/api/track/click?c=${encodeURIComponent(campaign || '')}&e=${encodeURIComponent(e)}&t=${trackToken(campaign, e)}&u=${encodeURIComponent(target || '')}`;
}

// Gabarit CAMPAGNE — IDENTITE FIDELE AU DESK : tokens reels du terminal (bg #0d0e11, panneau #16171b,
// filet #232429). OR DES MAILS = #f3c344 (dore du FAVICON/logo DTP, choix user 2026-07-11 pour la coherence
// identite visuelle : le #e3b23a du desk paraissait orange). N'utiliser QUE #f3c344 dans les mails (le desk
// garde #e3b23a). Degrade wordmark or #f0d27a->#cfa233->#b8860b. Le degrade est applique en
// TEXTE (wordmark) avec repli SOLIDE #f3c344 (Outlook ignore background-clip -> texte or plein, jamais
// invisible) + en bandeau haut (bgcolor #f3c344 de repli). Rendu premium, hierarchie du desk.
function _campaignLayout(title, bodyHtml, unsub) {
  return _shell(title, bodyHtml,
    `Besoin d'aide&nbsp;? <a href="mailto:${SUPPORT_EMAIL}" style="color:${TOK.or};text-decoration:none;">${SUPPORT_EMAIL}</a>`,
    `Vous recevez cet email en tant que membre de l'&eacute;cosyst&egrave;me DataTradingPro (JustOneTrader).<br>
        <a href="${unsub}" style="color:${TOK.grisDoux};text-decoration:underline;">Se d&eacute;sabonner en un clic</a>`);
}
function _campaignBtn(label, url) {
  // CTA = OR PLEIN (comme les boutons du desk : solide #f3c344, texte quasi-noir, coins ~desk, PAS de degrade).
  // bgcolor (attribut) = rendu Outlook/Word garanti. Repli couleur pleine partout.
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr>
    <td align="center" bgcolor="#f3c344" style="background:#f3c344;border-radius:6px;mso-padding-alt:14px 34px;">
      <a href="${url}" style="display:inline-block;padding:14px 34px;color:#0d0e11;font-weight:700;font-size:15px;letter-spacing:.01em;text-decoration:none;">${_esc(label)}</a>
    </td></tr></table>`;
}
// Bouton SECONDAIRE (bordure or, fond transparent) : pour les appels intermédiaires façon newsletter
// (teaser « ton des banques », etc.) sans concurrencer le CTA principal or plein.
function _campaignBtnGhost(label, url) {
  // mso-padding-alt : le moteur Word d'Outlook ignore le padding des <a> inline -> sans lui, la bordure
  // collerait au texte (technique bulletproof standard ; les autres clients gardent le padding du lien).
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px 0;"><tr>
    <td align="center" style="border:1px solid #b8860b;border-radius:6px;mso-padding-alt:10px 22px;">
      <a href="${url}" style="display:inline-block;padding:10px 22px;color:#f3c344;font-weight:700;font-size:13.5px;letter-spacing:.01em;text-decoration:none;">${_esc(label)}</a>
    </td></tr></table>`;
}
// Coupe PROPRE d'un texte : fin de phrase si possible, sinon fin de mot + points de suspension.
function _cutTxt(s, n) {
  s = String(s || '').trim();
  if (s.length <= n) return s;
  const t = s.slice(0, n);
  const d = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? '));
  if (d > n * 0.5) return t.slice(0, d + 1);
  const sp = t.lastIndexOf(' ');
  return (sp > 0 ? t.slice(0, sp) : t).replace(/[\s,;:]+$/, '') + '…';
}

// ══════════════════════════════════════════════════════════════════════════════
//  GRAMMAIRE DE TEXTE PARTAGÉE (24/08) : les mails « rapport entier » écrivent tous
//  avec les mêmes briques. Ces helpers vivaient en DOUBLE, recopiés à l'identique
//  dans buildWeeklyDigest et dans buildCampaignPointMarche : deux copies = deux
//  vérités, et le jour où l'une corrige un piège l'autre le garde (c'est ainsi que
//  l'échappement-avant-coupe a survécu six mois d'un côté seulement).
//  UN SEUL NIVEAU DE MISE EN AVANT (doctrine user 24/08 « y a trop d'encadré ») :
//  le gras doré. Pas de carte, pas de cadre décoratif, pas d'empilement.
// ══════════════════════════════════════════════════════════════════════════════

// Nettoyeur MARKDOWN des textes IA. Le rapport arrive avec des `**gras**`, des `#` et des
// backticks que le HTML d'un mail ne rend pas : sans lui, le lecteur voit les astérisques.
// ⚠️ Il écrase aussi les sauts de ligne : pour un texte à paragraphes, découper AVANT (_paraBlocs).
// ⚠️ TYPÉ (24/08, défaut mesuré) : l'ancienne version faisait String() sur N'IMPORTE QUOI. Un
// champ narratif arrivé en objet (`{texte:'perdu'}`) devenait la chaîne « [object Object] »,
// non vide, donc traitée comme du contenu légitime et IMPRIMÉE dans le mail : « Synthèse
// [object Object] », « Facteurs : [object Object] ». Un tableau devenait « a,b », un nombre
// « 0 ». Ces champs sont TOUS narratifs (titre, synthèse, intitulé, libellé, citation) : seule
// une chaîne y a un sens. Les valeurs CHIFFRÉES du produit passent par `_num`, qui accepte les
// nombres et distingue correctement un vrai « 0 » d'un champ absent. Rejeter ici ne perd donc
// aucune information : cela refuse une structure malformée au lieu de l'afficher.
const _md = s => (typeof s === 'string' ? s : '').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();

// Valeur CHIFFRÉE d'un print/calendrier. PIÈGE transversal du projet, dans les DEUX sens :
// une valeur absente n'est pas un zéro (Number(null) === 0), et un vrai « 0 » n'est pas une
// valeur absente. On teste donc la CHAÎNE, jamais la véracité JS d'un nombre.
// Typé lui aussi : un objet ne doit pas ressortir en « [object Object] » dans une colonne
// de chiffres. Un nombre est accepté tel quel (0 compris), une chaîne est conservée.
const _num = v => (typeof v === 'number') ? (isFinite(v) ? String(v) : '')
  : (typeof v === 'string' ? v.trim() : '');

// Prénom d'adresse. `(name || '').split(' ')` plantait dès que l'appelant passait autre chose
// qu'une chaîne (objet, nombre, tableau, booléen : 8 crashs sur 8 en banc) : « .split is not a
// function », et le mail ne partait pas du tout. Un prénom illisible ne doit jamais coûter un envoi.
const _prenom = n => (typeof n === 'string' ? n : '').trim().split(/\s+/)[0] || '';

// Découpe un texte long en PARAGRAPHES lisibles : d'abord les sauts de ligne du rapport (comme
// _wrParas côté desk), puis, pour un bloc trop dense, un paragraphe toutes les 2 phrases. La
// coupe de phrase se fait après . ! ? suivi d'une majuscule ou d'un guillemet : les décimales
// des cotations (« 1.1750 ») ne coupent pas, et RIEN n'est perdu (contrairement à un match glouton).
function _paraBlocs(txt, parPara) {
  const out = [];
  // Même typage que `_md` : un objet ou un tableau passé en texte de corps sortait en
  // « [object Object] » au milieu d'un paragraphe. Une chaîne, ou rien.
  for (const bloc of (typeof txt === 'string' ? txt : '').split(/\n+/)) {
    const t = _md(bloc);
    if (!t) continue;
    if (t.length <= 300) { out.push(t); continue; }
    const ph = t.split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ«"'(])/).filter(Boolean);
    const n = Math.max(1, parPara || 2);
    for (let i = 0; i < ph.length; i += n) { const p = ph.slice(i, i + n).join(' ').trim(); if (p) out.push(p); }
  }
  return out;
}
// Paragraphes de corps. AUCUNE troncature : ces mails PORTENT le rapport, ils ne le résument plus.
const _paraHtml = (txt, col, size) => _paraBlocs(txt)
  .map(p => `<p style="margin:0 0 12px;font-size:${size || '13.5px'};line-height:1.7;color:${col || '#cbd5e1'};">${_esc(p)}</p>`).join('');

// Sous-rubrique d'un bloc (blanc, capitales, 11px) : le 2e et DERNIER niveau de titre.
const _ssTitre = t => `<div style="color:#e6e6ea;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin:14px 0 5px;">${_esc(t)}</div>`;
// Ligne de détail (gris) : le contenu est du HTML DÉJÀ échappé par l'appelant.
const _puce = h => `<div style="color:#9aa3b2;font-size:12.5px;line-height:1.55;margin:3px 0;">${h}</div>`;
// Puce de lecture (corps, pastille or) : retrait négatif pour que la 2e ligne s'aligne sous le texte.
const _puceOr = h => `<div style="color:#cbd5e1;font-size:13.5px;line-height:1.62;margin:0 0 7px;padding-left:13px;text-indent:-13px;"><span style="color:${TOK.or};font-weight:700;">&bull;</span>&nbsp;${h}</div>`;
// Ligne INTITULÉE (« Pricing : … ») : l'intitulé porte le seul accent de la ligne.
const _ligne = (label, htmlValeur) => _puce(`<span style="color:#cbd5e1;font-weight:600;">${_esc(label)}&nbsp;:</span> ${htmlValeur}`);

// Couleur du BIAIS : l'échelle du desk a exactement 5 crans (demande user 11/08). On teste
// « légèrement » EN PREMIER : « légèrement haussier » contient « haussier », l'ordre inverse
// le peindrait en vert franc.
const _biasCol = b => {
  const s = String(b || '').toLowerCase();
  if (/^l[ée]g\S*\s+haussier/.test(s)) return '#7bc99a';
  if (/^l[ée]g\S*\s+baissier/.test(s)) return '#e08d86';
  if (/haussier/.test(s)) return TOK.vert;
  if (/baissier/.test(s)) return TOK.rouge;
  return TOK.gris;
};
// Drapeau + code devise (le drapeau est un plus, jamais l'information : le code reste écrit).
const _CCY_ISO = { USD: 'us', EUR: 'eu', GBP: 'gb', JPY: 'jp', CHF: 'ch', CAD: 'ca', AUD: 'au', NZD: 'nz', CNY: 'cn' };
const _ccyFlag = ccy => {
  const c = String(ccy || '').toUpperCase(); if (!c) return '';
  const iso = _CCY_ISO[c];
  return (iso ? `<img src="https://flagcdn.com/w20/${iso}.png" width="16" height="12" alt="" style="vertical-align:middle;border-radius:2px;margin-right:4px;">` : '')
    + `<span style="color:#cbd5e1;font-weight:700;">${_esc(c)}</span>`;
};
// PAS DE BADGE ACHAT / VENTE DANS LES MAILS (règle produit, 24/08). Le desk affiche le biais
// par paire de son carrousel ; un e-mail poussé dans la boîte du lecteur, lui, est INFORMATIF
// et ne doit jamais énoncer une direction à prendre. Un helper `_signalFR` avait été introduit
// ici pour traduire BUY/SELL/NEUTRAL : il rendait « EUR/USD ACHAT : au-dessus de 1.09 », soit
// une position, dans un mail dont la doctrine l'interdit. Il a été retiré, pas commenté : la
// phrase factuelle du desk (`pairs[].text`) reste rendue en entier, seul le badge disparaît.

// Avertissement de LONGUEUR : ces deux mails portent un rapport entier, donc Gmail peut les
// tronquer (limite ~102 Ko) et afficher « Message tronqué ». Le dire une fois, sobrement, vaut
// mieux qu'un lecteur qui croit que le desk s'est arrêté en cours de route.
// ⚠️ CONDITIONNEL (défaut mesuré) : la note était écrite MÊME sur le chemin de repli, un mail
// de 11 Ko que rien ne tronque jamais. Annoncer un rognage qui n'arrivera pas est un mensonge
// gratuit. On ne l'écrit qu'au-delà d'un corps réellement volumineux.
// LE SEUIL EST ATTEINT, ET C'EST ASSUMÉ. Mesure du 24/08 sur une semaine chargée (huit
// devises, calendrier passé de 38 lignes et calendrier à venir de 22) : le Récap Hebdo pèse
// ~120 Ko de HTML, le Récap Quotidien ~52 Ko, plus ~52 Ko d'image embarquée. Couper le
// rapport pour tenir sous les 102 Ko contredirait la demande même de ces deux mails (« on
// offre ENTIÈREMENT le récap »). On a donc traité l'effet, pas la matière : tout ce qui est
// structurellement compressible l'a été (une seule cellule pour l'heure et la devise, la
// couleur de base portée par la cellule et non par un span à chaque valeur), le BOUTON
// « Ouvrir le desk » est remonté AVANT le rapport pour ne jamais tomber dans la zone repliée,
// la désinscription voyage aussi en en-tête List-Unsubscribe, et cette note prévient le lecteur.
const _SEUIL_LONG = 45000;   // octets de corps HTML : en-deçà, aucune messagerie ne rogne
const _noteLongue = corps => (String(corps || '').length < _SEUIL_LONG) ? ''
  : `<p style="margin:20px 0 0;font-size:12px;color:${TOK.grisPied};">Rapport long&nbsp;: certaines messageries le tronquent en fin de message. Il reste lisible en entier sur le desk.</p>`;

// Widget MAIL = VRAI widget du desk (rendu frais PNG, embarque en inline cid a l'envoi par _sendWithInlineWidgets).
// PAS d'intitule visible au-dessus (le contexte est deja donne par le texte du mail) ; l'`eyebrow` ne sert plus
// que d'alt (accessibilite + repli si image bloquee). Cadre aux tokens desk (#232429, coins 6px) ; responsive + Outlook.
function _widgetImg(type, eyebrow, maxW, period, ccy, opts) {
  maxW = maxW || 532;
  const lbl = _esc(eyebrow || '');
  const per = period ? `&period=${encodeURIComponent(period)}` : '';
  // `ccy` (15/08) : la courbe d'UNE devise, comme sous chaque bloc devise du Récap Hebdo du desk.
  const cc = /^[A-Za-z]{3}$/.test(String(ccy || '')) ? `&ccy=${String(ccy).toUpperCase()}` : '';
  // `opts.params` (24/08) : paramètres supplémentaires déjà encodés (ex. l'identité de l'événement
  // vedette, pour que l'image montre EXACTEMENT celui dont parle le texte autour).
  // `opts.alt` : quand l'image PORTE l'information, son texte de remplacement doit la porter aussi.
  // Beaucoup de messageries bloquent les images par défaut : sans alt parlant, l'info disparaît.
  const sup = (opts && opts.params) ? String(opts.params) : '';
  const alt = (opts && opts.alt) ? _esc(opts.alt)
    : (ccy ? `Force du ${String(ccy).toUpperCase()} DataTradingPro` : `${lbl} DataTradingPro`);
  return `<img src="${APP_URL}/api/email-widget/${type}.png?t=${Date.now()}${per}${cc}${sup}" width="${maxW}" alt="${alt}" style="display:block;width:100%;max-width:${maxW}px;height:auto;border:1px solid #232429;border-radius:6px;margin:16px 0;">`;
}
// AGENDA en HTML (table facon calendrier du desk) construit a partir des MEMES evenements que le texte du mail
// (context.upcoming) -> COHERENCE garantie : l'evenement annonce dans l'accroche figure toujours dans l'agenda.
// Robuste (pas d'image -> jamais casse en apercu). ev = { time, ccy, impact, title, forecast, previous, dayLabel }.
function _agendaTable(events) {
  const rows = (events || []).slice(0, 8);
  if (!rows.length) return '';
  const dots = imp => { const on = imp === 'High' ? 3 : (imp === 'Medium' ? 2 : 1); const col = imp === 'High' ? '#ff3d00' : '#ffb300'; let s = ''; for (let i = 0; i < 3; i++) s += `<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:${i < on ? col : '#3a3a42'};margin-right:2px;"></span>`; return s; };
  let out = '', lastDay = null;
  for (const e of rows) {
    if (e.dayLabel && e.dayLabel !== lastDay) { lastDay = e.dayLabel; out += `<tr><td colspan="4" style="padding:8px 10px 4px;background:#101014;color:#9aa3b2;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;">${_esc(e.dayLabel)}</td></tr>`; }
    const vals = []; if (e.forecast) vals.push('prév. <span style="color:#cbd5e1;">' + _esc(e.forecast) + '</span>'); if (e.previous) vals.push('préc. ' + _esc(e.previous));
    out += `<tr>
      <td style="padding:9px 10px;border-top:1px solid #1f1f24;color:#f3c344;font-weight:700;font-size:12px;white-space:nowrap;vertical-align:top;">${_esc(e.time || '')}<div style="color:#8b93a1;font-weight:400;font-size:11px;margin-top:1px;">${_esc(e.ccy || '')}&nbsp;${dots(e.impact)}</div></td>
      <td style="padding:9px 10px;border-top:1px solid #1f1f24;color:#ffffff;font-size:13px;vertical-align:top;">${_esc(e.title || '')}</td>
      <td style="padding:9px 10px;border-top:1px solid #1f1f24;color:#9aa3b2;font-size:11.5px;text-align:right;white-space:nowrap;vertical-align:top;">${vals.join('<br>')}</td>
    </tr>`;
  }
  return `<div style="border:1px solid #232429;border-radius:6px;overflow:hidden;margin:8px 0 14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#0d0e11;">${out}</table></div>`;
}

// Mail d'INTRODUCTION de la campagne hebdomadaire (1er de la sequence). Audience = clients DTP + clients
// Whop (JustOneTrader). INFORMATIF : presente le terminal et ce qui sera recu chaque semaine, ne pousse
// AUCUNE position. Widget Force des Devises en direct (PNG servi par le desk). Desinscription en pied.
function buildCampaignIntro({ name, email, campaign } = {}) {
  campaign = campaign || 'intro-v1';
  const prenomRaw = (name || '').split(' ')[0] || '';
  const prenom = _esc(prenomRaw);
  const hello  = prenom ? `Bonjour ${prenom},` : 'Bonjour,';
  const unsub  = unsubUrl(email || '');
  const sender = _esc(_parseFrom().email);
  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:#e6e6ea;">${hello}</p>
    <p style="margin:0 0 14px;">Merci de faire partie de l'aventure <strong style="color:#f3c344;">DataTradingPro</strong>. Plusieurs fois par semaine, le desk vous &eacute;crit&nbsp;: <strong style="color:#fff;">l'actualit&eacute; macro&eacute;conomique d&eacute;crypt&eacute;e</strong>, les <strong style="color:#fff;">&eacute;v&eacute;nements majeurs</strong> expliqu&eacute;s simplement et des <strong style="color:#fff;">synth&egrave;ses de march&eacute;</strong> qui vont &agrave; l'essentiel, de quoi comprendre ce qui fait vraiment bouger les march&eacute;s, sans y passer la journ&eacute;e.</p>
    <p style="margin:0 0 14px;">L'objectif est simple&nbsp;: vous aider &agrave; <strong style="color:#fff;">lire l'actualit&eacute; macro comme un professionnel</strong>, anticiper les r&eacute;actions des march&eacute;s et prendre des d&eacute;cisions de trading plus &eacute;clair&eacute;es. C'est <strong style="color:#f3c344;">100% gratuit</strong>, et chaque e-mail est pens&eacute; pour vous apporter un maximum de valeur en quelques minutes de lecture.</p>
    <p style="margin:0 0 16px;">Concr&egrave;tement, voici votre <strong style="color:#fff;">semaine type</strong>&nbsp;:</p>
    <div style="margin:0 0 20px;color:#cbd5e1;">
      <p style="margin:6px 0;">🗓️ <strong style="color:#fff;">Semaine &agrave; venir</strong>&nbsp;: chaque dimanche, l'agenda tri&eacute; par le desk, vous savez o&ugrave; regarder avant que la semaine ne commence.</p>
      <p style="margin:6px 0;">🎓 <strong style="color:#fff;">Comprendre le march&eacute;</strong>&nbsp;: chaque mardi, un concept macro choisi selon l'actualit&eacute; et d&eacute;cod&eacute; simplement, comme au desk.</p>
      <p style="margin:6px 0;">📊 <strong style="color:#fff;">Point march&eacute;</strong>&nbsp;: chaque mercredi, le brief du desk, la s&eacute;ance, les chiffres &eacute;co et la force des devises, en clair.</p>
      <p style="margin:6px 0;">🧠 <strong style="color:#fff;">Mindset</strong>&nbsp;: chaque jeudi, psychologie et discipline, de quoi garder la t&ecirc;te froide quand le march&eacute; s'agite.</p>
      <p style="margin:6px 0;">📰 <strong style="color:#fff;">R&eacute;cap hebdo</strong>&nbsp;: chaque samedi, la r&eacute;trospective de la semaine &eacute;coul&eacute;e, devise par devise, sans le bruit.</p>
    </div>
    ${_campaignBtn('Ouvrir DataTradingPro', trackClickUrl(campaign, email, LANDING_URL))}
    <p style="margin:0 0 4px;">&Agrave; tr&egrave;s vite,</p>
    <p style="margin:0 0 16px;color:#9aa3b2;">L'&eacute;quipe DataTradingPro</p>
    <img src="${trackOpenUrl(campaign, email)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;overflow:hidden;">
  `;
  return { subject: '👋 Bienvenue au desk : voici votre semaine type', html: _campaignLayout('Bienvenue', body, unsub) };
}
// ENVOI : le widget Force des Devises est EMBARQUE dans le mail (piece jointe inline cid:) au lieu d'une
// URL distante. Preuve par logs (08/07) : Outlook TELECHARGEAIT l'image (200, 46Ko) mais ne la RENDAIT pas
// (proxy/regles internes) → seul l'inline garantit l'affichage partout. L'image est rendue FRAICHE a l'envoi
// (renderWidgetPngSafe = derniere bonne image, pre-chauffee toutes les 9 min → a jour). Repli : URL distante.
// Envoie un mail campagne en EMBARQUANT un ou plusieurs widgets en inline (cid:) — affichage garanti Outlook.
// Chaque type liste est rendu FRAIS (renderWidgetPngSafe, pre-chauffe) et son URL distante est remplacee par
// son cid. Repli : si le rendu echoue, l'URL distante reste dans le HTML. types = ['meter','calendar',...].
async function _sendWithInlineWidgets(to, subject, html, types) {
  const att = [];
  try {
    const ew = require('./emailWidget');   // meme process que server.js → cache/prewarm partages
    for (const t of (Array.isArray(types) ? types : [])) {
      try {
        // Entree « type:periode » (ex. 'strength:today') → rend le widget sur CETTE periode (TD/TW...).
        const ix = t.indexOf(':');
        const wt = ix > 0 ? t.slice(0, ix) : t, period = ix > 0 ? t.slice(ix + 1) : undefined;
        // GARDE-FOU « 0 piece jointe orpheline » : on n'attache un widget QUE s'il est REFERENCE dans le HTML.
        // Sinon le PNG etait attache sans cid correspondant → Gmail l'affichait comme « Une piece jointe ».
        const re = new RegExp('https?:\\/\\/[^"]*\\/api\\/email-widget\\/' + wt.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\.png[^"]*', 'g');
        const trouve = html.match(re);
        if (!trouve || !trouve.length) continue;   // widget non reference → NE PAS l'attacher
        re.lastIndex = 0;
        // Les paramètres SUPPLÉMENTAIRES posés dans l'URL du HTML (ex. l'identité de l'événement
        // vedette) doivent suivre jusqu'au rendu, sinon l'image embarquée montrerait autre chose que
        // ce que le texte annonce. On retire `t` (anti-cache navigateur) et `period` (déjà passé à
        // part) : les garder ferait exploser la clé de cache et re-rendrait une image par envoi.
        let extra = '';
        try {
          const q = String(trouve[0]).split('?')[1] || '';
          extra = q.split('&').filter(p => p && !/^t=/.test(p) && !/^period=/.test(p))
            .filter(p => /^[A-Za-z0-9_.%~-]+=[A-Za-z0-9_.%~+-]*$/.test(p)).join('&');
        } catch (e) { extra = ''; }
        const png = await ew.renderWidgetPngSafe(wt, Object.assign({}, period ? { period } : {}, extra ? { extra } : {}));
        if (png && png.length > 2000) {    // > placeholder 1x1 → vraie image
          const cid = wt + (period ? '-' + period : '') + '@datatradingpro';
          att.push({ filename: wt + (period ? '-' + period : '') + '.png', content: png, cid, contentType: 'image/png' });
          html = html.replace(re, 'cid:' + cid);
        }
      } catch (e) { console.warn('[Mailer] widget inline indisponible (' + t + ') → URL distante:', e.message); }
    }
  } catch (e) { console.warn('[Mailer] widgets inline indisponibles → URL distante:', e.message); }
  return _send(to, subject, html, att.length ? att : null);
}
// Retro-compat : ancien helper mono-widget (meter).
async function _sendWithInlineWidget(to, subject, html) { return _sendWithInlineWidgets(to, subject, html, ['meter']); }
async function sendCampaignIntro(d) { d = d || {}; const m = buildCampaignIntro({ name: d.name, email: d.email || d.to, campaign: d.campaign }); return _send(d.to, m.subject, m.html); }

// ── ANNONCE « App desktop finalisée » (broadcast one-shot, 16/07/2026) ─────────────────────────
// INFORMATIF : annonce la finalisation de l'application Windows/macOS + la feuille de route (widgets,
// puis mobile iOS/Android + Apple Watch). Aucune incitation à une position. Image = vraie capture du
// desk (public/assets/images/annonce-app-desktop.jpg, servie par le desk). Boutons = téléchargements
// directs. Tracking ouverture/clic + désinscription : mêmes mécanismes que la campagne.
function buildAnnouncementDesktop({ name, email, campaign } = {}) {
  campaign = campaign || 'app-desktop-v1';
  const prenom = _esc((name || '').split(' ')[0] || '');
  const hello  = prenom ? `Bonjour ${prenom},` : 'Bonjour,';
  const unsub  = unsubUrl(email || '');
  const dlWin  = trackClickUrl(campaign, email, `${APP_URL}/downloads/DataTradingPro-Setup.exe?v=111`);
  const dlMac  = trackClickUrl(campaign, email, `${APP_URL}/downloads/DataTradingPro-macOS.dmg?v=111`);
  const dlIntel = trackClickUrl(campaign, email, `${APP_URL}/downloads/DataTradingPro-macOS-Intel.dmg?v=111`);
  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:#e6e6ea;">${hello}</p>
    ${_H1}L'application DataTradingPro pour <span style="color:#f3c344;">Windows</span> et <span style="color:#f3c344;">macOS</span> est officiellement finalis&eacute;e. 🖥️</p>
    <p style="margin:0 0 14px;">Le terminal complet, dans une <strong style="color:#fff;">v&eacute;ritable application de bureau</strong>&nbsp;: plus d'onglet perdu au milieu du navigateur, votre desk s'ouvre en un clic et reste &agrave; sa place, comme un vrai poste de trading.</p>
    <a href="${trackClickUrl(campaign, email, LANDING_URL)}" style="text-decoration:none;"><img src="${LANDING_URL}/assets/images/annonce-app-desktop.jpg" width="532" alt="Le terminal DataTradingPro en application de bureau" style="display:block;width:100%;max-width:532px;height:auto;border:1px solid #232429;border-radius:6px;margin:16px 0;"></a>
    <ul style="margin:0 0 18px;padding-left:20px;color:#cbd5e1;">
      <li style="margin:6px 0;">🪟 <strong style="color:#fff;">Fen&ecirc;tre native &eacute;pur&eacute;e</strong>&nbsp;: la barre de titre s'int&egrave;gre au desk, rien ne d&eacute;passe.</li>
      <li style="margin:6px 0;">🔄 <strong style="color:#fff;">Mises &agrave; jour automatiques</strong>&nbsp;: l'application se met &agrave; jour toute seule, en silence, vous avez toujours la derni&egrave;re version.</li>
      <li style="margin:6px 0;">🔐 <strong style="color:#fff;">Session persistante</strong>&nbsp;: connect&eacute; une fois, connect&eacute; pour de bon.</li>
      <li style="margin:6px 0;">🖥️ <strong style="color:#fff;">Multi-&eacute;crans</strong>&nbsp;: placez le desk sur l'&eacute;cran de votre choix, il s'y sent chez lui.</li>
    </ul>
    ${_campaignBtn('Télécharger pour Windows', dlWin)}
    ${_campaignBtnGhost('Télécharger pour macOS', dlMac)}
    <p style="margin:0 0 16px;font-size:12.5px;color:#8b93a1;">Mac Intel (avant 2020)&nbsp;? <a href="${dlIntel}" style="color:#f3c344;text-decoration:underline;">Version Intel ici</a>. Premier lancement sur Mac&nbsp;: clic droit sur l'application &rarr; &laquo;&nbsp;Ouvrir&nbsp;&raquo;.<br>Vous avez d&eacute;j&agrave; l'application&nbsp;? Rien &agrave; faire&nbsp;: elle vous proposera la mise &agrave; jour toute seule.</p>
    ${_goldBox(`<span style="color:${TOK.or};font-weight:700;letter-spacing:.05em;font-size:11px;text-transform:uppercase;">Et ce n'est que le d&eacute;but</span><br>
        Le <strong style="color:#fff;">syst&egrave;me de widgets Mon Desk</strong> est depuis en ligne. Place maintenant &agrave; <strong style="color:#fff;">l'application mobile</strong> pour iOS (App&nbsp;Store) et Android (Google&nbsp;Play)&nbsp;: les alertes du desk <strong style="color:#fff;">en temps r&eacute;el sur votre t&eacute;l&eacute;phone</strong>, et m&ecirc;me sur Apple&nbsp;Watch. ⌚`)}
    <p style="margin:0 0 4px;">&Agrave; tr&egrave;s vite sur le desk,</p>
    <p style="margin:0 0 16px;color:#9aa3b2;">L'&eacute;quipe DataTradingPro</p>
    <img src="${trackOpenUrl(campaign, email)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;overflow:hidden;">
  `;
  return { subject: '🖥️ Votre application DataTradingPro est prête', html: _campaignLayout('Application desktop', body, unsub) };
}
/* ── ANNONCE ONE-SHOT : l'accueil « Vue d'ensemble » + Mon Desk (widgets) ──────────────────────────
   Même moule que l'annonce app desktop : gabarit CAMPAGNE (pied légal + désinscription), or #f3c344
   (celui des mails ; le desk garde #e3b23a), pixel d'ouverture en dernière ligne, liens suivis.
   TON marketeur / pro / institutionnel (demande user 06/08) : assuré et précis, vocabulaire de
   salle de marché, bénéfice avant fonctionnalité. SOBRE : ni superlatif creux, ni urgence inventée,
   ni promesse de performance, ni incitation à se positionner. On vend un outil de travail.
   Les deux nouveautés sont EN LIGNE : tout est au présent.
   ⚠️ Deux illustrations attendues dans public/assets/images/ : `annonce-accueil.jpg` et
   `annonce-mondesk.jpg`. Absentes, le mail part quand même (cf. sendAnnonceDesk). */
function buildAnnonceDesk({ name, email, campaign } = {}) {
  campaign = campaign || 'desk-widgets-v1';
  const prenom = _esc((name || '').split(' ')[0] || '');
  const hello  = prenom ? `Bonjour ${prenom},` : 'Bonjour,';
  const unsub  = unsubUrl(email || '');
  const ouvrir = trackClickUrl(campaign, email, APP_URL + '/');
  // Les illustrations vivent dans le depot du DESK (public/assets/images). La landing sert ses
  // PROPRES fichiers : `annonce-app-desktop.jpg` y avait ete copiee a la main, ce qui donnait
  // l illusion d un alias commun : verifie, les trois nouvelles y repondent 404. On pointe donc le
  // desk, ou elles sont reellement, et `/assets/images/` y est desormais public (server.js).
  const imgAcc = APP_URL + '/assets/images/annonce-accueil.jpg';
  const imgDsk = APP_URL + '/assets/images/annonce-mondesk.jpg';
  const imgDis = APP_URL + '/assets/images/annonce-dispositions.jpg';
  const _img = (src, alt) => `<img src="${src}" width="532" alt="${alt}" style="display:block;width:100%;max-width:532px;height:auto;border:1px solid #232429;border-radius:6px;margin:4px 0 20px;">`;
  const body = `
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Deux nouveaut&eacute;s en ligne&nbsp;: l'accueil Vue d'ensemble, et un desk que vous montez vous-m&ecirc;me.</div>
    <p style="margin:0 0 16px;font-size:15px;color:#e6e6ea;">${hello}</p>
    ${_H1}Vous montez d&eacute;sormais <span style="color:#f3c344;">votre propre &eacute;cran de travail</span>.</p>
    <p style="margin:0 0 20px;">Deux nouveaut&eacute;s viennent d'&ecirc;tre mises en ligne&nbsp;: l'accueil <strong style="color:#fff;">Vue d'ensemble</strong>, qui vous situe d&egrave;s la connexion, et <strong style="color:#fff;">Mon Desk</strong>, qui vous laisse composer votre grille.</p>

    ${_secTitle("L'accueil&nbsp;: vue d'ensemble")}
    <p style="margin:0 0 10px;">&Agrave; la connexion, un &eacute;cran de prise de poste remplace la page dense. En un coup d'&oelig;il&nbsp;:</p>
    <ul style="margin:0 0 14px;padding-left:20px;color:#cbd5e1;">
      <li style="margin:5px 0;">les places de march&eacute; ouvertes et celles qui vont l'&ecirc;tre, sur une carte du monde anim&eacute;e&nbsp;;</li>
      <li style="margin:5px 0;">les derni&egrave;res actualit&eacute;s du fil&nbsp;;</li>
      <li style="margin:5px 0;">la force des devises du jour&nbsp;;</li>
      <li style="margin:5px 0;">les publications &eacute;conomiques &agrave; venir&nbsp;;</li>
      <li style="margin:5px 0;">vos dispositions enregistr&eacute;es.</li>
    </ul>
    <p style="margin:0 0 14px;">Le temps de situer la s&eacute;ance, puis un bouton pour entrer dans le desk.</p>
    ${_img(imgAcc, "L'accueil Vue d'ensemble du terminal DataTradingPro")}

    <!-- ORDRE (demande user 06/08) : « Une disposition par usage » passe AVANT « Mon Desk ». On
         annonce donc le bénéfice : plusieurs écrans selon ce qu'on suit : puis le moyen, la grille
         qu'on compose. Entrée par l'usage plutôt que par l'outil. -->
    ${_secTitle('Une disposition par usage')}
    <p style="margin:0 0 14px;">Vous enregistrez <strong style="color:#fff;">plusieurs dispositions</strong> et vous basculez de l'une &agrave; l'autre&nbsp;: une pour le forex, une pour la crypto, une pour les indices. Ou simplement une pour l'analyse technique, une pour la fondamentale.</p>
    ${_img(imgDis, 'Le choix d une disposition dans Mon Desk')}

    ${_secTitle('Mon Desk')}
    <p style="margin:0 0 12px;">Chacune de ces dispositions, c'est vous qui la montez. Le desk n'est plus une grille impos&eacute;e&nbsp;: <strong style="color:#fff;">vous la composez bloc par bloc</strong>.</p>
    <!-- On NE LISTE PAS les modules (demande user 06/08 : « ne devoile pas tout, tisse la
         curiosite »). L enumeration epuisait le sujet des le mail ; un ordre de grandeur laisse la
         decouverte au produit. Chiffre realigne le 23/08 sur le CATALOG reel de widgets.js :
         une quarantaine d entrees aujourd hui (verifier a chaque reprise du template). -->
    <p style="margin:0 0 14px;">Une <strong style="color:#fff;">quarantaine de modules</strong> &agrave; assembler. Vous y retrouverez ceux que vous ouvrez tous les jours, et sans doute quelques-uns que vous n'aviez jamais eu l'occasion de regarder.</p>
    ${_img(imgDsk, 'Les modules disponibles dans Mon Desk')}
    <p style="margin:0 0 14px;">Chaque bloc se d&eacute;place, se redimensionne et se r&egrave;gle&nbsp;: p&eacute;riode d'un graphique, devises affich&eacute;es, places retenues sur l'horloge. Vous gardez ce que vous consultez, vous &eacute;cartez le reste.</p>
    ${_goldBox(`Rien n'est stock&eacute; dans le navigateur&nbsp;: tout tient <strong style="color:#fff;">sur votre compte</strong>. Votre desk vous suit d'un ordinateur &agrave; l'autre, sur l'application de bureau comme sur t&eacute;l&eacute;phone.`)}
    <p style="margin:0 0 14px;">La disposition de d&eacute;part reprend l'ensemble de vos onglets habituels. Rien &agrave; reconstruire&nbsp;: vous ajustez quand vous le souhaitez, &agrave; votre rythme.</p>

    <p style="margin:0 0 16px;">Les deux nouveaut&eacute;s sont actives sur votre compte. Une connexion suffit.</p>
    ${_campaignBtn('Ouvrir le desk', ouvrir)}
    <img src="${trackOpenUrl(campaign, email)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;overflow:hidden;">
  `;
  // OBJET (06/08, « plus percutant ») : un verbe d action en tete, et le vocabulaire du corps -
  // « bloc par bloc » dit la nouveaute en trois mots. 33 caracteres : rien n est tronque, ni dans
  // une boite de reception ni sur telephone. On enonce ce qui devient possible, sans superlatif,
  // sans urgence inventee, sans point d exclamation.
  return { subject: 'Montez votre desk, bloc par bloc', html: _campaignLayout('Accueil & Mon Desk', body, unsub) };
}
/* Les DEUX illustrations de l'annonce, embarquées en pièces inline (cid:) comme pour l'annonce app
   desktop. Raison : Gmail et Outlook bloquent souvent les images distantes ; en cid: l'affichage est
   garanti. Repli : si un fichier manque, son URL landing reste dans le HTML : le mail part quand
   même, avec au pire une image non chargée plutôt qu'un envoi bloqué. */
const _ANNONCE_DESK_IMGS = [
  { fichier: 'annonce-accueil.jpg', cid: 'annonce-accueil@datatradingpro', motif: /https?:\/\/[^"]*annonce-accueil\.jpg/g },
  { fichier: 'annonce-mondesk.jpg', cid: 'annonce-mondesk@datatradingpro', motif: /https?:\/\/[^"]*annonce-mondesk\.jpg/g },
  { fichier: 'annonce-dispositions.jpg', cid: 'annonce-dispositions@datatradingpro', motif: /https?:\/\/[^"]*annonce-dispositions\.jpg/g },
];
/* ANNONCE : la bibliotheque de widgets s&rsquo;elargit (19/08/2026).
   TON maison : assure et precis, benefice avant fonctionnalite, ni superlatif creux ni urgence
   inventee. VETO permanent : on n&rsquo;incite JAMAIS a prendre une position, on decrit un outil de
   travail. Aucun tiret cadratin (bani depuis le 14/08).
   ⚠️ Le paragraphe « disponibilite » est le SEUL a changer selon la decision : widgets ouverts a
   tous, ou encore en rodage interne. Il est isole et commente pour etre bascule d&rsquo;une ligne. */
function buildAnnonceWidgets({ name, email, campaign, ouverts } = {}) {
  campaign = campaign || 'bibliotheque-widgets-v1';
  const prenom = _esc((name || '').split(' ')[0] || '');
  const hello  = prenom ? `Bonjour ${prenom},` : 'Bonjour,';
  const unsub  = unsubUrl(email || '');
  const ouvrir = trackClickUrl(campaign, email, APP_URL + '/');

  /* Chaque famille montre son APERCU : mosaique des vraies cartes du desk (captures du banc,
     donnees plausibles), fichiers public/assets/images/apercu-widgets-*.png. En GALERIE le src
     reste l'URL absolue (l'apercu marche sans envoi) ; a l'ENVOI, sendAnnonceWidgets bascule ces
     src en pieces inline cid: comme sendAnnonceDesk (Gmail/Outlook bloquent les images distantes). */
  const fam = (titre, texte, img, alt) => `
    ${_secTitle(titre)}
    <p style="margin:0 0 8px;">${texte}</p>
    ${img ? `<img src="${APP_URL}/assets/images/${img}" width="640" alt="${alt}" style="display:block;width:100%;max-width:640px;height:auto;border:1px solid #232429;border-radius:8px;margin:6px 0 18px;">` : ''}`;

  /* ← LA SEULE LIGNE A BASCULER. `ouverts` a vrai quand les widgets sont ouverts a tous. */
  const dispo = ouverts
    ? `Ils sont <strong style="color:#fff;">disponibles d&egrave;s maintenant</strong> dans la biblioth&egrave;que de Mon Desk.`
    : `Ils arrivent progressivement dans la biblioth&egrave;que de Mon Desk, au fur et &agrave; mesure de leur rodage.`;

  const body = `
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Quatorze widgets de plus dans Mon Desk&nbsp;: cotations, amplitude, macro et outils.</div>
    <p style="margin:0 0 16px;font-size:15px;color:#e6e6ea;">${hello}</p>
    ${_H1}Quatorze widgets de plus pour <span style="color:#f3c344;">composer votre desk</span>.</p>
    <p style="margin:0 0 6px;">La biblioth&egrave;que de Mon Desk s&rsquo;&eacute;largit. ${dispo}</p>

    ${fam('Cotations et march&eacute;', 'Un <strong style="color:#fff;">bandeau de cotations</strong> d&eacute;filant, une <strong style="color:#fff;">matrice de taux crois&eacute;s</strong> qui donne les 28 croisements des huit majeures d&rsquo;un seul balayage, une <strong style="color:#fff;">carte de chaleur FX</strong> qui les colore selon la variation du jour, et une <strong style="color:#fff;">liste de suivi</strong> o&ugrave; vous choisissez vos paires.',
      'apercu-widgets-cotations.png', 'Aper&ccedil;u des widgets de cotations : bandeau d&eacute;filant, matrice des croisements, carte de chaleur FX et liste de suivi')}

    ${fam('Amplitude et volatilit&eacute;', 'De combien une paire bouge en moyenne par s&eacute;ance, ce qu&rsquo;elle parcourt pendant Tokyo, Londres et New York, la part des s&eacute;ances qui atteignent un seuil donn&eacute;, la forme r&eacute;elle de ses journ&eacute;es, son &eacute;cart-type, et ses points hauts et bas avec la position du cours entre les deux.',
      'apercu-widgets-volatilite.png', 'Aper&ccedil;u des widgets d&rsquo;amplitude et de volatilit&eacute; : amplitude par s&eacute;ance et par jour, probabilit&eacute; de mouvement, histogramme, statistiques et points hauts et bas')}

    ${fam('Macro', 'Un <strong style="color:#fff;">compte &agrave; rebours</strong> sur le prochain chiffre attendu, qui bascule sur le r&eacute;sultat d&egrave;s sa publication. L&rsquo;<strong style="color:#fff;">historique d&rsquo;un indicateur</strong> sur ses derni&egrave;res parutions. Et le <strong style="color:#fff;">rendement moyen par mois</strong>, sur cinq ans.',
      'apercu-widgets-macro.png', 'Aper&ccedil;u des widgets macro : compte &agrave; rebours d&rsquo;&eacute;v&eacute;nement, historique d&rsquo;un indicateur et rendement moyen par mois')}

    ${fam('Outils', 'Un <strong style="color:#fff;">bloc-notes</strong> qui vous suit d&rsquo;un appareil &agrave; l&rsquo;autre, avec verrou de lecture seule pour vos r&egrave;gles de risque.',
      'apercu-widgets-outils.png', 'Aper&ccedil;u du widget Notes : bloc-notes synchronis&eacute; entre appareils')}

    ${_secTitle('Ce qu&rsquo;ils n&rsquo;affichent pas')}
    <p style="margin:0 0 18px;">Une r&egrave;gle simple&nbsp;: jamais une donn&eacute;e que la source ne fournit pas. Quand une information manque, la carte le dit plut&ocirc;t que de combler le vide. Trois widgets envisag&eacute;s ont d&rsquo;ailleurs &eacute;t&eacute; abandonn&eacute;s pour cette raison.</p>

    ${_campaignBtn('Ouvrir mon desk', ouvrir)}

    <p style="margin:0 0 4px;font-size:12px;color:#8b93a1;">Chaque carte se r&egrave;gle&nbsp;: paire, unit&eacute;, profondeur d&rsquo;historique, seuils. Vos dispositions sont conserv&eacute;es par compte.</p>
    <img src="${trackOpenUrl(campaign, email)}" width="1" height="1" alt="" style="display:block;border:0;">`;

  /* _campaignLayout et NON _layout : _layout est le gabarit TRANSACTIONNEL (pas de mention legale,
     pas de lien de desinscription, pas de rendu mobile). Un envoi de masse sans desinscription
     visible se fait classer en courrier indesirable, et c'est aussi ce que la loi demande. Le lien
     n'est donc plus ecrit a la main dans le corps : le gabarit de campagne le pose lui-meme. */
  return { subject: 'Quatorze widgets de plus dans Mon Desk', html: _campaignLayout('Nouveaux widgets', body, unsub) };
}

/* Les QUATRE apercus de familles, embarques en pieces inline (cid:) comme _ANNONCE_DESK_IMGS.
   Ce sont les vraies cartes du desk capturees au banc (donnees plausibles), assemblees en mosaique
   par famille. Repli identique : fichier absent ou trop petit, l'URL absolue reste dans le HTML. */
const _ANNONCE_WIDGETS_IMGS = [
  { fichier: 'apercu-widgets-cotations.png',  cid: 'apercu-widgets-cotations@datatradingpro',  motif: /https?:\/\/[^"]*apercu-widgets-cotations\.png/g },
  { fichier: 'apercu-widgets-volatilite.png', cid: 'apercu-widgets-volatilite@datatradingpro', motif: /https?:\/\/[^"]*apercu-widgets-volatilite\.png/g },
  { fichier: 'apercu-widgets-macro.png',      cid: 'apercu-widgets-macro@datatradingpro',      motif: /https?:\/\/[^"]*apercu-widgets-macro\.png/g },
  { fichier: 'apercu-widgets-outils.png',     cid: 'apercu-widgets-outils@datatradingpro',     motif: /https?:\/\/[^"]*apercu-widgets-outils\.png/g },
];

async function sendAnnonceWidgets(d) {
  d = d || {};
  const m = buildAnnonceWidgets({ name: d.name, email: d.email || d.to, campaign: d.campaign, ouverts: d.ouverts });
  // Meme mecanique que sendAnnonceDesk : lecture du PNG, bascule src -> cid:, piece inline.
  // Garde-fou taille : sous 5 Ko le fichier est suspect (tronque, placeholder), on n'attache pas.
  let html = m.html; const att = [];
  for (const img of _ANNONCE_WIDGETS_IMGS) {
    try {
      const buf = require('fs').readFileSync(require('path').join(__dirname, 'public', 'assets', 'images', img.fichier));
      if (buf && buf.length > 5000) {
        html = html.replace(img.motif, 'cid:' + img.cid);
        att.push({ filename: img.fichier, content: buf, cid: img.cid, contentType: 'image/png' });
      }
    } catch (_) {}
  }
  return _send(d.to, m.subject, html, att.length ? att : null);
}

async function sendAnnonceDesk(d) {
  d = d || {};
  const m = buildAnnonceDesk({ name: d.name, email: d.email || d.to, campaign: d.campaign });
  let html = m.html; const att = [];
  for (const img of _ANNONCE_DESK_IMGS) {
    try {
      const buf = require('fs').readFileSync(require('path').join(__dirname, 'public', 'assets', 'images', img.fichier));
      if (buf && buf.length > 5000) {
        html = html.replace(img.motif, 'cid:' + img.cid);
        att.push({ filename: img.fichier, content: buf, cid: img.cid, contentType: 'image/jpeg' });
      }
    } catch (_) {}
  }
  return _send(d.to, m.subject, html, att.length ? att : null);
}

async function sendAnnouncementDesktop(d) {
  d = d || {};
  const m = buildAnnouncementDesktop({ name: d.name, email: d.email || d.to, campaign: d.campaign });
  // Image EMBARQUÉE en pièce inline (cid:) → affichage garanti dans TOUS les clients (Gmail/Outlook),
  // même si les images distantes sont bloquées ou que le proxy échoue (bug user 16/07 « l'image ne
  // s'affiche pas »). Repli : si le fichier manque, l'URL landing reste dans le HTML.
  let att = null, html = m.html;
  try {
    const buf = require('fs').readFileSync(require('path').join(__dirname, 'public', 'assets', 'images', 'annonce-app-desktop.jpg'));
    if (buf && buf.length > 5000) {
      const cid = 'annonce-desktop@datatradingpro';
      html = html.replace(/https?:\/\/[^"]*annonce-app-desktop\.jpg/g, 'cid:' + cid);
      att = [{ filename: 'datatradingpro-desk.jpg', content: buf, cid, contentType: 'image/jpeg' }];
    }
  } catch (_) {}
  return _send(d.to, m.subject, html, att);
}

// ══════════════════════════════════════════════════════════════════════════════
//  UNE SEULE GRAMMAIRE DE TABLE DE CALENDRIER pour les deux mails (24/08)
//  Le quotidien séparait ses jours par une LIGNE-TITRE dorée pleine largeur ; l'hebdo
//  répétait le jour dans une COLONNE, « Vendredi 21 août » cinq fois de suite, en
//  `nowrap`, mangeant une part visible des 390 px d'un téléphone pour une valeur déjà
//  écrite juste au-dessus. Deux grammaires pour la même idée dans le même produit.
//  Le séparateur de jour gagne : il dit la chose une fois et rend la place aux chiffres.
// ══════════════════════════════════════════════════════════════════════════════

// Cellule de table : le style est identique partout, il vit à UN endroit.
const _TDC = `padding:6px;border-top:1px solid ${TOK.filet2};`;
/* Séparateur de jour = LE BANDEAU DU DESK, au pixel (25/08). Il s'écrivait en or, tout en
   capitales, sur fond transparent : même date, autre casse et autre couleur que `.cal-day-sep`
   (style.css 7495), qui est une BANDE SOMBRE OPAQUE #1b1d23 à texte clair #f1f5f9, filets noirs
   au-dessus et en dessous. Le collant (`position:sticky`) est le seul attribut qu'un courrier ne
   peut pas rendre : l'apparence au repos, elle, se reproduit intégralement.
   La CASSE se fait en JS et non en CSS : le desk écrit « Mardi 25 août » puis laisse
   `text-transform:capitalize` afficher « Mardi 25 Août ». Le moteur Word d'Outlook ne rend pas
   capitalize : on capitalise donc la chaîne elle-même pour obtenir le MÊME texte partout. */
const _capMots = s => String(s == null ? '' : s).replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toLocaleUpperCase('fr-FR'));
const _trJour = (j, cols) => `<tr><td colspan="${cols}" bgcolor="#1b1d23" style="background:#1b1d23;color:#f1f5f9;font-size:11px;font-weight:700;letter-spacing:.03em;padding:6px 14px 5px;border-top:1px solid #050505;border-bottom:1px solid #050505;">${_esc(_capMots(j))}</td></tr>`;
// PREMIÈRE CELLULE d'une ligne de calendrier : heure au-dessus, drapeau + code devise dessous.
// Deux colonnes fusionnées en une (grammaire de `_tabPublications`) : sur 390 px, quatre
// colonnes nowrap volaient la largeur au libellé de l'événement, qui est l'information.
const _tdQuand = (heure, ccy) => `<td style="${_TDC}white-space:nowrap;vertical-align:top;">${heure ? `<div style="color:${TOK.or};font-weight:700;font-size:11.5px;">${_esc(heure)}</div>` : ''}${ccy ? `<div style="font-size:11px;${heure ? 'margin-top:2px;' : ''}">${_ccyFlag(ccy)}</div>` : ''}</td>`;
// DERNIÈRE CELLULE : le réel coloré, puis les références empilées (haut/prévision/bas/précédent).
// La couleur et la taille de base vivent sur le `<td>`, pas dans un span par valeur : la même
// information en un tiers d'octets, ce qui compte sur un rapport de plusieurs dizaines de lignes.
const _tdVals = (reelHtml, refs) => `<td align="right" style="${_TDC}color:${TOK.gris};font-size:11px;white-space:nowrap;vertical-align:top;">${reelHtml}${(reelHtml && refs) ? '<br>' : ''}${refs}${(!reelHtml && !refs) ? '·' : ''}</td>`;

// COULEUR DU RÉEL : miroir exact de `deviationClass` du desk (public/js/charts.js), qui
// distingue TROIS états depuis le 12/08 sur demande explicite de l'utilisateur (« mets une
// couleur si c'est positif, négatif ou neutre ») :
//   · au-dessus / en-dessous du consensus → vert ou rouge, POLARITÉ INTELLIGENTE (un chômage
//     plus BAS que prévu est une bonne surprise : la couleur s'inverse pour ces indicateurs) ;
//   · CONFORME au consensus → ambre neutre. Le marché n'a pas été surpris : c'est une
//     information, pas une absence d'information ;
//   · sans consensus → blanc, on ne déduit jamais un signal du précédent.
// Le mail rendait les deux derniers cas de la MÊME couleur : le miroir était incomplet d'un état.
const _INV_RX = /unemployment|jobless|claimant|ch[oô]mage|layoff|job cuts|foreclosure|bankruptc|delinquen/i;
/* LES TROIS COULEURS SONT CELLES DU DESK, pas celles de la charte « risque » (25/08).
   Le mail peignait ses écarts en TOK.vert #22c55e / TOK.rouge #ef4444, qui sont les couleurs
   risk-on / risk-off des mails, et le CONFORME AU CONSENSUS en ambre. Or les colonnes de chiffres
   du desk lisent `.cv-pos` / `.cv-neg` / `.cv-neu`, c'est-à-dire les jetons `--st-pos` #22e06a,
   `--st-neg` #ff3b3b et `--st-flat` #e8eaed (style.css 125-127) : deux verts et deux rouges
   différents pour la MÊME donnée selon l'écran, et surtout une QUATRIÈME couleur là où
   l'arbitrage user du 12/08 en impose trois (« blanc = neutre, vert positif, rouge négatif,
   juste ces 3 ») : `.cv-neu` a été repassé au blanc côté desk, le commentaire du mail affirmait
   un miroir que la feuille de style démentait depuis. Un chiffre sorti pile au consensus est
   donc BLANC ici aussi. */
const _CV = { pos: '#22e06a', neg: '#ff3b3b', flat: '#e8eaed' };
/* Miroir strict de `deviationClass` (public/js/charts.js) : chaîne VIDE quand la donnée n'est pas
   comparable, exactement comme la classe vide du desk. Les deux surfaces qui l'emploient n'en
   font pas la même chose, et c'est le desk qui le veut ainsi : dans « Données publiées » un réel
   sans prévision reste dans l'encre de la ligne (#c8ccd4), dans le calendrier il passe par
   `.cv-actual` et vaut donc le blanc `--st-flat`. */
function _cvCol(a, f, title) {
  const sa = _num(a), sf = _num(f);
  if (!sa || !sf) return '';
  const x = parseFloat(String(sa).replace(',', '.')), y = parseFloat(String(sf).replace(',', '.'));
  if (isNaN(x) || isNaN(y)) return '';
  if (x === y) return _CV.flat;
  return (_INV_RX.test(String(title || '')) ? x < y : x > y) ? _CV.pos : _CV.neg;
}
function _actCol(a, f, title) { return _cvCol(a, f, title) || _CV.flat; }
/* PRÉ-MÉLANGE d'une couleur avec son fond. Le desk pose beaucoup d'accents en `rgba()` (le liseré
   or des cartes à .6, le fond de la Synthèse à .06, les points d'impact inactifs à `opacity:.2`).
   Le moteur Word d'Outlook ne connaît ni `rgba` ni `opacity` : une bordure rgba y tombe en noir et
   un point estompé y redevient plein. On calcule donc le résultat À PLAT, ce qui donne au pixel la
   même couleur que le navigateur affiche, partout, sans propriété exotique. */
function _melange(hex, a, fond) {
  const trio = s => [1, 3, 5].map(i => parseInt(String(s).substr(i, 2), 16));
  const [r, g, b] = trio(hex), [R, G, B] = trio(fond);
  const m = (x, y) => Math.round(x * a + y * (1 - a)).toString(16).padStart(2, '0');
  return '#' + m(r, R) + m(g, G) + m(b, B);
}

// Table de calendrier d'une SEMAINE (rubriques « Chiffres publiés » et « À surveiller » du
// Récap Hebdo). `groupes` = [{ dayLabel, events:[{time, ccy, title, actual, forecast, previous}] }].
// Aucun plafond, aucune dédup, aucun filtre d'impact : le rapport est livré entier.
function _tabCalSemaine(groupes) {
  let out = '';
  for (const g of (Array.isArray(groupes) ? groupes : [])) {
    // ⚠️ Une entrée NULLE dans le calendrier faisait sauter TOUT le Récap Hebdo de la semaine
    // (« Cannot read properties of null (reading 'events') ») : le tableau était testé, jamais
    // ses éléments. Un jour malformé se saute, il ne coûte pas l'envoi.
    if (!g || typeof g !== 'object') continue;
    // AUCUN filtre au-delà du nom de l'événement. Un rendez-vous sans le moindre chiffre
    // (des minutes de banque centrale, par exemple) reste une ligne du calendrier de la
    // semaine : il sort avec un « · » en valeurs, comme sur le desk, plutôt que d'être
    // effacé du rapport. C'est déjà la grammaire de « À surveiller » du Récap Quotidien.
    const evs = (Array.isArray(g.events) ? g.events : [])
      .filter(e => e && typeof e === 'object' && _md(e.title));
    if (!evs.length) continue;
    const jour = _md(g.dayLabel);
    if (jour) out += _trJour(jour, 3);
    for (const e of evs) {
      const reel = _num(e.actual), att = _num(e.forecast), pre = _num(e.previous);
      // PRÉCÉDENT enfin rendu : le lecteur voyait le réel et le consensus, jamais la valeur
      // d'avant, donc il ne pouvait pas juger la TENDANCE. Empilé sous le consensus plutôt
      // qu'en 6e colonne : à 390 px de large, une colonne de plus écrase le libellé.
      const refs = [att ? 'prév. ' + _esc(att) : '', pre ? 'préc. ' + _esc(pre) : ''].filter(Boolean).join('<br>');
      out += `<tr>${_tdQuand(_md(e.time), e.ccy)}`
        + `<td style="${_TDC}color:#e6e6ea;font-size:12.5px;line-height:1.45;">${_esc(_md(e.title))}</td>`
        + _tdVals(reel ? `<b style="color:${_actCol(e.actual, e.forecast, e.title)};font-size:12px;">${_esc(reel)}</b>` : '', refs)
        + `</tr>`;
    }
  }
  return out ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:2px 0 8px;">${out}</table>` : '';
}

// ── VOTRE RÉCAP HEBDO (récurrent, AUTO-GÉNÉRÉ) ────────────────────────────────────────────
// REFONTE 24/08, demande user : « pour le récap hebdo pareil, on offre entièrement le récap
// hebdo, toutes les devises ». Le mail ne s'arrête plus à trois devises sur huit (et ne
// l'écrit plus noir sur blanc) : il DONNE le rapport entier, dans l'ordre du desk.
// Ce qui a été DÉBRIDÉ : la sélection _curPick (3 devises), et toutes les coupes qui
// amputaient un rapport déjà borné côté serveur (execSummary 300, monetaryPolicy 260,
// drivers 190, propos 180, géo 320, chronologie 190, prints 3/2/3, cbBullets 2…).
// Ce qui a été BRANCHÉ : trois blocs entiers écrits puis jetés depuis des semaines, jamais
// injectés dans `body` : le ton des banques centrales, le fait marquant macro et le tableau
// des chiffres de la semaine avec son classement par la grille du mentor.
// UNE SEULE IMAGE (doctrine 24/08) : la Force des Devises de la semaine. Les huit courbes
// par devise ont été RETIRÉES, et pas seulement pour la sobriété : _sendWithInlineWidgets
// ne construit qu'UN cid par type:période, donc les huit <img> auraient toutes affiché la
// MÊME courbe, celle de la première devise (défaut mesuré, déjà visible sur trois devises).
// `weekly` = objet _weekly complet (_freshWeekly le sert entier, jamais un extrait).
// Renvoie null si aucune donnée (règle « pas de données → pas de mail »). 100 % informatif.
function buildWeeklyDigest({ name, email, campaign, weekly } = {}) {
  campaign = campaign || 'weekly';
  const w = weekly || {};
  const prenomRaw = _prenom(name);
  const hello = prenomRaw ? `Bonjour ${_esc(prenomRaw)},` : 'Bonjour,';
  const unsub = unsubUrl(email || '');
  const P = [];
  const S = (titre, contenu) => { if (contenu && String(contenu).trim()) P.push({ t: titre, h: _secRapport(titre) + contenu }); };

  /* « L'ESSENTIEL » (24/08) : la première chose que le desk montre, et la seule rubrique qu'un
     lecteur pressé lira. Elle manquait au mail : le champ `essentiel` n'était même pas lu. Trois
     phrases numérotées, le numéro en or comme sur le desk. Rendu en table : un compteur CSS ne
     survivrait pas au courrier. */
  const _essentiel = (Array.isArray(w.essentiel) ? w.essentiel : []).map(x => _md(typeof x === 'string' ? x : (x && x.text))).filter(Boolean);
  S("L'essentiel", _essentiel.length ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">`
    + _essentiel.map((p, n) => `<tr>
        <td width="26" style="padding:3px 8px 3px 0;vertical-align:top;color:${TOK.or};font-weight:800;font-size:13px;line-height:1.6;">${n + 1}</td>
        <td style="padding:3px 0;color:#e3e3e6;font-size:13.5px;line-height:1.6;">${_esc(p)}</td></tr>`).join('')
    + `</table>` : '');

  /* « TEMPS FORTS DE LA SEMAINE ÉCOULÉE » RETIRÉE (24/08, demande user sur pièce). Deux raisons
     convergentes. (1) Sur le Weekly Market Recap — le rapport réellement envoyé — la rubrique
     rendait les MÊMES publications que « Calendrier économique » juste en dessous : la même
     donnée deux fois, mesuré à l'écran (Inflation Rate MoM passait de 4 à 6 occurrences dans le
     mail). (2) Le desk ne l'affiche PAS sur ce rapport : c'est une rubrique du Global Economic
     Weekly, et le calendrier du mail couvre déjà la matière sur les deux types de rapport depuis
     que sa double source est en place. Rien n'est perdu, un doublon disparaît. */

  // OUVERTURE (v43) : le rapport ouvre sur `intro` (le lead bâti sur les récaps quotidiens de
  // la semaine), pas sur `summary`. Le desk n'écrit JAMAIS les deux : `summary` n'est que le
  // repli des éditions antérieures à la v42. Les rendre tous les deux dirait la semaine 2 fois.
  const insights = (Array.isArray(w.insights) ? w.insights : []).map(t => _md(typeof t === 'string' ? t : (t && t.text))).filter(Boolean);
  const lead = _md(w.intro) || _md(w.summary) || insights[0] || '';

  /* ══ LE MAIL BRANCHE COMME LE DESK (24/08, 3e passe user : « le récap hebdo du template n'est
     pas celui du desk ») ═══════════════════════════════════════════════════════════════════════
     Relevé sur _renderWeeklyRecap, branche par branche — le desk ne rend QUE :
       · GEW (w.gew)            → L'essentiel · Temps forts · Synthèse de la semaine · Calendrier
       · Weekly Market Recap    → Géopolitique (+ Chronologie rapide) · La semaine devise par devise
     Le mail en empilait NEUF, dont six que le desk n'affiche sur AUCUNE des deux branches :
     « Points macro clés » (les thèmes Cross-Asset / Commerce & Tarifs / Techno que le user cite —
     retirés du desk le 11/08 parce qu'ils répétaient les blocs devise), « Banques centrales »
     (retirée le 11/08, sa matière vit dans la rubrique de CHAQUE devise), « Calendrier économique »
     et « À surveiller » (le premier vit dans le GEW, le second n'a jamais eu de rendu desk :
     _wrCalSection est du code mort) et l'image « Force des devises » (retirée le 11/08, chaque
     devise garde SA courbe).
     Le mail ne montre donc plus que ce que le rapport montre. ⚠️ Ceci revient sur l'annonce client
     du 24/08 qui promettait « les banques centrales avec leurs propos datés, les thèmes macro » :
     arbitrage assumé par le user, le rapport prime sur la promesse. */
  const _isGew = !!w.gew;

  // ── EN-TÊTE : le nom du mail, la semaine couverte, le titre réel du rapport ───────────────
  // Le mail ne disait même pas QUELLE semaine il couvrait (weekRange / weekEnding jamais lus).
  const periode = _md(w.weekRange) || (_num(w.weekEnding) ? 'semaine au ' + _md(w.weekEnding) : '');
  const titreRap = _md(w.title).replace(/^Weekly Market Recap\s*[:\-]?\s*/i, '').replace(/^R[ée]cap Hebdo\s*[:\-]?\s*/i, '');
  const entete = `${_H1}Votre Récap Hebdo</p>`
    + (periode ? `<p style="margin:-8px 0 10px;color:${TOK.grisDoux};font-size:12px;">${_esc(periode)}</p>` : '')
    + (titreRap ? `<p style="margin:0 0 14px;color:#e6e6ea;font-size:14.5px;font-weight:600;line-height:1.5;">${_esc(titreRap)}</p>` : '');

  /* ⚠️ DÉFAUT MESURÉ (24/08) : le lead était empilé dans `P` comme une CHAÎNE BRUTE, alors que
     l'assemblage final ne sait lire que des objets {t, h} (voir _ORDRE_DESK plus bas). Une chaîne
     n'a pas de `.t` : elle échappait à l'ordre du desk, puis le repli de fin lisait `x.h` sur une
     chaîne — `undefined`, que join('') efface. L'INTRODUCTION DU RAPPORT — le lead v42 bâti sur
     les récaps quotidiens de la semaine, la première chose que le desk montre — ne partait donc
     JAMAIS dans le mail, sans la moindre erreur. Elle entre désormais comme les autres sections. */
  if (lead) P.push({ t: 'Ouverture', h: _paraHtml(lead, '#e6e6ea', '14px') });

  // ── ÉCLAIRAGES : les idées du desk sur la semaine, TOUTES (le mail n'en montrait que 3, et
  //    les coupait à 230 caractères APRÈS échappement, ce qui pouvait trancher une entité HTML
  //    en plein milieu : on coupe avant d'échapper, ici on ne coupe plus du tout).
  const _reste = insights.filter(t => t !== lead);
  // PAIRES du rapport (w.pairs, jusqu'à 8 objets {pair, bias, text}) : elles n'étaient lues
  // NULLE PART, alors que le mail rendait déjà `w.insights`, de la même famille, et que le
  // mail QUOTIDIEN rend son équivalent. Le badge de biais, lui, ne passe pas : règle produit
  // (informatif uniquement) : la phrase factuelle du desk est rendue en entier, sans direction.
  const pairesW = (Array.isArray(w.pairs) ? w.pairs : []).filter(p => p && _md(p.pair)).map(p => {
    const txt = _md(p.text);
    return _puceOr(`<span style="color:${TOK.blanc};font-weight:700;">${_esc(_md(p.pair))}</span>${txt ? ' : ' + _esc(txt) : ''}`);
  }).join('');
  /* ÉCLAIRAGES RETIRÉS (24/08, même décision que pour le Récap Quotidien) : le carrousel du haut
     du rapport redisait, en plus vague, ce que les rubriques développent ensuite avec leurs chiffres.
     Il garde toute sa place SUR LE DESK, où il se survole d'un coup d'œil au-dessus du rapport. */

  // ── GÉOPOLITIQUE : le RÉCIT d'abord, la « Chronologie rapide » ensuite (ordre du desk) ────
  // Les points d'un jour sont filtrés UN PAR UN : un `points` contenant un null ou un objet
  // faisait sortir « lundi : a ; ; [object Object] » (le join() précédait le nettoyage).
  const geoN = (Array.isArray(w.geoNarrative) ? w.geoNarrative : []).map(_md).filter(Boolean);
  const gt = (w.geoTimeline && Array.isArray(w.geoTimeline.jours))
    ? w.geoTimeline.jours.map(j => ({ jour: _md(j && j.jour), pts: (Array.isArray(j && j.points) ? j.points : []).map(_md).filter(Boolean) }))
      .filter(j => j.jour && j.pts.length) : [];
  const gtTitre = _md(w.geoTimeline && w.geoTimeline.titre);
  const geoHtml = geoN.map(p => _paraHtml(p)).join('')
    // Intitulé en UN mot ; le titre que le rapport donne à sa chronologie (« Énergie et
    // corridors maritimes ») est une DONNÉE, il descend d'une ligne au lieu d'allonger le titre.
    + (gt.length ? _ssTitre('Chronologie')
      + (gtTitre ? `<div style="color:${TOK.grisDoux};font-size:12px;margin:0 0 4px;">${_esc(gtTitre)}</div>` : '')
      + gt.map(j => _puce(`<span style="color:${TOK.or};font-weight:700;">${_esc(j.jour)}</span> : ${_esc(j.pts.join(' ; '))}`)).join('') : '');
  S('Géopolitique', geoHtml);

  // ── BANQUES CENTRALES : la section ABSENTE du mail envoyé jusqu'ici (le bloc existait,
  //    il n'était jamais injecté). Elle porte ce que le desk range par devise plus bas :
  //    posture, décision, orientation, effet devise, probabilités du marché.
  //    RÉPARTITION VOLONTAIRE, pour ne rien dire deux fois : les PROPOS datés (quotes) sont
  //    rendus dans le bloc de LEUR devise (cd.cbBullets en vient). Ils ne reviennent ici que
  //    pour une banque dont la devise n'a PAS de bloc : sinon ils seraient perdus en silence.
  // `!Array.isArray` : typeof [] vaut 'object', donc un tableau passait et Object.keys rendait
  // '0','1', et le mail affichait des blocs devise intitulés « 0 » et « 1 » en or 17px.
  const curSrc = (w.currencies && typeof w.currencies === 'object' && !Array.isArray(w.currencies)) ? w.currencies : {};
  // ORDRE DU DESK (_WR_ORDER) puis toute clé inattendue : « toutes les devises » est la
  // demande centrale, aucune ne doit disparaître parce qu'elle manque à une liste en dur.
  // La SEULE condition est de ressembler à un code devise (3 lettres majuscules) : une clé
  // technique glissée dans l'objet (`_meta`) ne doit pas devenir un bloc devise fantôme.
  const _ORDRE = ['USD', 'EUR', 'JPY', 'GBP', 'CHF', 'AUD', 'CAD', 'NZD'];
  // RÉTRO-COMPAT DU DESK (app.js 9409) : une devise stockée en TEXTE BRUT garde son bloc, son
  // texte servant d'analyse. Le mail l'écartait — la devise disparaissait ENTIÈREMENT du mail
  // quand le desk l'affiche. Mord sur les rapports archivés et sur le cache durable.
  const _estDevise = c => /^[A-Z]{3}$/.test(String(c)) && curSrc[c]
    && (typeof curSrc[c] === 'string' ? !!String(curSrc[c]).trim() : (typeof curSrc[c] === 'object' && !Array.isArray(curSrc[c])));
  const codes = _ORDRE.filter(_estDevise)
    .concat(Object.keys(curSrc).filter(c => _ORDRE.indexOf(c) < 0 && _estDevise(c)));
  // SÉMANTIQUE de la charte : hawkish = resserrement = vert · dovish = assouplissement = rouge.
  const _tonCol = b => /hawk/i.test(b) ? TOK.vert : (/dov/i.test(b) ? TOK.rouge : TOK.gris);
  const _dateFR = d => { const t = Date.parse(String(d || '') + (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? 'T00:00:00Z' : '')); if (!isFinite(t)) return _md(d); try { return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }).format(new Date(t)); } catch (e) { return _md(d); } };
  // Probabilités : le serveur les produit déjà en POURCENTAGES 0-100 à deux décimales
  // (server.js 16159 et 16225). On arrondit à l'entier, on n'invente aucune conversion.
  const _pc = v => (typeof v === 'number' && isFinite(v)) ? Math.round(v) + ' %' : '';
  /* BLOC « Banques centrales » RETIRÉ (24/08). Il n'a plus d'appelant depuis que la section suit
     le desk, qui ne la rend sur aucune de ses deux branches. Sa matière n'est pas perdue : les
     PROPOS datés sont rendus dans le bloc de LEUR devise (cd.cbBullets). Seuls les propos d'une
     banque dont la devise n'a PAS de bloc ne sont plus rendus — le desk ne les rend pas non plus,
     c'est la conséquence assumée du miroir strict.
     Retiré et pas seulement débranché : il construisait le HTML de chaque banque À CHAQUE ENVOI
     pour un résultat jeté, sur un conteneur borné à 512 Mo. */
  // « Banques centrales » : RETIRÉE. Le desk ne la rend sur aucune des deux branches — sa matière
  // vit dans la rubrique Banque centrale de CHAQUE devise, où le mail la rend déjà.

  // ── THÈMES MACRO ─────────────────────────────────────────────────────────────────────────
  // ⚠️ Le 14/08, cette section avait été RETIRÉE du mail : sa taxonomie (« Performance
  // Cross-Asset », « Commerce International & Tarifs »…) avait quitté le récap du desk le
  // 11/08, et le mail affichait donc des rubriques absentes du rapport qu'il annonçait.
  // Elle revient le 24/08 sur demande explicite (« on offre entièrement le récap hebdo ») :
  // la matière EST produite, elle est datée et sourcée, la cacher revenait à jeter le tiers
  // du travail du desk. Le thème géopolitique est sauté quand le récit géo l'a déjà raconté,
  // et les thèmes banque centrale sont déjà écartés déterministiquement côté serveur.
  // DEUX DÉFAUTS RÉPARÉS ICI, tous deux des pertes sèches :
  //  1. un thème qui porte un `detail` mais AUCUNE puce disparaissait ENTIÈREMENT, intitulé
  //     compris, alors que le serveur produit `detail` indépendamment des puces (server 10806).
  //  2. le thème « Géopolitique » sautait dès que le RÉCIT géo existait. Le desk, lui, ne le
  //     retire que si la CHRONOLOGIE existe (app.js 8850 : `_geoTheme = !_gt ? … : null`) :
  //     sans chronologie il rend le thème, ses puces et son intitulé. On s'aligne : le doublon
  //     à éviter est chronologie/thème, pas récit/thème (le récit raconte, le thème liste).
  /* ⚠️ DÉFAUT MESURÉ (24/08) : le mail lisait `w.macro`, alors que le desk lit `w.synthese`
     (public/js/app.js, _renderWeeklyRecap). La rubrique la plus lue du rapport ne pouvait donc
     JAMAIS s'afficher dans le mail, sans que rien ne le signale : une source vide ne lève pas
     d'erreur, elle rend une chaîne vide et la section disparaît en silence. On accepte les trois
     noms rencontrés selon les générations de rapports, et on retombe sur le pavé `highlights`
     quand la synthèse structurée manque, exactement comme le desk. */
  /* LE TITRE SUIT LA SOURCE. `synthese` (GEW) et `macro` (Weekly Market Recap) ne coexistent
     jamais : le mail titrait « Synthèse de la semaine » dans les DEUX cas, donc il publiait les
     « Points Macro Clés » du Récap sous un intitulé emprunté à l'autre rapport. Le desk nomme
     chaque chose par son nom ; on fait pareil. */
  const _syntheseCands = [w.synthese, w.macroThemes, w.macro];
  const _syntheseIdx = _syntheseCands.findIndex(x => Array.isArray(x) && x.length);
  const _syntheseSrc = _syntheseIdx >= 0 ? _syntheseCands[_syntheseIdx] : [];
  const _titreSynthese = _syntheseIdx === 2 ? 'Points macro clés' : 'Synthèse de la semaine';
  const macroHtml = _syntheseSrc
    .map(m => ({ h: _md(m && m.heading), b: (Array.isArray(m && m.bullets) ? m.bullets : []).map(_md).filter(Boolean), d: _md(m && m.detail) }))
    .filter(x => x.h && (x.b.length || x.d))
    .filter(x => !(gt.length && /g[ée]opolit/i.test(x.h)))
    .map(x => _ssTitre(x.h) + x.b.map(b => _puceOr(_esc(b))).join('') + (x.d ? _paraHtml(x.d) : '')).join('');
  // GEW UNIQUEMENT. Sur un Weekly Market Recap la source serait `w.macro`, c'est-à-dire les
  // « Points Macro Clés » que le desk a retirés : les rendre ferait diverger les deux surfaces.
  if (_isGew) S(_titreSynthese, macroHtml || _paraHtml(_md(w.highlights)));

  // ── LE CALENDRIER DE LA SEMAINE : PUBLIÉ, PUIS À VENIR ───────────────────────────────────
  // TOUT ce que le rapport porte, sans sélection ni plafond. Ce qui a été retiré ici, et
  // pourquoi (quatre pertes mesurées, toutes silencieuses) :
  //  · le filtre `major || high` jetait une publication à impact MOYEN pourtant PUBLIÉE, alors
  //    que le serveur fait entrer dans `past` tout événement porteur d'un réel (server 20562) ;
  //  · le filtre `_num(e.actual)` jetait une décision de taux annoncée sans chiffre exploitable
  //    (BoE Bank Rate) : elle garde pourtant son consensus et son précédent ;
  //  · la dédup « devise + famille » jetait une publication sur deux dès que deux prints d'une
  //    même devise tombaient dans la même famille : « CPI YoY » et « Core CPI YoY » sont DEUX
  //    chiffres que le trader lit séparément, pas deux variantes d'un même. La clé de famille
  //    était en plus tronquée à 22 caractères, donc « Foreign Direct Investment YTD » et
  //    « … Change » fusionnaient ;
  //  · le plafond de 12 lignes coupait 6 publications sur 18 distinctes.
  // La sélection n'a plus lieu d'être : le serveur a déjà borné `past` et `upcoming` (45
  // événements chacun, majeurs protégés, server 20570) et les a triés chronologiquement. Le
  // classement par grande famille et la grille de priorité ont donc disparu avec le plafond :
  // ils n'existaient que pour choisir QUI aurait les 12 places.
  const _cal = (w.calendar && typeof w.calendar === 'object' && !Array.isArray(w.calendar)) ? w.calendar : {};
  /* DOUBLE SOURCE, comme « Temps forts ». `calendar` n'existe QUE sur le Weekly Market Recap ;
     un GEW porte son calendrier dans `days[]` — et le GEW PEUT alimenter ce mail (le Récap est
     évincé de allNews en moins d'une journée alors que le GEW est horodaté samedi 16 h : dans
     cette fenêtre _freshWeekly renvoie le GEW). Sans ce repli la rubrique disparaissait en
     silence sur un GEW, quand le desk y affiche le calendrier complet jour par jour. Les formes
     diffèrent — {day, date, events[{currency}]} côté GEW, {dayLabel, events[{ccy}]} attendu par
     la table — on convertit. */
  const _calPast = (Array.isArray(_cal.past) && _cal.past.length) ? _cal.past
    : (Array.isArray(w.days) ? w.days : []).map(d => ({
      dayLabel: [_md(d && d.day), _md(d && d.date)].filter(Boolean).join(' '),
      events: (Array.isArray(d && d.events) ? d.events : []).map(e => Object.assign({}, e, { ccy: (e && (e.ccy || e.currency)) || '' })),
    })).filter(g => g.events.length);
  // GEW UNIQUEMENT, comme le desk : le calendrier a été retiré du Weekly Market Recap (il vit
  // dans le Global Economic Weekly, app.js 9397).
  if (_isGew) S('Calendrier économique', _tabCalSemaine(_calPast));
  // `upcoming` (le calendrier de la semaine qui vient) est produit et stocké AVEC le rapport
  // (server 20569) et n'était lu NULLE PART : le mail livrait le pendant passé et gardait
  // celui-ci pour lui. Même grammaire de table, sans colonne « réel » remplie : ce sont des
  // rendez-vous, pas des résultats.
  // « À surveiller » : RETIRÉE. Elle n'a JAMAIS eu de rendu desk — _wrCalSection, seule fonction
  // qui lise cal.upcoming, n'a aucun appelant. Le mail publiait une rubrique que le rapport
  // n'a jamais portée.

  // ── LA SEMAINE DEVISE PAR DEVISE : TOUTES les devises publiées, TOUTES leurs rubriques,
  //    dans l'ordre exact du desk : entête (code + biais + accroche) · résumé exécutif ·
  //    Croissance économique · Emploi · Inflation · Banque centrale · moteurs ·
  //    « Semaine à venir : » · « Biais / Scénario : ».
  const _CTRY_FR = { DE: 'All.', FR: 'Fr.', ES: 'Esp.', IT: 'It.' };
  // Même grammaire que le rapport : « [All.] CPI Y/Y : publié 3,5 % · attendu 3,8 % · préc. 3,4 % → lecture (15 juil.) ».
  const _print = pr => {
    // Un print sans réel ne s'affiche pas (règle du desk). _num, pas la véracité JS : un
    // réel « 0 » est une valeur légitime, il ne doit pas disparaître comme un champ absent.
    if (!pr || !_md(pr.label) || !_num(pr.actual)) return '';
    const nums = [`publié <b style="color:#e6e6ea;">${_esc(_num(pr.actual))}</b>`,
      _num(pr.forecast) ? `attendu ${_esc(_num(pr.forecast))}` : '',
      _num(pr.previous) ? `préc. ${_esc(_num(pr.previous))}` : ''].filter(Boolean).join(' · ');
    const ctry = (pr.ctry && _CTRY_FR[pr.ctry]) ? `<span style="color:${TOK.grisDoux};">${_CTRY_FR[pr.ctry]}</span> ` : '';
    const lean = _md(pr.lean) ? ` <span style="color:#cbd5e1;">→ ${_esc(_md(pr.lean))}</span>` : '';
    const dt = _md(pr.date) ? ` <span style="color:#6b7280;">(${_esc(_md(pr.date))})</span>` : '';
    return _puce(`${ctry}<span style="color:#cbd5e1;font-weight:600;">${_esc(_md(pr.label))}</span> : ${nums}${lean}${dt}`);
  };
  // La géopolitique est exclue des moteurs : le fil géo est déjà raconté plus haut.
  const _geoDrv = /^(?:(?:risques?|tensions?)\s+g[ée]opolit|g[ée]opolit|conflit|sanctions?|guerre(?!\s+commercial))/i;
  const curHtml = codes.map(c => {
    const cd = (curSrc[c] && typeof curSrc[c] === 'object' && !Array.isArray(curSrc[c])) ? curSrc[c] : { analysis: _md(curSrc[c]) || '' };
    // v44 : `rubriquesVides` déclare ce qui n'a rien donné. Quand le champ existe, les QUATRE
    // rubriques restent affichées, une devise sans publication recevant la phrase sobre du
    // desk : le lecteur ne doit jamais confondre « rien n'est sorti » et « on n'a pas regardé ».
    // ⚠️ On ne se fie PAS à ce tableau pour la banque centrale : le test serveur (11006) porte
    // sur `cbQuotes`, un champ qui n'existe nulle part, donc « banque » y est déclarée vide dès
    // que `pricing` manque, propos ou pas. On teste la matière réelle.
    // ⚠️ On lit le CONTENU du tableau, plus sa seule existence : `rubriquesVides: []` déclare
    // que RIEN n'est vide et déclenchait pourtant les quatre « Aucune publication cette
    // semaine. », donc la phrase contredisait la donnée qui la produit. Les clés sont celles du
    // serveur (server 11002) : 'croissance', 'emploi', 'inflation', 'banque'.
    const rvSet = Array.isArray(cd.rubriquesVides) ? new Set(cd.rubriquesVides.map(x => _md(x).toLowerCase())) : null;
    const rv = !!rvSet;   // rétro-compat : présence du champ = rapport v44 ou plus récent
    const declVide = k => !!(rvSet && rvSet.has(k));
    const vide = `<div style="color:${TOK.grisPied};font-size:12.5px;margin:3px 0;">Aucune publication cette semaine.</div>`;
    const listeP = arr => (Array.isArray(arr) ? arr : []).map(_print).filter(Boolean).join('');
    // Entête : le CODE en gras, son biais en couleur, l'accroche en gris. Pas de badge, pas de cadre.
    const b = _md(cd.bias);
    const th = _md(cd.thesis);
    const tete = `<div style="margin:20px 0 4px;padding-top:12px;border-top:1px solid ${TOK.filet2};">
      <span style="color:${TOK.or};font-weight:800;font-size:17px;letter-spacing:.02em;">${_esc(c)}</span>${b ? ` <span style="color:${_biasCol(b)};font-weight:700;font-size:12px;">${_esc(b)}</span>` : ''}
      ${th ? `<div style="color:${TOK.gris};font-size:12.5px;line-height:1.5;margin-top:3px;">${_esc(th)}</div>` : ''}
    </div>`;
    // Résumé exécutif, en entier (il était coupé à 300 caractères).
    const exec = _paraHtml(cd.execSummary || cd.analysis);
    // RETRO-COMPAT : sans `employmentPrints` ni `rubriquesVides`, le rapport est antérieur au
    // découpage croissance/emploi et son intitulé était « Croissance & Emploi ».
    const titreCroi = (Array.isArray(cd.employmentPrints) && cd.employmentPrints.length) || rv ? 'Croissance économique' : 'Croissance & Emploi';
    const croiL = listeP(cd.growthPrints);
    const empL = ((Array.isArray(cd.employmentPrints) && cd.employmentPrints.length) || rv) ? listeP(cd.employmentPrints) : '';
    const infTxt = _md(cd.inflation) ? _puce(_esc(_md(cd.inflation))) : '';
    const infPr = listeP(cd.inflationPrints);
    const infL = infTxt + infPr;
    // Banque centrale : intitulé UNIQUE pour les huit devises (15/08) + posture accolée.
    // DÉDUP PAR INTERVENANT au rendu, comme le desk, mais sur l'intervenant ET son propos :
    // dédupliquer sur le SEUL nom supprimait le 2e propos d'un officiel qui parle deux fois
    // dans la semaine (Powell lundi puis vendredi), et cette 2e prise de parole n'était alors
    // lue NULLE PART. On ne retire plus qu'un doublon exact, ce que la dédup visait vraiment.
    const vus = new Set();
    const cbB = (Array.isArray(cd.cbBullets) ? cd.cbBullets : []).map(q => {
      if (typeof q === 'string') return _md(q) ? _puce(_esc(_md(q))) : '';
      if (!q) return '';
      const sp = _md(q.speaker), tx = _md(q.text), dt = _md(q.date);
      if (!sp && !tx) return '';
      const k = (sp + '|' + dt + '|' + tx).toLowerCase(); if (vus.has(k)) return ''; vus.add(k);
      return _puce(`${sp ? `<span style="color:#cbd5e1;font-weight:600;">${_esc(sp)}</span>` : ''}${dt ? ` <span style="color:#6b7280;">(${_esc(dt)})</span>` : ''}${(sp || dt) && tx ? ' → ' : ''}${_esc(tx)}`);
    }).filter(Boolean).join('');
    /* LA DÉCISION D'ABORD (25/08, demande user) — même lecture que le desk : `decision` est produit
       par banque depuis toujours mais n'avait plus aucun lecteur rendu. Apparié sur le code devise,
       donc l'édition déjà publiée en bénéficie sans régénération. */
    const _cbBanque = (Array.isArray(w.centralBanks) ? w.centralBanks : []).find(b => b && b.code === c);
    const _cbDec = _cbBanque ? _md(_cbBanque.decision) : '';
    const cbDecL = _cbDec ? _ligne('Décision', _esc(_cbDec)) : '';
    const cbTxt = _md(cd.monetaryPolicy) ? _puce(_esc(_md(cd.monetaryPolicy))) : '';
    const pri = _md(cd.pricing) ? _ligne('Pricing', _esc(_md(cd.pricing))) : '';
    const cbL = cbDecL + cbTxt + cbB + pri;
    const titreCB = 'Banque centrale' + (_md(cd.cbStance) ? ' · ' + _md(cd.cbStance) : '');
    // LES QUATRE RUBRIQUES, dans l'ordre du desk. Quand les QUATRE sont vides, la phrase
    // « Aucune publication cette semaine. » s'écrivait quatre fois sous quatre intertitres :
    // huit lignes de vide pour deux lignes utiles (mesuré sur NZD et CHF). Le même fait tient
    // en une ligne, qui nomme les rubriques regardées : rien n'est perdu, rien n'est empilé.
    const rubs = [
      { titre: titreCroi, html: croiL, vide: !croiL && declVide('croissance') },
      { titre: 'Emploi', html: empL, vide: !empL && declVide('emploi') },
      { titre: 'Inflation', html: infL, vide: !infL && declVide('inflation') },
      // La banque centrale se lit dans les deux sens : la matière réelle d'abord (le test
      // serveur, 11006, porte sur `cbQuotes`, un champ qui n'existe nulle part, donc
      // « banque » y est déclarée vide dès que `pricing` manque, propos ou pas), et la phrase
      // sobre seulement si le rapport a VRAIMENT déclaré cette rubrique vide.
      { titre: titreCB, html: cbL, vide: !cbL && declVide('banque') },
    ];
    const vides = rubs.filter(r => r.vide);
    const rubBloc = (!rubs.some(r => r.html) && vides.length === rubs.length)
      ? `<div style="color:${TOK.grisPied};font-size:12.5px;margin:8px 0 3px;">Aucune publication cette semaine&nbsp;: ${_esc(vides.map(r => r.titre.toLowerCase()).join(', '))}.</div>`
      : rubs.map(r => r.html ? _ssTitre(r.titre) + r.html : (r.vide ? _ssTitre(r.titre) + vide : '')).join('');
    // Moteurs : TOUS les thèmes du rapport, en lignes intitulées (le mail n'en gardait que 3).
    /* RÉTRO-COMPAT + `why` FACULTATIF, comme le desk (app.js 9512-9517). Le mail exigeait name
       ET why, et ne connaissait que le format {name, why} : il jetait donc en silence (a) tous
       les moteurs des rapports antérieurs à la v34, au format {heading, bullets}, et (b) tout
       moteur au libellé renseigné mais sans « pourquoi » — que le serveur produit et que le desk
       affiche. Dans les deux cas la rubrique Moteurs disparaissait sans un mot. */
    const drv = (Array.isArray(cd.drivers) ? cd.drivers : [])
      .map(d => d && { n: _md(d.name) || _md(d.heading), w: _md(d.why) || (Array.isArray(d.bullets) ? d.bullets.map(_md).filter(Boolean).join(' ') : '') || _md(d.detail) })
      .filter(d => d && d.n && !_geoDrv.test(String(d.n)))
      .map(d => _ligne(d.n, _esc(d.w))).join('');
    // Deux lignes de clôture, comme dans le rapport.
    const wa = (Array.isArray(cd.weekAhead) ? cd.weekAhead : []).map(_md).filter(Boolean);
    const sav = (wa.length || _md(cd.conclusion))
      ? _ligne('Semaine à venir', `${_esc(_md(cd.conclusion))}${wa.length ? ` <span style="color:${TOK.grisDoux};">${_esc(wa.join(' · '))}</span>` : ''}`) : '';
    const bsc = _md(cd.biasRationale) ? _ligne('Biais / Scénario', _esc(_md(cd.biasRationale))) : '';
    // « Semaine à venir » et « Biais / Scénario » ne sont PAS des moteurs : rendus avec la
    // même grammaire juste sous l'intertitre « Moteurs », ils étaient lus comme deux moteurs
    // de plus. Ils regardent devant, ils ont leur propre intertitre.
    const aVenir = (sav || bsc) ? _ssTitre('À venir') + sav + bsc : '';
    const corps = exec + rubBloc + (drv ? _ssTitre('Moteurs') + drv : '') + aVenir;
    // Une devise sans la moindre matière ne s'écrit pas : pas de code doré orphelin.
    return (corps || b || th) ? tete + corps : '';
  }).join('');

  // L'UNIQUE image : la Force des Devises sur LA SEMAINE, juste avant les blocs devise
  // (elle porte ce que le texte ne peut pas dire : la trajectoire relative des huit).
  // Image « Force des devises » : RETIRÉE, comme sur le desk le 11/08 — chaque devise porte SA
  // courbe dans son propre bloc, la vue d'ensemble faisait doublon.
  S('La semaine devise par devise', curHtml);

  // Rien de rendu du tout = pas de mail (règle « pas de données → pas de mail »).
  /* ORDRE DU DESK (24/08, demande user : « remets à jour toute la structure comme on a fait pour
     le récap quotidien »). Relevé sur _renderWeeklyRecap (public/js/app.js) : L'essentiel, Temps
     forts de la semaine écoulée, Synthèse de la semaine, Calendrier économique, Géopolitique et
     sa Chronologie rapide, puis La semaine devise par devise. Les sections étaient jusqu'ici
     empilées dans l'ordre où le code les calculait, qui n'était pas celui du rapport.
     Toute section non prévue par cette liste reste rendue, à la fin : mieux vaut un ordre
     imparfait qu'une rubrique qui disparaîtrait en silence. */
  /* MISE À PLAT 24/08 (2e passe) : l'ordre précédent fusionnait les DEUX branches du desk, qui
     s'excluent (isGew). Sur le Weekly Market Recap — le rapport réellement envoyé — le desk ouvre
     sur l'intro puis enchaîne GÉOPOLITIQUE (récit + Chronologie rapide) et LA SEMAINE DEVISE PAR
     DEVISE ; « L'essentiel » et « Temps forts » n'existent que sur le GEW. La Géopolitique se
     retrouvait donc en 7e position, enterrée derrière quatre rubriques, alors qu'elle OUVRE le
     rapport — et d'autant plus bas que Gmail replie la fin d'un mail long.
     Cet ordre unique sert correctement les deux rapports : chaque rubrique absente est sautée. */
  // Les deux branches réunies : sur un rapport donné, la moitié est naturellement absente et
  // se saute. GEW → L'essentiel, Synthèse, Calendrier. Recap → Géopolitique, devise par devise.
  const _ORDRE_DESK = ['Ouverture', "L'essentiel", 'Géopolitique',
    _titreSynthese, 'Calendrier économique', 'La semaine devise par devise'];
  const _vus = new Set();
  const corpsRapport = _ORDRE_DESK.map(t => { const e = P.find(x => x && x.t === t); if (!e) return ''; _vus.add(t); return e.h; }).join('')
    + P.filter(x => x && !_vus.has(x.t)).map(x => x.h).join('');
  if (!corpsRapport.trim()) return null;

  // PROMESSE HONNÊTE (défaut mesuré) : la phrase de clôture affirmait « dans son intégralité,
  // devise par devise » y compris quand le mail ne portait AUCUN bloc devise (rapport réduit à
  // son intro, à sa géopolitique ou à son seul calendrier : six entrées minimales testées, la
  // phrase tombait à chaque fois). On ne promet que ce qui est réellement dans le corps.
  const cloture = curHtml
    ? "Vous venez de lire le Récap Hebdo du desk dans son intégralité, devise par devise. Sur le desk, il s'accompagne du calendrier économique, de la force des devises et du Smart Bias, mis à jour en direct."
    : "Vous venez de lire le Récap Hebdo du desk, tel qu'il a été publié. Sur le desk, il s'accompagne du calendrier économique, de la force des devises et du Smart Bias, mis à jour en direct.";

  /* BOUTON EN PIED (24/08, demande user) : il vient APRÈS le récap, sous la phrase de clôture —
     on lit le rapport, puis on nous propose d'ouvrir le desk. Le mail ne s'ouvre plus sur un
     appel à l'action posé avant toute valeur.
     ⚠️ CONTREPARTIE ASSUMÉE, mesurée en juillet : sur une semaine chargée (huit devises,
     calendrier complet, image du widget) ce mail dépasse le seuil au-delà duquel Gmail replie la
     fin derrière « Message tronqué ». Le bouton peut donc tomber dans la zone repliée. Deux
     garde-fous limitent la casse : _noteLongue prévient honnêtement du repliement juste en
     dessous, et la désinscription voyage dans l'en-tête List-Unsubscribe (posé par _sendOvhSmtp),
     donc elle reste atteignable en un clic quoi qu'il arrive. */
  const body = `
    <p style="margin:0 0 14px;font-size:15px;color:#e6e6ea;">${hello}</p>
    ${entete}
    ${corpsRapport}
    <p style="margin:26px 0 12px;font-size:13.5px;line-height:1.6;color:#cbd5e1;">${cloture}</p>
    <div style="margin:0 0 14px;">${_campaignBtn('Ouvrir le desk', trackClickUrl(campaign, email, LANDING_URL))}</div>
    ${_noteLongue(corpsRapport)}
    <p style="margin:18px 0 4px;">Bonne semaine,</p>
    <p style="margin:0 0 16px;color:${TOK.gris};">L'équipe DataTradingPro</p>
    <img src="${trackOpenUrl(campaign, email)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;overflow:hidden;">
  `;
  // Sujets ROTATIFS (déterministes par semaine) : le nom du mail d'abord, la promesse ensuite.
  const _wkR = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
  const _subsR = [
    '📰 Votre Récap Hebdo : la semaine en entier',
    '🗞️ Votre Récap Hebdo, devise par devise',
    '📰 Votre Récap Hebdo : ce que la semaine a changé',
  ];
  const subject = _subsR[_wkR % _subsR.length];
  return { subject, html: _campaignLayout('Votre Récap Hebdo', body, unsub) };
}
// UNE image, période SEMAINE. `strength` tout court rendait le widget sur la période par
// défaut alors que le corps demandait period=week : le type porte désormais sa période, donc
// l'image embarquée est bien celle que le mail annonce.
async function sendWeeklyDigest(d) { d = d || {}; const m = buildWeeklyDigest({ name: d.name, email: d.email || d.to, campaign: d.campaign, weekly: d.weekly }); if (!m) return false; return _sendWithInlineWidgets(d.to, m.subject, m.html, ['strength:week']); }

// ── DÉCRYPTAGE — e-mail ÉDUCATIF évergreen (S2 de la séquence). Décode les grandes annonces éco (macro US)
// que les abonnés voient chaque semaine dans le calendrier : sigles (CPI, NFP, PCE, FOMC…) rendus lisibles,
// regroupés par famille + « sert à anticiper ». Source : doc « Learning Economics News » fourni par l'admin.
// 100 % INFORMATIF : explique, ne pousse aucune position. Aucune dépendance données → prêt en permanence.
const _DECRYPT_FAMILIES = [
  { name: 'INFLATION', accent: '#f3c344', lead: "Le coût de la vie. C'est le carburant des décisions de la Fed.", items: [
    { k: 'CPI', full: 'Consumer Price Index',        d: 'Le prix du panier de la ménagère.',                          a: 'Politique de la Fed, taux, dollar' },
    { k: 'Core CPI', full: 'Core Consumer Price Index', d: 'Le même panier hors énergie et alimentation (plus stable).', a: 'Décisions de la Fed, PCE' },
    { k: 'PCE', full: 'Personal Consumption Expenditures', d: 'Le prix réellement payé par les ménages.',              a: 'Orientation de la Fed' },
    { k: 'Core PCE', full: 'Core PCE',               d: "La mesure d'inflation préférée de la Fed.",                   a: 'Orientation future des taux' },
    { k: 'PPI', full: 'Producer Price Index',        d: 'Le coût de production des usines, en amont.',                 a: 'Le CPI à venir (pression sur les prix)' },
  ] },
  { name: 'EMPLOI', accent: '#f3c344', lead: 'La santé du marché du travail. Un marché solide laisse la Fed rester ferme.', items: [
    { k: 'NFP', full: 'Non-Farm Payrolls',           d: "Le nombre d'emplois créés hors agriculture.",                a: 'Chômage, salaires, Fed' },
    { k: 'Taux de chômage', full: 'Unemployment Rate', d: 'La part de gens sans travail.',                             a: 'Consommation, croissance' },
    { k: 'Salaire horaire', full: 'Average Hourly Earnings', d: 'La vitesse de hausse des salaires.',                  a: 'Inflation future (CPI/PCE)' },
    { k: 'ADP', full: 'ADP Employment Change',       d: "L'estimation privée, quelques jours avant le NFP.",          a: 'Le NFP (de façon imparfaite)' },
    { k: 'JOLTS', full: 'Job Openings and Labor Turnover', d: 'Le nombre de postes à pourvoir.',                       a: "Salaires, tensions sur l'emploi" },
  ] },
  { name: 'CROISSANCE', accent: '#f3c344', lead: "L'activité réelle de l'économie. Trop chaud ou trop froid, tout se joue là.", items: [
    { k: 'PIB', full: 'Gross Domestic Product (GDP)', d: 'La richesse totale produite par le pays.',                  a: 'Politique Fed, bénéfices des entreprises' },
    { k: 'Ventes au détail', full: 'Retail Sales',   d: "L'argent dépensé par les consommateurs.",                     a: 'Salaires, inflation, croissance' },
    { k: 'ISM Manufacturier', full: 'ISM Manufacturing PMI', d: "La santé des usines (industrie).",                    a: 'Croissance à venir' },
    { k: 'ISM Services', full: 'ISM Services PMI',   d: 'La santé des entreprises de services.',                       a: 'Croissance, emploi' },
  ] },
  { name: 'POLITIQUE MONÉTAIRE', accent: '#f3c344', lead: "La décision qui déplace tous les marchés d'un coup.", items: [
    { k: 'Décision de taux (FOMC)', full: 'Federal Open Market Committee', d: "La Fed fixe le niveau des taux d'intérêt.", a: 'Absolument tous les marchés' },
  ] },
];
// Glossaire indicateur -> phrase en clair (deduit de _DECRYPT_FAMILIES ci-dessus). Cle = libelle FR du desk.
const _INDIC_GLOSS = (() => { const g = {}; const map = { CPI: 'CPI', 'Core CPI': 'Core CPI', PCE: 'PCE', 'Core PCE': 'Core PCE', PPI: 'PPI', NFP: 'NFP', 'Taux de chomage': 'Taux de chômage', 'Salaire horaire': 'Salaire horaire', ADP: 'ADP', JOLTS: 'JOLTS', PIB: 'PIB', 'Ventes au detail': 'Ventes au détail', 'ISM Manufacturier': 'ISM Manufacturier', 'ISM Services': 'ISM Services', 'Décision de taux': 'Décision de taux (FOMC)' }; for (const fam of _DECRYPT_FAMILIES) for (const it of fam.items) g[it.k] = it.d; g['Décision de taux'] = "La banque centrale fixe le niveau des taux d'intérêt."; return g; })();

// ── BIBLIOTHEQUE DE CONCEPTS (Decryptage contextuel) — le moteur choisit le concept selon l'etat REEL du desk
// (theme dominant de la semaine deduit du calendrier live) et evite la redondance (recentKeys). 100% educatif.
const DECRYPT_CONCEPTS = [
  { key: 'taux-mecanisme', theme: 'rates', eyebrow: 'POLITIQUE MONÉTAIRE', title: 'Une décision de taux, et tout le marché bouge', paras: [
    "Quand une banque centrale change son taux directeur, elle change le prix de l'argent pour toute l'économie. Monter les taux freine le crédit et la consommation pour calmer l'inflation ; les baisser relance l'activité.",
    "Pour le marché, ce n'est pas tant la décision qui compte que la SURPRISE par rapport à ce qui était déjà anticipé, et surtout le TON du communiqué. Une banque qui laisse la porte ouverte à d'autres hausses (hawkish) soutient sa devise ; une banque qui temporise (dovish) l'affaiblit.",
    "C'est pour cela qu'un taux laissé inchangé peut quand même faire plonger ou bondir une devise : le marché lit entre les lignes, pas seulement le chiffre.",
  ] },
  { key: 'cpi-vs-core', theme: 'inflation', eyebrow: 'INFLATION', title: 'CPI et Core CPI : pourquoi la Fed regarde surtout le second', paras: [
    "Le CPI mesure la hausse des prix du panier complet de la ménagère. Le Core CPI en retire l'énergie et l'alimentation, deux postes très volatils qui bougent souvent pour des raisons extérieures (météo, pétrole).",
    "La Fed pilote sa politique sur la tendance de FOND de l'inflation, pas sur un pic d'essence passager. Le Core est donc sa vraie boussole, et le marché réagit parfois davantage au Core qu'au chiffre principal.",
    "La règle de lecture : un chiffre au-dessus des attentes pousse les anticipations de taux vers le haut (dollar plus fort, or et actions sous pression) ; en-dessous, c'est l'inverse.",
  ] },
  { key: 'inflation-taux', theme: 'inflation', eyebrow: 'INFLATION', title: "Pourquoi l'inflation fait bouger les taux et le dollar", paras: [
    "L'inflation, c'est la vitesse à laquelle les prix montent. Quand elle accélère, la banque centrale garde ou remonte ses taux pour la freiner ; quand elle ralentit, elle peut se permettre de les baisser.",
    "Or des taux plus élevés rendent une devise plus attractive à détenir. C'est le fil qui relie une simple statistique de prix au cours du dollar, de l'or et des indices.",
    "À retenir : sur une publication d'inflation, le marché compare le chiffre aux attentes, pas à zéro. Une inflation qui ralentit moins vite que prévu peut faire monter le dollar.",
  ] },
  { key: 'nfp-decode', theme: 'jobs', eyebrow: 'EMPLOI', title: 'NFP : le chiffre qui fait trembler le dollar', paras: [
    "Les Non-Farm Payrolls comptent les emplois créés le mois passé hors agriculture. C'est le thermomètre le plus suivi du marché du travail américain.",
    "Un marché de l'emploi solide donne à la Fed la liberté de garder des taux élevés pour combattre l'inflation. Un marché qui se fissure ouvre la voie à des baisses de taux, et pèse sur le dollar.",
    "À lire ensemble : le taux de chômage et le salaire horaire, publiés en même temps. Des salaires qui accélèrent, c'est de l'inflation future en germe.",
  ] },
  { key: 'salaires', theme: 'jobs', eyebrow: 'EMPLOI', title: 'Les salaires : le carburant caché de l\'inflation', paras: [
    "Le salaire horaire moyen mesure la vitesse à laquelle les rémunérations montent. C'est un indicateur d'emploi, mais c'est surtout un signal d'inflation à venir.",
    "Quand les salaires grimpent vite, les ménages consomment plus et les entreprises répercutent leurs coûts sur les prix : l'inflation se nourrit d'elle-même. La banque centrale surveille cela de près.",
    "C'est pourquoi un bon chiffre d'emploi accompagné de salaires trop chauds peut être mal reçu par le marché : il éloigne les baisses de taux.",
  ] },
  { key: 'pmi-pib', theme: 'growth', eyebrow: 'CROISSANCE', title: 'PMI et PIB : lire la vitesse réelle de l\'économie', paras: [
    "Le PIB mesure toute la richesse produite par le pays, mais il arrive tard. Les PMI (indices des directeurs d'achat) sont des enquêtes mensuelles auprès des entreprises : ils donnent le pouls en temps quasi réel.",
    "Au-dessus de 50, l'activité progresse ; en-dessous, elle se contracte. Les services pèsent le plus lourd dans l'économie américaine, d'où l'importance de l'ISM Services.",
    "Une croissance trop faible fait craindre la récession ; trop forte, elle ravive l'inflation et retarde les baisses de taux. Le marché cherche le juste milieu.",
  ] },
  { key: 'ventes-detail', theme: 'growth', eyebrow: 'CROISSANCE', title: 'Ventes au détail : le pouls du consommateur', paras: [
    "La consommation des ménages représente l'essentiel de l'économie américaine. Les ventes au détail mesurent, chaque mois, l'argent réellement dépensé dans les magasins et en ligne.",
    "Des ventes robustes signalent une économie qui tient, ce qui soutient le dollar mais peut entretenir l'inflation. Des ventes en berne annoncent un ralentissement.",
    "C'est un indicateur précoce : il éclaire la croissance avant même que le PIB ne soit publié.",
  ] },
  { key: 'gestion-risque', theme: 'risk', eyebrow: 'GESTION DU RISQUE', title: 'Semaine chargée : pourquoi la gestion du risque prime', paras: [
    "Dans les semaines denses en annonces, les marchés bougent vite et dans les deux sens. La tentation est de multiplier les positions ; c'est souvent l'erreur.",
    "Ceux qui durent ne cherchent pas à avoir raison à chaque coup : ils dimensionnent leurs positions pour survivre à une série de pertes. Le risque par position, pas la prévision, décide de qui reste en jeu.",
    "Un repère simple : savoir AVANT d'entrer où l'on a tort et combien on perd si c'est le cas. Le reste n'est que discipline.",
  ] },
  // ── Ajouts 28/07 (veille éditoriale : thèmes éducation macro non couverts — texte 100 % DTP) ──
  { key: 'divergence-bc', theme: 'rates', eyebrow: 'POLITIQUE MONÉTAIRE', title: 'Deux banques centrales, une paire : le vrai moteur des devises', paras: [
    "Une paire de devises met toujours DEUX économies face à face. Ce qui la fait tendre dans une direction sur des semaines, ce n'est pas une news isolée : c'est l'écart entre les trajectoires de leurs banques centrales.",
    "Quand l'une monte ses taux pendant que l'autre les baisse, l'argent migre vers le rendement le plus élevé. Cette divergence de politique crée les tendances les plus longues et les plus lisibles du marché des changes.",
    "La règle de lecture : comparez toujours les DEUX côtés de la paire. Une devise « faible » face à une banque centrale ferme peut être « forte » face à une banque qui capitule : c'est l'écart qui compte, pas l'absolu.",
  ] },
  { key: 'courbe-taux', theme: 'rates', eyebrow: 'TAUX', title: 'La courbe des taux : le thermomètre que le marché lit en premier', paras: [
    "La courbe des taux compare ce que rapporte un emprunt d'État à 2 ans et à 10 ans. Normalement, prêter plus longtemps rapporte plus : la courbe monte.",
    "Quand le court terme rapporte PLUS que le long terme, la courbe s'inverse : le marché dit qu'il s'attend à des baisses de taux, donc à un ralentissement, voire une récession. Historiquement, ce signal a précédé la plupart des récessions américaines.",
    "La règle de lecture : une courbe qui se re-pentifie après inversion accompagne souvent le début du cycle de baisses ; le dollar et les actions n'y réagissent pas de la même façon selon que la re-pentification vient du court (baisses imminentes) ou du long (croissance qui revient).",
  ] },
  { key: 'intervention-japon', theme: 'risk', eyebrow: 'CHANGES', title: 'Intervention de change : quand un État défend sa monnaie', paras: [
    "Quand une devise chute trop vite, le ministère des Finances peut ordonner d'en acheter massivement pour casser le mouvement. Le Japon est le cas d'école : ses interventions sur le yen font bouger USD/JPY de plusieurs figures en minutes.",
    "Une intervention ne se décrète jamais à l'avance : mais elle se devine : avertissements verbaux répétés (« nous surveillons avec la plus grande attention »), niveaux psychologiques, volatilité désordonnée. Le marché appelle ça l'escalade verbale.",
    "La règle de lecture : l'intervention gagne une bataille, rarement la guerre, si l'écart de taux qui affaiblissait la devise persiste, le mouvement de fond finit souvent par reprendre. Elle définit surtout un niveau que l'État ne veut pas voir franchi trop vite.",
  ] },
  { key: 'or-taux-reels', theme: 'inflation', eyebrow: 'MÉTAUX', title: "Pourquoi l'or vit au rythme des taux réels", paras: [
    "L'or ne verse ni intérêt ni dividende. Le détenir « coûte » donc ce que rapporterait un placement sûr à la place : le taux d'intérêt RÉEL, c'est-à-dire le taux après inflation.",
    "Quand les taux réels montent, garder de l'or devient plus coûteux et il baisse souvent ; quand ils chutent : inflation qui dépasse les taux, ou banque centrale qui baisse, , l'or redevient attractif et monte.",
    "La règle de lecture : suivez le rendement américain à 10 ans moins l'inflation anticipée. Un dollar faible amplifie la hausse de l'or ; un dollar fort la freine : les deux forces se lisent ensemble.",
  ] },
  { key: 'petrole-devises', theme: 'growth', eyebrow: 'MATIÈRES PREMIÈRES', title: 'Pétrole et devises : qui gagne, qui perd quand le baril bouge', paras: [
    "Certains pays VENDENT du pétrole (Canada, Norvège), d'autres l'ACHÈTENT massivement (Japon, zone euro). Quand le baril monte, les premiers encaissent plus de revenus : leur devise en profite ; les seconds paient une facture énergétique plus lourde : leur devise en souffre.",
    "C'est pourquoi le dollar canadien suit souvent le WTI, et pourquoi un choc pétrolier pèse structurellement sur le yen et l'euro. La corrélation n'est pas mécanique au jour le jour, mais elle structure les tendances.",
    "La règle de lecture : sur un mouvement du pétrole, demandez-vous QUI exporte et QUI importe, et rappelez-vous qu'un baril durablement plus cher nourrit aussi l'inflation, donc les anticipations de taux.",
  ] },
  { key: 'risk-on-off', theme: 'risk', eyebrow: 'SENTIMENT', title: 'Risk-on / risk-off : la boussole du marché', paras: [
    "En risk-on, les investisseurs cherchent le rendement : les actions et les devises pro-cycliques (dollar australien, néo-zélandais, canadien) montent, les valeurs refuges reculent.",
    "En risk-off, ils cherchent la sécurité : dollar américain, yen, franc suisse et or se renforcent, les actions souffrent.",
    "Savoir dans quel régime on se trouve évite de se battre contre le courant dominant du marché. C'est l'une des premières lectures du desk chaque matin.",
  ] },
];
// Selection PURE : choisit le concept selon le theme du contexte, en sautant les cles couvertes recemment.
function pickDecryptConcept(context, recentKeys, extraConcepts) {
  recentKeys = Array.isArray(recentKeys) ? recentKeys : [];
  // AUTONOMIE (10/08, même politique que le Mindset) : le pool = catalogue statique + concepts GÉNÉRÉS
  // PAR IA (KV campaign:decrypt-ai, côté server). Les concepts IA portent leur propre thème et
  // rejoignent la rotation définitivement.
  const ALL = [...DECRYPT_CONCEPTS, ...(Array.isArray(extraConcepts) ? extraConcepts : [])];
  const theme = (context && context.theme) || 'calm';
  const byTheme = {}; for (const c of ALL) (byTheme[c.theme] = byTheme[c.theme] || []).push(c);
  const order = { rates: ['rates', 'inflation', 'jobs'], inflation: ['inflation', 'jobs', 'growth'], jobs: ['jobs', 'inflation', 'growth'], growth: ['growth', 'jobs', 'risk'], risk: ['risk', 'growth', 'inflation'], calm: ['inflation', 'growth', 'jobs', 'risk', 'rates'] }[theme] || ['inflation', 'growth'];
  for (const th of order) { const cands = byTheme[th] || []; const fresh = cands.find(c => !recentKeys.includes(c.key)); if (fresh) return { concept: fresh, theme }; }
  // tout couvert recemment -> reprend le 1er du theme (mieux vaut un rappel pertinent qu'un hors-sujet)
  const cands = byTheme[theme] || byTheme.inflation || ALL; return { concept: cands[0], theme };
}

// CTA adapte MEMBRE / NON-MEMBRE (validation user : tout le monde recoit, contenu adapte).
// Le bloc PS a ete RETIRE des templates (demande user) ; la mention informative vit desormais,
// discrete, dans le footer du layout (_campaignLayout).
function _campaignCta(isMember, campaign, email, libelle) {
  const url = trackClickUrl(campaign, email, LANDING_URL);
  // libelle : permet un bouton INTERMÉDIAIRE propre au sujet du mail (cf. mindset). Sans lui, on
  // garde le libellé produit habituel.
  if (libelle) return { btn: _campaignBtn(libelle, url), url };
  if (isMember) return { btn: _campaignBtn('Ouvrir mon Desk', url), url };
  return { btn: _campaignBtn('Découvrir le Desk en direct', url), url };
}
// Petite liste "temps forts a surveiller" (donnees calendrier REELLES). ev = { dayLabel, time, ccy, title, forecast, previous, indicator }.
function _watchRows(events) {
  return (events || []).slice(0, 4).map(ev => {
    const gloss = ev.indicator && _INDIC_GLOSS[ev.indicator] ? `<div style="color:#8b93a1;font-size:12px;line-height:1.45;margin-top:2px;">${_esc(_INDIC_GLOSS[ev.indicator])}</div>` : '';
    const vals = [];
    if (ev.forecast) vals.push(`prév. <strong style="color:#cbd5e1;">${_esc(ev.forecast)}</strong>`);
    if (ev.previous) vals.push(`préc. ${_esc(ev.previous)}`);
    const valLine = vals.length ? `<div style="color:#9aa3b2;font-size:12px;margin-top:2px;">${vals.join(' &middot; ')}</div>` : '';
    return `<tr><td style="padding:9px 0;border-top:1px solid #1f1f24;">
      <div>
        <span style="color:#f3c344;font-weight:700;font-size:12px;">${_esc(ev.dayLabel || '')}${ev.time ? ' ' + _esc(ev.time) : ''}</span>
        <span style="color:#6b7280;font-size:12px;">&nbsp;&middot;&nbsp;${_esc(ev.ccy || '')}</span>
        <span style="color:#ffffff;font-weight:600;font-size:13.5px;">&nbsp;&nbsp;${_esc(ev.title || '')}</span>
      </div>${gloss}${valLine}
    </td></tr>`;
  }).join('');
}

// Bloc « ce que publient les grandes banques » — feed Institution REEL du desk (context.bankNotes = _brCache).
// Attribue (banque + titre + date UNIQUEMENT) : sources publiques, aucune reproduction du texte proprietaire.
function _bankNotesBlock(notes) {
  if (!Array.isArray(notes) || !notes.length) return '';
  const rows = notes.slice(0, 4).map(n => `<tr><td style="padding:9px 0;border-top:1px solid #1f1f24;">
      <span style="color:#f3c344;font-weight:700;font-size:12.5px;">${_esc(n.institution)}</span>${n.ago ? `<span style="color:#6b7280;font-size:12px;">&nbsp;&middot;&nbsp;${_esc(n.ago)}</span>` : ''}
      <div style="color:#e6e6ea;font-size:13.5px;line-height:1.5;margin-top:2px;">${_esc(n.title)}</div>
    </td></tr>`).join('');
  return `<p style="margin:20px 0 6px;">Ce que publient les grandes banques en ce moment&nbsp;:</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    <p style="margin:8px 0 0;font-size:12.5px;color:#7b828f;">Les notes complètes (Goldman Sachs, ING, Scotiabank&hellip;) se lisent en entier sur le <strong style="color:#9aa3b2;">Desk</strong>.</p>`;
}
// ══════════════════════════════════════════════════════════════════════════════
//  RÉCAP QUOTIDIEN : LE RAPPORT ENTIER DANS LE MAIL (24/08)
//  Demande user : « on offre le récap du jour du desk dans le template pour offrir
//  cette valeur ». Ce n'est donc plus un APERÇU qui renvoie au desk : le mail EST le
//  rapport. Source = `daily.full`, l'objet _fxr COMPLET posé par server.js (l.20681)
//  et jusqu'ici lu NULLE PART : tout ce que `sections` n'avait pas recopié était perdu
//  avant même d'arriver au mail.
//  ORDRE DU DESK (public/js/app.js, _renderFXDailyRecap), repris tel quel :
//    Synthèse · Géopolitique (+ points clés à retenir) · Banques centrales · Macro ·
//    Données du jour (rétro-compat) · Analyse par session (+ données publiées) · À surveiller.
//  ⚠️ LES INTITULÉS SONT CEUX DU DESK, MOT POUR MOT (25/08, demande user « il faut que ce soit
//  tout pareil »). Ils avaient été raccourcis le 24/08 au nom d'une doctrine « deux mots » :
//  « Analyse par session » écrit « Les séances », « Données du jour » « Par pays », « Points
//  clés à retenir » « Points clés ». Le lecteur voyait donc, dans un mail qui annonce le récap
//  du desk, des rubriques qui ne portent pas le nom qu'elles portent sur le desk. La demande
//  d'identité l'emporte : les intitulés d'origine sont rétablis.
//  ⚠️ `watch` et `corporate` valent [] EN DUR depuis le 24/08 (server.js 11315 / 11334) :
//     ne JAMAIS les rendre. `comments` et `notableCommentsHtml` ne sont plus rendus par le
//     desk depuis le 11/08 : le mail est le miroir du desk, il ne les rend pas non plus.
// ══════════════════════════════════════════════════════════════════════════════

/* ══ BRIQUES DU RÉCAP QUOTIDIEN, CALQUÉES SUR LE DESK (25/08, demande user « il faut que ce soit
   tout pareil ») ══
   Chaque fonction ci-dessous est le miroir d'une classe de `public/css/style.css`, valeur par
   valeur. Elles ne servent QUE le Récap Quotidien : les briques génériques des mails
   (`_ssTitre`, `_puceOr`, `_secTitle`) restent en place pour les autres gabarits, qui ne
   copient pas le desk et n'ont aucune raison de bouger. */

// Miroir de `_ccyWho` (app.js 8964) : on nomme la DEVISE, jamais le pays, sauf pour l'euro
// quand un pays PRÉCIS a publié (« EUR · Allemagne » dit lequel des dix-neuf, « EUR » seul non).
function _ccyWhoMail(ccy, pays) {
  const c = String(ccy == null ? '' : ccy).trim().toUpperCase();
  const p = _md(pays);
  if (!c) return p;
  if (c === 'EUR' && p && !/^zone\s*euro$/i.test(p)) return 'EUR · ' + p;
  return c;
}
// Miroir de `_wrInline` (app.js 8973) : le **gras** du rapport devient un vrai <strong> BLANC
// semi-gras (`.wr-bullet strong`, style.css 5486), les entités pré-échappées sont décodées
// (« S&amp;P » redevient « S&P ») et toute astérisque résiduelle disparaît. `_md`, lui, rasait
// les astérisques SANS les convertir : la mise en valeur voulue par le rapport était perdue en
// silence, la puce sortait tout en gris.
function _wrInlineMail(t) {
  let s = (typeof t === 'string' ? t : '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');
  s = s.replace(/^\s*\*\*\s*sous-th[eè]me\s*:?\s*\*\*\s*:?\s*/i, '').replace(/^\s*sous-th[eè]me\s*:\s*/i, '');
  return _esc(s).replace(/\*\*(.+?)\*\*/g, '<strong style="color:#ffffff;font-weight:600;">$1</strong>').replace(/\*+/g, '');
}
/* Paragraphes du rapport, calés sur `.wr-p` : la DERNIÈRE marge est remise à zéro comme le fait
   `.fxdr-exec .wr-p:last-child` (style.css 6118). Sans cela l'encadré or de la Synthèse se
   refermait douze pixels sous son texte, alors que sur le desk il se ferme au ras. */
function _parasDesk(txt, col, size, mb) {
  const bl = _paraBlocs(txt);
  return bl.map((p, i) => `<p style="margin:0 0 ${i === bl.length - 1 ? '0' : (mb || '9px')};font-size:${size || '13px'};line-height:1.7;color:${col || '#e3e3e6'};">${_wrInlineMail(p)}</p>`).join('');
}
/* Puces de lecture = `.wr-bullet` (style.css 5484) : point or à x=0, texte à x=14, 13 px, encre
   #c9d1d9, interligne 1.7, 10 px sous chaque puce. Rendu en TABLE à deux cellules et non en
   `text-indent` négatif : le desk pose son point en `::before` ABSOLU, donc le texte commence
   toujours au même x quelle que soit la largeur du glyphe. Une cellule de 14 px donne exactement
   la même colonne, et elle tient dans Outlook, qui rend mal les retraits négatifs.
   `gras` = la variante « Points clés à retenir », dont les puces sont semi-grasses
   (`.fxdr-keypts .wr-bullet`, style.css 18677). */
function _pucesDesk(items, gras) {
  const l = (Array.isArray(items) ? items : []).filter(Boolean);
  if (!l.length) return '';
  const tds = 'padding:0 0 10px;font-size:13px;line-height:1.7;';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 4px;">`
    + l.map(h => `<tr><td width="14" valign="top" style="width:14px;${tds}color:${TOK.or};">&bull;</td>`
      + `<td valign="top" style="${tds}color:#c9d1d9;${gras ? 'font-weight:600;' : ''}">${h}</td></tr>`).join('')
    + `</table>`;
}
/* Sous-titre INTERNE = `.fxdr-grp-title` (style.css 6148) : 10 px, capitales, gris #7d7d86,
   interlettrage .06em. C'est le SEUL second niveau du rapport : il coiffe « Points clés à
   retenir », « Données publiées » et les familles d'indicateurs. Le générique `_ssTitre` des
   mails (11 px, presque blanc) en faisait un titre plus fort que sur le desk.
   `filet` = la variante « Points clés à retenir » (`.fxdr-keypts-t`, style.css 18676) : filet fin
   au-dessus et marge haute réduite à 8 px. Le filet du desk est un blanc à 5,5 % : mélangé au
   fond, il devient une valeur pleine que tous les clients rendent. */
function _grpTitre(t, filet) {
  const bord = filet ? `margin:8px 0 7px;padding-top:7px;border-top:1px solid ${_melange('#ffffff', .055, TOK.panneau)};` : 'margin:13px 0 7px;';
  return `<div style="${bord}color:#7d7d86;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">${_esc(t)}</div>`;
}
/* Carte de séance / de pays = `.fxdr-card` (style.css 6134) : bordure fine, liseré or à gauche,
   coins 4 px, 14/16 px de marge intérieure.
   ⚠️ LE FOND, ET POURQUOI IL N'EST PAS COPIÉ TEL QUEL. Le desk peint sa carte en `--bg2` #16171b
   POSÉE SUR la page `--bg` #0d0e11 : c'est l'écart entre les deux qui détache la carte. Or le
   panneau du mail vaut DÉJÀ #16171b (TOK.panneau) : recopier la valeur donnerait un fond
   strictement identique au sien, donc une carte sans relief, l'inverse de ce que le desk montre.
   La carte prend donc le cran suivant de la MÊME échelle, l'encart du mail #101014, et retrouve
   exactement le détachement d'origine. */
const _carteDesk = inner => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:${TOK.encart};border:1px solid #1f1f24;border-left:3px solid ${_melange(TOK.or, .6, TOK.panneau)};border-radius:4px;">
  <tr><td style="padding:14px 16px;">${inner}</td></tr></table>`;
/* Empilement des cartes. `.fxdr-grid` est une grille CSS (deux colonnes sur un écran large,
   gouttière de 12 px) : ni `grid` ni `flex` n'existent en courrier. L'empilement vertical est
   l'équivalent EXACT du desk sous 720 px, gouttière comprise, posée ici en rangée d'espacement. */
const _grilleDesk = cartes => cartes.filter(Boolean).map((c, i) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">`
  + (i ? `<tr><td height="12" style="height:12px;line-height:12px;font-size:0;">&nbsp;</td></tr>` : '')
  + `<tr><td>${c}</td></tr></table>`).join('');
/* En-tête de carte = `.fxdr-region-head` : nom de séance (14 px, 700, #f3f3f5) puis, s'il existe,
   UNE pastille portant toute la chaîne de codes (« JPY · AUD · NZD · CNY »), pas une par devise.
   Rendu en table à trois cellules : la troisième, élastique, pousse le couple à gauche comme le
   fait `justify-content` par défaut d'un flex. */
function _teteCarte(nom, code) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 8px;"><tr>`
    + `<td valign="middle" style="font-size:14px;font-weight:700;color:#f3f3f5;line-height:1.3;">${_esc(nom)}</td>`
    + (code ? `<td width="8" style="width:8px;font-size:0;line-height:0;">&nbsp;</td>`
      + `<td valign="middle"><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;"><tr>`
      + `<td bgcolor="#1a1a1f" style="background:#1a1a1f;border:1px solid ${TOK.filet};border-radius:4px;padding:1.5px 6px;font-size:10px;color:#a2a2aa;white-space:nowrap;line-height:1.4;">${_esc(code)}</td>`
      + `</tr></table></td>` : '')
    + `</tr></table>`;
}
/* « Données publiées » = les LIGNES `.fxdr-data` du desk (app.js 10021), et non un tableau.
   Le mail en faisait une table à quatre colonnes COIFFÉE D'UN EN-TÊTE que le desk n'affiche
   jamais, tandis que « À surveiller », qui en a un sur le desk, n'en avait pas : le rapport
   était exactement inversé. Chaque donnée redevient donc une ligne de lecture continue :
   badge d'heure or, devise et libellé en gras, deux points, le réel coloré, puis « attendu » et
   « préc. » ÉCRITS EN TOUTES LETTRES (le mail abrégeait en « att. »), puis la lecture derrière
   sa flèche. Ce que le courrier ne peut pas porter, et qui n'est pas de l'information : le clic
   qui déroule le Décryptage, son chevron et l'état de survol. */
function _lignesDonnees(rows) {
  const l = (Array.isArray(rows) ? rows : []).filter(r => r && r.label);
  if (!l.length) return '';
  const badge = `display:inline-block;min-width:38px;font-size:10.5px;font-weight:700;color:${TOK.or};background:${_melange(TOK.or, .12, TOK.encart)};border:1px solid ${_melange(TOK.or, .28, TOK.encart)};border-radius:3px;padding:0 4px;margin-right:4px;letter-spacing:.02em;text-align:center;`;
  return l.map(d => {
    const titre = _md(d.label || d.title);
    const cls = _cvCol(d.actual, d.forecast, titre);
    const heure = _num(d.t), reel = _num(d.actual), att = _num(d.forecast), pre = _num(d.previous);
    const qui = _ccyWhoMail(d.ccy, d.country);
    // Miroir du desk jusque dans les manques : un réel absent laisse un gras VIDE (aucun tiret de
    // remplacement à cet endroit), et un « attendu » ou un « préc. » absent fait disparaître le
    // morceau ENTIER, séparateur compris. Rien n'est inventé pour combler.
    const nums = [`<b style="${cls ? `color:${cls};` : ''}">${_esc(reel)}</b>`,
      att ? 'attendu ' + _esc(att) : '', pre ? 'préc. ' + _esc(pre) : ''].filter(Boolean).join(' &middot; ');
    const lean = _md(d.lean);
    return `<div style="padding:5px 9px;margin:3px 0;color:#c8ccd4;font-size:12.5px;line-height:1.5;">`
      + (heure ? `<span style="${badge}">${_esc(heure)}</span> ` : '')
      + `<strong>${qui ? _esc(qui) + ' &middot; ' : ''}${_esc(titre)}</strong> : ${nums}`
      + (lean ? ` <span style="color:${cls || '#9aa4b2'};">&rarr; ${_esc(lean)}</span>` : '')
      + `</div>`;
  }).join('');
}
/* ÉTIQUETTES DU RAPPORT = la rangée `.arlib-rtag` du lecteur (app.js 9910, style.css 5280) :
   « Fed », « BoJ », « PMI », « Géopolitique Moyen-Orient »... Le mail n'en portait aucune. Elles
   ne répètent rien : ce sont les thèmes de la journée, lus d'un coup d'oeil avant le texte, et
   elles font partie du rapport (`_fxr.tags`), pas du décor du lecteur. Même traitement qu'au
   desk : on éclate sur les virgules et points-virgules, on écarte les étiquettes de service
   (`_ARLIB_TAG_HIDE`) et on met la première lettre en capitale.
   Ne pas confondre avec le TITRE du rapport, retiré le 24/08 parce qu'il redisait mot pour mot
   la première phrase de la Synthèse : une étiquette ne redit aucune phrase. */
const _TAGS_MUETS = new Set(['fx flows', 'flux fx', 'energy & power', 'énergie', 'energie', 'global news', 'actualités mondiales', 'actualites mondiales']);
/* ÉTIQUETTES COURTES (24/08, demande user sur pièce). L'IA écrit les thèmes en toutes lettres —
   « Rachat de bons du Trésor américain », « Ventes au détail néo-zélandaises », « Sanctions
   américaines contre l'Iran » — et sept étiquettes prenaient TROIS LIGNES sous la date. Or une
   étiquette se SCANNE, elle ne se lit pas : trois lignes de thèmes avant le texte, c'est un
   paragraphe de plus, pas un repère.
   Raccourci par RÈGLES DÉTERMINISTES, jamais par troncature : couper « Politique monétai… »
   serait pire que long. Trois passes dans cet ordre — gentilé → code court, tournure longue →
   forme courte, puis retrait des mots de liaison devenus inutiles. Une étiquette déjà courte
   ressort intacte, et si les règles la vidaient on garde l'originale : mieux vaut une étiquette
   longue qu'une étiquette fausse. */
const _TAG_GENTILE = [
  [/\b[ée]tats[-\s]unis\b/gi, 'US'], [/\bam[ée]ricain(?:e|s|es)?\b/gi, 'US'],
  [/\bbritanniques?\b/gi, 'UK'], [/\bn[ée]o[-\s]?z[ée]landais(?:e|es)?\b/gi, 'NZ'],
  [/\bcanadien(?:ne|s|nes)?\b/gi, 'Canada'], [/\baustralien(?:ne|s|nes)?\b/gi, 'Australie'],
  [/\bjaponais(?:e|es)?\b/gi, 'Japon'], [/\bchinois(?:e|es)?\b/gi, 'Chine'],
  [/\beurop[ée]en(?:ne|s|nes)?\b/gi, 'Europe'], [/\ballemand(?:e|s|es)?\b/gi, 'Allemagne'],
  [/\bfran[çc]ais(?:e|es)?\b/gi, 'France'], [/\bsuisses?\b/gi, 'Suisse'],
];
const _TAG_COURT = [
  [/\bpolitique mon[ée]taire\b/gi, 'Politique'], [/\bbons du tr[ée]sor\b/gi, 'Trésor'],
  [/\bventes au d[ée]tail\b/gi, 'Ventes détail'], [/\bguerre commerciale\b/gi, 'Commerce'],
  [/\bmarch[ée] du travail\b/gi, 'Emploi'], [/\btaux d['’]int[ée]r[êe]t\b/gi, 'Taux'],
  [/^prix (?:du|de la|des|de l['’])\s*/i, ''],
  [/\s+(?:contre|envers|vis-à-vis de)\s+/gi, ' '],
  [/\s+(?:de la|de l['’]|des|du|de|aux|au|à la)\s+/gi, ' '],
  [/\bl['’]/gi, ''],
];
function _tagCourt(s) {
  let t = s;
  [_TAG_GENTILE, _TAG_COURT].forEach(regles => regles.forEach(([rx, par]) => { t = t.replace(rx, par); }));
  t = t.replace(/\s{2,}/g, ' ').trim();
  return t.length >= 2 ? t : s;   // une règle qui vide l'étiquette n'a pas lieu de s'appliquer
}
function _tagsRapport(tags) {
  const l = (Array.isArray(tags) ? tags : []).flatMap(t => String(t == null ? '' : t).split(/\s*[,;]\s*/))
    .map(s => s.trim()).filter(s => s && !_TAGS_MUETS.has(s.toLowerCase()))
    .map(_tagCourt)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1));
  if (!l.length) return '';
  return `<p style="margin:0 0 14px;line-height:2;">` + l.map(t =>
    `<span style="display:inline-block;font-size:11px;font-weight:500;color:#a3a3a3;background:#141416;border:1px solid #262626;border-radius:4px;padding:2px 10px;margin:0 6px 0 0;white-space:nowrap;">${_esc(t)}</span>`).join('') + `</p>`;
}
/* Ligne d'indicateur du bloc « Données du jour » = `.wr-bullet.wr-cat` (app.js 9995) : une PUCE,
   pas une ligne de tableau. Le libellé est en blanc semi-gras, le réel aussi (`.wr-cat b`,
   style.css 5459) sauf quand l'écart au consensus le colore, et la lecture ferme la puce derrière
   sa flèche, en gris #9aa4b2 (`.wr-cat-impact`) ou dans la couleur de l'écart. */
function _puceCat(p) {
  const titre = _md(p.label || p.title);
  const cls = _cvCol(p.actual, p.forecast, titre);
  const att = _num(p.forecast), pre = _num(p.previous);
  const nums = [`<b style="color:${cls || '#ffffff'};font-weight:600;">${_esc(_num(p.actual))}</b>`,
    att ? 'attendu ' + _esc(att) : '', pre ? 'préc. ' + _esc(pre) : ''].filter(Boolean).join(' &middot; ');
  const lean = _md(p.lean);
  return `<strong style="color:#ffffff;font-weight:600;">${_esc(titre)}</strong> : ${nums}`
    + (lean ? ` <span style="color:${cls || '#9aa4b2'};">&rarr; ${_esc(lean)}</span>` : '');
}

// Tableau SOBRE de publications (4 colonnes MAXIMUM, contrainte mobile) : heure + devise,
// libellé (+ pays et lecture), réel, attendu/précédent.
// ⚠️ RÉSERVÉ AU CHEMIN DE REPLI `_recapQuotidienSections` (rapports en cache d'avant le 24/08,
// et Point Marché `kind:'dtpd'`), qui n'a ni heure de sortie ni structure de séance à mirer.
// Le Récap Quotidien complet, lui, passe désormais par `_lignesDonnees`, calqué sur le desk.
// Le RÉEL reste en BLANC : le colorer supposerait de connaître la polarité de chaque
// indicateur (un chômage plus BAS est une BONNE surprise). La lecture honnête, c'est le
// `lean` que le rapport a déjà calculé, écrit en toutes lettres sous le libellé.
function _tabPublications(rows, entete1) {
  const l = (Array.isArray(rows) ? rows : []).filter(r => r && r.label);
  if (!l.length) return '';
  const th = (t, right) => `<td${right ? ' align="right"' : ''} style="padding:5px 6px;color:#8b93a1;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid ${TOK.filet};">${t}</td>`;
  const corps = l.map(r => {
    // _num, pas la véracité JS : un réel « 0 » est une VALEUR, un champ absent est vide.
    const heure = _num(r.t), dev = _num(r.ccy), reel = _num(r.actual), att = _num(r.forecast), pre = _num(r.previous);
    const pays = _md(r.country), lean = _md(r.lean);
    return `<tr>
      <td style="padding:7px 6px;border-top:1px solid ${TOK.filet2};white-space:nowrap;vertical-align:top;">
        ${heure ? `<div style="color:${TOK.or};font-weight:700;font-size:11.5px;">${_esc(heure)}</div>` : ''}
        ${dev ? `<div style="font-size:11px;${heure ? 'margin-top:2px;' : ''}">${_ccyFlag(dev)}</div>` : ''}
      </td>
      <td style="padding:7px 6px;border-top:1px solid ${TOK.filet2};color:#e6e6ea;font-size:12.5px;line-height:1.45;">${_esc(_md(r.label))}${(pays || lean) ? `<div style="color:${TOK.grisDoux};font-size:11px;margin-top:2px;">${_esc(pays)}${(pays && lean) ? ' · ' : ''}${_esc(lean)}</div>` : ''}</td>
      <td align="right" style="padding:7px 6px;border-top:1px solid ${TOK.filet2};color:${TOK.blanc};font-weight:700;font-size:12.5px;white-space:nowrap;vertical-align:top;">${reel ? _esc(reel) : '·'}</td>
      <td align="right" style="padding:7px 6px;border-top:1px solid ${TOK.filet2};color:${TOK.gris};font-size:11px;white-space:nowrap;vertical-align:top;">${att ? 'att. ' + _esc(att) : ''}${(att && pre) ? '<br>' : ''}${pre ? 'préc. ' + _esc(pre) : ''}${(!att && !pre) ? '·' : ''}</td>
    </tr>`;
  }).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0 10px;">
    <tr>${th(entete1 || 'Heure')}${th('Publication')}${th('Réel', true)}${th('Att. / préc.', true)}</tr>${corps}</table>`;
}

/* POINTS D'IMPACT ●●● = `calImpDots` (charts.js 3919) : les trois points sont TOUJOURS dessinés,
   les inactifs estompés. La colonne manquait ENTIÈREMENT au mail (mesure : zéro occurrence du
   caractère ● dans tout le HTML), alors que le desk la remplit sur chaque ligne et que les deux
   événements du rapport du 21/08 sont en importance haute. Elle tient sans peine dans 600 px :
   son absence perdait le niveau d'importance, qui est la première chose qu'on lit d'un agenda.
   `opacity` n'existant pas chez Outlook, les points éteints sont pré-mélangés au fond. */
function _impPoints(imp, fond) {
  const l = String(imp || '').toLowerCase();
  const enveloppe = (col, dedans) => `<span style="color:${col};font-size:10px;letter-spacing:2.5px;white-space:nowrap;">${dedans}</span>`;
  if (l === 'high') return enveloppe('#ef4444', '&#9679;&#9679;&#9679;');
  if (l === 'medium') return enveloppe('#ffb300', `&#9679;&#9679;<span style="color:${_melange('#ffb300', .2, fond)};">&#9679;</span>`);
  // Tout le reste, VIDE COMPRIS, tombe en « low » : c'est déjà le repli du desk.
  return enveloppe('#4ade80', `&#9679;<span style="color:${_melange('#4ade80', .2, fond)};">&#9679;&#9679;</span>`);
}

/* « À surveiller » = LE CALENDRIER DU DESK, déroulé (app.js 10058). Le rapport a supprimé ses
   puces narratives le 24/08 : la rubrique EST le tableau.
   ══ CE QUI CHANGE LE 25/08 (demande user « tout pareil ») ══
   1. RANGÉE D'EN-TÊTE. Le desk nomme ses dix colonnes ; le mail n'en nommait aucune, et le
      lecteur voyait « prév. 87.2 / préc. 86.6 » sans savoir que Réel, Haut et Bas existaient.
   2. COLONNE D'IMPACT, purement et simplement absente jusqu'ici.
   3. VALEUR MANQUANTE = TIRET, comme `.cv-empty` (app.js 10063). Le mail effaçait la référence
      absente : les cinq colonnes du desk n'étaient plus reconnaissables. Un rendez-vous sans
      aucun chiffre (des minutes de banque centrale) affiche donc cinq tirets, exactement comme
      sur le desk, au lieu d'un point médian solitaire.
   4. RÉFÉRENCES ÉCRITES EN TOUTES LETTRES : « Haut », « Prévision », « Bas », « Précédent »,
      c'est-à-dire les intitulés de colonnes du desk, à la place des « prév. » et « bas » abrégés.
   5. MÉTRIQUE DES LIGNES (`.fxdr-callike .cal-row td`, style.css 6182) : 8/11 px de marge
      intérieure, filet bas #131316, dernière ligne sans filet. Et la HIÉRARCHIE du desk, qui
      était inversée : l'heure y est un repère discret (gris moyen, 11 px, graisse 500) et c'est
      le LIBELLÉ qui domine (blanc, 12 px, semi-gras). Le mail faisait de l'heure l'élément le
      plus fort de la ligne.
   6. CADRE de la rubrique (`.fxdr-callike`) : le tableau coulait à même le fond.
   Ce qui ne peut pas suivre, et pourquoi : les CINQ colonnes de valeurs restent empilées dans
   une seule cellule (à 390 px, sept colonnes de chiffres écrasent le libellé de l'événement,
   et le défilement horizontal du desk n'existe pas en courrier) ; le clic qui déroule le
   Décryptage, son chevron, son infobulle et l'en-tête collant disparaissent, faute de JS et de
   `position:sticky`. Aucune information n'est perdue dans l'opération. */
function _tabAgendaFXR(rows) {
  const l = (Array.isArray(rows) ? rows : []).filter(r => r && r.event);
  if (!l.length) return '';
  const _fmt = (ts, opts) => { try { return new Intl.DateTimeFormat('fr-FR', Object.assign({ timeZone: 'Europe/Paris' }, opts)).format(new Date(ts)); } catch (e) { return ''; } };
  // Tri défensif : les lignes sans horodatage passent en fin plutôt que de casser la chronologie.
  const tri = l.slice().sort((a, b) => (a.ts ? a.ts : 8.64e15) - (b.ts ? b.ts : 8.64e15));
  const FOND = TOK.encart;                                     // fond du cadre, sert aux mélanges
  const VIDE = '<span style="color:#6b7280;">-</span>';        // `.cv-empty` du desk
  // En-tête : `.cal-table thead th` (style.css 7388) : 11 px, semi-gras, capitales, gris --text2
  // sur le fond d'en-tête --head-bg, filet bas --border. Le collant en moins, rien d'autre.
  const TH = (t, droite) => `<td align="${droite ? 'right' : 'left'}" bgcolor="#101012" style="background:#101012;color:#9a9aa4;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;line-height:14px;padding:8px 11px 7px;border-bottom:1px solid ${TOK.filet};white-space:nowrap;">${t}</td>`;
  let out = '';
  let jourVu = '';
  tri.forEach((e, i) => {
    // Une ligne SANS horodatage ne doit pas hériter du dernier séparateur de jour : elle
    // serait annoncée à une date que la donnée ne dit pas. Elle a son propre intertitre.
    const j = e.ts ? _fmt(e.ts, { weekday: 'long', day: 'numeric', month: 'long' }) : 'Date à confirmer';
    if (j && j !== jourVu) { jourVu = j; out += _trJour(j, 4); }
    const heure = e.ts ? _fmt(e.ts, { hour: '2-digit', minute: '2-digit' }) : '-';
    const reel = _num(e.actual), haut = _num(e.high), att = _num(e.forecast), bas = _num(e.low), pre = _num(e.previous);
    // ÉCLAIR ⚡ du desk (`calActualCell`, charts.js 3957) : le réel est sorti SOUS l'estimation
    // basse. SVG en ligne, sans fichier ni dépendance, dans la couleur du résultat. Les clients
    // qui l'ignorent (Gmail retire la balise) gardent le chiffre, sa couleur et la ligne « Bas »
    // juste en dessous : le repère se perd, l'information non.
    const _f = v => parseFloat(String(v).replace(',', '.'));
    const eclair = (reel && bas && !isNaN(_f(reel)) && !isNaN(_f(bas)) && _f(reel) < _f(bas))
      ? '<svg width="9" height="13" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true" style="vertical-align:-2px;margin-right:4px;"><path d="M6.2 0 0 8.2h3.5L3.2 14l6.8-8.4H6.4L6.2 0z"/></svg>' : '';
    // Les quatre références portent les INTITULÉS DE COLONNES du desk, dans son ordre exact.
    // Attention au croisement à ne pas inverser : « Haut » lit e.high, « Bas » lit e.low.
    /* ⚠️ LES QUATRE RÉFÉRENCES TIENNENT SUR UNE LIGNE (24/08, demande user : « mets le même que
       le récap quotidien du desk, dans le template il y en a beaucoup »). Elles étaient empilées
       en `<br>`, donc CHAQUE rendez-vous occupait CINQ lignes : sur une journée chargée la
       rubrique devenait un mur. Le desk en fait des COLONNES de tableau, une ligne par événement ;
       un mail ne peut pas tenir dix colonnes sur mobile, mais il peut les mettre bout à bout.
       Et une référence VIDE ne s'écrit plus : en colonne, le tiret garde l'alignement ; en ligne,
       « Haut - » n'est que du bruit. Quand les quatre manquent, la cellule reste vide. */
    const ref = (lbl, v) => v ? `<span style="color:#9a9aa4;">${lbl}</span> <span style="color:#e8e8ea;">${_esc(v)}</span>` : '';
    const refs = [ref('Haut', haut), ref('Prévision', att), ref('Bas', bas), ref('Précédent', pre)]
      .filter(Boolean).join(' <span style="color:#3a3a42;">&middot;</span> ');
    const finDeTable = (i === tri.length - 1);
    const TD = `padding:8px 11px;${finDeTable ? '' : `border-bottom:1px solid #131316;`}vertical-align:top;`;
    out += `<tr>`
      + `<td style="${TD}white-space:nowrap;">`
        + `<div style="color:#9a9aa4;font-size:11px;font-weight:500;letter-spacing:.02em;">${_esc(heure)}</div>`
        + (e.ccy ? `<div style="font-size:11px;margin-top:3px;">${_ccyFlag(e.ccy)}</div>` : '')
      + `</td>`
      + `<td align="center" style="${TD}white-space:nowrap;">${_impPoints(e.importance, FOND)}</td>`
      + `<td style="${TD}color:#ffffff;font-size:12px;font-weight:600;line-height:1.35;padding-right:16px;">${_esc(_md(e.event))}</td>`
      + `<td align="right" style="${TD}font-size:11px;line-height:1.55;white-space:nowrap;">`
        + `<b style="color:${_actCol(e.actual, e.forecast, e.event)};">${reel ? eclair + _esc(reel) : VIDE}</b><br>${refs}`
      + `</td></tr>`;
  });
  /* Cadre `.fxdr-callike` (style.css 6179). Le desk le peint en `var(--bg2)` #16171b sur sa page
     #0d0e11 ; le panneau du mail vaut DÉJÀ #16171b, où ce filet serait invisible. Il prend donc
     le cran voisin de la même échelle, #1f1f24, celui que le desk emploie juste à côté pour
     `.fxdr-tablewrap` et pour la bordure de ses cartes : même discrétion, réellement visible. */
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border:1px solid #1f1f24;border-radius:6px;margin:2px 0 6px;">
    <tr><td bgcolor="${FOND}" style="background:${FOND};padding:0;border-radius:6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>${TH('Heure &middot; Devise')}${TH('Imp.')}${TH('Événement')}${TH('Réel', true)}</tr>${out}
      </table>
    </td></tr></table>`;
}

// LE RAPPORT ENTIER, rubrique par rubrique. Chaque section ne s'écrit QUE si elle a de la
// matière : jamais d'intertitre orphelin, jamais de « non disponible » (zéro invention).
/* ══ LES RUBRIQUES DU RAPPORT REPRENNENT L'APPARENCE DU DESK (24/08, demande user : « comme ceci »,
   capture du rapport à l'appui) ══
   Relevé sur .fxdr-section (style.css) : barre or de 3 px à gauche, intitulé or 12 px en capitales
   espacées, et surtout un FILET FIN sous toute la ligne, que l'intertitre générique des mails n'avait
   pas. Rendu en TABLE et non en flex : le moteur de rendu d'Outlook ignore flex, la barre et le filet
   se seraient effondrés. Deux rangées plutôt qu'un `border-left` sur la cellule entière : sinon la
   barre or descendrait jusqu'au filet et formerait un L, là où le desk pose un court repère de 13 px. */
/* ⚠️ MÉTRIQUE RELEVÉE AU JETON PRÈS (25/08). Trois écarts silencieux avec `.fxdr-section` :
   la graisse était 800 là où le desk pose `--fw-bold` = 700, les marges 26/12 au lieu de 28/13,
   et surtout le `border-left` faisait descendre la barre or sur TOUTE la hauteur de la cellule,
   filet compris, quand le desk pose un repère DÉTACHÉ de 3 x 13 px suivi de 8 px de gouttière.
   La barre vit donc dans sa propre cellule, à hauteur fixe : un `::before` ne s'écrit pas en
   courrier, une cellule de 13 px de haut donne exactement le même trait.
   `premier` = `.fxdr-section:first-child` (style.css 6112) : la Synthèse démarre à 4 px du haut,
   collée au bandeau de date, au lieu de flotter à 28 px. */
function _secRapport(t, premier) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:${premier ? '4px' : '28px'} 0 13px;border-collapse:collapse;">
    <tr>
      <td width="3" valign="middle" style="width:3px;padding:0 0 7px;"><table role="presentation" cellpadding="0" cellspacing="0" width="3" style="width:3px;border-collapse:collapse;"><tr><td width="3" height="13" bgcolor="${TOK.or}" style="width:3px;height:13px;line-height:13px;font-size:0;background:${TOK.or};border-radius:2px;mso-line-height-rule:exactly;">&nbsp;</td></tr></table></td>
      <td width="8" style="width:8px;font-size:0;line-height:0;">&nbsp;</td>
      <td valign="middle" style="padding:0 0 7px;color:${TOK.or};font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;line-height:1.15;">${_esc(t)}</td>
    </tr>
    <tr><td colspan="3" style="height:1px;line-height:1px;font-size:0;background:${TOK.filet};">&nbsp;</td></tr>
  </table>`;
}
/* Bloc de SYNTHÈSE, relevé sur .fxdr-exec : liseré or à gauche, fond or très dilué, coins arrondis
   à droite seulement. C'est le SEUL bloc encadré du rapport, exactement comme sur le desk : la
   synthèse est le texte de tête, tout le reste coule en puces.
   ⚠️ L'OR DU LISERÉ ET DU FOND EST CELUI DU MAIL (25/08). Ils étaient écrits en dur en
   rgba(227,178,58,…), c'est-à-dire l'or DU DESK, pendant que l'intertitre juste au-dessus
   emploie TOK.or #f3c344 : deux ors différents se touchaient dans le même bloc. Le desk garde
   #e3b23a, le mail garde #f3c344 (choix user du 11/07 : en messagerie, le #e3b23a vire à
   l'orange), et les deux dérivés se recalculent donc à partir de TOK.or, aux opacités du desk.
   Elles sont PRÉ-MÉLANGÉES au panneau : `rgba` n'existe pas dans le moteur Word d'Outlook, où
   un liseré rgba tombe en noir. */
function _blocSynthese(inner) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 4px;border-collapse:separate;">
    <tr><td bgcolor="${_melange(TOK.or, .06, TOK.panneau)}" style="border-left:2px solid ${_melange(TOK.or, .55, TOK.panneau)};background:${_melange(TOK.or, .06, TOK.panneau)};border-radius:0 8px 8px 0;padding:13px 16px;">${inner}</td></tr>
  </table>`;
}
function _recapQuotidienFull(fx) {
  if (!fx || typeof fx !== 'object') return '';
  const P = [];
  // `P.length === 0` reproduit `.fxdr-section:first-child` : seule la toute première rubrique
  // rendue se colle au haut du corps.
  const S = (titre, contenu) => { if (contenu && String(contenu).trim()) P.push(_secRapport(titre, P.length === 0) + contenu); };
  /* Puces de rubrique. Deux corrections de fond par rapport à `_puceOr` (25/08) :
     la métrique redevient celle de `.wr-bullet` (13 px, encre #c9d1d9, point or de graisse
     NORMALE, texte calé à 14 px), et le texte passe par `_wrInlineMail` au lieu de `_md`, donc
     le **gras** du rapport ressort en blanc semi-gras au lieu d'être rasé en silence. */
  const puces = (v, gras) => _pucesDesk((Array.isArray(v) ? v : [])
    .map(x => (typeof x === 'string' ? x : (x && typeof x.text === 'string' ? x.text : '')))
    .filter(t => t && t.trim()).map(_wrInlineMail), gras);

  /* ÉCLAIRAGES RETIRÉS (24/08, demande user : « enlève tout ceci »). Le bloc ouvrait le mail sur
     dix puces qui, pour l'essentiel, redisaient ce que les rubriques développent ensuite avec leurs
     chiffres : la ligne EUR/USD annonçait « l'euro maintient ses gains sur des PMI résilients »
     quand la rubrique Macro donne le PMI, sa valeur et l'attendu. Le lecteur lisait deux fois la
     même séance, la version vague d'abord. Le rapport s'ouvre désormais sur sa Synthèse.
     Le carrousel d'Éclairages garde toute sa place SUR LE DESK, où il se survole d'un coup d'œil. */

  // 2) SYNTHÈSE : `intro` est vide EN DUR depuis la v16 (fusionnée dans `summary`) mais on
  //    garde la concaténation du desk : les rapports v14 archivés la portent encore.
  //    ⚠️ On ne garde que les CHAÎNES avant de recoller : un `summary` arrivé en objet passait
  //    le `filter(Boolean)`, et le `join` le transformait en la chaîne « [object Object] »,
  //    déjà du texte quand `_md` la recevait. Le filtrage de type doit précéder le join.
  //    La taille redescend à 13 px et la dernière marge tombe à zéro : `.fxdr-exec .wr-p`.
  const _synth = _parasDesk([fx.intro, fx.summary].filter(x => typeof x === 'string' && x.trim()).join('\n\n'), '#e3e3e6', '13px');
  S('Synthèse', _synth ? _blocSynthese(_synth) : '');

  /* 3) GÉOPOLITIQUE. Le sous-titre « Points clés à retenir » suit le desk, où il vient d'être
        retiré (app.js, 24/08) : il distillait en 3-5 lignes les puces géopolitiques qui le
        précèdent immédiatement — le lecteur relisait la même journée deux fois de suite.
        Le mail suit le desk, sans quoi les deux surfaces ne montreraient plus le même rapport. */
  /* GÉOPOLITIQUE : LES TROIS POINTS QUI COMPTENT (24/08 puis 25/08, demandes user :
     « tu en as trop mis », puis « mets-en 3 »).
     Le prompt demande une note de renseignement EXHAUSTIVE — 6 à 14 puces, plafonnées à 14 côté
     serveur — et tant que « Points clés à retenir » distillait la section, cette longueur passait.
     Cette rubrique ayant été retirée le même jour, la liste brute restait seule : un mur.
     CLASSEMENT DÉTERMINISTE, avec le signal que le modèle produit lui-même : le prompt réserve la
     flèche « → effet marché » aux développements dont les données MONTRENT l'effet, donc elle pèse
     le plus lourd ; viennent ensuite le fait chiffré, puis le vocabulaire des développements
     majeurs. On garde les trois meilleurs, PUIS on rétablit l'ordre d'origine : la note se lit dans
     sa séquence, on n'en réordonne pas le récit.
     RENDU SEULEMENT : le serveur produit et stocke toujours les 14 puces (server.js 11344 et 21168 s'en servent). Rien à régénérer, retour possible. */
  const _geoPoids = t => {
    const s = String(t == null ? '' : t);
    return (/→|->/.test(s) ? 4 : 0)
      + (/\d/.test(s) ? 2 : 0)
      + (/sanction|frappe|missile|cessez[- ]le[- ]feu|embargo|guerre|tarif|droits? de douane|repr[ée]saille|blocus|d[ée]troit|opep|nucl[ée]aire|attaque|incursion|accord/i.test(s) ? 2 : 0);
  };
  const _geoTop = l => (Array.isArray(l) ? l : []).map((t, i) => ({ t, i }))
    .sort((a, b) => (_geoPoids(b.t) - _geoPoids(a.t)) || (a.i - b.i))
    .slice(0, 3)
    .sort((a, b) => a.i - b.i)
    .map(x => x.t);
  S('Géopolitique', puces(_geoTop(fx.geopolitics)));

  // 4) BANQUES CENTRALES : champ `cb` (v19) : décisions, minutes, discours, opérations du
  //    Trésor vivent ICI et nulle part ailleurs. Absent des rapports v18 : la section saute.

  // 5) MACRO : les AUTRES moteurs (données, flux, commerce, budgets). C'est le cœur du rapport.
  /* « BANQUES CENTRALES » EST UN SOUS-GROUPE DE MACRO (25/08, demande user : « banque centrale
     doit être dans macro pour les 2 »). Elle avait sa propre section depuis la v19, qui séparait
     `cb` (institution : fait → interprétation → réaction chiffrée) de `macro` (les AUTRES moteurs :
     données, flux, commerce). La séparation reste vraie DANS LES DONNÉES — on ne fusionne pas les
     deux champs — mais elle n'a plus de titre de section à elle : la posture des banques est un
     moteur macro parmi les autres, elle se lit avec eux.
     Les deux groupes ne prennent un sous-titre QUE s'ils coexistent : seul, un groupe n'a rien à
     distinguer et la section garde le rendu qu'elle avait. */
  /* ══ TABLE DE CLASSEMENT — LA MÊME QUE LE DESK (app.js, _FAM_JOUR) ══════════════════════════
     Reprise du tableau de référence fourni par le user (« Learning Economics News ») : chaque
     indicateur y a SA catégorie. Étendue aux équivalents hors États-Unis, le tableau étant écrit
     pour le calendrier américain quand le desk suit huit devises.
     PRÉCÉDENCE : inflation d'abord (« Average Hourly Earnings » contient « Earnings » mais mesure
     un salaire ; « GDP Price Index » est un prix, pas une croissance), puis emploi, puis
     croissance. Le premier motif qui répond gagne.
     BILINGUE, ET CE N'EST PAS DU CONFORT : les LIBELLÉS DU CALENDRIER arrivent en anglais (« Retail
     Sales MoM »), mais les NEWS de la section Macro sont rédigées en français (« les ventes au
     détail américaines progressent de 0,6 % »). Une table anglaise seule classait les chiffres et
     laissait passer les news — défaut mesuré au banc le 25/08. */
  const _FAM_JOUR = [
    /* UN BANQUIER CENTRAL QUI PARLE RELÈVE DE LA POLITIQUE MONÉTAIRE, MÊME S'IL PARLE D'INFLATION
     (26/08, capture du Récap Quotidien à l'appui : « Fed (Collins) : la désinflation est l'issue la
     plus probable » y figure sous POLITIQUE MONÉTAIRE). Dans le Quotidien c'est le champ `cb` qui
     l'y place ; un récap de séance n'a pas ce champ, seulement du texte — d'où cette règle, testée
     EN PREMIER. Elle est ANCRÉE en début de ligne ET exige un marqueur de prise de parole
     (« (Nom) : » ou « : »), sinon « BOJ Core CPI y/y », qui est un chiffre d'INFLATION, basculerait
     ici. Une inflation qui CITE une banque en conséquence (« … → pression sur la BCE ») reste de
     l'inflation : la banque n'y est pas le sujet. */
    ['Politique monétaire', /^\s*\*{0,2}(?:fed|fomc|bce|ecb|boj|boe|boc|rba|rbnz|snb|bns|pboc|riksbank|norges bank|banque centrale|central bank|us treasury|tr[ée]sor(?: am[ée]ricain)?)\*{0,2}\s*(?:\([^)]{0,60}\))?\s*:/i],
    ['Inflation', /prix a la consommation|prix à la consommation|indice des prix|d[ée]sinflation|ench[ée]rit|\bcpi\b|\bppi\b|\bpce\b|\bhicp\b|\bipch\b|\brpi\b|inflation|consumer price|producer price|price index|import prices|export prices|wholesale price|trimmed mean|deflator/i],
    ['Emploi', /cr[ée]ations? d.emplois?|demandes d.allocation|inscriptions au ch[oô]mage|march[ée] du travail|\bnfp\b|non[-\s]?farm|payroll|unemployment|jobless|initial claims|continuing claims|\badp\b|\bjolts\b|job openings|employment|hourly earnings|wage|labou?r force|labou?r costs?|co[ûu]ts? salariaux|co[ûu]t du travail|participation rate|job cuts|ch[oô]mage|emploi|salaire|claimant count|claimant|effectifs|licenciements/i],
    ['Croissance économique', /indice d.activit[ée]|activity index|\bcfnai\b|activit[ée] [ée]conomique|indice manufacturier|indice des directeurs d.achat|ventes au d[ée]tail|production industrielle|commandes (?:de biens|industrielles|d.usine)|confiance d(?:es|u) (?:consommateurs?|m[ée]nages?|entreprises?)|activit[ée] manufacturi[èe]re|activit[ée] des services|mises en chantier|permis de construire|croissance [ée]conomique|\bgdp\b|gross domestic|\bpib\b|growth rate|retail sales|retail trade|\bism\b|\bpmi\b|industrial production|manufacturing production|factory orders|industrial orders|(?:machine tool|machinery|core machinery) orders|durable goods|capacity utilization|business confidence|consumer confidence|consumer sentiment|consumer climate|\btankan\b|\bifo\b|\bzew\b|\bsentix\b|\bgfk\b|investor confidence|economic sentiment|business climate|business survey|climat des affaires|leading index|leading indicator|indicateur avanc[ée]|housing starts|building permits|home sales|house price|\bhpi\b|prix des logements|construction (?:output|spending|\bpmi\b)|wholesale (?:trade|sales)|commerce de gros|ventes en gros|manufacturing sales|building approvals|mortgage approvals|logements? neufs?|ventes de logements|corporate profits|b[ée]n[ée]fices des entreprises|productivity|productivit[ée]|(?:business|retail|wholesale) inventories|stocks des (?:entreprises|grossistes)|personal (?:spending|income)|consumer spending|d[ée]penses des m[ée]nages|revenus? des m[ée]nages|consumer credit|cr[ée]dit [àa] la consommation|tertiary industry|vehicle sales|car registrations|immatriculations|(?:philly|philadelphia|dallas|richmond|kansas city|\bkc\b|empire state|new york|\bny\b) fed (?:manufacturing|services|business|composite|index)|empire state manufacturing|richmond (?:manufacturing|services)/i],
    ['Politique monétaire', /d[ée]cision de taux|taux directeur|politique mon[ée]taire|r[ée]union de politique|rate decision|interest rate decision|\bfomc\b|rate statement|monetary policy|cash rate|\bocr\b|bank rate|official rate|refi rate|deposit rate|policy rate|federal funds|official bank rate|refinancing rate|overnight rate|loan prime rate|press conference|conf[ée]rence de presse|economic projections|meeting minutes|minutes de la|comptes rendus?|\bfed\b|\bfomc\b|\bbce\b|\becb\b|\bboj\b|\bboe\b|\bboc\b|\brba\b|\brbnz\b|\bsnb\b|\bbns\b|\bpboc\b|banque centrale|central bank|taux inchang|maintien du taux|hausse de(?:s)? taux|baisse de(?:s)? taux|resserrement|assouplissement|hawkish|dovish|quantitative|money supply|private sector credit|cr[ée]dit au secteur priv[ée]|net lending|mortgage lending|masse mon[ée]taire|private loans|pr[êe]ts au secteur priv[ée]|bank lending|cr[ée]dit bancaire/i],
    ['Commerce', /guerre commerciale|trade war|tarifs?\b|droits? de douane|surtaxes?|r[ée]torsion|quotas?|embargo commercial|balance commerciale|exportations|importations|d[ée]ficit commercial|trade balance|balance of trade|current account|securities purchases|capital flows|flux de capitaux|investissements? [ée]tranger|exports|imports|balance commerciale/i],
  ];
  const _famJour = t => (_FAM_JOUR.find(([, rx]) => rx.test(String(t || ''))) || ['Autres'])[0];
  const _ORDRE_FAM = ['Inflation', 'Croissance économique', 'Emploi', 'Politique monétaire', 'Commerce', 'Autres'];

  /* ── MACRO : STRICTEMENT LES SECTIONS DEMANDÉES (25/08) — MÊME BLOC QUE LE DESK (app.js).
     D'abord trois, puis QUATRE le même jour (« il y a 4 catégories pas 3, les 4 de l'onglet
     biais ») : la liste qui fait foi est _SECTIONS_NEWS ci-dessous (les 4 rubriques du Radar). Une section sans actualité ce jour-là ne s'écrit pas.
     J'avais ajouté « Énergie & matières premières » et « Marchés & devises » pour loger les
     mouvements de marché ; le user les a écartées. Elles sont retirées de la table.
     ⚠️ CE QUI NE RENTRE DANS AUCUNE DES TROIS N'EST PAS JETÉ, et se rend EN PREMIER, juste sous le
     titre MACRO — avant « Banques centrales » et avant les trois familles. C'est le seul détail qui
     s'écarte de la maquette validée, et il est délibéré : rendues APRÈS un groupe intitulé, ces
     puces se lisaient comme la suite de ce groupe (le user a vu « l'or à 4 650 $ » annoncé sous
     « Banques centrales »). Placées en tête, elles se lisent comme le corps de la section. */
  const _cbP = puces(fx.cb);
  /* LES QUATRE RUBRIQUES SONT CELLES DU RADAR DE BIAIS (25/08, précision user : « les 4 de
     l'onglet biais »). Le Radar range chaque devise en Politique monétaire · Inflation ·
     Croissance économique · Emploi ; le Récap Quotidien reprend exactement ces quatre-là, dans
     cet ordre et avec les mêmes mots. Deux surfaces du même desk ne peuvent pas nommer
     différemment la même chose — c'est la cohérence Radar ↔ Récap déjà posée côté serveur.
     « BANQUES CENTRALES » DISPARAÎT COMME INTITULÉ : le champ `cb` EST de la politique monétaire.
     Il rejoint la rubrique du Radar, en tête, plutôt que d'ouvrir une rubrique parallèle qui
     disait la même chose sous un autre nom. Au passage, une actualité macro sur les taux tombait
     jusqu'ici dans la liste sans intitulé faute de rubrique où aller : elle a la sienne. */
  const _SECTIONS_NEWS = ['Politique monétaire', 'Inflation', 'Croissance économique', 'Emploi'];
  const _txtDe = t => (typeof t === 'string' ? t : (t && t.text)) || '';
  const _macroL = (Array.isArray(fx.macro) ? fx.macro : []).filter(t => _md(_txtDe(t)));
  const _sansFam = _macroL.filter(t => _SECTIONS_NEWS.indexOf(_famJour(_txtDe(t))) < 0);
  const _macroHtml = puces(_sansFam)
    + _SECTIONS_NEWS.map(fam => {
      // `cb` entre EN TÊTE de la Politique monétaire : la décision d'abord, son écho macro ensuite.
      const l = _macroL.filter(t => _famJour(_txtDe(t)) === fam);
      const html = (fam === 'Politique monétaire' ? (_cbP || '') : '') + puces(l);
      return html ? _grpTitre(fam) + html : '';
    }).join('');
  /* AUTRES ÉLÉMENTS NOTABLES (28/08) : les faits du jour qui ne sont NI le dossier géopolitique NI
     de la macro. Le mail suit le rapport du desk à la rubrique près — sans quoi le lecteur du Point
     Marché n'aurait pas la même journée que celui qui ouvre le desk. Posée ENTRE Géopolitique et
     Macro, comme là-bas. */
  const _autresHtml = puces((Array.isArray(fx.autres) ? fx.autres : []).filter(t => _md(_txtDe(t))));
  if (_autresHtml) S('Autres éléments notables', _autresHtml);
  S('Macro', _macroHtml);

  /* ── LES CHIFFRES DU JOUR, RANGÉS PAR FAMILLE — SOUS MACRO (25/08, demande user). Duplication
     assumée du desk : le mail doit montrer le même rapport, donc il porte le même bloc et la même
     table de classement. Le bloc était au-dessus de Macro ; il passe en dessous, l'ordre de lecture
     allant du récit vers les chiffres qui l'étayent. */
  {
    const src = (fx.dataBySession && typeof fx.dataBySession === 'object' && !Array.isArray(fx.dataBySession)) ? fx.dataBySession : {};
    const parFam = new Map();
    Object.keys(src).forEach(k => (Array.isArray(src[k]) ? src[k] : []).forEach(d => {
      if (!d || !_md(d.label)) return;
      const f = _famJour(d.label);
      if (!parFam.has(f)) parFam.set(f, []);
      parFam.get(f).push(d);
    }));
    /* MIROIR DU DESK (30/08) : UNE section « Chiffres du jour », les familles en SOUS-TITRES.
       Chaque famille avait sa propre rubrique de plein droit, alors que les mêmes noms servent
       déjà de sous-rubriques sous MACRO : « Croissance économique » apparaissait à deux niveaux
       dans le même courriel, sans rien pour distinguer les NEWS des CHIFFRES PUBLIÉS. */
    const _fams = _ORDRE_FAM.filter(f => (parFam.get(f) || []).length);
    if (_fams.length) {
      S('Chiffres du jour', _fams.map(fam => {
        const l = (parFam.get(fam) || []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
        return _grpTitre(fam) + _lignesDonnees(l);
      }).join(''));
    }
  }

  // LECTURE DES SÉANCES, commune aux deux blocs qui suivent (elles décident lequel s'affiche).
  // Le rattachement des données à une carte se fait par TEST SUR LE NOM de la région (comme
  // app.js 10019), jamais par index : l'IA peut réordonner ses cartes, l'index mentirait en silence.
  const sess = (fx.dataBySession && typeof fx.dataBySession === 'object' && !Array.isArray(fx.dataBySession)) ? fx.dataBySession : {};
  // RATTACHEMENT ÉLARGI : le nom de la carte est écrit par l'IA, qui ne dit pas toujours
  // « Séance Asie ». Sur « Séance Tokyo », le test échouait, la carte sortait sans chiffres et
  // les chiffres ressortaient plus bas sous un second intitulé « Séance Asie » : le lecteur
  // voyait deux fois la même séance. On reconnaît donc aussi les places financières et les
  // continents que le rapport emploie réellement.
  /* `clef` (rattachement d'un nom de séance à une clé) RETIRÉE avec la boucle de rattrapage :
     plus aucun appelant depuis que les chiffres se rangent par famille. */
  /* 6) DONNÉES DU JOUR (par pays) : RÉTRO-COMPAT STRICTE, exactement comme le desk (app.js 9985) :
        rendue SEULEMENT si aucune des trois séances ne porte de données, c'est-à-dire pour les
        rapports antérieurs à la v11. Sinon ce seraient LES MÊMES publications deux fois.
        ⚠️ ELLE PASSE AVANT LES SÉANCES (25/08). Le desk écrit ce bloc AVANT `w.regions` ; le mail
        l'écrivait après, tout en affirmant en commentaire reprendre « l'ORDRE DU DESK tel quel ».
        Les deux blocs s'excluant, l'écart ne se voyait pas aujourd'hui, mais il serait sorti au
        grand jour au premier rapport d'archive envoyé.
        ⚠️ LA GARDE EST CELLE DU DESK, sur les trois clés attendues et non sur toutes : sinon une
        clé inattendue (« europe ») suffisait à faire disparaître du mail un bloc que le desk, lui,
        aurait affiché. */
  const aSession = ['asia', 'london', 'ny'].some(k => Array.isArray(sess[k]) && sess[k].length);
  if (!aSession) {
    /* GROUPÉ PAR DEVISE, ET LA FAMILLE REDEVIENT UN SOUS-TITRE (25/08). Le mail groupait par PAYS
       (« Nouvelle-Zélande ») là où le desk titre par devise (`_ccyWho` : « NZD », et « EUR ·
       Allemagne » pour l'euro), et il rangeait le nom de la FAMILLE dans le champ pays de la
       ligne : « Croissance » s'affichait à l'endroit exact où les autres lignes affichent un
       pays, donc une famille se lisait comme un pays. Les douze sous-titres de famille du desk
       (COMMERCE, CROISSANCE, INFLATION...) étaient perdus au passage. */
    const cartes = (Array.isArray(fx.dataByCountry) ? fx.dataByCountry : [])
      .filter(g => g && g.country && Array.isArray(g.families) && g.families.length)
      .map(g => {
        const corps = g.families.filter(f => f && Array.isArray(f.items) && f.items.length)
          .map(f => _grpTitre(_md(f.name)) + _pucesDesk(f.items.filter(p => p && p.label).map(_puceCat))).join('');
        return corps ? _carteDesk(_teteCarte(_ccyWhoMail(g.ccy, g.country), '') + corps) : '';
      });
    S('Données du jour', _grilleDesk(cartes));
  }

  // 7) ANALYSE PAR SESSION : l'intitulé du desk est rétabli (il avait été raccourci en « Les
  //    séances »), et chaque séance redevient une CARTE bordée à liseré or, comme sur le desk,
  //    au lieu de trois blocs qui coulaient les uns dans les autres sans séparation visuelle.
  const cartesSess = [];
  for (const r of (Array.isArray(fx.regions) ? fx.regions : [])) {
    if (!r || !r.name) continue;
    // Sous-groupes : interdits par le prompt depuis la v16, donc vides en pratique. On les
    // rend quand même pour les rapports archivés qui en portent (`.fxdr-sub` du desk :
    // liseré or de 2 px, intitulé #dcdce0, texte #a6a6ad).
    const grp = (Array.isArray(r.groups) ? r.groups : []).map(g => (g && g.title ? _grpTitre(_md(g.title)) : '')
      + (Array.isArray(g && g.items) ? g.items.filter(i => i && (i.heading || i.text)).map(i =>
        `<div style="border-left:2px solid ${_melange(TOK.or, .6, TOK.encart)};padding:1px 0 1px 11px;margin:0 0 9px;">`
        + (i.heading ? `<div style="font-size:12px;font-weight:600;color:#dcdce0;margin:0 0 2px;">${_wrInlineMail(i.heading)}</div>` : '')
        + (i.text ? `<div style="font-size:12px;color:#a6a6ad;line-height:1.6;">${_wrInlineMail(i.text)}</div>` : '')
        + `</div>`).join('') : '')).join('');
    // Le résumé est UN bloc (`.fxdr-card-text`), pas une suite de paragraphes : 12 px, #b6b6bd.
    const resume = (typeof r.summary === 'string' && r.summary.trim())
      ? `<div style="font-size:12px;color:#b6b6bd;line-height:1.65;">${_wrInlineMail(r.summary)}</div>` : '';
    // « Données publiées » NE FERME PLUS LA CARTE (24/08) : les chiffres du jour sont rangés par
    // famille plus haut, une seule fois. La séance garde ce qui lui est propre : son analyse.
    // ⚠️ UNE CARTE VIDE NE S'ÉCRIT PAS. Tant que « Données publiées » fermait la carte, elle avait
    // toujours du contenu ; depuis que les chiffres sont rangés par famille, une séance sans
    // analyse ne porterait plus qu'un titre dans un cadre. Même règle que les blocs devise.
    if (resume || grp) cartesSess.push(_carteDesk(_teteCarte(_md(r.name), _md(r.code)) + resume + grp));
  }
  /* BOUCLE DE RATTRAPAGE RETIRÉE (24/08). Elle existait pour qu'une séance sans carte de région
     ne perde pas ses chiffres en silence — et elle fabriquait, ce faisant, des cartes que le desk
     n'affiche jamais (il ne rend « Analyse par session » que depuis `regions`). Sa raison d'être
     tombe : le bloc PAR FAMILLE plus haut balaie TOUTES les clés de `dataBySession`, connues ou
     non, donc aucune publication ne peut plus être perdue, quel que soit le nom de séance. */
  S('Analyse par session', _grilleDesk(cartesSess));

  // 8) À SURVEILLER : dernière rubrique du rapport, le calendrier des prochains jours.
  /* LES FILS OUVERTS, AVANT LE TABLEAU (28/08) — miroir exact du desk. Le tableau dit tout des
     PUBLICATIONS ; il ne peut rien dire d'une sanction annoncée pour la fin de semaine ou d'une
     médiation en cours, et ce sont souvent elles qui font la séance suivante. Rendus dans la MÊME
     rubrique, au-dessus, pour que les deux surfaces se lisent pareil. */
  const _filsL = (Array.isArray(fx.fils) ? fx.fils : []).map(x => _md(typeof x === 'string' ? x : (x && x.text))).filter(Boolean);
  S('À surveiller', (_filsL.length ? puces(_filsL) : '') + _tabAgendaFXR(fx.lookahead));

  return P.join('');
}

// REPLI pour les rapports SANS `full` (mails rendus sur un cache antérieur au 24/08, ou
// Point Marché `kind:'dtpd'` qui n'a jamais de `full`) : on déroule les `sections` telles
// quelles, même grammaire, sans plafond. Aucune régression, une source de moins.
function _recapQuotidienSections(sections) {
  const secs = (Array.isArray(sections) ? sections : []).filter(s => s && _md(s.title));
  if (!secs.length) return '';
  return secs.map(s => {
    // ⚠️ TITRE ÉCHAPPÉ. `_secTitle` reçoit ailleurs des libellés écrits en dur, entités HTML
    // comprises, donc il n'échappe pas lui-même : c'est à l'appelant de le faire quand le
    // titre vient de l'IA. Ici il n'était pas échappé, et il vient bel et bien de l'IA :
    // `_dtpdSanitize` (server 11607) ne fait que retirer le markdown, passer en capitales et
    // couper à 60 caractères, il ne touche ni <, ni >, ni &, ni ". Un titre « RISQUE
    // <script>… » créait donc une VRAIE balise script, EXÉCUTÉE au moteur (mesuré au Chrome),
    // et l'aperçu admin charge ce HTML dans une iframe SANS sandbox, en même origine que le
    // panneau. Corollaire cosmétique : « TAUX & OBLIGATIONS » sortait avec une esperluette
    // brute, du HTML invalide.
    const titre = _esc(_md(s.title));
    if (s.kind === 'data' && Array.isArray(s.data) && s.data.length) {
      // La section `data` était FILTRÉE puis remplacée par une image : images bloquées =
      // chiffres disparus. Elle redevient un tableau HTML.
      const rows = s.data.filter(r => r && (r.release || r.label))
        .map(r => ({ ccy: r.ccy, label: r.release || r.label, actual: r.actual, forecast: r.expected || r.forecast, previous: r.previous }));
      const t = _tabPublications(rows, 'Devise');
      return t ? _secTitle(titre) + t : '';
    }
    const arr = (s.kind === 'paras' ? s.paras : s.items) || [];
    const items = (Array.isArray(arr) ? arr : []).map(_md).filter(Boolean)
      .map(x => _puceOr(_esc(x))).join('');
    return items ? _secTitle(titre) + items : '';
  }).join('');
}
// ── DÉCRYPTAGE CONTEXTUEL (S2) — moteur intelligent : choisit un concept selon le calendrier REEL de la semaine,
// l'explique en clair, puis liste les vrais temps forts a surveiller (prevision/precedent live). Anti-redondance
// via recentKeys. Repli evergreen (decodeur 4 familles) si aucune donnee. Renvoie aussi conceptKey (marquage).
function buildCampaignDecryptage({ name, email, campaign, context, recentKeys, isMember, conceptKey, extraConcepts } = {}) {
  campaign = campaign || 'decryptage';
  const prenomRaw = (name || '').split(' ')[0] || '';
  const hello = prenomRaw ? `Bonjour ${_esc(prenomRaw)},` : 'Bonjour,';
  const unsub = unsubUrl(email || '');
  const cta = _campaignCta(isMember, campaign, email);
  const upcoming = (context && Array.isArray(context.upcoming)) ? context.upcoming : [];
  const majors = upcoming.filter(e => e.impact === 'High');
  // conceptKey = concept DU JOUR épinglé côté server (tous les destinataires du mardi reçoivent le MÊME).
  const _all = [...DECRYPT_CONCEPTS, ...(Array.isArray(extraConcepts) ? extraConcepts : [])];
  const _forced = conceptKey ? _all.find(x => x && x.key === conceptKey) : null;
  const pick = _forced ? { concept: _forced, theme: _forced.theme || ((context && context.theme) || 'calm') } : pickDecryptConcept(context, recentKeys, extraConcepts);
  const c = pick.concept;

  // Accroche ancree sur l'evenement VEDETTE du calendrier (context.featured = ce que le widget affiche en tete)
  // -> le mail vedette le MEME evenement que le calendrier affiche -> jamais de contradiction texte/calendrier.
  const featured = (context && context.featured) || majors[0] || upcoming[0] || null;
  // ══ DOCTRINE « UN SEUL SUJET » (retour user 23/08 : « le badge me dérange, pas trop d'information,
  //    d'autres news ou quoi, faut se focaliser ») ══
  //    Le mail du mardi enseigne UNE notion et l'applique à UN rendez-vous. Tout le reste est parti :
  //      - le badge de catégorie (« INFLATION ») : le titre dit déjà de quoi on parle ;
  //      - le widget calendrier et son compte de temps forts : 76 autres publications noyaient la leçon ;
  //      - le décodeur evergreen des 4 familles : un second cours dans le premier ;
  //      - TOUS les cadres (encadré or, encart du rendez-vous, cartes de scénario). Cinq blocs encadrés
  //        se disputaient l'attention, donc plus rien ne ressortait. Un seul niveau de mise en avant
  //        subsiste : le gras or. Ce qui se lit en deux lignes s'écrit en deux lignes.
  const _cParas = (c.paras || []).filter(Boolean);
  const _regleIdx = _cParas.length > 1 ? _cParas.length - 1 : -1;
  // Le dernier paragraphe porte l'essentiel actionnable. Il s'annonce « La règle de lecture » quand
  // il le dit lui-même (6 concepts sur 14 + tous ceux générés par l'IA, dont le prompt l'impose),
  // sinon « À retenir », vrai dans tous les cas.
  //   ⚠️ PIÈGE MESURÉ (audit du catalogue, 23/08) : ne JAMAIS titrer les paragraphes un par un
  //   (« ce que c'est » / « pourquoi le marché y réagit »). Le contrat de rédaction n'est tenu que par
  //   6 concepts sur 14 : `risk-on-off` oppose deux régimes, `gestion-risque` enchaîne tentation puis
  //   discipline. Des intitulés fixes mentiraient donc sur 8 mails.
  const _regleDeclaree = _regleIdx >= 0 && /^\s*la règle de lecture/i.test(String(_cParas[_regleIdx]));
  const _regleTitre = _regleDeclaree ? 'La règle de lecture' : 'À retenir';
  const _regleTxt = (() => {
    if (_regleIdx < 0) return '';
    const t = String(_cParas[_regleIdx]).replace(/^\s*la règle de lecture\s*:?\s*/i, '');
    return t.charAt(0).toUpperCase() + t.slice(1);   // le préfixe retiré laissait une minuscule en tête
  })();
  const lead = `Votre leçon du mardi.`;
  // Titre SEUL, sans badge de catégorie. L'explication coule en paragraphes, l'essentiel tient sur
  // une ligne mise en valeur par la couleur, pas par un cadre.
  const conceptHtml = `
    <div style="color:#ffffff;font-weight:800;font-size:18px;line-height:1.3;margin:18px 0 14px;letter-spacing:-.01em;">${_esc(c.title)}</div>
    ${_cParas.slice(0, _regleIdx >= 0 ? _regleIdx : _cParas.length).map(p => `<p style="margin:0 0 13px;">${_esc(p)}</p>`).join('')}
    ${_regleIdx >= 0 ? `<p style="margin:18px 0 13px;color:${TOK.or};font-weight:700;">${_regleTitre}&nbsp;: <span style="color:#e6e6ea;font-weight:400;">${_esc(_regleTxt)}</span></p>` : ''}`;

  // « Cette semaine » : LE rendez-vous auquel la notion s'applique, en une ligne, puis les deux
  // mécaniques types. Chiffres = VRAIES prévision/précédent du calendrier, zéro invention.
  let appliedHtml = '';
  if (featured && featured.title) {
    const fwhen = `${featured.dayLabel || ''}${featured.time ? ' à ' + featured.time : ''}`.trim();
    const fnums = [];
    if (featured.forecast) fnums.push(`prévision <strong style="color:#e6e6ea;">${_esc(featured.forecast)}</strong>`);
    if (featured.previous) fnums.push(`précédent <strong style="color:#e6e6ea;">${_esc(featured.previous)}</strong>`);
    const fnumLine = fnums.length ? ` Le marché attend ${fnums.join(', ')}.` : '';
    // L'UNIQUE image du mail (demande user 24/08) : l'aperçu du calendrier du desk, réduit au SEUL
    // rendez-vous dont parle la leçon (period=vedette). On transmet son identité exacte (titre +
    // horodatage) pour que l'image montre CET événement et pas un autre : le texte qui l'entoure,
    // les deux mécaniques comprises, est bâti sur `featured`, une image décalée le contredirait.
    // Le texte de remplacement porte toute l'information : messagerie qui bloque les images = rien de perdu.
    const _txtVedette = `${featured.title}${fwhen ? ', ' + fwhen : ''}.${fnumLine.replace(/<[^>]+>/g, '')}`;
    const _paramsVedette = `&ev=${encodeURIComponent(String(featured.title).slice(0, 120))}`
      + (featured.ts || featured.timestamp ? `&ts=${encodeURIComponent(String(featured.ts || featured.timestamp))}` : '');
    appliedHtml = `<p style="margin:24px 0 6px;color:#ffffff;font-weight:700;font-size:15px;">Cette semaine</p>`
      + _widgetImg('calendar', 'Le rendez-vous de la semaine', 532, 'vedette', null, { params: _paramsVedette, alt: _txtVedette });
    // ── LES DEUX MÉCANIQUES (refonte 15/07) : au-dessus / en-dessous des attentes, appliquées à
    //    L'ÉVÉNEMENT vedette. Polarité par indicateur (chômage/inscriptions : un chiffre plus haut =
    //    économie plus faible → lecture inversée). 100 % INFORMATIF : on décrit des mécaniques de marché
    //    habituelles (« tend à », « généralement »), jamais une prédiction ni une incitation à prendre
    //    position (règle DTP). Deux LIGNES, plus deux cartes encadrées : même information, moitié moins haut.
    if (featured.forecast || featured.previous) {
      const _inv = /unemployment|jobless|claimant|ch[oô]mage|layoff|job cuts/i.test(featured.title || '');
      const hawk = `le marché tend à repousser ses attentes d'assouplissement : la devise concernée est généralement soutenue, l'obligataire et les actifs sensibles aux taux passent sous pression.`;
      const dove = `la banque centrale est perçue comme plus accommodante : la devise concernée a tendance à s'affaiblir et les actifs sensibles aux taux respirent.`;
      const _scLigne = (fleche, t, txt) => `<p style="margin:0 0 13px;"><span style="color:${TOK.or};font-weight:700;">${fleche} ${t}&nbsp;:</span> ${txt}</p>`;
      appliedHtml += _scLigne('▲', 'Au-dessus des attentes', _inv ? dove : hawk)
        + _scLigne('▼', 'En-dessous', _inv ? hawk : dove)
        + `<p style="margin:0 0 4px;font-size:12.5px;color:#7b828f;">Ce ne sont pas des prédictions, mais deux mécaniques types à avoir en tête avant la publication. La réaction réelle dépend toujours du contexte, à suivre en direct sur le Desk.</p>`;
    }
  }

  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:#e6e6ea;">${hello}</p>
    <p style="margin:0 0 6px;">${lead}</p>
    ${conceptHtml}
    ${appliedHtml}
    <div style="margin:22px 0 6px;">${cta.btn}</div>
    <p style="margin:0 0 4px;">À très vite,</p>
    <p style="margin:0 0 16px;color:#9aa3b2;">L'équipe DataTradingPro</p>
    <img src="${trackOpenUrl(campaign, email)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;overflow:hidden;">
  `;
  return { subject: '🎓 ' + c.title, html: _campaignLayout('Comprendre le marché', body, unsub), conceptKey: c.key, conceptTitle: c.title, theme: pick.theme };
}
async function sendCampaignDecryptage(d) { d = d || {}; const m = buildCampaignDecryptage({ name: d.name, email: d.email || d.to, campaign: d.campaign, context: d.context, recentKeys: d.recentKeys, isMember: d.isMember, conceptKey: d.conceptKey, extraConcepts: d.extraConcepts }); /* UNE seule image : l'aperçu du calendrier réduit au rendez-vous vedette, embarqué en inline (cid) */ const prov = await _sendWithInlineWidgets(d.to, m.subject, m.html, ['calendar:vedette']); return prov ? { provider: prov, conceptKey: m.conceptKey } : false; }

// ── MINDSET (track psychologie/discipline) — bibliotheque de mails ORIGINAUX DTP (voix or, informatif, ZERO
// promesse de gains, aucun texte repris d'une newsletter existante). Structure : accroche -> croyance -> faille ->
// recadrage (puces) -> question reflexive. Rotation anti-repetition par recentKeys (marques cote serveur, KV
// campaign:mindset-history). Aucun widget -> envoi texte simple (_send).
const MINDSET_CONCEPTS = [
  // ── Thèmes ajoutés le 30/07, écrits au rythme resserré (paragraphes courts, ouverture sur la
  //    pensée du lecteur, bouton intermédiaire propre au sujet via `cta`). Psychologie et
  //    discipline uniquement : aucun actif, aucune direction, aucune promesse de gain.
  { key: 'decider-avant-ouverture', subject: "🧭 Décider pendant, c'est déjà trop tard", cta: 'Je prépare ma séance', paras: [
    "Tu ouvres l'écran, le marché bouge, et tu décides dans la seconde.",
    "C'est le moment où le raisonnement est le plus faible : le prix parle plus fort que le plan.",
    "**Une décision prise pendant la séance est une décision prise sous influence.**",
    "Celle qui tient, tu l'as prise avant, au calme, quand rien ne bougeait encore.",
    "- Ce qui doit se passer pour que tu interviennes.",
    "- Ce qui invaliderait ta lecture.",
    "- Ce que tu fais si rien de tout ça n'arrive.",
    "Trois réponses écrites avant l'ouverture valent mieux que trente minutes d'hésitation devant l'écran.",
  ], closing: "Ta dernière décision, tu l'as prise avant l'ouverture ou en regardant le prix bouger ?" },

  { key: 'revenge-trade', subject: "🔁 Reprendre tout de suite après une perte", cta: "J'attends la prochaine séance", paras: [
    "La perte vient de tomber. Et la première envie, c'est de la reprendre immédiatement.",
    "Pas d'analyser. **De réparer.**",
    "C'est là que la taille grossit, que le plan s'assouplit, que le stop devient négociable.",
    "Le marché, lui, ne sait pas que tu viens de perdre. Il ne te doit rien.",
    "La position suivante n'a aucune raison d'être meilleure parce que la précédente était mauvaise.",
    "**Le temps entre deux trades fait partie du métier.** Ce n'est pas du temps perdu.",
  ], closing: "Ta dernière position, tu l'as prise pour une raison : ou pour effacer la précédente ?" },

  { key: 'ne-pas-trader', subject: "⏸️ Ne rien faire est une décision", cta: 'Je veux voir avant de décider', paras: [
    "Une journée sans position ressemble à une journée perdue.",
    "Pourtant, rester à l'écart quand rien ne correspond à ta lecture, c'est appliquer ton plan.",
    "**S'abstenir n'est pas de la passivité.** C'est un choix, avec une raison derrière.",
    "Ce qui coûte cher, ce n'est pas la séance vide.",
    "C'est la position prise parce que la séance était vide.",
    "Un carnet où figure « aucune opportunité aujourd'hui » vaut mieux qu'un trade sans justification.",
  ], closing: "Aujourd'hui, tu es entré parce que le contexte le disait : ou parce que tu étais devant l'écran ?" },

  { key: 'stop-qui-recule', subject: "📏 Le stop qu'on déplace un peu", cta: 'Je fixe mes niveaux avant', paras: [
    "Le prix approche du stop. Et une petite voix dit : laisse-lui un peu d'air.",
    "Le déplacement paraît minime. Une fois.",
    "**Mais un stop qu'on déplace n'est plus un stop.** C'est un souhait.",
    "Le niveau que tu avais choisi disait quelque chose : à partir d'ici, ma lecture est fausse.",
    "En le reculant, tu ne protèges pas la position. Tu retardes le moment de l'admettre.",
    "La perte que tu refuses de prendre à 1 % se prend rarement à 1 % plus tard.",
  ], closing: "Ton dernier stop, tu l'as respecté : ou tu lui as laissé « un peu d'air » ?" },

  { key: 'objectif-chiffre', subject: "🎯 L'objectif mensuel qui fait forcer", cta: 'Je juge mon process, pas mon mois', paras: [
    "Se fixer un objectif chiffré au mois paraît sérieux. Professionnel, même.",
    "Sauf que le marché ne connaît pas ton calendrier.",
    "**Un objectif de gain te met en dette envers toi-même.** Et une dette, ça se rattrape.",
    "Le 25 du mois, si le compteur est en retard, la taille monte et les critères descendent.",
    "Les objectifs qui tiennent portent sur ce que tu contrôles :",
    "- Respecter ton risque sur chaque position.",
    "- Ne prendre que ce qui correspond à ta lecture.",
    "- Tenir ton journal jusqu'au bout du mois.",
    "Le résultat, lui, n'est pas une variable de ta volonté.",
  ], closing: "Ton objectif du mois porte sur ce que tu contrôles, ou sur ce que le marché décide ?" },

  { key: 'gagnants-a-relire', subject: "🔍 Relire ses trades gagnants", cta: 'Je relis mes trades', paras: [
    "On relit ses pertes. Rarement ses gains.",
    "Pourtant un trade gagnant peut avoir été mal pris.",
    "**Un bon résultat ne prouve pas une bonne décision.** Il peut juste prouver de la chance.",
    "Et une décision hasardeuse récompensée une fois se répète : jusqu'à la fois où elle ne l'est plus.",
    "La vraie question sur un gain n'est pas « combien ».",
    "C'est : est-ce que je referais exactement la même chose, en sachant seulement ce que je savais alors ?",
  ], closing: "Ton dernier gain venait de ta lecture, ou du fait que le marché a été clément ?" },

  { key: 'fatigue-ecran', subject: "😴 L'état dans lequel tu arrives", cta: 'Je prépare mes conditions', paras: [
    "On parle beaucoup de méthode. Presque jamais de l'état dans lequel on s'assoit devant l'écran.",
    "Une nuit courte ne change pas ton analyse. Elle change ta patience.",
    "**Fatigué, tu ne prends pas de mauvaises décisions : tu en prends plus vite.**",
    "Le seuil d'hésitation baisse, l'attente devient insupportable, le doute se règle par un clic.",
    "Ce n'est pas un problème de discipline. C'est un problème de ressource.",
    "Une séance manquée coûte moins qu'une séance menée à moitié présent.",
  ], closing: "Ta dernière séance difficile, était-ce le marché : ou l'état dans lequel tu l'as abordée ?" },

  { key: 'changer-de-methode', subject: "🪃 Changer de méthode après trois pertes", cta: 'Je garde ma méthode', paras: [
    "Trois pertes de suite, et l'approche entière devient suspecte.",
    "On cherche autre chose. Un réglage, un indicateur, une autre lecture.",
    "**Trois trades ne disent rien d'une méthode.** Ils ne disent rien du tout.",
    "Toute approche a des séries perdantes : c'est une propriété, pas un défaut.",
    "Ce qui se juge sur trois trades, en revanche, c'est l'exécution :",
    "- As-tu respecté ta taille ?",
    "- As-tu attendu tes conditions ?",
    "- As-tu tenu ton niveau d'invalidation ?",
    "Changer de méthode après une série, c'est recommencer à zéro juste avant d'avoir des données.",
  ], closing: "Ta dernière remise en question portait sur ta méthode, ou sur la façon dont tu l'as appliquée ?" },

  { key: 'alerte-permanente', subject: "🔔 Être alerté de tout, tout le temps", cta: 'Je filtre mes alertes', paras: [
    "Chaque alerte promet de ne rien rater.",
    "Mises bout à bout, elles garantissent surtout de ne jamais réfléchir plus de deux minutes d'affilée.",
    "**Une notification n'attend pas que tu sois prêt.** Elle interrompt.",
    "Et une décision prise dans une interruption n'est pas une décision : c'est une réaction.",
    "Le tri se fait en amont, pas dans l'instant :",
    "- Quelles publications peuvent réellement changer ta lecture ?",
    "- Lesquelles ne changeront rien, quoi qu'il arrive ?",
    "Le reste peut attendre la fin de ta séance.",
  ], closing: "Ta dernière alerte t'a fait décider : ou seulement réagir ?" },

  { key: 'avis-des-autres', subject: "🗣️ Chercher un avis avant d'entrer", cta: 'Je construis ma lecture', paras: [
    "Avant d'entrer, on va souvent vérifier ce que pensent les autres.",
    "Rarement pour apprendre. Le plus souvent pour être rassuré.",
    "**Un avis extérieur ne remplace pas une lecture.** Il la remplit d'emprunts.",
    "Et quand la position tourne mal, tu ne sais plus quoi corriger : ce n'était pas ton raisonnement.",
    "Une lecture t'appartient quand tu peux dire ce qui la rendrait fausse.",
    "Sans ce point, ce n'est pas une analyse : c'est une opinion que tu as adoptée.",
  ], closing: "Ta dernière entrée reposait sur ta lecture, ou sur celle de quelqu'un d'autre ?" },

  { key: 'bruit-news', subject: "🔕 Tout suivre, ce n'est pas s'informer", paras: [
    "Beaucoup de traders confondent une chose : être présent partout et être réellement informé. On croit qu'un bon trader suit tout, lit tout, réagit à tout. 📰",
    "Pourtant, **un titre qui claque n'est pas une information neuve**. Le plus souvent, c'est une réaction déjà absorbée par le marché, déjà inscrite dans les prix.",
    "À force de courir après chaque alerte, **tu ne t'informes plus : tu t'épuises**. Ton attention, ta ressource la plus rare, se disperse ligne après ligne.",
    "L'avantage ne vient jamais du volume de nouvelles. Il vient de ta capacité à trier ce qui mérite ton regard. 🥇",
    "- Un titre qui crie fort n'est pas un titre qui pèse lourd.",
    "- Le calendrier économique désigne à l'avance ce qui mérite ton attention.",
    "- Trier, c'est décider avant l'ouverture ce qui changerait vraiment ta lecture.",
    "- Le silence entre deux nouvelles fait partie de l'analyse, pas du vide.",
    "**Un feed calme n'est pas un feed pauvre**. C'est un feed déjà passé au tamis.",
  ], closing: "La dernière nouvelle qui t'a fait réagir modifiait-elle vraiment ta lecture, ou comblait-elle seulement le silence ?" },
  { key: 'process-vs-prediction', subject: "🎯 Deviner juste ne prouve rien", paras: [
    "Il y a une envie difficile à taire chez le trader : deviner le prochain mouvement avant tout le monde, sentir le marché mieux que les autres. 🎯",
    "Peu à peu, on confond la qualité d'une décision avec le simple fait d'avoir vu juste.",
    "Mais **le marché ne récompense pas les devins**. Une prédiction juste posée sur une méthode fragile, c'est de la chance déguisée en talent, et la chance ne signe pas deux fois.",
    "Le vrai levier est ailleurs : une méthode que tu peux dérouler cent fois de la même manière, sans rien improviser. 🧭",
    "- Lire le contexte avant d'ouvrir un graphique, jamais l'inverse.",
    "- Poser tes règles à froid : conditions d'invalidation, événements à surveiller, plan de sortie.",
    "- Juger une décision sur la rigueur de sa méthode, pas sur son résultat isolé.",
    "- Accepter qu'une bonne décision puisse déplaire, et une mauvaise réussir par hasard.",
    "**Une méthode solide te libère du besoin d'avoir raison** : tu n'as plus à deviner, tu observes et tu exécutes. ✨",
  ], closing: "Et si, cette semaine, tu évaluais tes décisions à la rigueur de ta méthode plutôt qu'à leur seul résultat ?" },
  { key: 'serie-de-pertes', subject: "⚖️ Le marché ne te doit aucune revanche", paras: [
    "Après deux, trois, quatre pertes qui s'enchaînent, une pulsion monte : tout récupérer, immédiatement. 🔴",
    "Alors on force une entrée, on gonfle la taille, on réclame au marché une revanche.",
    "Le piège tient en une phrase : **le marché ignore ton solde. Il ne te doit aucun remboursement**.",
    "Vouloir effacer une perte, c'est laisser l'émotion choisir à la place de ton analyse.",
    "Sépare le score du geste. **Une série rouge est une donnée, jamais un verdict sur ta valeur**.",
    "- Une perte t'informe sur le marché, pas sur ce que tu vaux.",
    "- Le sur-risque après un revers, c'est de l'émotion déguisée en stratégie.",
    "- Une pause nette vaut mieux qu'une décision prise pour de mauvaises raisons.",
    "- Revenir à ta méthode apaise l'envie de te rattraper.",
    "Reprendre pied, c'est retrouver ta lecture avant de décider quoi que ce soit. 🪙",
  ], closing: "Ta prochaine position, tu la prends pour lire le marché, ou pour effacer la précédente ?" },
  { key: 'patience-vs-agitation', subject: "⏳ S'agiter n'est pas travailler", paras: [
    "Une idée colle à la peau : plus tu passes d'heures devant les écrans, plus tu progresserais. 🕰️",
    "Comme si l'agitation prouvait le sérieux, et le calme trahissait la paresse.",
    "**Le marché, lui, ne paie jamais ta présence**. Il ne répond qu'à la justesse de tes décisions.",
    "Multiplier les positions pour « ne rien manquer », c'est souvent manquer l'essentiel : le recul.",
    "- **Une séance sans position peut être ta meilleure séance**.",
    "- Attendre le bon scénario, c'est un travail, pas de l'inaction.",
    "- Ta discipline se lit aussi dans les trades que tu refuses.",
    "- La patience n'est pas de l'attente subie : c'est une décision, tenue. ⚙️",
    "Ta progression ne se mesure pas au nombre d'onglets ouverts, mais à la netteté de tes choix. 🟡",
  ], closing: "Et si tu jaugeais ta semaine non pas à tes heures d'écran, mais à la qualité de tes décisions ?" },
  { key: 'ego-avoir-tort', subject: "🥇 Ton ego pèse plus lourd que ton stop", paras: [
    "Une croyance s'accroche chez beaucoup de traders : couper une position, ce serait admettre qu'on s'est trompé. Alors on serre les dents et on espère. 🤔",
    "**Le marché, pourtant, ignore ta fierté**. Il ne sait même pas que tu existes.",
    "**Espérer n'a jamais été un plan**. C'est souvent l'ego qui refuse de rendre les clés.",
    "Accepter d'avoir tort vite n'est pas une humiliation : c'est une compétence, l'une des plus rares.",
    "- Une thèse invalidée est une information précieuse, pas une insulte.",
    "- Reconnaître son erreur tôt libère l'esprit pour la prochaine lecture.",
    "- Le contexte évolue ; ton scénario a le droit d'évoluer avec lui.",
    "- La vraie question n'est pas « qui a raison », mais « qu'est-ce qui est encore vrai ».",
    "Confronter ta thèse aux faits plutôt qu'à ton amour-propre : c'est là que se joue le sang-froid. 🥇",
  ], closing: "Quand tu gardes une position, qu'est-ce qui tient encore vraiment : ton scénario, ou ton ego ?" },
  { key: 'regularite', subject: "🪙 Ce que les captures ne montrent pas", paras: [
    "Sur les réseaux, tu ne croises que des feux d'artifice : la capture parfaite, la position héroïque, l'exploit du jour. 🚀",
    "Ton cerveau enregistre alors une équation trompeuse : réussir, ce serait signer le coup spectaculaire.",
    "Ces images taisent tout le reste : les séances plates, les erreurs, les comptes vidés en silence.",
    "**Ce qui construit un trader, ce n'est pas l'éclair isolé**, mais la répétition propre du même geste.",
    "- Un geste que tu peux tenir cent fois vaut mieux qu'un éclair irremplaçable.",
    "- La régularité protège ton capital mental : moins d'euphorie, moins de tilt.",
    "- Le spectacle des réseaux se trie comme le reste : tu gardes le fond, tu laisses la mise en scène.",
    "- Une routine lisible se répète ; un coup de génie, non.",
    "L'or n'impressionne pas parce qu'il brille fort. **Il compte parce qu'il dure**. 🪙",
  ], closing: "Ton dernier « bon trade », était-ce un geste reproductible à froid, ou une exception que tu t'es racontée ?" },
  { key: 'preparation-contexte', subject: "🧭 L'avantage se gagne avant la première bougie", paras: [
    "On croit souvent que l'avantage d'un trader se joue dans l'instant : le bon setup, le réflexe éclair, le clic au bon moment. 🕰️",
    "C'est là que l'illusion s'installe. Réagir à un marché qu'on n'a pas préparé, c'est courir derrière un mouvement déjà lancé.",
    "**Le vrai avantage se façonne avant l'ouverture**, dans le calme de la préparation.",
    "Lire le contexte, c'est donner un sens au prix : un chiffre seul ne dit rien, c'est le cadre qui parle.",
    "- Ouvre le calendrier économique avant la séance, pas au milieu d'une bougie.",
    "- Repère à l'avance les événements capables de déplacer tes paires.",
    "- Distingue le signal du décor, sans t'y perdre.",
    "- Prépare des scénarios plutôt que de subir l'annonce.",
    "Se préparer, ce n'est pas prédire. C'est arriver lucide, une carte en main, quand d'autres avancent à l'aveugle.",
  ], closing: "Avant ta prochaine séance, sauras-tu dire ce que le calendrier réserve à tes paires, ou le découvriras-tu en pleine bougie ?" },
  { key: 'journal-erreurs', subject: "📓 Une erreur non écrite revient toujours", paras: [
    "Le réflexe le plus courant après une erreur ? La glisser dans un coin de la tête en se disant « leçon retenue ». 🧠",
    "Sauf que **la mémoire réécrit tout**. Sans trace, la même erreur revient plus tard, déguisée mais identique.",
    "Un journal n'est pas un carnet de regrets. C'est l'outil qui transforme une faute en information exploitable. ✍️",
    "- Note le contexte, pas seulement l'issue : la macro du jour, les événements, ton état d'esprit.",
    "- Distingue la décision de son résultat : une bonne méthode peut perdre, une mauvaise gagner par hasard.",
    "- Cherche le schéma qui se répète, pas l'anecdote isolée.",
    "- Relis-toi à froid, une fois par semaine, quand l'émotion est retombée.",
    "**Une erreur n'est un problème que tant qu'elle reste invisible**. Écrite, elle devient une étape. 🪙",
  ], closing: "Ta dernière erreur, l'as-tu vraiment analysée, ou seulement rangée ?" },
  { key: 'risque-taille', subject: "🛡️ Survivre d'abord, performer ensuite", paras: [
    "Une idée séduisante circule : pour gagner gros, il faudrait miser gros. Plus la taille est forte, plus le gain serait beau. 💰",
    "C'est oublier une évidence : sur le marché, tu ne joues pas une main, tu joues des centaines de mains d'affilée.",
    "Une position démesurée peut avoir raison une fois. Répétée, elle finit par croiser la perte de trop, celle qui efface tout.",
    "Le vrai sujet n'est pas « combien je peux gagner », mais « **combien je peux perdre sans sortir du jeu** ». 🧮",
    "- Ta taille de position se décide AVANT l'entrée, jamais dans l'émotion du moment.",
    "- Un risque fixe et modeste par trade rend une série perdante survivable.",
    "- Rester en jeu vaut mieux qu'avoir raison une fois : le capital est ton billet d'entrée.",
    "- Le sur-risque, c'est emprunter à ton futur pour un frisson présent.",
    "**Durer n'est pas une ambition timide** : c'est la condition de toutes les autres. 🛡️",
  ], closing: "Ta prochaine position te laisse-t-elle encore dans le jeu si elle tourne mal, ou joues-tu ton billet d'entrée ?" },
  { key: 'fomo-train', subject: "🚉 Le train raté n'est jamais le dernier", paras: [
    "Un mouvement démarre sans toi. Le prix s'envole, et une petite voix murmure : « vite, avant qu'il soit trop tard ». 🏃",
    "**C'est la peur de manquer qui parle, pas ton analyse**. Elle transforme un spectateur lucide en passager pressé.",
    "Sauter dans un train déjà lancé, c'est entrer sans plan, au pire endroit : là où ceux qui étaient à l'heure prennent leurs bénéfices.",
    "**Le marché ne ferme jamais**. Il y aura un autre setup, une autre séance, une autre occasion préparée. 🚉",
    "- Une opportunité qui exige la précipitation n'en est déjà plus une.",
    "- Entrer en retard, c'est offrir ton stop à ceux qui étaient là avant.",
    "- Rater un mouvement ne coûte rien ; le courir en coûte souvent beaucoup.",
    "- Ton avantage naît d'un plan, jamais d'une course.",
    "Manquer un train n'est pas un échec : forcer l'entrée dans le mauvais wagon, si. 🟡",
  ], closing: "Ta dernière entrée « avant qu'il soit trop tard », l'aurais-tu prise à froid, plan en main ?" },
  { key: 'comparaison', subject: "🪞 Ta courbe n'est pas la leur", paras: [
    "En regardant les autres, on finit par mesurer sa réussite à l'aune de la leur : leurs gains, leur rythme, leur capital. 🪞",
    "Mais **tu ne vois d'eux qu'une vitrine** : ni leur taille de compte, ni leur risque réel, ni leurs séances silencieuses.",
    "Se comparer pousse à copier des décisions qui ne collent ni à ton capital, ni à ton horizon, ni à ta tolérance au risque.",
    "**Le seul étalon qui compte, c'est toi d'hier** : ta discipline, ta régularité, tes erreurs corrigées. 📈",
    "- Le risque supportable dépend de TON compte, pas de celui d'un inconnu.",
    "- Copier une position sans son contexte, c'est hériter du risque sans la thèse.",
    "- Ta progression se lit sur ta propre courbe, pas sur celle d'un fil d'actualité.",
    "- Le trader d'à côté ne trade pas ta vie ; toi si.",
    "Avancer à ton rythme n'est pas prendre du retard : c'est rester aligné avec ce que tu peux tenir. 🧭",
  ], closing: "La dernière décision inspirée d'un autre, l'as-tu prise pour ta stratégie, ou pour ne pas rester sur le quai ?" },
  { key: 'probabilites', subject: "🎲 Penser en probabilités, pas en certitudes", paras: [
    "On cherche souvent une chose que le marché ne donne jamais : la certitude. Le trade « sûr », celui qui ne peut pas échouer. 🎯",
    "Sauf qu'**aucune configuration n'est garantie**. Même la meilleure lecture n'est qu'une probabilité, jamais une promesse.",
    "Croire à la certitude mène à deux pièges : sur-risquer quand on est « sûr », et s'effondrer quand le marché ose désobéir.",
    "Le trader mûr raisonne autrement : chaque trade est un pari mesuré parmi une longue série. 🎲",
    "- Un trade perdant ne prouve pas que la décision était mauvaise : il fait partie de la série.",
    "- **On juge une méthode sur cent trades, pas sur le dernier**.",
    "- Accepter l'incertitude libère du besoin de « toujours avoir raison ».",
    "- Le stop n'est pas un aveu d'erreur : c'est le prix connu d'un pari assumé.",
    "Trader sereinement, c'est accepter de ne pas savoir, tout en sachant quoi faire dans chaque cas. ✨",
  ], closing: "Ton dernier trade, l'as-tu vécu comme un pari mesuré, ou comme une certitude trahie ?" },
  // ── Ajouts 28/07 (veille éditoriale : angles psychologie non couverts — texte 100 % DTP) ──
  { key: 'surtrading-ennui', subject: "🪑 L'ennui est plus cher que la peur", paras: [
    "On parle beaucoup de la peur en trading. Beaucoup moins de son cousin discret, qui coûte souvent plus cher : l'ennui. 🪑",
    "Une séance calme s'installe, rien ne se passe… et l'envie monte de FABRIQUER un trade. Pas parce que le marché offre quelque chose : parce que toi, tu veux qu'il se passe quelque chose.",
    "**Le marché ne paie pas la présence, il paie la sélection.** Un jour sans configuration est un jour réussi si tu n'as rien forcé.",
    "Les traders qui durent ont tous appris la même chose : savoir NE PAS trader est une compétence à part entière. 🧘",
    "- L'ennui déguise le sur-trading en « travail ».",
    "- Un trade né de l'ennui n'a ni plan ni conviction : il n'a qu'une impulsion.",
    "- **Si tu ne peux pas dire ce qui t'a fait entrer, c'est l'ennui qui a cliqué.**",
    "- Fermer l'écran une heure coûte zéro. Un trade fabriqué, rarement.",
    "Une journée à zéro trade n'est pas une journée perdue. C'est une journée où ta discipline a gagné. ✅",
  ], closing: "Ton dernier trade sans conviction : le marché te l'avait-il proposé, ou l'as-tu inventé pour tuer le temps ?" },
  { key: 'euphorie-apres-gain', subject: "🎢 Ton pire trade arrive après ton meilleur", paras: [
    "Le moment le plus dangereux de ta semaine n'est pas après une perte. C'est juste après un GROS gain. 🎢",
    "L'euphorie s'installe et chuchote toujours la même chose : « tu as compris le marché ». Alors la taille grossit, les critères se relâchent, et le trade suivant part avec deux fois la conviction… et moitié moins d'analyse.",
    "**Le marché n'a pas changé parce que tu as gagné.** Ta lecture d'hier n'était pas meilleure : elle a simplement été payée cette fois-ci.",
    "Les statistiques des journaux de trading racontent presque toujours la même histoire : les pires drawdowns suivent les meilleures séries. 📉",
    "- Après un gros gain, la taille devrait rester IDENTIQUE : c'est le test de discipline le plus dur.",
    "- L'euphorie se repère à un signe : l'envie d'y retourner tout de suite.",
    "- **Une série de gains valide ta méthode, pas ton intuition du moment.**",
    "- Le meilleur moment pour relire ses règles, c'est quand on croit ne plus en avoir besoin.",
    "Encaisser un gain avec le même calme qu'une perte : c'est là que se voit la maturité. 🧊",
  ], closing: "Après ton dernier gros gain, ta taille de position est-elle restée la même : honnêtement ?" },
  { key: 'rituel-cloture', subject: "🌙 Ta journée se gagne à sa clôture", paras: [
    "Tout le monde parle de la préparation du matin. Presque personne du moment qui compte autant : la CLÔTURE de ta journée. 🌙",
    "Fermer l'écran sans regarder ce qui s'est passé, c'est laisser la journée s'évaporer : les bonnes décisions comme les mauvaises. Et une leçon non capturée est une leçon à repayer.",
    "**Dix minutes suffisent** : qu'est-ce que j'avais prévu ? Qu'ai-je réellement fait ? Où l'écart s'est-il créé ?",
    "Ce n'est pas de la paperasse. C'est le seul moment où tu te vois trader de l'extérieur. 🔍",
    "- Une journée non relue se répète : surtout ses erreurs.",
    "- L'écart entre le plan et l'exécution EST la matière à travailler, pas le P&L.",
    "- **Clôturer sa journée, c'est aussi la quitter** : le marché n'a pas à te suivre au dîner.",
    "- Trois lignes honnêtes battent trois pages écrites pour se rassurer.",
    "Le trader qui progresse n'est pas celui qui trade le plus. C'est celui qui se relit le plus honnêtement. 📓",
  ], closing: "Ce soir, sauras-tu dire en une phrase ce que ta journée de marché t'a appris ?" },
];
// Rend les paragraphes : les lignes « - … » consecutives deviennent une liste a puces or ; le reste = paragraphes.
// Rendu des paragraphes Mindset. MARQUEURS (posés par le rédacteur/l'IA selon le FORMAT de la semaine —
// rotation de formats 17/07 : deux jeudis de suite ne se ressemblent plus, demande user) :
//   « - texte »  → puce (liste)
//   « > texte »  → PENSÉE INTÉRIEURE : citation encadrée en italique (format « scène »)
//   « → texte »  → BRANCHE : bloc à liseré or (format « tri » : si c'est ceci… / si c'est cela…)
//   « # texte »  → ENCART de contexte desk (format « ancré » : ce qui s'est passé cette semaine)
// Tout le reste = paragraphe normal. Rétro-compatible : les 12 concepts historiques n'utilisent que « - ».
// Gras OR DTP : « **texte** » → <strong or>. Le mail Mindset doit être LISIBLE À LA VOLÉE (demande user
// 17/07 : « du gras, couleur orange/doré, agréable pour le trader ») — un lecteur qui ne scanne QUE les
// passages en or doit comprendre l'essentiel. On échappe AVANT de convertir (les * ne sont pas échappés).
function _mindsetRich(s) {
  return _esc(String(s == null ? '' : s))
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#f3c344;font-weight:700;">$1</strong>')
    .replace(/\*+/g, '');   // astérisques ORPHELINES (gras mal fermé par l'IA) → jamais visibles chez le lecteur
}
// RYTHME. Un paragraphe de plus de ~170 caractères se lit comme un bloc ; coupé à la phrase, il se
// balaie. On ne réécrit rien — on coupe à la frontière de phrase existante, et seulement s'il reste
// deux morceaux consistants. Les puces et les citations ne sont jamais touchées.
function _mindsetRythme(paras) {
  const out = [];
  for (const p of (paras || [])) {
    const t = String(p == null ? '' : p).trim();
    if (!t || t.slice(0, 2) === '- ' || t.slice(0, 2) === '> ' || t.length <= 170) { out.push(t); continue; }
    const bouts = t.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (bouts.length < 2) { out.push(t); continue; }
    // On regroupe pour éviter les fragments orphelins (< 40 car.).
    const groupes = []; let cur = '';
    for (const b of bouts) {
      if (!cur) { cur = b; continue; }
      if (cur.length < 40) { cur += ' ' + b; continue; }
      groupes.push(cur); cur = b;
    }
    if (cur) { if (cur.length < 40 && groupes.length) groupes[groupes.length - 1] += ' ' + cur; else groupes.push(cur); }
    groupes.forEach(g => out.push(g));
  }
  return out;
}
// Bloc « EN PRATIQUE » : trois gestes numérotés, applicables dès la séance suivante. Encadré SOBRE
// (pas d'or : l'or est réservé à la question de clôture, qui reste le point d'arrêt du mail).
function _mindsetPratique(etapes) {
  if (!Array.isArray(etapes) || !etapes.length) return '';
  const li = etapes.slice(0, 4).map((e, i) => `<tr>
      <td width="26" valign="top" style="padding:4px 0;color:#f3c344;font-weight:700;font-size:13px;line-height:1.5;">${i + 1}.</td>
      <td style="padding:4px 0;color:#cbd5e1;font-size:14px;line-height:1.55;">${_mindsetRich(String(e || ''))}</td>
    </tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 4px;"><tr>
    <td style="padding:14px 16px;background:#101216;border:1px solid #262a31;border-left:3px solid #f3c344;border-radius:8px;">
      <div style="color:#9aa3b2;font-weight:700;font-size:10px;letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px;">En pratique, dès ta prochaine séance</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${li}</table>
    </td></tr></table>`;
}
function _mindsetParas(paras) {
  paras = _mindsetRythme(paras);
  let html = '', bullets = [];
  const flush = () => { if (bullets.length) { html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 16px;">${bullets.map(b => `<tr><td style="padding:5px 0;color:#cbd5e1;font-size:14px;line-height:1.55;"><span style="color:#f3c344;font-weight:700;">&bull;</span>&nbsp;${_mindsetRich(b)}</td></tr>`).join('')}</table>`; bullets = []; } };
  let first = true;
  for (const p of (paras || [])) {
    const s = String(p == null ? '' : p).trim();
    if (!s) continue;
    if (s.slice(0, 2) === '- ') { bullets.push(s.slice(2).trim()); continue; }
    flush();
    if (s.slice(0, 2) === '> ') {   // pensée intérieure (format scène)
      html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;"><tr><td style="padding:14px 18px;background:#101013;border-left:3px solid #f3c344;border-radius:0 6px 6px 0;color:#e6e6ea;font-size:15px;font-style:italic;line-height:1.65;">${_mindsetRich(s.slice(2).trim())}</td></tr></table>`;
      first = false; continue;
    }
    if (s.slice(0, 2) === '→ ' || s.slice(0, 3) === '-> ') {   // branche (format tri)
      const t = s.replace(/^(→|->)\s*/, '').trim();
      const ix = t.indexOf(' : ');
      const lead = ix > 0 && ix < 70 ? t.slice(0, ix) : '';
      const rest = lead ? t.slice(ix + 3) : t;
      html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 14px;"><tr><td style="padding:14px 16px;background:rgba(243,195,68,0.06);border:1px solid rgba(243,195,68,0.26);border-radius:8px;color:#e6e6ea;font-size:14.5px;line-height:1.65;">${lead ? `<strong style="color:#f3c344;font-weight:700;">${_esc(lead)}</strong><br>` : ''}${_mindsetRich(rest)}</td></tr></table>`;
      first = false; continue;
    }
    if (s.slice(0, 2) === '# ') {   // encart contexte desk (format ancré)
      html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;"><tr><td style="padding:13px 16px;background:#101013;border:1px solid #232429;border-radius:8px;color:#c8ccd4;font-size:13.5px;line-height:1.6;"><span style="color:#f3c344;font-weight:700;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;">Cette semaine sur le desk</span><br>${_mindsetRich(s.slice(2).trim())}</td></tr></table>`;
      first = false; continue;
    }
    // 1er paragraphe = ACCROCHE : légèrement plus grand et plus clair → l'œil entre dans le mail.
    html += first
      ? `<p style="margin:0 0 16px;font-size:16.5px;color:#ffffff;line-height:1.55;font-weight:600;">${_mindsetRich(s)}</p>`
      : `<p style="margin:0 0 14px;font-size:15px;color:#c8ccd4;line-height:1.65;">${_mindsetRich(s)}</p>`;
    first = false;
  }
  flush();
  return html;
}
// Choisit un concept en evitant les recentKeys (rotation). Repli : tout le catalogue.
// extraConcepts (Mindset hybride IA, 15/07) : concepts GÉNÉRÉS PAR IA (KV campaign:mindset-ai côté server)
// fusionnés au catalogue statique — même forme { key, subject, paras, closing }.

// ── « EN PRATIQUE » : ce qui transforme la lecture en geste ──────────────────────────────────────
// Trois actions faisables dès la séance suivante, et quand c'est utile l'endroit du desk qui sert à
// les tenir. C'est l'écart avec une newsletter de motivation : on ne dit pas seulement quoi penser,
// on montre où le faire. Discipline et méthode uniquement — aucun actif, aucune direction de marché.
const MINDSET_PRATIQUE = {
  'bruit-news': ['Avant l\'ouverture, note les 2 seules publications qui pourraient changer ta lecture du jour.',
    'Coupe les alertes de tout le reste jusqu\'à la clôture de ta séance.',
    'Le soir, compte combien de titres lus ont réellement modifié une décision. En général : zéro ou un.'],
  'process-vs-prediction': ['Avant d\'entrer, écris la phrase « je me trompe si… » et son niveau.',
    'Note ta décision AVANT le résultat, pas après.',
    'En fin de semaine, sépare tes trades en deux piles : bien exécutés, mal exécutés. Ignore les gains.'],
  'serie-de-pertes': ['Fixe à l\'avance le nombre de pertes consécutives après lequel tu fermes la journée.',
    'À ce seuil, arrête : sans négocier avec toi-même.',
    'Reprends le lendemain à taille réduite jusqu\'à deux exécutions propres d\'affilée.'],
  'patience-vs-agitation': ['Définis tes créneaux de séance, et ferme l\'écran en dehors.',
    'Hors créneau, autorise-toi la lecture, pas l\'exécution.',
    'Compte tes trades de la semaine : au-delà de ton rythme habituel, cherche ce qui t\'a poussé.'],
  'ego-avoir-tort': ['Écris ton invalidation avant l\'entrée, pas pendant.',
    'Quand elle est touchée, sors : la relecture vient après, pas au moment du choix.',
    'Relis une fois par mois les trades où tu as eu raison trop tard.'],
  'regularite': ['Choisis un indicateur de régularité que tu contrôles : risque respecté, journal tenu.',
    'Suis-le en série sur 20 séances, pas au jour le jour.',
    'Une séance ratée ne casse rien ; deux d\'affilée méritent une explication écrite.'],
  'preparation-contexte': ['Avant l\'ouverture : quel est le contexte, qu\'attend le marché, qu\'est-ce qui le surprendrait ?',
    'Écris ces trois réponses en trois lignes. Pas plus.',
    'Le soir, vérifie laquelle des trois était fausse : c\'est là que se trouve ta marge de progrès.'],
  'journal-erreurs': ['Note pour chaque trade la RAISON d\'entrée, en une phrase, avant l\'exécution.',
    'Ajoute une seule étiquette : conforme au plan, ou non.',
    'Au bout de 30 trades, compte le ratio. C\'est ton vrai tableau de bord.'],
  'risque-taille': ['Fixe ton risque par position en pourcentage, et calcule la taille à partir de là.',
    'Si le calcul te gêne, c\'est que la position est trop grosse : pas que le calcul est mauvais.',
    'Vérifie une fois par semaine que ton risque réel correspond à celui que tu avais décidé.'],
  'fomo-train': ['Quand tu vois un mouvement déjà parti, note l\'heure et ne fais rien pendant 10 minutes.',
    'Écris ce que tu aurais dû voir AVANT pour être positionné.',
    'Ce sont ces conditions-là qu\'il faut préparer, pas le mouvement d\'après.'],
  'comparaison': ['Coupe une semaine les comptes qui ne montrent que des gains.',
    'Compare-toi à TON mois précédent, sur le respect de ton plan.',
    'Un résultat sans le risque pris à côté ne veut rien dire : le tien non plus.'],
  'probabilites': ['Raisonne par séries de 20 trades, jamais sur le dernier.',
    'Note ton espérance sur la série, pas ton solde du jour.',
    'Un trade perdant conforme au plan est une bonne décision. Écris-le, pour t\'en souvenir.'],
  'surtrading-ennui': ['Fixe un nombre maximum de positions par séance, avant de commencer.',
    'Atteint ce nombre, ferme : même si « ça a l\'air bien ».',
    'Note ce que tu ressentais juste avant les trades hors plan : l\'ennui revient souvent.'],
  'euphorie-apres-gain': ['Après un gain inhabituel, garde la même taille sur les trois trades suivants.',
    'Écris pourquoi ce gain est arrivé : lecture juste, ou marché généreux ?',
    'La séance qui suit un bon jour mérite plus de vigilance, pas moins.'],
  'rituel-cloture': ['Termine chaque séance par trois lignes : ce que j\'ai fait, pourquoi, ce que je referais.',
    'Ferme les écrans après, pas avant.',
    'Relis ces lignes le lundi suivant, avant d\'ouvrir quoi que ce soit.'],
  'decider-avant-ouverture': ['Écris tes trois réponses avant l\'ouverture : ce qui te fait intervenir, ce qui t\'invalide, ce que tu fais si rien n\'arrive.',
    'Garde-les visibles pendant la séance.',
    'Le soir, vérifie si tu as suivi ce papier : ou improvisé.'],
  'revenge-trade': ['Après une perte, impose-toi un délai fixe avant toute nouvelle position.',
    'Pendant ce délai, écris ce qui s\'est passé, sans chercher de coupable.',
    'Reprends à la taille prévue, jamais au-dessus.'],
  'ne-pas-trader': ['Autorise-toi explicitement la mention « aucune opportunité » dans ton journal.',
    'Compte ces journées : elles font partie du métier, pas du temps perdu.',
    'Compare la performance de tes journées calmes et de tes journées chargées.'],
  'stop-qui-recule': ['Place ton stop au niveau qui invalide ta lecture, pas à celui qui te fait mal.',
    'Une fois posé, il ne bouge que dans le sens du gain.',
    'Note chaque stop déplacé : le compte parle de lui-même au bout d\'un mois.'],
  'objectif-chiffre': ['Remplace ton objectif de gain par un objectif de process, mesurable chaque jour.',
    'Vérifie-le en fin de semaine, jamais en fin de mois seulement.',
    'Si tu es en retard sur un objectif chiffré, c\'est le moment de réduire, pas d\'augmenter.'],
  'gagnants-a-relire': ['Relis un trade gagnant par semaine comme si tu l\'avais perdu.',
    'Demande-toi : le referais-je avec les informations que j\'avais alors ?',
    'Marque ceux qui étaient chanceux. Ce sont eux qui coûteront cher un jour.'],
  'fatigue-ecran': ['Note ton état en une ligne avant d\'ouvrir : reposé, moyen, fatigué.',
    'En état « fatigué », lecture seulement : aucune exécution.',
    'Au bout d\'un mois, croise cette colonne avec tes trades hors plan.'],
  'changer-de-methode': ['Avant de changer quoi que ce soit, exige 30 trades appliqués à la lettre.',
    'Sépare le problème : est-ce la méthode, ou son exécution ?',
    'Ne change qu\'UNE variable à la fois, sinon tu ne sauras jamais ce qui a agi.'],
  'alerte-permanente': ['Liste les publications qui peuvent réellement changer ta lecture. Elles sont peu nombreuses.',
    'Désactive les alertes de tout le reste jusqu\'à la fin de ta séance.',
    'Regarde le calendrier une fois le matin, plutôt que le fil vingt fois par jour.'],
  'avis-des-autres': ['Écris ta lecture AVANT d\'aller voir celle des autres.',
    'Note ce qui la rendrait fausse : sans ce point, ce n\'est pas une analyse.',
    'Si un avis extérieur te fait changer d\'avis, écris pourquoi. Souvent, il n\'y a pas de raison.'],
};
// Fusion : chaque concept récupère son bloc. Un concept sans entrée reste valable — le bloc est
// simplement omis au rendu (c'est le cas des concepts écrits par l'IA qui n'en fournissent pas).
MINDSET_CONCEPTS.forEach(c => { const p = MINDSET_PRATIQUE[c.key]; if (p && p.length) c.pratique = p; });


// ── ÉTOFFEMENT DES THÈMES DU 30/07 ───────────────────────────────────────────────────────────────
// Mécanisme + nuance + repère concret, insérés avant la chute. Voir le commentaire de MINDSET_PLUS
// pour le raisonnement : un mail de méthode sans son exception se lit comme un slogan.
const MINDSET_PLUS = {
  'decider-avant-ouverture': [
    "Ce n'est pas un manque de rigueur. C'est la façon dont l'attention fonctionne : devant un prix qui bouge, le cerveau traite l'urgence avant la pertinence.",
    "Écrire avant, c'est simplement décider dans des conditions où tu raisonnes encore.",
    "La nuance : préparer ne veut pas dire tout prévoir. Un plan qui anticipe dix scénarios n'est plus un plan, c'est une liste d'excuses.",
    "Trois lignes suffisent. Si tu ne peux pas les écrire, c'est que la lecture n'est pas encore claire : et c'est déjà une information.",
  ],
  'revenge-trade': [
    "Le mécanisme est connu : après une perte, la tolérance au risque augmente au lieu de diminuer. On accepte pour se refaire ce qu'on aurait refusé une heure plus tôt.",
    "C'est pour ça que les pires séances commencent rarement par un mauvais trade. Elles commencent par un mauvais DEUXIÈME trade.",
    "La nuance : reprendre vite n'est pas toujours une erreur. Si le contexte correspond vraiment à ton plan, la perte précédente n'a rien à voir.",
    "Le test est simple : aurais-tu pris cette position si la précédente avait été gagnante ?",
  ],
  'ne-pas-trader': [
    "Le biais est structurel : on mesure son travail à l'activité, parce que l'activité se voit. Une décision de ne pas intervenir ne laisse aucune trace.",
    "D'où l'impression d'avoir « perdu sa journée » alors qu'on a appliqué son plan à la lettre.",
    "La nuance : l'abstention n'est pas une stratégie. Rester à l'écart des semaines entières, ce n'est plus de la sélectivité, c'est de l'évitement.",
    "La différence tient à une chose : peux-tu nommer la condition qui manquait ? Si oui, c'est un choix. Sinon, c'est de la peur.",
  ],
  'stop-qui-recule': [
    "Le mécanisme est bien décrit : on accepte plus de risque pour éviter une perte certaine que pour sécuriser un gain équivalent.",
    "Déplacer un stop, ce n'est donc pas un accident de discipline. C'est une réaction prévisible, et c'est justement pour ça qu'elle se prépare à l'avance.",
    "La nuance : un stop peut légitimement bouger, dans le sens du gain, ou si ta lecture change pour une raison EXTÉRIEURE au prix.",
    "Ce qui ne se justifie jamais, c'est de l'élargir parce qu'il est sur le point d'être touché.",
  ],
  'objectif-chiffre': [
    "Un objectif de résultat crée une échéance là où le marché n'en a pas. Et une échéance, ça pousse à forcer quand le temps manque.",
    "C'est pour ça que les dernières séances du mois ressemblent rarement aux premières : même méthode, mais plus la même pression.",
    "La nuance : se fixer un cap n'est pas absurde. Ce qui l'est, c'est de le fixer sur la seule variable que tu ne contrôles pas.",
    "Un objectif de process se vérifie chaque jour, sans attendre la fin du mois pour savoir si c'est raté.",
  ],
  'gagnants-a-relire': [
    "Le résultat contamine le jugement : un trade qui finit bien paraît rétrospectivement mieux pensé qu'il ne l'était.",
    "En ne relisant que les pertes, tu ne corriges qu'une moitié de tes décisions : et tu renforces l'autre sans le savoir.",
    "La nuance : un gain bien exécuté n'a pas besoin d'être disséqué. L'idée n'est pas de douter de tout.",
    "Un tri sur trente trades suffit à voir la tendance : combien de gains venaient de ta lecture, combien du hasard ?",
  ],
  'fatigue-ecran': [
    "La fatigue ne dégrade pas l'analyse en premier. Elle dégrade l'inhibition : cette capacité à ne PAS agir.",
    "C'est pour ça qu'on se sent lucide tout en enchaînant des décisions qu'on n'aurait pas prises reposé.",
    "La nuance : il ne s'agit pas d'attendre des conditions parfaites. Personne n'arrive frais tous les jours.",
    "Il s'agit d'adapter ce que tu t'autorises à ton état : lire quand tu es moyen, exécuter quand tu es net.",
  ],
  'changer-de-methode': [
    "Trois trades, c'est un échantillon trop petit pour distinguer une méthode défaillante d'une série normale. Statistiquement, il ne dit rien.",
    "Le problème n'est pas de changer. C'est de changer AVANT d'avoir de quoi juger : et de recommencer ce cycle indéfiniment.",
    "La nuance : certaines méthodes doivent être abandonnées. Si le risque n'est pas maîtrisable, ou si elle ne correspond ni à ton temps ni à ton tempérament, insister ne sert à rien.",
    "Mais cette décision-là se prend au calme, sur des dizaines de trades : jamais le soir d'une troisième perte.",
  ],
  'alerte-permanente': [
    "Chaque interruption a un coût qu'on ne voit pas : il faut plusieurs minutes pour retrouver le fil d'un raisonnement coupé.",
    "Vingt alertes dans une séance, ce n'est donc pas vingt informations. C'est une séance sans raisonnement continu.",
    "La nuance : certaines publications méritent vraiment une alerte. Une décision de banque centrale ne se découvre pas le lendemain.",
    "Elles se comptent sur les doigts d'une main par semaine. Tout le reste peut attendre la fin de ta séance.",
  ],
  'avis-des-autres': [
    "Chercher un avis avant d'entrer sert rarement à s'informer. Ça sert à partager la responsabilité de la décision.",
    "Et une décision dont tu ne portes pas entièrement la raison est une décision que tu ne peux pas corriger.",
    "La nuance : lire les autres est utile, après avoir formé ta propre lecture. Le désaccord devient alors une information, pas une pression.",
    "L'ordre compte plus que le contenu : ta lecture d'abord, celle des autres ensuite.",
  ],
};
// Fusion : les paragraphes s'insèrent AVANT le dernier (la chute reste la chute). Les puces restent
// groupées là où elles sont — on insère après le dernier bloc de puces s'il termine le concept.
MINDSET_CONCEPTS.forEach(c => {
  const plus = MINDSET_PLUS[c.key];
  if (!plus || !Array.isArray(c.paras) || !c.paras.length) return;
  let i = c.paras.length - 1;
  while (i > 0 && String(c.paras[i]).slice(0, 2) === '- ') i--;   // ne pas casser une liste de puces
  c.paras = c.paras.slice(0, i).concat(plus, c.paras.slice(i));
});

// Liste { key, subject, ia } de tous les thèmes disponibles — catalogue écrit + concepts générés.
// Sert l'aperçu du panel admin : on doit pouvoir RELIRE chaque thème avant qu'il ne parte.
function listMindsetConcepts(extraConcepts) {
  const ecrits = MINDSET_CONCEPTS.map(c => ({ key: c.key, subject: c.subject, ia: false }));
  const ia = (Array.isArray(extraConcepts) ? extraConcepts : [])
    .filter(c => c && c.key && !ecrits.some(e => e.key === c.key))
    .map(c => ({ key: c.key, subject: c.subject || c.key, ia: true }));
  return ecrits.concat(ia);
}
function pickMindsetConcept(recentKeys, extraConcepts) {
  recentKeys = Array.isArray(recentKeys) ? recentKeys : [];
  const all = [...MINDSET_CONCEPTS, ...(Array.isArray(extraConcepts) ? extraConcepts : [])];
  const fresh = all.filter(c => !recentKeys.includes(c.key));
  const pool = fresh.length ? fresh : all;
  return pool[0] || null;
}
function buildCampaignMindset({ name, email, campaign, recentKeys, isMember, conceptKey, extraConcepts } = {}) {
  campaign = campaign || 'mindset';
  const _all = [...MINDSET_CONCEPTS, ...(Array.isArray(extraConcepts) ? extraConcepts : [])];
  const pick = (conceptKey && _all.find(c => c.key === conceptKey)) || pickMindsetConcept(recentKeys, extraConcepts);
  if (!pick) return null;
  const prenomRaw = (name || '').split(' ')[0] || '';
  const hello = prenomRaw ? `Salut ${_esc(prenomRaw)},` : 'Salut,';
  const unsub = unsubUrl(email || '');
  const cta = _campaignCta(isMember, campaign, email);
  // Question de clôture : ENCADRÉE (liseré or + fond) au lieu d'un italique noyé dans le texte —
  // c'est le point d'arrêt du mail, celui que le lecteur doit emporter (demande user 17/07).
  // BOUTON INTERMÉDIAIRE. Un seul bouton, tout en bas, n'est lu que par ceux qui sont allés au
  // bout ; réparti, il attrape aussi le lecteur qui décroche à mi-parcours. Libellé à la PREMIÈRE
  // PERSONNE et propre au sujet (`cta` du concept) : « Je veux… » se clique mieux qu'« En savoir
  // plus », parce qu'il prolonge la phrase que le lecteur vient de lire.
  const _pars = Array.isArray(pick.paras) ? pick.paras : [];
  /* UN SEUL BOUTON, ET IL VIENT APRÈS (24/08, demande user : « tu mets 2 boutons c'est pas bon, il
     en faut 1 seul et à la fin, après avoir partagé la valeur »). Un bouton était posé AU MILIEU du
     texte, coupant la réflexion en deux : on demandait au lecteur de partir vers le desk avant même
     de lui avoir donné ce pour quoi il ouvrait le mail. Le seul bouton restant est celui de la fin,
     juste après la question à se poser, qui est le point d'orgue du texte. */
  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:#9aa3b2;">${hello}</p>
    ${_mindsetParas(_pars)}
    ${_mindsetPratique(pick.pratique)}
    ${_goldBox(`<div style="color:${TOK.or};font-weight:700;font-size:10px;letter-spacing:.07em;text-transform:uppercase;margin-bottom:6px;">La question à te poser</div>
        <div style="color:${TOK.blanc};font-size:15.5px;font-style:italic;line-height:1.55;">${_esc(pick.closing)}</div>`)}
    <div style="margin:22px 0 6px;">${cta.btn}</div>
    <p style="margin:0 0 4px;">À très vite,</p>
    <p style="margin:0 0 16px;color:#9aa3b2;">L'équipe DataTradingPro</p>
    <img src="${trackOpenUrl(campaign, email)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;overflow:hidden;">
  `;
  return { subject: pick.subject, html: _campaignLayout('Mindset', body, unsub), conceptKey: pick.key, conceptTitle: pick.subject };
}
async function sendCampaignMindset(d) { d = d || {}; const m = buildCampaignMindset({ name: d.name, email: d.email || d.to, campaign: d.campaign, recentKeys: d.recentKeys, isMember: d.isMember, conceptKey: d.conceptKey, extraConcepts: d.extraConcepts }); if (!m) return false; const prov = await _send(d.to, m.subject, m.html); return prov ? { provider: prov, conceptKey: m.conceptKey } : false; }

// ── INVITATION (CONVERSION) — campagne MENSUELLE vers les MEMBRES NON ABONNES (segment != active). Offre :
// une SEMAINE d'accès offerte au Desk via DM Instagram. 3 variantes (pro / conviviale / performance) en
// ROTATION MENSUELLE (mois calendaire % 3) → anti-lassitude. 100% produit, ZERO promesse de gain (conforme
// au veto informatif : on vend l'OUTIL, jamais une position). CTA = Instagram. Or mail #f3c344.
const IG_URL = 'https://www.instagram.com/datatradingpro';
// REFONTE 23/08 (retour user : « il faut valoriser le desk + améliorer le mail ») : les puces
// génériques (« analyse structurée », « temps réel ») ne disaient rien du desk RÉEL. Chaque variante
// valorise désormais des capacités CONCRÈTES et nommées (lecture banque centrale, graphe de réaction,
// récaps rédigés, force des devises, biais) ; l'offre passe dans l'ENCADRÉ OR (grammaire commune) avec
// un titre H1. Toujours zéro promesse de gain : on décrit ce que le desk fait, jamais ce qu'on gagnerait.
const _INVIT_VARIANTS = [
  { key: 'pro', eyebrow: 'INVITATION',
    subject: "Votre semaine d'accès au Desk DataTradingPro",
    h1: 'Votre desk vous attend déjà',
    lead: "Vous faites partie de la communauté DataTradingPro, mais vous n'avez pas encore ouvert le Desk : le terminal que nos abonnés consultent chaque matin pour lire le marché macro et forex en quelques minutes.",
    secTitle: 'Ce que votre desk réunit',
    benefits: [
      ['La lecture banque centrale', " : chaque publication majeure (CPI, emploi, PIB) est confrontée au ton réel de sa banque centrale, en direct sous la news."],
      ['Le fil et le graphe de réaction', " : la news importante arrive avec la réaction du marché, minute par minute, sur la paire concernée."],
      ['Les récaps rédigés', " : chaque séance et chaque semaine résumées par le desk, façon salle de marché, en français."],
      ['Vos repères en un écran', " : calendrier économique, force des devises, biais du marché, taux."],
    ],
    exclu: "Ce mois-ci, nous ouvrons un nombre limité d'accès découverte, réservés à la communauté.",
    ctaLead: "Écrivez-nous sur Instagram et nous vous offrons une semaine complète d'accès au Desk, sans carte et sans engagement.",
    ctaLabel: "Nous écrire sur Instagram", signoff: "Bien à vous," },
  { key: 'convivial', eyebrow: 'UNE SEMAINE OFFERTE',
    subject: "On vous ouvre le Desk pendant une semaine 👀",
    h1: 'Le Desk, de l’intérieur',
    lead: "Petit message pour vous : vous êtes dans la communauté DataTradingPro, mais on ne vous a encore jamais montré le Desk de l'intérieur. C'est là que tout se passe, chaque matin.",
    secTitle: 'Ce qui vous attend derrière la porte',
    benefits: [
      ['Le marché du jour, déjà lu', " : les récaps de séance rédigés par le desk, la macro et le forex sans jargon."],
      ['Les news qui comptent, en direct', " : chaque chiffre important arrive avec sa lecture banque centrale et la réaction du marché."],
      ['Vos repères réunis', " : calendrier, force des devises, biais et taux, au même endroit."],
    ],
    exclu: "On garde quelques accès offerts pour les membres curieux ce mois-ci.",
    ctaLead: "Envoyez-nous un petit message sur Instagram, et on vous offre une semaine sur le Desk. Aucune carte, aucun engagement.",
    ctaLabel: "Écrire sur Instagram", signoff: "À très vite," },
  { key: 'performance', eyebrow: 'GAGNEZ DU TEMPS',
    subject: "Lisez le marché en quelques minutes chaque matin",
    h1: 'Tout le marché, un seul écran',
    lead: "Combien de temps passez-vous à rassembler l'actu macro, le calendrier et le sentiment du marché ? Sur le Desk DataTradingPro, tout est réuni, déjà lu et remis en contexte par le desk.",
    secTitle: 'Ce que le desk fait pour vous',
    benefits: [
      ['Il lit les banques centrales', " : chaque publication majeure est confrontée au ton de sa banque centrale, à l'instant où elle tombe."],
      ['Il filtre et mesure', " : le fil ne garde que le signal, et la réaction du marché s'affiche minute par minute."],
      ['Il rédige vos récaps', " : la séance et la semaine résumées en français, prêtes à lire."],
    ],
    exclu: "Ce mois-ci, on ouvre l'accès une semaine, gratuitement, pour que vous testiez en conditions réelles.",
    ctaLead: "Un simple message sur Instagram suffit pour activer votre semaine offerte.",
    ctaLabel: "Activer ma semaine (Instagram)", signoff: "À bientôt sur le Desk," },
];
function _invitationVariantIndex() { const d = new Date(); return (d.getFullYear() * 12 + d.getMonth()) % _INVIT_VARIANTS.length; }
function buildCampaignInvitation({ name, email, campaign, variant, isMember } = {}) {
  campaign = campaign || 'invitation';
  const v = _INVIT_VARIANTS[Number.isInteger(variant) ? ((variant % _INVIT_VARIANTS.length + _INVIT_VARIANTS.length) % _INVIT_VARIANTS.length) : _invitationVariantIndex()];
  const prenom = (name || '').split(' ')[0] || '';
  const hello = prenom ? `Bonjour ${_esc(prenom)},` : 'Bonjour,';
  const unsub = unsubUrl(email || '');
  const igUrl = trackClickUrl(campaign, email, IG_URL);
  const benefitsHtml = v.benefits.map(b => `<tr>
      <td style="padding:5px 10px 5px 0;vertical-align:top;width:12px;"><span style="color:#f3c344;font-weight:700;">&rarr;</span></td>
      <td style="padding:4px 0;color:#cbd5e1;font-size:13.5px;line-height:1.55;"><strong style="color:#fff;">${b[0]}</strong>${b[1]}</td>
    </tr>`).join('');
  const body = `
    <div style="display:inline-block;color:#0d0e11;background:#f3c344;font-weight:800;font-size:11px;letter-spacing:.06em;padding:4px 11px;border-radius:6px;margin-bottom:14px;">${v.eyebrow}</div>
    ${_H1}${_esc(v.h1 || 'Votre desk vous attend')}</p>
    <p style="margin:0 0 6px;font-size:15px;color:#e6e6ea;">${hello}</p>
    <p style="margin:0 0 4px;">${v.lead}</p>
    ${_secTitle(_esc(v.secTitle || 'Ce que votre desk réunit'))}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:2px 0 4px;">${benefitsHtml}</table>
    ${_goldBox(`<div style="color:${TOK.or};font-weight:800;font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">Une semaine offerte</div><div style="margin-bottom:6px;">${v.exclu}</div><div><strong style="color:#fff;">${v.ctaLead}</strong></div>`)}
    <div style="margin:14px 0 4px;">${_campaignBtn(v.ctaLabel, igUrl)}</div>
    <p style="margin:18px 0 4px;">${v.signoff}</p>
    <p style="margin:0 0 16px;color:#9aa3b2;">L'équipe DataTradingPro</p>
    <img src="${trackOpenUrl(campaign, email)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;overflow:hidden;">
  `;
  return { subject: v.subject, html: _campaignLayout('Invitation', body, unsub), variant: v.key };
}
async function sendCampaignInvitation(d) { d = d || {}; const m = buildCampaignInvitation({ name: d.name, email: d.email || d.to, campaign: d.campaign || 'invitation', variant: d.variant, isMember: d.isMember }); if (!m) return false; const prov = await _send(d.to, m.subject, m.html); return prov ? { provider: prov, variant: m.variant } : false; }

// ── PARRAINAGE (campagne SEMESTRIELLE) ────────────────────────────────────────────────────
// 04/09, demande user : « programme tous les 6 mois tu envoi un mail pour dire ça puis à chaque
// fois de différente façon pour pas que ça soit des mails identiques ». Deux exigences, et la
// seconde est la difficile : un rappel qui revient tous les six mois avec le MÊME texte se lit
// comme un mail automatique et finit en désabonnement. On ne reformule donc pas — on change
// D'ANGLE. Les quatre variantes ci-dessous ne disent pas la même chose autrement : elles
// s'adressent à quatre raisons différentes de parrainer (le revenu, l'abonnement remboursé, la
// recommandation qu'on fait déjà gratuitement, le lien qu'on n'a jamais activé). À raison de deux
// envois par an, la première répétition tombe dans DEUX ANS.
//
// ⚠️ AUCUN LIEN PERSONNEL DANS LA CAMPAGNE, ET C'EST VOLONTAIRE. Résoudre le lien d'affiliation
// Whop de chaque destinataire demanderait un appel API PAR CONTACT au moment du broadcast : lent,
// faillible, et vide pour tout contact pas encore inscrit sur Whop — le mail promettrait alors un
// lien qu'il ne porte pas. La campagne renvoie donc vers le panneau Parrainages du desk (lien
// profond `?parrainage=1`, qui ouvre le volet directement sur la section), lequel affiche TOUJOURS
// le lien à jour. Le lien nominatif reste porté par buildReferralInvite, l'envoi à l'unité.
/* « 15% », PAS « 15 % » (04/09, capture user : « enleve l'espace avant le %, ca fait IA »). La
   typographie francaise demande une espace insecable avant le signe pourcent ; le desk, lui, ecrit
   « 15% » depuis toujours — l'en-tete du panneau Parrainages dit « Gagnez 15% recurrent ». Entre la
   regle et la coherence du produit, c'est le produit qui gagne : un client qui lit « 15% » dans le
   desk et « 15 % » dans le mail voit deux mains differentes. */
const _PARRAIN_VARIANTS = [
  { key: 'revenu',
    subject: '15% à vie sur chaque abonné que vous amenez',
    h1: 'Votre lien vous rapporte, tous les mois',
    lead: "Le parrainage DataTradingPro est ouvert à tous les membres. Vous partagez votre lien, et chaque personne qui s'abonne grâce à vous vous verse une commission — pas une fois, tous les mois, tant qu'elle reste abonnée.",
    secTitle: 'Ce que vous touchez',
    points: [
      ['15% à vie', " : la commission tombe à chaque échéance de votre filleul, pas seulement à son inscription."],
      ['1 mois offert tous les 3 filleuls', " : en plus de la commission, un mois d'accès s'ajoute à votre abonnement."],
      ['Rien à avancer', " : aucun minimum, aucun palier à atteindre, aucune carte à renseigner."],
    ],
    boxTitre: 'La différence entre 15% et 15% à vie',
    box: "Une prime unique vous paie une fois. Une commission récurrente vous paie chaque mois où votre filleul reste. Trois filleuls fidèles valent plus, sur un an, que quinze inscriptions qui ne durent pas.",
    ctaLead: "Votre lien vous attend dans le desk, section Parrainages de votre profil.",
    ctaLabel: 'Ouvrir mes parrainages', signoff: 'Merci de faire grandir le desk,' },

  { key: 'rembourse',
    subject: 'Trois personnes, et votre abonnement est remboursé',
    h1: 'Le desk que vous payez peut se payer tout seul',
    lead: "Vous ouvrez le desk chaque matin. Trois autres personnes le feront sur votre recommandation, et votre abonnement cesse d'être une dépense : entre la commission récurrente et le mois offert, il commence à se financer lui-même.",
    secTitle: 'Comment le calcul tourne',
    points: [
      ['3 filleuls = 1 mois offert', " : ajouté à votre abonnement, sans rien demander."],
      ['Puis 15% chaque mois', " : sur chacun d'eux, aussi longtemps qu'ils restent abonnés."],
      ['Et cela continue', " : les trois suivants remettent un mois, la commission s'empile."],
    ],
    boxTitre: 'Ce que cela change',
    box: "Un parrainage n'est pas un geste ponctuel : c'est une ligne qui revient. Le compteur de vos filleuls s'affiche en direct dans votre panneau Parrainages, et vos commissions sont versées par Whop, dans votre espace.",
    ctaLead: "Le lien à partager se trouve dans votre profil.",
    ctaLabel: 'Voir mon compteur', signoff: 'À bientôt sur le desk,' },

  { key: 'deja',
    subject: 'Vous recommandez le desk. Autant que cela vous rapporte.',
    h1: 'Vous en parlez déjà. Sans lien, cela ne compte pas.',
    lead: "Un trader qui vous demande où vous lisez la macro, une capture du desk envoyée dans un groupe, un nom lâché en discussion : ces recommandations existent déjà. Elles partent simplement sans votre lien, donc sans rien pour vous.",
    secTitle: 'Ce que le lien change, concrètement',
    points: [
      ['La recommandation est tracée', " : toute inscription passée par votre lien vous est attribuée, à vie."],
      ['Aucun discours à tenir', " : vous partagez un lien, le desk fait la démonstration."],
      ['15% récurrents', " : sur chaque abonnement, chaque mois, plus un mois offert tous les 3 filleuls."],
    ],
    boxTitre: 'Où le mettre',
    box: "Une bio Instagram ou X, la description d'une vidéo, un message épinglé de groupe, une signature de mail : partout où l'on vous demande déjà ce que vous utilisez. Un lien posé une fois travaille pendant des mois.",
    ctaLead: "Récupérez votre lien dans la section Parrainages du desk.",
    ctaLabel: 'Récupérer mon lien', signoff: 'Bien à vous,' },

  { key: 'dormant',
    subject: 'Votre lien de parrainage existe. Il ne sert peut-être à rien.',
    h1: 'Un lien inutilisé ne coûte rien. Il ne rapporte rien non plus.',
    lead: "Message court. Chaque compte DataTradingPro dispose d'un lien de parrainage. Beaucoup n'ont jamais été ouverts une seule fois — ce mail est là pour ceux-là.",
    secTitle: 'Trois choses à savoir, et rien de plus',
    points: [
      ['La commission est de 15%, à vie', " : elle revient chaque mois où votre filleul reste abonné."],
      ['Trois filleuls valent un mois offert', " : ajouté automatiquement à votre abonnement."],
      ["L'offre gratuite Whop suffit", " : parrainer ne demande pas d'être abonné au produit payant."],
    ],
    boxTitre: 'Le seul point qui bloque',
    box: "Votre compte Whop doit porter la MÊME adresse e-mail que votre compte DataTradingPro. C'est par elle que les deux se reconnaissent : avec une autre adresse, votre lien ne s'affichera jamais, quoi que vous fassiez d'autre.",
    ctaLead: "Deux minutes suffisent pour vérifier.",
    ctaLabel: 'Vérifier mon lien', signoff: 'Merci de votre lecture,' },
];
// Rotation STRICTE : l'index vient du serveur (compteur d'envois en KV), jamais du hasard. Un tirage
// aléatoire sur quatre variantes redonne la même une fois sur quatre — soit, à deux envois par an,
// une répétition attendue tous les deux ans en moyenne, exactement ce que le user ne veut pas. Le
// repli sur le semestre calendaire ne sert qu'à l'aperçu admin, où aucun compteur n'existe.
function _parrainVariantIndex() { const d = new Date(); return (d.getFullYear() * 2 + (d.getMonth() >= 6 ? 1 : 0)) % _PARRAIN_VARIANTS.length; }
// Clé de la variante qui partirait pour un index donné — le panel admin l'affiche AVANT l'envoi.
function parrainVariantKey(variant) {
  const n = _PARRAIN_VARIANTS.length;
  const i = Number.isInteger(variant) ? ((variant % n) + n) % n : _parrainVariantIndex();
  return _PARRAIN_VARIANTS[i].key;
}
const PARRAIN_VARIANTES = _PARRAIN_VARIANTS.map(v => ({ key: v.key, subject: v.subject, h1: v.h1 }));
/* APERCU DU PANNEAU PARRAINAGES, DANS LE MAIL (04/09, capture user : « affiche cette section dans
   le template, au lieu de justo tu mets x »). Le mail disait « votre lien vous attend dans la
   section Parrainages » — une instruction, pas une image. Montrer l'ecran d'arrivee fait deux
   choses qu'aucune phrase ne fait : le lecteur RECONNAIT la section quand il y arrive, et il voit
   que le lien existe deja, tout pret, au lieu de l'imaginer comme une demarche a faire.

   ⚠️ LE NOM D'UTILISATEUR EST MASQUE, ET C'EST LE POINT. Le lien reel se termine par le pseudo Whop
   du parrain : reproduire celui de l'admin dans un mail envoye a toute la liste ferait credit de
   CHAQUE inscription a une seule personne, si un lecteur recopiait ce qu'il voit. On affiche donc
   des x. La page de l'espace, elle, reste vraie : elle est publique, et c'est ce qui rend l'apercu
   credible.

   ⚠️ ET AUCUNE SVG, AUCUN FLEXBOX. Le moteur de rendu d'Outlook est celui de Word : il ignore
   `display:flex` et n'affiche pas les SVG en ligne. Cet apercu est donc bati en TABLES avec des
   styles en ligne, comme le reste des mails de la maison — sinon il s'effondrerait en une colonne
   de texte nu chez une partie des lecteurs, precisement ceux qu'on veut convaincre. */
function _apercuParrainages() {
  /* ⚠️ AUCUN SLUG D'ESPACE EN DUR, ET C'EST UNE CORRECTION (04/09, question user : « pourquoi
     c'est actions-7 ? »). J'avais recopie l'adresse vue sur SA capture. Or ce chemin ne vient pas
     de nous : c'est `affiliate_page_url`, l'adresse CANONIQUE que Whop renvoie pour un membre
     donne — le « -7 » est un discriminant fabrique par Whop, pas un choix DTP. Elle n'est donc pas
     la meme pour tout le monde : le code connait deja trois formes (`jot-dtp`, `justonetrader`, et
     celle-la). Reproduire celle d'UN compte dans un mail envoye a TOUTE la liste montrerait a
     chaque lecteur une adresse qui n'est pas la sienne. On masque donc le chemin autant que le
     pseudo : l'apercu montre la FORME du lien, ce qui est vrai pour tout le monde, et le vrai lien
     s'affiche dans le panneau, ou il est lu chez Whop a chaque ouverture. */
  const lien = 'https://whop.com/…/?a=xxxxxxx';
  const tuile = (val, lbl, couleur) => `<td width="50%" style="padding:0 4px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${TOK.encart};border:1px solid ${TOK.filet};border-radius:8px;">
        <tr><td align="center" style="padding:12px 8px;">
          <div style="font-size:20px;font-weight:800;color:${couleur};line-height:1.2;">${val}</div>
          <div style="font-size:11px;color:${TOK.grisDoux};margin-top:3px;">${lbl}</div>
        </td></tr></table></td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${TOK.panneau};border:1px solid ${TOK.filet};border-radius:10px;margin:18px 0;">
    <tr><td style="padding:12px 16px;border-bottom:1px solid ${TOK.filet};">
      <span style="color:${TOK.or};font-size:12px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;">Parrainages</span>
      <span style="color:${TOK.grisPied};font-size:11px;"> &nbsp;·&nbsp; dans votre profil</span>
    </td></tr>
    <tr><td style="padding:14px 16px 16px;">
      <p style="margin:0 0 12px;font-size:13.5px;line-height:1.55;color:#e6e6ea;">Gagnez <strong style="color:${TOK.vert};">15% récurrent</strong> sur chaque parrainage <strong style="color:${TOK.or};">+ 1 mois offert tous les 3 inscrits</strong>.</p>
      <p style="margin:0 0 6px;font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${TOK.grisDoux};">Votre lien de parrainage</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;">
        <tr>
          <td style="background:${TOK.encart};border:1px solid ${TOK.filet};border-radius:6px;padding:9px 11px;font-size:12px;color:${TOK.gris};font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">${_esc(lien)}</td>
          <td width="72" style="padding-left:8px;">
            <div style="background:${TOK.encart};border:1px solid ${TOK.filet};border-radius:6px;padding:9px 0;text-align:center;font-size:12px;font-weight:700;color:#e6e6ea;">Copier</div>
          </td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        ${tuile('0', 'Total filleuls', '#e6e6ea')}
        ${tuile('15%', 'Commission à vie', TOK.vert)}
      </tr></table>
    </td></tr></table>`;
}
function buildCampaignReferral({ name, email, campaign, variant } = {}) {
  campaign = campaign || 'parrainage';
  const n = _PARRAIN_VARIANTS.length;
  const v = _PARRAIN_VARIANTS[Number.isInteger(variant) ? ((variant % n) + n) % n : _parrainVariantIndex()];
  const prenom = (name || '').split(' ')[0] || '';
  const hello = prenom ? `Bonjour ${_esc(prenom)},` : 'Bonjour,';
  const unsub = unsubUrl(email || '');
  const cta = trackClickUrl(campaign, email, APP_URL + '/?parrainage=1');
  const pointsHtml = v.points.map(p => `<tr>
      <td style="padding:5px 10px 5px 0;vertical-align:top;width:12px;"><span style="color:${TOK.or};font-weight:700;">&rarr;</span></td>
      <td style="padding:4px 0;color:#cbd5e1;font-size:13.5px;line-height:1.55;"><strong style="color:#fff;">${_esc(p[0])}</strong>${_esc(p[1])}</td>
    </tr>`).join('');
  /* PAS DE BADGE AU-DESSUS DU TITRE (04/09, capture user : « enleve ce badge du template »). Il
     redisait en capitales ce que le titre dit en clair juste dessous, et il posait un aplat dore
     pleine largeur en tete de mail — la premiere chose lue etait une etiquette, pas la phrase qui
     porte l'offre. Le titre ouvre desormais le mail. Le champ `eyebrow` a ete RETIRE des variantes
     et non simplement laisse de cote : une donnee que plus rien ne rend finit toujours par etre
     re-affichee par quelqu'un qui la trouve inutilisee. */
  const body = `
    ${_H1}${_esc(v.h1)}</p>
    <p style="margin:0 0 6px;font-size:15px;color:#e6e6ea;">${hello}</p>
    <p style="margin:0 0 4px;">${_esc(v.lead)}</p>
    ${_secTitle(_esc(v.secTitle))}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:2px 0 4px;">${pointsHtml}</table>
    ${_goldBox(`<div style="color:${TOK.or};font-weight:800;font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">${_esc(v.boxTitre)}</div><div>${_esc(v.box)}</div>`)}
    ${_apercuParrainages()}
    <p style="margin:0 0 4px;"><strong style="color:#fff;">${_esc(v.ctaLead)}</strong></p>
    <div style="margin:14px 0 4px;">${_campaignBtn(v.ctaLabel, cta)}</div>
    <p style="margin:18px 0 4px;">${_esc(v.signoff)}</p>
    <p style="margin:0 0 16px;color:${TOK.gris};">L'équipe DataTradingPro</p>
    <img src="${trackOpenUrl(campaign, email)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;overflow:hidden;">
  `;
  return { subject: v.subject, html: _campaignLayout('Parrainage', body, unsub), variant: v.key };
}
async function sendCampaignReferral(d) {
  d = d || {};
  const m = buildCampaignReferral({ name: d.name, email: d.email || d.to, campaign: d.campaign || 'parrainage', variant: d.variant });
  if (!m) return false;
  const prov = await _send(d.to, m.subject, m.html);
  return prov ? { provider: prov, variant: m.variant } : false;
}

// ── VOTRE RÉCAP QUOTIDIEN (ex « Point marché », S3) ───────────────────────────────────────
// REFONTE 24/08, demande user : « on offre le récap du jour du desk dans le template pour
// offrir cette valeur ». Le mail ne teasait plus rien : il DONNE le rapport quotidien entier,
// dans l'ordre du desk, sections comprises. Son nom suit : « Votre Récap Quotidien ».
// VOUVOIEMENT assumé (« Votre », pas « Ton ») : tous les mails de campagne vouvoient le
// lecteur, un tutoiement isolé casserait la cohérence demandée le 23/08.
// Source, dans l'ordre : `daily.full` (l'objet _fxr complet, posé par server.js le 24/08),
// puis `daily.sections` en repli (rapports en cache d'avant cette date, et Point Marché
// `kind:'dtpd'` qui n'a JAMAIS de `full`, piège mesuré : il est plus récent que le Récap
// toute la matinée, donc ce repli sert vraiment).
// UNE SEULE IMAGE dans tout le mail (doctrine 24/08) : la Force des Devises du jour. Le
// calendrier n'est plus un PNG, il EST la rubrique « À surveiller », en HTML : un lecteur
// qui bloque les images garde ses dates et son consensus.
// Règle « pas de données -> pas de mail » (renvoie null). 100 % informatif, CTA adapté.
function buildCampaignPointMarche({ name, email, campaign, context, isMember } = {}) {
  campaign = campaign || 'point-hebdo';
  const ctx = context || {};
  /* `dailyRecap` d'abord (24/08) : c'est LE Récap Quotidien, le rapport `_fxr` avec sa structure
     propre (synthèse, géopolitique, banques centrales, macro, les trois séances, à surveiller).
     `daily` peut porter le « Point Marché · Ouverture US », un AUTRE rapport, bâti sur des sections
     et des points clés : le mail affichait donc une structure qui ne ressemblait pas au Récap
     Quotidien du desk, sous un titre qui l'annonçait. Repli sur `daily` pour les appels anciens
     (aperçu admin, tests) qui ne fournissent pas encore le champ. */
  const daily = ctx.dailyRecap || ctx.daily || null;   // { kind, ts, title, dateLabel, summary, insights[], sections[], full }
  const weekly = ctx.weekly || null;
  const bias = Array.isArray(ctx.bias) ? ctx.bias : [];   // [{ ccy, label, signal }]
  const risk = ctx.risk || null;           // { label, description }
  const themeLabel = ctx.themeLabel || '';

  // ⚠️ `full` n'existe QUE sur un Récap Quotidien (kind:'fxr'). Le Point Marché du desk
  // (kind:'dtpd') n'en a pas : lire d.full sans tester le kind rendrait `undefined`.
  const full = (daily && daily.kind === 'fxr' && daily.full && typeof daily.full === 'object' && !Array.isArray(daily.full)) ? daily.full : null;
  // Texte d'ouverture : la synthèse du rapport, COMPLÈTE (plus de plafond qui l'ampute), sinon
  // le premier éclairage, sinon le résumé hebdo. Sert aussi de garde « il y a de la matière ».
  const moves = _md((full && full.summary) || (daily && (daily.summary || (Array.isArray(daily.insights) && daily.insights[0]))) || (weekly && weekly.summary) || '');
  // ── CHEMIN DE REPLI (Point Marché `kind:'dtpd'`, ou rapport en cache d'avant le 24/08) ────
  // DEUX PERTES SÈCHES réparées ici. `_recapQuotidienFull` rend la SYNTHÈSE et les ÉCLAIRAGES
  // du rapport ; le repli, lui, ne déroulait que `sections`. Or `daily.summary` n'était écrit
  // qu'en l'ABSENCE de corps (`corpsRapport ? '' : …`) et `daily.insights` n'était lu nulle
  // part : dès que le Point Marché portait des sections, sa synthèse ET ses points clés
  // disparaissaient du mail. Ce chemin n'est pas théorique : `_freshDaily` (server 20599)
  // sert le Point Marché EN PRIORITÉ tant qu'il est plus récent que le Récap, donc toute la
  // matinée. Les points clés reprennent l'intitulé du desk, « Points clés ».
  const _eclRepli = full ? [] : (Array.isArray(daily && daily.insights) ? daily.insights : [])
    .map(x => _md(typeof x === 'string' ? x : (x && x.text))).filter(Boolean)
    .filter(t => t !== moves);   // le 1er éclairage sert de texte de tête quand il n'y a pas de synthèse
  const corpsRapport = full ? _recapQuotidienFull(full)
    : ((_eclRepli.length ? _secTitle('Points clés') + _eclRepli.map(t => _puceOr(_esc(t))).join('') : '')
       + _recapQuotidienSections(daily && daily.sections));
  // La rubrique « Synthèse » n'existe que dans le rendu `full`. Partout ailleurs, le texte de
  // tête est le SEUL endroit où la synthèse du rapport peut être lue : la taire la jetait.
  const synthEcrite = !!(full && [full.intro, full.summary].some(x => _md(x)));
  // GARDE DURCIE (24/08) : l'ancien test passait au vert avec un SEUL événement de calendrier,
  // donc un mail qui promet le rapport entier pouvait partir avec un corps quasi vide. On exige
  // désormais du RAPPORT : soit son corps rendu, soit au minimum sa synthèse.
  if (!corpsRapport && !moves) return null;

  const prenomRaw = _prenom(name);
  const hello = prenomRaw ? `Bonjour ${_esc(prenomRaw)},` : 'Bonjour,';
  const unsub = unsubUrl(email || '');
  const cta = _campaignCta(isMember, campaign, email);

  // Accroche éditoriale : thème dominant + climat de risque, tissés proprement (jamais de
  // « régime de risque Risk-on (appétit pour le risque) » recopié brut).
  // UN SEUL NIVEAU DE MISE EN AVANT (doctrine 24/08) : le gras doré, et lui seul. La même
  // phrase portait deux teintes de gras, l'or sur le thème et le BLANC sur le climat de
  // risque : deux niveaux dans une seule phrase, exactement ce que la doctrine écarte. Le
  // climat de risque reste écrit en toutes lettres, simplement sans second accent.
  const _riskClause = (() => {
    const l = String((risk && risk.label) || '').toLowerCase();
    if (/off|aversion/.test(l)) return "où l'aversion au risque reprend le dessus";
    if (/on|appétit|appetit/.test(l)) return "porté par l'appétit pour le risque";
    return 'sans biais de risque marqué';
  })();
  let lead = `Voici le récap du jour, tel que le desk le publie, en entier.`;
  if (themeLabel && risk && risk.label) {
    lead = `Le desk garde le cap sur un thème dominant, <strong style="color:${TOK.or};">${_esc(themeLabel)}</strong>, dans un marché ${_riskClause}. Voici le rapport du jour, en entier.`;
  } else if (themeLabel) {
    lead = `Le desk garde le cap sur un thème dominant : <strong style="color:${TOK.or};">${_esc(themeLabel)}</strong>. Voici le rapport du jour, en entier.`;
  } else if (risk && risk.label) {
    lead = `Un marché ${_riskClause}. Voici le rapport du jour, en entier.`;
  }

  // En-tête : le NOM du mail (« Votre Récap Quotidien »), la date du rapport, puis son titre
  // réel débarrassé de son préfixe (le desk écrit « Récap Quotidien: Le dollar recule… » :
  // répéter le préfixe sous le H1 ferait bégayer le mail).
  const dateLbl = _md(daily && daily.dateLabel);
  /* TITRE DU RAPPORT RETIRÉ SOUS L'EN-TÊTE (24/08, demande user : « enlève tout ceci »). Le desk
     titre son rapport « Le dollar recule sur l'atténuation des anticipations de hausse de la Fed… »,
     ce qui est la PREMIÈRE PHRASE de la Synthèse, à deux mots près : le mail annonçait donc la même
     chose deux fois de suite, à trois lignes d'intervalle. L'en-tête garde le nom du mail et la date
     du rapport ; le rapport parle ensuite de lui-même, en commençant par sa Synthèse.
     L'objet du mail, lui, reste inchangé : c'est une autre surface, lue ailleurs. */
  // Les ÉTIQUETTES du rapport suivent la date, exactement comme sur le desk (le lecteur les
  // affiche sous le titre daté). Elles n'existent que sur le rendu `full`.
  /* LA DATE ENTRE DANS LE TITRE (24/08, demande user). Le mail ouvrait sur « Votre Récap
     Quotidien » seul, puis rejetait la date sur une ligne grise en dessous : un intitulé nu, qui
     ne disait pas DE QUAND il parlait avant la ligne suivante. Fondus, ils font un titre daté qui
     se lit d'un trait — et le mail gagne une ligne avant le contenu.
     Le NOM DU PRODUIT est conservé intact : c'est celui annoncé aux clients (entrée DTP du 24/08),
     il porte la reconnaissance du mail. La date le suit en gris, plus légère, pour que le nom
     domine toujours ; sa capitale initiale tombe puisqu'elle n'ouvre plus la phrase. */
  const _dateTitre = dateLbl ? dateLbl.charAt(0).toLowerCase() + dateLbl.slice(1) : '';
  const entete = `${_H1}Votre Récap Quotidien`
    + (_dateTitre ? `<span style="font-weight:500;font-size:15px;color:${TOK.grisDoux};letter-spacing:0;"> — ${_esc(_dateTitre)}</span>` : '')
    + `</p>`
    + (full ? _tagsRapport(full.tags) : '');

  // La synthèse ne s'écrit ici QUE si la rubrique « Synthèse » ne l'a pas déjà écrite. Le test
  // portait avant sur la présence d'un CORPS : dès que le repli `sections` produisait quelque
  // chose, la synthèse du Point Marché n'était plus écrite nulle part. On teste ce qu'il faut
  // tester : la rubrique a-t-elle été rendue, oui ou non.
  const movesHtml = synthEcrite ? '' : _paraHtml(moves, '#e6e6ea', '14px');

  // L'UNIQUE image du mail : le vrai widget du desk, Force des Devises sur LA JOURNÉE (le
  // récap parle du jour, pas de la semaine). Elle porte ce que le texte ne peut pas dire :
  // la trajectoire relative des huit devises, heure par heure.
  /* (Widget Force des Devises RETIRE le 24/08 : le mail est le rapport, rien d autre.) */

  // Le biais du desk, s'il est fourni : une ligne, valeurs réelles, aucune recommandation.
  /* (Ligne « Biais » RETIREE le 24/08 : elle ne fait pas partie du Recap Quotidien du desk.) */

  // PROMESSE HONNÊTE (défaut mesuré) : la phrase affirmait « dans son intégralité » même
  // quand le corps se réduisait à une phrase de synthèse, à l'image et au bouton. On ne
  // promet le rapport entier que lorsqu'il est réellement là.
  const clotureJ = corpsRapport
    /* CLÔTURE (24/08, demande user : « c est bien mais on peut encore améliorer, pour donner
       envie »). La phrase ne vante rien et ne promet aucun gain : elle nomme la SEULE chose qu un
       courrier ne peut pas contenir, le direct. Le rapport que le lecteur vient de finir est déjà
       daté, et le terminal, lui, a continué : c est ce décalage qui donne envie d ouvrir, pas un
       argument de vente. Deux phrases courtes, la seconde enchaînant sur le bouton juste en dessous. */
    ? "Voilà la séance, en entier. Le marché, lui, n'a pas attendu : le calendrier, la force des devises et le Radar de Biais ont déjà bougé depuis."
    : "Le desk publie ce rapport chaque jour. Entre deux éditions, le terminal, lui, ne s'arrête pas.";

  // BOUTON EN TÊTE (même raison que le Récap Hebdo) : le mail porte un rapport entier, donc
  // il peut dépasser le seuil de repliement de Gmail. Un lien d'action placé après le rapport
  // tomberait dans la zone repliée. On ne coupe pas le rapport pour tenir : on place le lien
  // là où il survit et la note de fin prévient du repliement.
  const corpsMail = `${movesHtml}${corpsRapport}`;   // le mail EST le rapport : plus de biais ni de widget a compter
  /* ══ LE MAIL EST LE RAPPORT (24/08, demande user : « enlève tout et met le récap quotidien qu'on
     reçoit sur le desk pour leur offrir ceci ») ══
     Tout ce qui n'est pas le récap est parti : l'accroche éditoriale sur le climat de risque, l'image
     Force des Devises, la ligne de biais du desk, et le bouton qui s'intercalait AVANT le contenu.
     Le lecteur ouvre le mail et tombe directement sur le rapport, dans l'ordre du desk. Ne subsistent
     autour que le strict nécessaire : la salutation, le titre daté du rapport, puis en pied une seule
     invitation à ouvrir le desk, la signature, et le pixel de suivi.
     ⚠️ Ne PAS réintroduire un widget ici : une image en tête repousse le rapport sous la ligne de
     flottaison, et l'ensemble frôle déjà le seuil de repliement de Gmail. */
  const body = `
    <p style="margin:0 0 14px;font-size:15px;color:#e6e6ea;">${hello}</p>
    ${entete}
    ${movesHtml}
    ${corpsRapport}
    <p style="margin:24px 0 12px;font-size:13.5px;line-height:1.6;color:#cbd5e1;">${clotureJ}</p>
    <div style="margin:4px 0 4px;">${cta.btn}</div>
    ${_noteLongue(corpsMail)}
    <p style="margin:16px 0 4px;">Bonne séance,</p>
    <p style="margin:0 0 16px;color:${TOK.gris};">L'équipe DataTradingPro</p>
    <img src="${trackOpenUrl(campaign, email)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;overflow:hidden;">
  `;
  // Sujets ROTATIFS (déterministes par semaine) : le NOM du mail d'abord, la promesse ensuite.
  // Un emoji au plus, jamais deux fois de suite le même objet (délivrabilité).
  const _wk = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
  const _subs = themeLabel ? [
    `📊 Votre Récap Quotidien : ${themeLabel} donne le ton`,
    `🧭 Votre Récap Quotidien : la séance en clair`,
    `👀 Votre Récap Quotidien, en entier`,
  ] : [
    '📊 Votre Récap Quotidien : la séance en clair',
    "🧭 Votre Récap Quotidien : ce que le desk retient",
    '👀 Votre Récap Quotidien, en entier',
  ];
  const subject = _subs[_wk % _subs.length];
  return { subject, html: _campaignLayout('Votre Récap Quotidien', body, unsub) };
}
// UNE seule image embarquée : le calendrier PNG a disparu du corps (la rubrique « À surveiller »
// le rend en HTML). Le garde-fou de _sendWithInlineWidgets l'aurait ignoré de toute façon, mais
// un type listé qui n'existe plus dans le HTML est un piège pour la relecture suivante.
async function sendCampaignPointMarche(d) { d = d || {}; const m = buildCampaignPointMarche({ name: d.name, email: d.email || d.to, campaign: d.campaign, context: d.context, isMember: d.isMember }); if (!m) return false; return _sendWithInlineWidgets(d.to, m.subject, m.html, ['strength:today']); }

// ── OUTLOOK (« la semaine a venir ») — agenda PUR, tourne vers l'avenir, SANS pousser de position. Reutilise le
// VRAI widget calendrier du desk. Regle « pas de donnees -> pas de mail » (renvoie null).
function buildCampaignOutlook({ name, email, campaign, context, isMember } = {}) {
  campaign = campaign || 'outlook-hebdo';
  const ctx = context || {};
  const upcoming = Array.isArray(ctx.upcoming) ? ctx.upcoming : [];
  const waDays = (ctx.weekAhead && Array.isArray(ctx.weekAhead.days)) ? ctx.weekAhead.days : [];
  if (!upcoming.length && !waDays.length) return null;
  const majors = upcoming.filter(e => e.impact === 'High');
  const hiDays = waDays.filter(d => d && String(d.impact || '').toUpperCase() === 'HIGH').length;
  const themeLabel = ctx.themeLabel || '';
  const featured = ctx.featured || majors[0] || upcoming[0] || null;
  const weekLabel = (ctx.weekAhead && ctx.weekAhead.week) || '';
  const prenomRaw = (name || '').split(' ')[0] || '';
  const hello = prenomRaw ? `Bonjour ${_esc(prenomRaw)},` : 'Bonjour,';
  const unsub = unsubUrl(email || '');
  const cta = _campaignCta(isMember, campaign, email);
  // STRUCTURE NEWSLETTER PRO (10/08 — inspiration STRUCTURE de la veille concurrente, jamais de copie) :
  // accroche d'UNE ligne → sommaire annoncé (les rendez-vous en gras, une phrase) → une mini-section
  // PAR JOUR FORT (titre thématique FR du desk + les 2 phrases factuelles du jour) → widget → leçon de
  // clôture en 2 lignes. Paragraphes COURTS (une idée par phrase), gras sur les termes clés.
  // INFORMATIF UNIQUEMENT (veto user) : on dit où regarder, jamais quoi trader.
  const _DOW_FR = { Monday: 'Lundi', Tuesday: 'Mardi', Wednesday: 'Mercredi', Thursday: 'Jeudi', Friday: 'Vendredi', Saturday: 'Samedi', Sunday: 'Dimanche' };
  const _hiDaysList = waDays.filter(d => d && String(d.impact || '').toUpperCase() === 'HIGH').slice(0, 5);
  // Sommaire : les TITRES THÉMATIQUES du desk (« Décision de la Fed », « CPI américain »…), en gras or.
  const _sumTitles = _hiDaysList.map(d => (d.title || '').split(' · ')[0]).filter(Boolean).slice(0, 5);
  const _sommaire = _sumTitles.length > 1
    ? _sumTitles.slice(0, -1).map(t => `<strong style="color:#f3c344;">${_esc(t)}</strong>`).join(', ') + ' et ' + `<strong style="color:#f3c344;">${_esc(_sumTitles[_sumTitles.length - 1])}</strong>`
    : (_sumTitles[0] ? `<strong style="color:#f3c344;">${_esc(_sumTitles[0])}</strong>` : '');
  const count = hiDays || majors.length;
  // REFONTE (retour user 23/08 : « il se répète, il y a l'image du desk et la retranscription
  // textuelle ») : les mini-sections PAR JOUR redisaient exactement ce que le widget Semaine à Venir
  // montre déjà. Le mail devient hiérarchique : le WIDGET porte la liste des journées, le texte ne
  // garde qu'UN zoom éditorial sur le rendez-vous n°1 de la semaine (ce que l'image ne met pas en avant).
  const _zoomDay = (featured && _hiDaysList.find(d => d && d.title && featured.title && String(d.title).toLowerCase().includes(String((featured.title || '').split(' ')[0] || '').toLowerCase()))) || _hiDaysList[0] || null;
  let zoomHtml = '';
  if (_zoomDay) {
    const jour = _DOW_FR[_zoomDay.dow] || _zoomDay.dow || '';
    // Split robuste (même règle que le Point marché) : coupe après .!? SEULEMENT devant une majuscule —
    // « prév. 3,60% » et les décimales ne cassent pas la phrase.
    const desc = String(_zoomDay.description || '').split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ«"'(])/).slice(0, 3).join(' ');
    zoomHtml = _secTitle('Le rendez-vous n°1 de la semaine')
      + _encart(`<div style="color:#ffffff;font-weight:800;font-size:14.5px;">${_esc(_zoomDay.title || '')}</div>`
        + (jour ? `<div style="color:${TOK.or};font-weight:700;font-size:12px;margin-top:3px;">${_esc(jour)}</div>` : '')
        + (desc ? `<div style="color:#aab2c0;font-size:12.5px;line-height:1.55;margin-top:7px;">${_esc(desc)}</div>` : ''), true);
  }
  const body = `
    <p style="margin:0 0 14px;font-size:15px;color:#e6e6ea;">${hello}</p>
    <p style="margin:0 0 14px;">Une nouvelle semaine s'ouvre sur les marchés${weekLabel ? ` (<strong style="color:#fff;">${_esc(weekLabel)}</strong>)` : ''}. 📅</p>
    ${_sommaire
      ? `<p style="margin:0 0 14px;">${count ? `<strong style="color:#fff;">${count} rendez-vous</strong> retiendront` : 'Plusieurs rendez-vous retiendront'} particulièrement l'attention du desk&nbsp;: ${_sommaire}.</p>`
      : `<p style="margin:0 0 14px;">${themeLabel ? `Sur fond d'<strong style="color:#f3c344;">${_esc(themeLabel)}</strong>, plusieurs` : 'Plusieurs'} temps forts se profilent cette semaine.</p>`}
    ${_widgetImg('week-ahead', 'La semaine à venir')}
    <p style="margin:2px 0 0;font-size:12.5px;color:#7b828f;">Le détail de chaque journée (chiffres attendus, contexte, lecture du desk) est en direct sur le Desk.</p>
    ${zoomHtml}
    <div style="margin:22px 0 18px;">${cta.btn}</div>
    <p style="margin:0 0 4px;">Ces publications donneront le ton de la semaine.</p>
    <p style="margin:0 0 14px;">L'essentiel n'est pas d'être devant l'écran à chaque chiffre : c'est de savoir <strong style="color:#fff;">à l'avance lesquels peuvent changer la lecture du marché</strong>. 👀</p>
    <p style="margin:0 0 4px;">Bonne semaine,</p>
    <p style="margin:0 0 16px;color:#9aa3b2;">L'équipe DataTradingPro</p>
    <img src="${trackOpenUrl(campaign, email)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;overflow:hidden;">
  `;
  // Sujets ROTATIFS (déterministes par semaine) : accrocheurs, factuels, jamais deux lundis de suite le même.
  const _wkO = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
  const _subsO = [
    '🗓️ Semaine à venir : les rendez-vous qui comptent',
    '👀 La semaine qui arrive mérite votre attention',
    "🧭 L'agenda de la semaine, trié par le desk",
  ];
  const subject = _subsO[_wkO % _subsO.length];
  return { subject, html: _campaignLayout('Semaine à venir', body, unsub) };
}
async function sendCampaignOutlook(d) { d = d || {}; const m = buildCampaignOutlook({ name: d.name, email: d.email || d.to, campaign: d.campaign, context: d.context, isMember: d.isMember }); if (!m) return false; return _sendWithInlineWidgets(d.to, m.subject, m.html, ['week-ahead']); }

// (Template « Alerte macro / banque centrale » supprime a la demande user — 2026-07-12.)

// Variante TEXTE PURE — pensée pour maximiser la boîte PRINCIPALE : aucune image, aucun pixel de suivi,
// aucun lien tracé (lien direct visible), HTML minimal (ressemble à un e-mail perso). On perd le suivi
// ouvertures/clics : à réserver aux e-mails où le placement prime (ex. bienvenue). Garde la désinscription.
function buildCampaignIntroPlain({ name, email } = {}) {
  const prenomRaw = (name || '').split(' ')[0] || '';
  const hello = prenomRaw ? `Bonjour ${_esc(prenomRaw)},` : 'Bonjour,';
  const unsub = unsubUrl(email || '');
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#222222;max-width:600px;">
    <p style="margin:0 0 14px;">${hello}</p>
    <p style="margin:0 0 14px;">Merci de faire partie de DataTradingPro. Chaque semaine, je vous enverrai un court e-mail pour rendre le marché macro et forex plus lisible, en français : le récap de la semaine, la force des devises et le ton des banques centrales, expliqués simplement, sans jamais vous pousser à prendre position.</p>
    <p style="margin:0 0 14px;">Vous pouvez explorer le terminal quand vous voulez : <a href="https://datatradingpro.com" style="color:#1a56db;">datatradingpro.com</a></p>
    <p style="margin:0 0 14px;">À très vite,<br>L'équipe DataTradingPro</p>
    <p style="margin:18px 0 0;font-size:12px;color:#999999;">Pour ne plus rater nos e-mails, ajoutez contact@datatradingpro.com à vos contacts.<br>
    <a href="${unsub}" style="color:#999999;">Se désabonner</a></p>
  </div>`;
  const subject = '👋 Bienvenue au desk : voici votre semaine type';
  return { subject, html };
}
async function sendCampaignIntroPlain(d) { d = d || {}; const m = buildCampaignIntroPlain({ name: d.name, email: d.email || d.to }); return _send(d.to, m.subject, m.html); }

// ── Rappel ADMIN : abonnements à renouveler (envoyé à datatradingpro.contact) ──
function buildAdminExpiryReminder({ clients }) {
  const rows = (clients || []).map(c => {
    const end  = new Date(c.expiresAt);
    const days = Math.ceil((end.getTime() - Date.now()) / 86400000);
    const when = end.toLocaleDateString('fr-FR');
    const state = days < 0
      ? `<span style="color:${TOK.rouge};font-weight:700;">EXPIRÉ depuis ${-days}j</span>`
      : `<span style="color:${TOK.ambre};font-weight:700;">expire dans ${days}j</span>`;
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #232429;color:#fff;font-size:13px;">${_esc(c.name || '-')}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #232429;color:#9aa3b2;font-size:13px;font-family:monospace;">${_esc(c.email)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #232429;color:#9aa3b2;font-size:13px;">${when}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #232429;font-size:12px;">${state}</td>
    </tr>`;
  }).join('');
  const body = `
    ${_H1}⏰ Abonnements à vérifier</p>
    <p style="margin:0 0 14px;">Voici les clients dont l'abonnement <strong style="color:#fff;">expire bientôt ou vient d'expirer</strong>. Pense à les renouveler (paiement Whop) dans l'admin.</p>
    <p style="margin:0 0 8px;color:#9aa3b2;font-size:12px;">⚠️ Délai de grâce : ces clients gardent l'accès <strong style="color:#fff;">48h après expiration</strong>. Au-delà, leur connexion sera bloquée automatiquement.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#101014;border:1px solid #232429;border-radius:10px;margin:14px 0;border-collapse:collapse;">
      <tr><th style="padding:8px 10px;text-align:left;color:#6b7280;font-size:10px;text-transform:uppercase;border-bottom:1px solid #232429;">Nom</th>
          <th style="padding:8px 10px;text-align:left;color:#6b7280;font-size:10px;text-transform:uppercase;border-bottom:1px solid #232429;">Email</th>
          <th style="padding:8px 10px;text-align:left;color:#6b7280;font-size:10px;text-transform:uppercase;border-bottom:1px solid #232429;">Échéance</th>
          <th style="padding:8px 10px;text-align:left;color:#6b7280;font-size:10px;text-transform:uppercase;border-bottom:1px solid #232429;">État</th></tr>
      ${rows}
    </table>
    ${_button('Ouvrir le panel admin', APP_URL + '/admin')}
    <p style="margin:0;font-size:13px;">Rappel automatique DataTradingPro</p>`;
  return { subject: `DataTradingPro : ${(clients || []).length} abonnement(s) à renouveler`, html: _layout('Rappel abonnements', body) };
}
async function sendAdminExpiryReminder({ clients, to }) {
  if (!clients || !clients.length) return false;
  const m = buildAdminExpiryReminder({ clients });
  return _send(to || SUPPORT_EMAIL, m.subject, m.html);
}

// ── Notif ADMIN : un paiement/renouvellement DTP a eu lieu (→ datatradingpro.contact) ──
function buildAdminRenewalNotice({ clientEmail, clientName, expiresAt, isNew }) {
  const end = expiresAt ? new Date(expiresAt).toLocaleDateString('fr-FR') : 'illimité';
  const kind = isNew ? 'Nouveau client DTP' : 'Renouvellement DTP';
  const body = `
    ${_H1}✅ ${_esc(kind)}</p>
    <p style="margin:0 0 14px;">Un paiement Whop <strong style="color:#fff;">JOT DTP</strong> a été traité automatiquement :</p>
    ${_credBox([['Client', clientName || clientEmail], ['Email', clientEmail], ["Accès jusqu'au", end], ['Action', isNew ? 'Compte créé' : 'Abonnement renouvelé']])}
    <p style="margin:0;font-size:13px;color:#9aa3b2;">Le compte a été ${isNew ? 'créé' : 'mis à jour'} et le client a été notifié par email. Aucune action de ta part.</p>`;
  return { subject: `DTP : ${kind} : ${clientEmail}`, html: _layout('Notification DTP', body) };
}
async function sendAdminRenewalNotice({ clientEmail, clientName, expiresAt, isNew, to }) {
  const m = buildAdminRenewalNotice({ clientEmail, clientName, expiresAt, isNew });
  return _send(to || SUPPORT_EMAIL, m.subject, m.html);
}

// ══════════════════════════════════════════════════════════════════════════════
//  PRÉVISUALISATION — catalogue + galerie HTML (route admin /api/emails/preview)
// ══════════════════════════════════════════════════════════════════════════════

// État des fournisseurs configurés (affiché en tête de la galerie)
function getProviderStatus() {
  const gmail   = !!(GMAIL_USER && GMAIL_APP_PASSWORD);
  const mailjet = !!(MAILJET_API_KEY && MAILJET_SECRET_KEY);
  const resend  = !!RESEND_API_KEY;
  const order = [];
  if (gmail)   order.push('Gmail');
  if (mailjet) order.push('Mailjet');
  if (resend)  order.push('Resend');
  return { gmail, mailjet, resend, from: EMAIL_FROM, support: SUPPORT_EMAIL, order };
}

// Liste de TOUS les emails avec un rendu d'exemple (données factices). Sert au preview + à la doc.

// ── RENOUVELLEMENT AUTOMATIQUE DÉSACTIVÉ (30/07) ────────────────────────────────────────────────
//    Déclencheur PRÉVU : un client coupe le renouvellement automatique côté Whop, alors que son
//    abonnement court encore. AUCUN ENVOI N'EST BRANCHÉ à ce jour — le template existe, il est
//    visible dans le panel admin, et il attend validation avant d'être relié au webhook.
//    Ton : informatif. On énonce la date d'échéance, ce qui s'arrête précisément, et on rappelle
//    que ne rien faire est un choix valable. Pas de compte à rebours anxiogène.
function buildAutoRenewOff({ name, expiresAt }) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher trader');
  const fin = expiresAt
    ? new Date(expiresAt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  // Jours RESTANTS (et non écoulés : _delai compte le retard d'une échéance passée).
  const restants = expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000)) : null;
  const quand = restants == null ? 'à la fin de la période en cours'
    : restants === 0 ? "aujourd'hui"
    : restants === 1 ? 'demain'
    : `dans ${restants} jours`;
  const body = `
    ${_H1}Votre renouvellement automatique est désactivé</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Votre abonnement DataTradingPro arrive à échéance <strong style="color:#fff;">${quand}</strong>${fin ? ` (le ${fin})` : ''}. Le renouvellement automatique étant désactivé, il <strong style="color:#fff;">prendra fin à cette date</strong> et ne sera pas reconduit.</p>
    ${_secTitle("Ce qui s'arrête à l'échéance")}
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 14px;">
      <tr><td style="padding:5px 0;color:#cbd5e1;font-size:14px;">→ Le desk en temps réel : news, squawk, calendrier économique et résultats live</td></tr>
      <tr><td style="padding:5px 0;color:#cbd5e1;font-size:14px;">→ <strong style="color:#fff;">Mon Desk</strong> et vos dispositions de widgets enregistrées</td></tr>
      <tr><td style="padding:5px 0;color:#cbd5e1;font-size:14px;">→ Votre <strong style="color:#fff;">Journal de trading</strong>, ses statistiques et sa courbe d'équité</td></tr>
      <tr><td style="padding:5px 0;color:#cbd5e1;font-size:14px;">→ L'onglet Biais, la Recherche bancaire et les récaps hebdomadaires</td></tr>
    </table>
    <p style="margin:0 0 14px;">Vos données ne sont pas supprimées à l'échéance : votre desk reste en place et vous attend si vous revenez. Seul l'accès se ferme.</p>
    ${_button('Réactiver le renouvellement automatique', WHOP_RENEW_URL)}
    <p style="margin:0 0 14px;font-size:13px;color:#9aa3b2;">Sans engagement : le renouvellement se coupe à nouveau quand vous le souhaitez, depuis votre espace Whop.</p>
    ${_goldBox(`<strong style="color:${TOK.or};">Si cette désactivation est volontaire, vous n'avez rien à faire</strong> : votre accès reste entier jusqu'${fin ? 'au ' + fin : "à l'échéance"}.`)}
    <p style="margin:0;font-size:13px;">À bientôt sur le desk,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: 'Votre abonnement DataTradingPro ne sera pas renouvelé', html: _layout('Renouvellement automatique désactivé', body) };
}
async function sendAutoRenewOff(d) { const m = buildAutoRenewOff(d); return _send(d.to, m.subject, m.html); }

function getEmailCatalog() {
  const now = Date.now();
  const s = { to: 'paul.client@example.com', name: 'Paul Martin', password: 'Xy7k-92Qm-Rs', expiresAt: now + 30 * 86400000 };
  const sampleClients = [
    { name: 'Paul Martin',  email: 'paul.client@example.com', expiresAt: now + 3 * 86400000 },
    { name: 'Marie Dupont', email: 'marie.d@example.com',     expiresAt: now - 1 * 86400000 },
  ];
  return [
    { key: 'welcome',       audience: 'Client', label: 'Bienvenue',                       trigger: 'À la création du compte client',              ...buildWelcome(s) },
    { key: 'passwordReset', audience: 'Client', label: 'Réinitialisation du mot de passe', trigger: 'Reset MDP (admin ou « mot de passe oublié »)', ...buildPasswordReset(s) },
    { key: 'forgotNoSub',   audience: 'Client', label: 'MDP oublié : abonnement inactif',   trigger: '« Mot de passe oublié » sur un compte sans abonnement actif', ...buildForgotNoSub(s) },
    { key: 'trialUpsell',   audience: 'Client', label: 'Fin d\'essai gratuit',             trigger: 'Le jour où l\'essai 7 jours expire',          ...buildTrialUpsell(s) },
    { key: 'renewalFailed', audience: 'Client', label: 'Échec de renouvellement',          trigger: 'Abonnement non renouvelé → accès suspendu',   ...buildRenewalFailed(s) },
    { key: 'reactivated',   audience: 'Client', label: 'Compte réactivé',                  trigger: 'Compte remis en actif (paiement ou admin)',   ...buildReactivated(s) },
    { key: 'renewed',       audience: 'Client', label: 'Abonnement renouvelé',             trigger: 'Paiement Whop renouvelé',                     ...buildRenewed(s) },
    { key: 'reengagement',  audience: 'Client', label: 'Réengagement (inactif ~7j)',       trigger: 'Utilisateur inactif depuis ~7 jours',         ..._buildReengagement(s.name, 7) },
    // AUCUN ENVOI BRANCHÉ : visible ici pour relecture/validation avant d'être relié au webhook Whop.
    { key: 'autoRenewOff', audience: 'Client', label: 'Renouvellement auto désactivé',  trigger: 'Client coupe le renouvellement auto : AUCUN ENVOI AUTOMATIQUE (à valider)', ...buildAutoRenewOff({ name: s.name, expiresAt: now + 7 * 86400000 }) },
    { key: 'announcementV2', audience: 'Client', label: 'Annonce : v2 finalisée',           trigger: 'Broadcast manuel (admin) → tous les clients',  ...buildAnnouncementV2({ name: s.name }) },
    { key: 'campaignIntro', audience: 'Client + Whop', label: 'Campagne : intro hebdo',       trigger: 'Broadcast campagne (admin) → clients DTP + Whop', ...buildCampaignIntro({ name: s.name, email: s.to }) },
    { key: 'adminExpiry',   audience: 'Admin',  label: 'Rappel abonnements à renouveler',  trigger: 'Rappel automatique (→ toi)',                  ...buildAdminExpiryReminder({ clients: sampleClients }) },
    { key: 'adminRenewal',  audience: 'Admin',  label: 'Notif paiement / nouveau client',  trigger: 'Paiement Whop traité (→ toi)',                ...buildAdminRenewalNotice({ clientEmail: s.to, clientName: s.name, expiresAt: s.expiresAt, isNew: true }) },
    { key: 'referralInvite',   audience: 'Client', label: 'Parrainage : invitation (à l\'unité)', trigger: 'Envoi manuel à une personne — mail répondable, sans suivi', ...buildReferralInvite({ name: s.name }) },
    { key: 'referralInviteLien', audience: 'Client', label: 'Parrainage : invitation (lien connu)', trigger: 'Idem, quand le lien Whop est déjà résolu', ...buildReferralInvite({ name: s.name, lien: 'https://whop.com/jot-dtp/?a=votrepseudo' }) },
    { key: 'parrainCamp1', audience: 'Client + Whop', label: 'Parrainage semestriel : variante 1/4 — revenu', trigger: 'Tous les 6 mois → toute la base (rotation, envoi 1)', ...buildCampaignReferral({ name: s.name, email: s.to, campaign: 'parrainage-apercu', variant: 0 }) },
    { key: 'parrainCamp2', audience: 'Client + Whop', label: 'Parrainage semestriel : variante 2/4 — rembourse', trigger: 'Tous les 6 mois → toute la base (rotation, envoi 2)', ...buildCampaignReferral({ name: s.name, email: s.to, campaign: 'parrainage-apercu', variant: 1 }) },
    { key: 'parrainCamp3', audience: 'Client + Whop', label: 'Parrainage semestriel : variante 3/4 — deja', trigger: 'Tous les 6 mois → toute la base (rotation, envoi 3)', ...buildCampaignReferral({ name: s.name, email: s.to, campaign: 'parrainage-apercu', variant: 2 }) },
    { key: 'parrainCamp4', audience: 'Client + Whop', label: 'Parrainage semestriel : variante 4/4 — dormant', trigger: 'Tous les 6 mois → toute la base (rotation, envoi 4)', ...buildCampaignReferral({ name: s.name, email: s.to, campaign: 'parrainage-apercu', variant: 3 }) },
    { key: 'referredWelcome',  audience: 'Client', label: 'Parrainage : bienvenue filleul',  trigger: 'Un filleul s\'inscrit via un parrain',          ...buildReferredWelcome({ name: s.name, referrerName: 'Alex' }) },
    { key: 'referralCredited', audience: 'Client', label: 'Parrainage : filleul confirmé', trigger: 'Un filleul s\'abonne via votre lien',          ...buildReferralCredited({ name: s.name, count: 1, untilNext: 2 }) },
    { key: 'referralReward',   audience: 'Client', label: 'Parrainage : mois offert',       trigger: '3 parrainages atteints → 1 mois offert',      ...buildReferralReward({ name: s.name, count: 3, newExpiresAt: now + 30 * 86400000 }) },
    { key: 'adminReferral',    audience: 'Admin',  label: 'Parrainage : mois crédité (→ toi)', trigger: 'Un membre débloque un mois offert',         ...buildAdminReferralReward({ refEmail: s.to, refName: s.name, count: 3, newExpiresAt: now + 30 * 86400000 }) },
  ];
}

// Galerie HTML (dark HUD) : statut fournisseurs + une carte par email (iframe = rendu réel isolé)
function renderEmailGallery(catalog, status) {
  const cat = catalog || getEmailCatalog();
  const st  = status  || getProviderStatus();
  const chip = (on, label) => `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700;
    background:${on ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.05)'};border:1px solid ${on ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.12)'};color:${on ? '#22c55e' : '#6b7280'};">
    <span style="width:7px;height:7px;border-radius:50%;background:${on ? '#22c55e' : '#52525b'};"></span>${_esc(label)}</span>`;
  const cards = cat.map(e => {
    const audColor = e.audience === 'Admin' ? '#f3c344' : '#3f9280';
    return `<section style="background:#16171b;border:1px solid #232429;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;">
      <div style="padding:14px 16px;border-bottom:1px solid #232429;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;">
          <span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#0a0a0c;background:${audColor};padding:2px 8px;border-radius:4px;">${_esc(e.audience)}</span>
          <h2 style="margin:0;font-size:15px;font-weight:700;color:#fff;">${_esc(e.label)}</h2>
        </div>
        <div style="font-size:12px;color:#8a8a90;margin-bottom:4px;">⏱ ${_esc(e.trigger)}</div>
        <div style="font-size:12.5px;color:#cbd5e1;"><span style="color:#6b7280;">Objet :</span> ${_esc(e.subject)}</div>
      </div>
      <iframe sandbox="" loading="lazy" style="width:100%;height:560px;border:0;background:#0a0a0c;" srcdoc="${_esc(e.html)}"></iframe>
    </section>`;
  }).join('');
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DataTradingPro : Aperçu des emails</title>
<style>
  *{box-sizing:border-box;}
  body{margin:0;background:#0a0a0c;color:#e6e9ef;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,sans-serif;padding:28px;}
  .hd{max-width:1320px;margin:0 auto 22px;}
  .hd h1{margin:0 0 4px;font-size:22px;font-weight:800;letter-spacing:-.02em;}
  .hd h1 .o{color:#f3c344;}
  .hd .sub{color:#8a8a90;font-size:13px;margin-bottom:14px;}
  .panel{background:#16171b;border:1px solid #232429;border-radius:12px;padding:14px 16px;display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;}
  .panel .lbl{font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.04em;}
  .panel .from{font-size:12.5px;color:#cbd5e1;font-family:monospace;}
  .grid{max-width:1320px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:18px;}
</style></head>
<body>
  <div class="hd">
    <h1>Data<span class="o">TradingPro</span> : Aperçu des emails</h1>
    <div class="sub">${cat.length} emails transactionnels · rendus avec des données d'exemple</div>
    <div class="panel">
      <span class="lbl">Envoi</span>
      ${chip(st.gmail, 'Gmail SMTP')} ${chip(st.mailjet, 'Mailjet')} ${chip(st.resend, 'Resend')}
      <span class="lbl" style="margin-left:8px;">Ordre</span>
      <span class="from">${_esc((st.order || []).join('  →  ') || 'aucun fournisseur')}</span>
      <span class="lbl" style="margin-left:8px;">Expéditeur</span>
      <span class="from">${_esc(st.from)}</span>
    </div>
  </div>
  <div class="grid">${cards}</div>
</body></html>`;
}

// ── 9) Parrainage : filleul confirmé (→ parrain) ─────────────────────────────
function buildReferralCredited({ name, count, untilNext }) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher client');
  const restant = `${untilNext} parrainage${untilNext > 1 ? 's' : ''}`;
  const body = `
    ${_H1}Nouveau filleul confirmé 🎉</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom}, un nouvel abonné vient de rejoindre <strong style="color:#fff;">DataTradingPro</strong> grâce à votre lien de parrainage. Merci !</p>
    ${_credBox([['Filleuls confirmés', String(count)], ['Avant 1 mois offert', restant]])}
    <p style="margin:0 0 14px;">Plus que <strong style="color:#f3c344;">${restant}</strong> et nous créditons <strong style="color:#fff;">1 mois d'accès offert</strong> sur votre compte.</p>
    ${_button('Voir mes parrainages', APP_URL)}
    <p style="margin:0;font-size:13px;">À très vite,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: `DataTradingPro : nouveau filleul confirmé (${count})`, html: _layout('Parrainage', body) };
}
async function sendReferralCredited(d) { const m = buildReferralCredited(d); return _send(d.to, m.subject, m.html); }

// ── 10) Parrainage : mois offert débloqué (→ parrain) ────────────────────────
function buildReferralReward({ name, count, newExpiresAt }) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher client');
  const end = newExpiresAt ? new Date(newExpiresAt).toLocaleDateString('fr-FR') : '';
  const body = `
    ${_H1}🎁 1 mois offert débloqué !</p>
    <p style="margin:0 0 14px;">Bravo ${prenom} : vous avez atteint <strong style="color:#fff;">${count} parrainages</strong>. Comme promis, nous ajoutons <strong style="color:#f3c344;">1 mois d'accès offert</strong> à votre abonnement DataTradingPro.</p>
    ${_credBox([['Récompense', "1 mois d'accès offert"], ['Accès prolongé jusqu\'au', end]])}
    <p style="margin:0 0 14px;font-size:13px;color:#9aa3b2;">Le mois est appliqué automatiquement à votre accès. Continuez à parrainer : chaque 3 parrainages = un mois de plus.</p>
    ${_button('Ouvrir mon desk', APP_URL)}
    <p style="margin:0;font-size:13px;">Merci de faire grandir la communauté,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: `DataTradingPro : 🎁 mois offert débloqué (palier ${count})`, html: _layout('Récompense parrainage', body) };
}
async function sendReferralReward(d) { const m = buildReferralReward(d); return _send(d.to, m.subject, m.html); }

// ── 11) Parrainage : notif ADMIN (→ toi) ─────────────────────────────────────
function buildAdminReferralReward({ refEmail, refName, count, newExpiresAt }) {
  const end = newExpiresAt ? new Date(newExpiresAt).toLocaleDateString('fr-FR') : '';
  const body = `
    ${_H1}Mois offert crédité (parrainage)</p>
    <p style="margin:0 0 10px;">Un membre a atteint un palier de parrainage. <strong>1 mois d'accès DTP</strong> lui a été crédité automatiquement.</p>
    ${_credBox([['Membre', refName || refEmail], ['Email', refEmail], ['Parrainages', String(count)], ['Accès prolongé au', end]])}
    <p style="margin:0;font-size:13px;color:#9aa3b2;">Pour offrir aussi le mois côté <strong>facturation Whop</strong>, appliquez-le manuellement dans le tableau de bord Whop (le crédit ci-dessus ne touche que l'accès DTP, pas la facturation).</p>`;
  return { subject: `DTP : mois offert crédité · ${refEmail}`, html: _layout('Admin : parrainage', body) };
}
async function sendAdminReferralReward(d) { const m = buildAdminReferralReward(d); const to = d.to || process.env.ADMIN_EMAIL || SUPPORT_EMAIL; return _send(to, m.subject, m.html); }

// ── 12) Parrainage : bienvenue du FILLEUL (→ le parrainé) ────────────────────
function buildReferredWelcome({ name, referrerName }) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher trader');
  const par = referrerName ? _esc(referrerName) : 'votre parrain';
  const body = `
    ${_H1}Bienvenue 🤝 : et à vous de jouer</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom}, vous avez rejoint <strong style="color:#fff;">DataTradingPro</strong> grâce à ${par}. Vous pouvez maintenant en profiter à votre tour avec notre programme de parrainage.</p>
    ${_goldBox(`<div style="text-align:center;">
        <div style="font-size:22px;font-weight:800;color:${TOK.or};letter-spacing:-.01em;">3 inscrits&nbsp;=&nbsp;1 mois offert</div>
        <div style="font-size:13px;margin-top:6px;">Et ça se cumule : chaque palier de 3 filleuls ajoute un mois d'accès.</div>
      </div>`)}
    <p style="margin:0 0 14px;">Partagez votre lien personnel : à chaque <strong style="color:#fff;">3ᵉ</strong> abonné venu grâce à vous, nous créditons <strong style="color:#f3c344;">1 mois d'accès offert</strong> sur votre compte. Votre lien se trouve dans <strong style="color:#fff;">Profil&nbsp;▸&nbsp;Parrainages</strong>.</p>
    ${_button('Voir mon lien de parrainage', APP_URL)}
    <p style="margin:0;font-size:13px;">Bon trading,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: 'DataTradingPro : bienvenue 🎁 3 inscrits = 1 mois offert', html: _layout('Parrainage : bienvenue', body) };
}
async function sendReferredWelcome(d) { const m = buildReferredWelcome(d); return _send(d.to, m.subject, m.html); }

// ── 13) Parrainage : L'INVITATION (→ tous les clients) ───────────────────────
/* Les trois e-mails de parrainage ci-dessus réagissent tous à un ÉVÉNEMENT : un filleul confirmé, un
   palier atteint, une inscription via un parrain. Aucun ne DIT au client que le programme existe —
   il ne pouvait le découvrir qu'en ouvrant le panneau Parrainages de lui-même. Celui-ci est
   l'annonce : il s'envoie en campagne, une fois, à la base entière.
   DEUX FORMES, SELON CE QU'ON SAIT DU DESTINATAIRE. Si son lien d'affiliation Whop est déjà
   résolvable (`lien` fourni), l'e-mail le PORTE : rien à faire, il copie et partage. Sinon il donne
   les deux étapes pour l'obtenir. Envoyer les étapes à quelqu'un qui a déjà son lien serait lui
   faire refaire un travail déjà fait — et c'est le genre de détail qui fait fermer un e-mail.
   ⚠️ LA MÊME ADRESSE DES DEUX CÔTÉS EST MISE EN AVANT, PAS EN NOTE DE BAS. C'est la seule cause
   d'échec du parcours : Whop et le desk se reconnaissent par l'e-mail, et un parrain qui s'inscrit
   sur Whop avec une autre adresse ne verra jamais son lien apparaître. */
function buildReferralInvite({ name, lien, joinUrl } = {}) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher trader');
  const rejoindre = _esc(joinUrl || 'https://whop.com/justonetrader/');
  const aLeLien = !!(lien && String(lien).trim());
  const bloclien = aLeLien
    ? `${_secTitle('Votre lien de parrainage')}
       ${_encart(`<p style="margin:0 0 8px;font-size:12px;color:#9aa3b2;">Copiez-le et partagez-le&nbsp;: chaque abonnement passé par ce lien vous est attribué à vie.</p>
         <p style="margin:0;word-break:break-all;"><a href="${_esc(lien)}" style="color:${TOK.or};text-decoration:none;font-weight:700;">${_esc(lien)}</a></p>`, true)}`
    : `${_secTitle('Obtenir votre lien — 2 minutes')}
       ${_encart(`<p style="margin:0 0 10px;"><strong style="color:${TOK.blanc};">1.</strong> Sur le desk, ouvrez <strong style="color:${TOK.blanc};">Profil&nbsp;▸&nbsp;Parrainages</strong>. Si votre lien s'y trouve déjà, c'est terminé.</p>
         <p style="margin:0 0 10px;"><strong style="color:${TOK.blanc};">2.</strong> Sinon, créez votre compte <a href="${rejoindre}" style="color:${TOK.or};text-decoration:none;">Whop</a> (gratuit) et rejoignez l'espace <strong style="color:${TOK.blanc};">JustOneTrader</strong>&nbsp;: <strong style="color:${TOK.or};">l'offre gratuite suffit</strong>, vous n'avez rien à payer.</p>
         <p style="margin:0;">Revenez ensuite sur <strong style="color:${TOK.blanc};">Parrainages</strong> et cliquez sur «&nbsp;J'ai rejoint — vérifier&nbsp;»&nbsp;: votre lien apparaît.</p>`, true)}`;
  const body = `
    ${_H1}15% à vie sur chaque abonné que vous amenez</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom}, le <strong style="color:#fff;">parrainage DataTradingPro</strong> est ouvert. Vous partagez votre lien, et chaque personne qui s'abonne grâce à vous vous rapporte&nbsp;— tous les mois, tant qu'elle reste.</p>
    ${_goldBox(`<div style="text-align:center;">
        <div style="font-size:22px;font-weight:800;color:${TOK.or};letter-spacing:-.01em;">15%&nbsp;à vie&nbsp;·&nbsp;3 inscrits&nbsp;=&nbsp;1 mois offert</div>
        <div style="font-size:13px;margin-top:6px;">La commission est récurrente, pas une prime unique. Et tous les 3 filleuls, nous ajoutons un mois d'accès à votre abonnement.</div>
      </div>`)}
    ${bloclien}
    ${_encart(`<p style="margin:0;font-size:13px;color:#e6e6ea;"><strong style="color:${TOK.or};">Important&nbsp;:</strong> utilisez sur Whop <strong style="color:${TOK.blanc};">la même adresse e-mail</strong> que celle de votre compte DataTradingPro. C'est par elle que les deux se reconnaissent&nbsp;— avec une autre adresse, votre lien ne s'affichera jamais.</p>`)}
    <p style="margin:0 0 14px;font-size:13px;color:#9aa3b2;">Vos commissions sont suivies et versées <strong style="color:#e6e6ea;">directement par Whop</strong>&nbsp;; vous les retrouvez dans votre espace Whop. Votre compteur de filleuls, lui, s'affiche en direct dans votre panneau Parrainages.</p>
    ${_button(aLeLien ? 'Ouvrir mes parrainages' : 'Obtenir mon lien', APP_URL)}
    <p style="margin:0;font-size:13px;">Merci de faire grandir le desk,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: 'DataTradingPro : 15% à vie sur chaque abonné que vous amenez', html: _layout('Parrainage', body, { repondable: true }) };
}
async function sendReferralInvite(d) { const m = buildReferralInvite(d); return _send(d.to, m.subject, m.html); }

// Alerte ADMIN — monitoring IA (provider en rouge / quota proche épuisement). L'anti-spam (cooldown)
// est géré côté serveur ; ici on se contente d'envoyer via la chaîne habituelle (OVH→Gmail).
async function sendAdminAlert({ subject, html, to } = {}) {
  const dest = to || process.env.ADMIN_EMAIL || SUPPORT_EMAIL;
  const body = '<h2 style="color:#f3c344;margin:0 0 12px;">🚨 Alerte monitoring IA</h2>' + (html || '')
    + '<p style="color:#6b7280;font-size:12px;margin-top:16px;">Détails en direct : <a href="https://desk.datatradingpro.com/admin" style="color:#f3c344;">dashboard IA Monitor</a>.</p>';
  return _send(dest, '[DTP Alerte IA] ' + (subject || 'Alerte'), _layout('Alerte monitoring IA', body));
}

module.exports = {
  // envoi (API publique inchangée)
  sendWelcome, sendRenewalFailed, sendExpired, sendReactivated, sendRenewed, sendPasswordReset, sendForgotNoSub,
  sendTrialUpsell, sendAutoRenewOff, sendReengagement, _buildReengagement, sendAdminExpiryReminder, sendAdminRenewalNotice,
  sendReferralCredited, sendReferralReward, sendAdminReferralReward, sendReferredWelcome,
  sendReferralInvite, buildReferralInvite,
  sendCampaignReferral, buildCampaignReferral, PARRAIN_VARIANTES, parrainVariantKey,
  sendAnnouncementV2, sendGestureMonth, sendLaunchLive, sendCampaignIntro, sendCampaignIntroPlain, sendWeeklyDigest, sendCampaignDecryptage, sendCampaignPointMarche, sendCampaignMindset, sendCampaignOutlook, sendCampaignInvitation,
  // désinscription campagne (opt-out) — server.js vérifie le même jeton
  unsubToken, unsubUrl,
  // tracking ouvertures/clics — server.js vérifie mailer.trackToken
  trackToken, trackOpenUrl, trackClickUrl,
  // build (rendu sans envoi) — pour la preview
  buildWelcome, buildRenewalFailed, buildExpired, buildReactivated, buildRenewed, buildPasswordReset, buildForgotNoSub,
  buildTrialUpsell, buildAutoRenewOff, buildReengagement, buildAdminExpiryReminder, buildAdminRenewalNotice,
  buildExpiredFollowup, sendExpiredFollowup, buildWinback, sendWinback, buildTemoignage, sendTemoignage, TEMOIGN_VARIANTES, pickTemoignVariante,
  buildReferralCredited, buildReferralReward, buildAdminReferralReward, buildReferredWelcome,
  listMindsetConcepts,
  buildAnnonceWidgets, sendAnnonceWidgets,
  buildAnnouncementV2, buildAnnouncementDesktop, sendAnnouncementDesktop, buildAnnonceDesk, sendAnnonceDesk, buildGestureMonth, buildLaunchLive, buildCampaignIntro, buildCampaignIntroPlain, buildWeeklyDigest, buildCampaignDecryptage, buildCampaignPointMarche, pickDecryptConcept, DECRYPT_CONCEPTS, buildCampaignMindset, pickMindsetConcept, MINDSET_CONCEPTS, buildCampaignOutlook, buildCampaignInvitation,
  // preview / doc
  getEmailCatalog, getProviderStatus, renderEmailGallery,
  // monitoring / vérification
  verifyGmail, getMailHealth, sendTest, sendAdminAlert,
};

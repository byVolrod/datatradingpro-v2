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
      console.log('[Mailer] ✅ API Gmail vérifiée (OAuth OK, HTTPS) — les emails partiront du compte Google → boîte de réception.');
    } catch (e) {
      _mailStats.apiVerified = false; _mailStats.apiError = String(e.message).slice(0, 160);
      console.error('[Mailer] ❌ API Gmail KO:', _mailStats.apiError, '— vérifier GMAIL_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN.');
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
function _buildRaw(to, subject, html) {
  const fromHeader = `DataTradingPro <${GMAIL_USER || SUPPORT_EMAIL}>`;
  const subjEnc = '=?UTF-8?B?' + Buffer.from(subject, 'utf8').toString('base64') + '?=';   // sujet UTF-8 (accents/emojis)
  const text = _htmlToText(html);
  const boundary = 'dtp_' + Date.now().toString(36) + Math.floor(Date.now() % 1e6).toString(36);
  const lines = [
    `From: ${fromHeader}`, `To: ${to}`, `Reply-To: ${SUPPORT_EMAIL}`,
    `Subject: ${subjEnc}`, 'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    Buffer.from(text, 'utf8').toString('base64'), '',
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    Buffer.from(html, 'utf8').toString('base64'), '',
    `--${boundary}--`,
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8')
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function _sendGmailApi(to, subject, html) {
  const token = await _gmailAccessToken();
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: _buildRaw(to, subject, html) }), signal: ctrl.signal,
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
async function _sendGmail(to, subject, html) {
  const from = _parseFrom();
  const fromHeader = `${from.name || 'DataTradingPro'} <${GMAIL_USER}>`;   // expéditeur = compte authentifié (alignement garanti)
  await _getGmailTransport().sendMail({ from: fromHeader, replyTo: SUPPORT_EMAIL, to, subject, html, text: _htmlToText(html) });
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
async function _sendOvhSmtp(to, subject, html) {
  if (!process.env.OVH_SMTP_USER || !process.env.OVH_SMTP_PASS) return false;
  const from = process.env.EMAIL_FROM || process.env.OVH_SMTP_USER;   // ex. "DataTradingPro <contact@datatradingpro.com>"
  await _getOvhTransport().sendMail({ from, replyTo: SUPPORT_EMAIL, to, subject, html, text: _htmlToText(html),   // texte+HTML (multipart) = meilleure délivrabilité
    headers: { 'List-Unsubscribe': '<mailto:' + SUPPORT_EMAIL + '?subject=Unsubscribe>' } });   // mail-tester / bonnes pratiques
  return true;
}

async function _send(to, subject, html) {
  if (!_validEmail(to)) { console.warn('[Mailer] destinataire invalide — email ignoré:', to); return false; }
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
    console.warn('[Mailer] Aucun fournisseur configuré (GMAIL_*, MAILJET_* ou RESEND_API_KEY) — email non envoyé:', subject);
    return false;
  }
  const errors = [];
  for (const [nom, fn] of chain) {
    try { if (await fn(to, subject, html)) { _mailStats.sent++; _mailStats.byProvider[nom] = (_mailStats.byProvider[nom] || 0) + 1; _mailStats.lastProvider = nom; console.log(`[Mailer] ✅ ${nom} → ${to} : "${subject}"`); return nom; } }   // succès → log + renvoie le canal gagnant (visibilité)
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
    <h2 style="color:#f7941d;margin:0 0 12px;">✅ Test d'envoi DataTradingPro</h2>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.6;">Si tu lis cet email <b>dans ta boîte de réception</b> (pas les spams),
    l'envoi fonctionne parfaitement. 🎉</p>
    <p style="color:#64748b;font-size:13px;">Email automatique de vérification — tu peux l'ignorer.</p>`);
  const provider = await _send(to, 'DataTradingPro — test d\'envoi ✅', html);   // string (canal) si OK, false sinon
  return { ok: !!provider, provider: provider || null, lastError: _mailStats.lastError || null };
}

// ── Gabarit HTML commun (dark, professionnel — DataTradingPro) ────────────────
function _layout(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${_esc(title)}</title></head>
<body style="margin:0;padding:0;background:#0a0a0c;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0c;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#141417;border:1px solid #26262b;border-radius:14px;overflow:hidden;">
        <!-- Header -->
        <tr><td style="padding:28px 32px 18px;border-bottom:1px solid #26262b;">
          <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">DataTradingPro</div>
          <div style="font-size:12px;font-weight:600;color:#f7941d;margin-top:4px;">Terminal de news &amp; d'analyse de marché en temps réel</div>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:28px 32px;color:#cbd5e1;font-size:15px;line-height:1.65;">
          ${bodyHtml}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:18px 32px;border-top:1px solid #26262b;color:#6b7280;font-size:12px;line-height:1.6;">
          DataTradingPro — Terminal de news & d'analyse en temps réel.<br>
          Besoin d'aide ? <a href="mailto:${SUPPORT_EMAIL}" style="color:#f7941d;text-decoration:none;">${SUPPORT_EMAIL}</a>
        </td></tr>
      </table>
      <div style="color:#4b5563;font-size:11px;margin-top:16px;">Cet email vous est envoyé automatiquement, merci de ne pas y répondre directement.</div>
    </td></tr>
  </table>
</body></html>`;
}

function _button(label, url) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr>
    <td style="background:#f7941d;border-radius:10px;">
      <a href="${url}" style="display:inline-block;padding:13px 28px;color:#0a0a0c;font-weight:700;font-size:14px;text-decoration:none;">${_esc(label)}</a>
    </td></tr></table>`;
}

function _credBox(rows) {
  // Échappe la valeur ; si c'est un email, on la pré-emballe dans un <a> blanc : ça empêche
  // les clients (Gmail) de la re-transformer en lien bleu illisible sur fond sombre.
  const fmt = v => {
    const raw = String(v == null ? '' : v).trim();
    const s = _esc(raw);
    return _EMAIL_RE.test(raw)
      ? `<a href="mailto:${s}" style="color:#ffffff;text-decoration:none;">${s}</a>`
      : s;
  };
  const items = rows.map(([k, v]) =>
    `<tr><td style="padding:6px 0;color:#94a3b8;font-size:13px;width:130px;">${_esc(k)}</td>
         <td style="padding:6px 0;color:#ffffff;font-size:14px;font-weight:600;font-family:monospace;">${fmt(v)}</td></tr>`
  ).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
    style="background:#0f0f12;border:1px solid #26262b;border-radius:10px;padding:14px 18px;margin:18px 0;">${items}</table>`;
}

// Encart "Note importante" : astuce anti-spam (à mettre dans tous les emails)
function _spamNote() {
  const sender = _esc(_parseFrom().email);
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
    style="background:rgba(247,148,29,0.08);border:1px solid rgba(247,148,29,0.35);border-radius:10px;margin:20px 0;">
    <tr><td style="padding:14px 16px;color:#f3d9b0;font-size:13px;line-height:1.6;">
      <strong style="color:#f7941d;">📌 Note importante — pour ne plus rater nos emails</strong><br>
      Pour éviter que nos messages (accès, alertes, renouvellement) ne tombent dans vos <strong>spams</strong> :
      <ul style="margin:8px 0 0;padding-left:18px;color:#e2cba0;">
        <li>Ajoutez <strong style="color:#fff;">${sender}</strong> à vos <strong>contacts</strong>.</li>
        <li>Si cet email est dans les spams/indésirables, ouvrez-le et cliquez sur <strong>« Non spam »</strong> (ou déplacez-le vers la boîte de réception).</li>
      </ul>
    </td></tr></table>`;
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
    <p style="margin:0 0 4px;font-size:13px;color:#94a3b8;">Par sécurité, nous vous recommandons de changer votre mot de passe après votre première connexion.</p>`
    : `${_credBox([['Email', to], ['Abonnement', `valide jusqu'au ${end}`]])}
    <p style="margin:0 0 4px;font-size:13px;color:#94a3b8;">Connectez-vous avec l'email ci-dessus. Si vous n'avez pas (ou plus) votre mot de passe, cliquez sur « Mot de passe oublié » sur la page de connexion — ou répondez simplement à ce message, on vous aide.</p>`;
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:18px;font-weight:700;">Bienvenue, ${prenom} 👋</p>
    <p style="margin:0 0 14px;">Votre accès à <strong style="color:#fff;">DataTradingPro</strong> a été activé. Vous disposez désormais du flux de news en temps réel, du calendrier économique et des analyses institutionnelles.</p>
    <p style="margin:0 0 6px;color:#94a3b8;font-size:13px;">Vos identifiants de connexion :</p>
    ${creds}
    ${_button('Accéder au terminal', APP_URL)}
    ${_spamNote()}
    <p style="margin:0;font-size:13px;">Excellents trades,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: 'Bienvenue sur DataTradingPro — votre accès est activé', html: _layout('Bienvenue', body) };
}
async function sendWelcome(d) { const m = buildWelcome(d); return _send(d.to, m.subject, m.html); }

// ── 2) Email de renouvellement échoué (abonnement non renouvelé) ──────────────
function buildRenewalFailed({ name }) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher client');
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:18px;font-weight:700;">Renouvellement de votre abonnement</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Nous n'avons pas pu <strong style="color:#fff;">renouveler votre abonnement</strong> à DataTradingPro. Par conséquent, votre accès au terminal est actuellement <strong style="color:#e25563;">suspendu</strong>.</p>
    <p style="margin:0 0 14px;">Pour réactiver votre accès et reprendre le suivi des marchés en temps réel, il vous suffit de renouveler votre abonnement en un clic ci-dessous :</p>
    ${_button('Renouveler mon abonnement', WHOP_RENEW_URL)}
    <p style="margin:0 0 14px;font-size:13px;color:#9aa3b2;">Une question ? Écrivez-nous à <a href="mailto:${SUPPORT_EMAIL}" style="color:#ff7a1a;">${SUPPORT_EMAIL}</a>.</p>
    ${_spamNote()}
    <p style="margin:0;font-size:13px;">Nous restons à votre disposition,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: 'DataTradingPro — échec du renouvellement de votre abonnement', html: _layout('Renouvellement', body) };
}
async function sendRenewalFailed(d) { const m = buildRenewalFailed(d); return _send(d.to, m.subject, m.html); }

// ── 2a-bis) Email « abonnement expiré » (l'admin a marqué le compte expiré) ───
function buildExpired({ name, expiresAt }) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher client');
  const end = expiresAt ? new Date(expiresAt).toLocaleDateString('fr-FR') : null;
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:18px;font-weight:700;">Votre abonnement a expiré</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Votre période d'abonnement à <strong style="color:#fff;">DataTradingPro</strong>${end ? ` est arrivée à échéance le <strong style="color:#fff;">${end}</strong>` : ' a expiré'}. Votre accès au terminal est désormais <strong style="color:#e25563;">suspendu</strong>.</p>
    <p style="margin:0 0 14px;">Pour reprendre le suivi des marchés en temps réel (news, calendrier économique, force des devises, analyses institutionnelles), renouvelez votre abonnement en un clic :</p>
    ${_button('Renouveler mon abonnement', WHOP_RENEW_URL)}
    <p style="margin:0 0 14px;font-size:13px;color:#9aa3b2;">Une question ? Écrivez-nous à <a href="mailto:${SUPPORT_EMAIL}" style="color:#ff7a1a;">${SUPPORT_EMAIL}</a>.</p>
    ${_spamNote()}
    <p style="margin:0;font-size:13px;">À très vite,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: 'DataTradingPro — votre abonnement a expiré', html: _layout('Abonnement expiré', body) };
}
async function sendExpired(d) { const m = buildExpired(d); return _send(d.to, m.subject, m.html); }

// ── « Mot de passe oublié » demandé par un compte SANS abonnement actif (suspendu/expiré) ─────
//    SÉCURITÉ : on NE réinitialise PAS le mot de passe (réservé aux comptes actifs). On explique
//    l'abonnement inactif + CTA de réactivation, façon pro. (Aucun mot de passe n'est régénéré.)
function buildForgotNoSub({ name }) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher client');
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:18px;font-weight:700;">Réinitialisation impossible : abonnement inactif</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Vous venez de demander la réinitialisation de votre mot de passe DataTradingPro. Or votre <strong style="color:#fff;">abonnement n'est pas actif</strong> : votre accès au terminal est actuellement <strong style="color:#e25563;">suspendu</strong>.</p>
    <p style="margin:0 0 14px;">Pour des raisons de sécurité, nous ne réinitialisons le mot de passe que pour les comptes disposant d'un <strong style="color:#fff;">abonnement actif</strong>. Dès que le vôtre sera réactivé, vous pourrez de nouveau vous connecter (et réinitialiser votre mot de passe si besoin).</p>
    ${_button('Réactiver mon abonnement', WHOP_RENEW_URL)}
    <p style="margin:0 0 14px;font-size:13px;color:#9aa3b2;">Une question ? Écrivez-nous à <a href="mailto:${SUPPORT_EMAIL}" style="color:#ff7a1a;">${SUPPORT_EMAIL}</a>.</p>
    ${_spamNote()}
    <p style="margin:0;font-size:13px;">À très vite sur le terminal,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: 'DataTradingPro — réinitialisation impossible : abonnement inactif', html: _layout('Abonnement inactif', body) };
}
async function sendForgotNoSub(d) { const m = buildForgotNoSub(d); return _send(d.to, m.subject, m.html); }

// ── 2b) Email de réactivation (compte remis en actif) ────────────────────────
function buildReactivated({ name, expiresAt }) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher client');
  const end = expiresAt ? new Date(expiresAt).toLocaleDateString('fr-FR') : null;
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:18px;font-weight:700;">Votre accès est réactivé ✅</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Bonne nouvelle : votre abonnement à <strong style="color:#fff;">DataTradingPro</strong> est de nouveau <strong style="color:#34d399;">actif</strong>. Vous avez à nouveau accès au flux de news en temps réel, au calendrier économique et aux analyses.${end ? ` Votre accès est valable jusqu'au <strong style="color:#fff;">${end}</strong>.` : ''}</p>
    ${_button('Accéder au terminal', APP_URL)}
    ${_spamNote()}
    <p style="margin:0;font-size:13px;">Bons trades,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: 'DataTradingPro — votre accès est réactivé', html: _layout('Réactivation', body) };
}
async function sendReactivated(d) { const m = buildReactivated(d); return _send(d.to, m.subject, m.html); }

// ── 2c) Email de renouvellement réussi (paiement Whop renouvelé) ──────────────
function buildRenewed({ name, expiresAt }) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher client');
  const end = expiresAt ? new Date(expiresAt).toLocaleDateString('fr-FR') : null;
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:18px;font-weight:700;">Abonnement renouvelé ✅</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Merci ! Votre abonnement à <strong style="color:#fff;">DataTradingPro</strong> a bien été <strong style="color:#34d399;">renouvelé</strong>${end ? ` jusqu'au <strong style="color:#fff;">${end}</strong>` : ''}. Votre accès au terminal continue sans interruption.</p>
    ${_button('Accéder au terminal', APP_URL)}
    ${_spamNote()}
    <p style="margin:0;font-size:13px;">Bons trades,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: 'DataTradingPro — votre abonnement est renouvelé', html: _layout('Renouvellement', body) };
}
async function sendRenewed(d) { const m = buildRenewed(d); return _send(d.to, m.subject, m.html); }

// ── 2d) Geste commercial : +1 mois offert (maintenance) ───────────────────────
function buildGestureMonth({ name, expiresAt }) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher client');
  const end = expiresAt ? new Date(expiresAt).toLocaleDateString('fr-FR') : null;
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:18px;font-weight:700;">1 mois offert 🎁</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Pour la récente période de <strong style="color:#fff;">maintenance</strong>, et pour vous remercier de votre patience, nous vous offrons <strong style="color:#34d399;">1 mois supplémentaire</strong> sur votre abonnement DataTradingPro — c'est notre geste commercial.</p>
    ${end ? `<p style="margin:0 0 14px;">Votre accès est désormais valable jusqu'au <strong style="color:#fff;">${end}</strong>.</p>` : ''}
    ${_button('Accéder au terminal', APP_URL)}
    ${_spamNote()}
    <p style="margin:0;font-size:13px;">Merci de votre confiance,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: 'DataTradingPro — 1 mois offert pour la maintenance 🎁', html: _layout('Geste commercial', body) };
}
async function sendGestureMonth(d) { const m = buildGestureMonth(d); return _send(d.to, m.subject, m.html); }

// ── Annonce « de nouveau en ligne » (membres existants) ───────────────────────
function buildLaunchLive({ name } = {}) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher trader');
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:20px;font-weight:800;">C'est de nouveau en ligne 🚀</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Bonne nouvelle : <strong style="color:#fff;">DataTradingPro est de nouveau en ligne</strong>, avec une <strong style="color:#fff;">interface entièrement repensée</strong>.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 12px;">
      <tr><td style="padding:6px 0;color:#cbd5e1;font-size:14px;line-height:1.55;">🎨 <strong style="color:#fff;">Nouvelle identité visuelle</strong> — design premium, plus lisible, pensé pour le trading.</td></tr>
      <tr><td style="padding:6px 0;color:#cbd5e1;font-size:14px;line-height:1.55;">🇫🇷 <strong style="color:#fff;">100% en français</strong> — chaque widget, chaque libellé.</td></tr>
      <tr><td style="padding:6px 0;color:#cbd5e1;font-size:14px;line-height:1.55;">⚡ <strong style="color:#fff;">Terminal plus clair</strong> — Smart Bias, calendrier, news priorisée, force des devises, COT, Week Ahead, taux & Copilote Macro IA.</td></tr>
    </table>
    <p style="margin:0 0 14px;">Vos <strong style="color:#fff;">identifiants restent les mêmes</strong> — connectez-vous, tout se charge en temps réel.</p>
    ${_button('Accéder à mon terminal →', APP_URL)}
    ${_spamNote()}
    <p style="margin:14px 0 0;font-size:13px;">À très vite sur le desk,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: 'DataTradingPro est de nouveau en ligne — nouvelle interface 🚀', html: _layout('De nouveau en ligne', body) };
}
async function sendLaunchLive(d) { const m = buildLaunchLive(d || {}); return _send(d.to, m.subject, m.html); }

// ── 3) Email de réinitialisation de mot de passe ──────────────────────────────
function buildPasswordReset({ to, name, password }) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher client');
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:18px;font-weight:700;">Réinitialisation de votre mot de passe</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Votre mot de passe DataTradingPro a été réinitialisé. Voici votre nouveau mot de passe :</p>
    ${_credBox([['Email', to], ['Nouveau mot de passe', password || '—']])}
    <p style="margin:0 0 4px;font-size:13px;color:#94a3b8;">Pour votre sécurité, pensez à le modifier depuis votre profil après connexion. Si vous n'êtes pas à l'origine de cette demande, contactez-nous immédiatement.</p>
    ${_button('Me connecter', APP_URL)}
    ${_spamNote()}
    <p style="margin:0;font-size:13px;">L'équipe DataTradingPro</p>`;
  return { subject: 'DataTradingPro — votre mot de passe a été réinitialisé', html: _layout('Réinitialisation', body) };
}
async function sendPasswordReset(d) { const m = buildPasswordReset(d); return _send(d.to, m.subject, m.html); }

// ── 4) Fin d'essai gratuit (1 semaine) → passer à l'abonnement MENSUEL ────────
//    Envoyé LE JOUR où l'essai a expiré. Sans prix : invite à prendre l'abonnement
//    mensuel via la page Whop.
function buildTrialUpsell({ name, expiresAt }) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher trader');
  const end = expiresAt ? new Date(expiresAt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : null;
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:18px;font-weight:700;">Votre essai gratuit est terminé ⏳</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Votre <strong style="color:#fff;">semaine d'accès offert</strong> à DataTradingPro vient de prendre fin${end ? ` (elle a expiré <strong style="color:#f7941d;">${end}</strong>)` : ''}. Vous avez pu tester en conditions réelles le flux de news en temps réel, le calendrier économique et nos analyses institutionnelles.</p>
    <p style="margin:0 0 14px;">Pour <strong style="color:#fff;">retrouver votre accès</strong> et continuer à trader avec les données qui font bouger les marchés, passez dès maintenant à l'<strong style="color:#fff;">abonnement mensuel</strong> — sans engagement et résiliable à tout moment :</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:18px 0;">
      <tr><td style="padding:6px 0;color:#cbd5e1;font-size:14px;">✅ News &amp; squawk en temps réel, sans délai</td></tr>
      <tr><td style="padding:6px 0;color:#cbd5e1;font-size:14px;">✅ Calendrier économique et résultats live</td></tr>
      <tr><td style="padding:6px 0;color:#cbd5e1;font-size:14px;">✅ Analyses institutionnelles &amp; Rapports de banques</td></tr>
      <tr><td style="padding:6px 0;color:#cbd5e1;font-size:14px;">✅ FX Weekly Recap &amp; FX Daily Recap</td></tr>
    </table>
    ${_button('Activer mon abonnement mensuel', WHOP_RENEW_URL)}
    <p style="margin:0 0 14px;font-size:13px;color:#94a3b8;">Abonnement mensuel sans engagement — votre accès est réactivé immédiatement après l'inscription.</p>
    ${_spamNote()}
    <p style="margin:0;font-size:13px;">À très vite sur le terminal,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: 'Votre essai DataTradingPro est terminé — réactivez votre accès', html: _layout('Fin d\'essai', body) };
}
async function sendTrialUpsell(d) { const m = buildTrialUpsell(d); return _send(d.to, m.subject, m.html); }

// ── 5) Réengagement : utilisateur inactif depuis ~7 jours (marketing, "reviens !") ──
//    Ton direct (tutoiement), centré sur NOS fonctionnalités réelles. But : recliquer
//    et reprendre l'habitude d'ouvrir le terminal pendant les sessions.
function _buildReengagement(name, days) {
  const prenom = _esc((name || '').split(' ')[0] || 'trader');
  const d = days || 7;
  // Encart "Pour démarrer en 5 minutes" (bordure orange, à notre sauce)
  const startBox = `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
      style="background:#0f0f12;border:1px solid #26262b;border-left:3px solid #f7941d;border-radius:10px;margin:20px 0;">
      <tr><td style="padding:16px 18px;">
        <div style="color:#f7941d;font-size:15px;font-weight:700;margin-bottom:8px;">Pour démarrer en 5 minutes</div>
        <div style="color:#cbd5e1;font-size:14px;line-height:1.6;margin-bottom:10px;">Pendant la session de Londres (9h–10h), ouvre&nbsp;:</div>
        <div style="color:#e2e8f0;font-size:14px;line-height:1.9;">
          → <strong style="color:#fff;">Live Squawk</strong> <span style="color:#94a3b8;">(les news qui bougent les marchés, en direct)</span><br>
          → <strong style="color:#fff;">Calendrier économique</strong> <span style="color:#94a3b8;">(résultats live + détail de l'événement au clic)</span><br>
          → <strong style="color:#fff;">Force des devises · COT · DMX</strong> <span style="color:#94a3b8;">(qui est fort, qui est faible, d'un coup d'œil)</span>
        </div>
        <div style="color:#8a9097;font-size:12.5px;font-style:italic;margin-top:12px;">Tu auras compris ce que t'apporte DataTradingPro en moins de temps qu'un café. ☕</div>
      </td></tr>
    </table>`;
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:20px;font-weight:800;">Hey ${prenom},</p>
    <p style="margin:0 0 14px;">Il y a ${d} jours, tu as activé ton accès à <strong style="color:#fff;">DataTradingPro</strong>. Depuis, je ne t'ai pas vu revenir.</p>
    <p style="margin:0 0 8px;color:#94a3b8;">C'est peut-être que&nbsp;:</p>
    <ul style="margin:0 0 6px;padding-left:18px;color:#cbd5e1;font-size:14px;line-height:1.8;">
      <li>Tu n'as pas eu le temps d'explorer <span style="color:#94a3b8;">(le terminal est dense, c'est vrai)</span></li>
      <li>Tu ne sais pas par où commencer</li>
      <li>Quelque chose ne t'a pas plu — dans ce cas, <strong style="color:#fff;">réponds-moi</strong>, je lis tout</li>
    </ul>
    ${startBox}
    ${_button('Revenir sur le terminal →', APP_URL)}
    <p style="margin:18px 0 10px;color:#94a3b8;font-size:13px;">Et tout le reste t'attend aussi&nbsp;:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr><td style="padding:5px 0;color:#cbd5e1;font-size:13.5px;">📊 <strong style="color:#fff;">FX List</strong> — vue d'ensemble Forex (force, biais, momentum 1M/3M/12M)</td></tr>
      <tr><td style="padding:5px 0;color:#cbd5e1;font-size:13.5px;">🏛️ <strong style="color:#fff;">Rapports institutionnels</strong> — ING, MUFG, SEB, Scotiabank… avec AI Insights</td></tr>
      <tr><td style="padding:5px 0;color:#cbd5e1;font-size:13.5px;">📝 <strong style="color:#fff;">Session Recaps &amp; Weekly</strong> — le marché résumé, à ta place</td></tr>
      <tr><td style="padding:5px 0;color:#cbd5e1;font-size:13.5px;">🌡️ <strong style="color:#fff;">Sentiment de risque</strong> live + sentiment retail contrarien</td></tr>
    </table>
    ${_spamNote()}
    <p style="margin:14px 0 0;font-size:13px;">On se revoit sur le terminal,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: `${prenom}, ton terminal DataTradingPro t'attend 👀`, html: _layout('On se revoit ?', body) };
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
    ['🧭', 'Smart Bias', 'le biais directionnel des 8 grandes devises, recalculé chaque semaine sur les fondamentaux.'],
    ['⚡', 'Force des devises en temps réel', "qui mène, qui décroche, d'un coup d'œil."],
    ['📅', 'Calendrier macro', 'les publications qui bougent les marchés : consensus, précédent et résultat dès la sortie.'],
    ['🤖', 'Assistant IA macro', "posez votre question en français, l'IA répond avec le contexte marché du moment."],
    ['🏦', 'Rapports de banques', 'Goldman, ING, MUFG, Danske… la recherche institutionnelle réunie, lisible en PDF.'],
  ].map(([ico, t, d]) =>
    `<tr><td style="padding:7px 0;color:#cbd5e1;font-size:14px;line-height:1.55;">${ico} <strong style="color:#fff;">${t}</strong> — ${d}</td></tr>`
  ).join('');
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:20px;font-weight:800;">C'est officiel : la v2 est finalisée 🚀</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Ça y est. Après des mois de développement et d'écoute, <strong style="color:#fff;">la version 2 de DataTradingPro est officiellement finalisée.</strong></p>
    <p style="margin:0 0 14px;">Ce n'est plus une promesse — c'est le terminal le plus abouti qu'on ait livré. Tout ce qu'un trader macro attend, réuni et <strong style="color:#fff;">connecté sur un seul écran</strong> :</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 12px;">${feats}</table>
    <p style="margin:0 0 14px;color:#94a3b8;font-size:13px;">+ Live Squawk, jauge Risk Sentiment, saisonnalité, taux des banques centrales, journal de trading…</p>
    <p style="margin:14px 0 4px;color:#fff;font-size:15px;font-weight:700;">Arrêtez de deviner les mouvements. Commencez à les comprendre.</p>
    ${_button('Rejoindre DataTradingPro →', WHOP_RENEW_URL)}
    <p style="margin:0 0 14px;font-size:13px;color:#94a3b8;">Accès complet immédiat · sans engagement, résiliable en un clic.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:rgba(247,148,29,0.08);border:1px solid rgba(247,148,29,0.3);border-radius:10px;margin:6px 0 4px;">
      <tr><td style="padding:12px 15px;color:#f3d9b0;font-size:13.5px;line-height:1.6;">⏳ Le terminal est complet et déjà en ligne. Chaque session que vous manquez, c'est une longueur d'avance en moins — <strong style="color:#fff;">rejoignez le lancement maintenant.</strong></td></tr>
    </table>
    ${_spamNote()}
    <p style="margin:14px 0 0;font-size:13px;">À très vite sur le terminal,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>
    <p style="margin:14px 0 0;font-size:11px;color:#6b7280;">Vous recevez cet email en tant que membre DataTradingPro. <a href="mailto:${SUPPORT_EMAIL}?subject=Desabonnement" style="color:#6b7280;text-decoration:underline;">Se désabonner</a>.</p>`;
  return { subject: "C'est officiel : DataTradingPro v2 est finalisé 🚀", html: _layout('DataTradingPro v2', body) };
}
async function sendAnnouncementV2(d) { const m = buildAnnouncementV2(d || {}); return _send(d.to, m.subject, m.html); }

// ══════════════════════════════════════════════════════════════════════════════
//  CAMPAGNE HEBDO — mail d'introduction (1er de la sequence) + desinscription reelle
// ══════════════════════════════════════════════════════════════════════════════
const LANDING_URL   = process.env.LANDING_URL || 'https://datatradingpro.com';
const _UNSUB_SECRET = process.env.UNSUB_SECRET || process.env.SESSION_SECRET || 'dtp-unsub-v1';
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

// Gabarit CAMPAGNE — identite landing (or #e3b23a, pas l'orange transactionnel) + pied de desinscription.
function _campaignLayout(title, bodyHtml, unsub) {
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${_esc(title)}</title></head>
<body style="margin:0;padding:0;background:#0a0a0c;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0c;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#111114;border:1px solid #26262b;border-radius:14px;overflow:hidden;">
        <tr><td style="padding:26px 34px 18px;border-bottom:1px solid #1f1f24;">
          <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">Data<span style="color:#e3b23a;">Trading</span>Pro</div>
          <div style="font-size:12px;font-weight:600;color:#e3b23a;margin-top:5px;letter-spacing:.02em;">Terminal macro &amp; forex, en fran&ccedil;ais</div>
        </td></tr>
        <tr><td style="padding:26px 34px;color:#cbd5e1;font-size:15px;line-height:1.66;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:18px 34px;border-top:1px solid #1f1f24;color:#6b7280;font-size:12px;line-height:1.6;">
          DataTradingPro &middot; terminal de news &amp; d'analyse de march&eacute;.<br>
          Une question&nbsp;? <a href="mailto:${SUPPORT_EMAIL}" style="color:#e3b23a;text-decoration:none;">${SUPPORT_EMAIL}</a>
        </td></tr>
      </table>
      <div style="color:#4b5563;font-size:11px;margin-top:14px;line-height:1.7;max-width:600px;">
        Vous recevez cet email en tant que membre de l'&eacute;cosyst&egrave;me DataTradingPro (JustOneTrader).<br>
        <a href="${unsub}" style="color:#8b93a1;text-decoration:underline;">Se d&eacute;sabonner en un clic</a>
      </div>
    </td></tr>
  </table>
</body></html>`;
}
function _campaignBtn(label, url) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;"><tr>
    <td style="background:#e3b23a;border-radius:10px;">
      <a href="${url}" style="display:inline-block;padding:13px 30px;color:#0a0a0c;font-weight:700;font-size:14px;text-decoration:none;">${_esc(label)}</a>
    </td></tr></table>`;
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
    <p style="margin:0 0 16px;">Merci de faire partie de l'aventure <strong style="color:#e3b23a;">DataTradingPro</strong>. &Agrave; partir de maintenant, je vous enverrai <strong>chaque semaine</strong> un e-mail court pour rendre le march&eacute; <strong>macro &amp; forex</strong> plus lisible, en fran&ccedil;ais. Au programme, sans jargon&nbsp;:</p>
    <ul style="margin:0 0 20px;padding-left:20px;color:#cbd5e1;">
      <li style="margin:5px 0;"><strong style="color:#fff;">Le R&eacute;cap Hebdo</strong>&nbsp;: ce qui a compt&eacute; sur les march&eacute;s, prioris&eacute; par impact.</li>
      <li style="margin:5px 0;"><strong style="color:#fff;">La Force des Devises</strong>&nbsp;: quelles monnaies dominent, lesquelles faiblissent.</li>
      <li style="margin:5px 0;"><strong style="color:#fff;">Les &Eacute;clairages IA</strong>&nbsp;: le contexte expliqu&eacute; simplement, sans jargon.</li>
      <li style="margin:5px 0;"><strong style="color:#fff;">Les banques centrales</strong>&nbsp;: le ton (hawkish / dovish) et ce qu'il implique.</li>
    </ul>
    <img src="${APP_URL}/api/email-widget/meter.png" width="380" alt="Force des Devises" style="display:block;width:100%;max-width:380px;height:auto;border:1px solid #26262b;border-radius:8px;margin:8px 0 16px;">
    <p style="margin:0 0 18px;">Pour explorer le terminal quand vous voulez&nbsp;: <a href="${trackClickUrl(campaign, email, LANDING_URL)}" style="color:#e3b23a;font-weight:700;text-decoration:none;">ouvrir DataTradingPro &rarr;</a></p>
    <p style="margin:0 0 4px;">&Agrave; tr&egrave;s vite,</p>
    <p style="margin:0 0 16px;color:#9aa3b2;">L'&eacute;quipe DataTradingPro</p>
    <p style="margin:16px 0 0;font-size:12px;color:#7b828f;line-height:1.6;">PS&nbsp;: pour ne rien manquer, ajoutez <strong style="color:#cbd5e1;">${sender}</strong> &agrave; vos contacts. DataTradingPro est un terminal de donn&eacute;es et d'analyse&nbsp;: il n'ex&eacute;cute aucun ordre et ne donne aucun conseil personnalis&eacute;.</p>
    <img src="${trackOpenUrl(campaign, email)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;overflow:hidden;">
  `;
  return { subject: 'DataTradingPro : votre point macro & forex de la semaine', html: _campaignLayout('Bienvenue', body, unsub) };
}
async function sendCampaignIntro(d) { d = d || {}; const m = buildCampaignIntro({ name: d.name, email: d.email || d.to, campaign: d.campaign }); return _send(d.to, m.subject, m.html); }

// ── Rappel ADMIN : abonnements à renouveler (envoyé à datatradingpro.contact) ──
function buildAdminExpiryReminder({ clients }) {
  const rows = (clients || []).map(c => {
    const end  = new Date(c.expiresAt);
    const days = Math.ceil((end.getTime() - Date.now()) / 86400000);
    const when = end.toLocaleDateString('fr-FR');
    const state = days < 0
      ? `<span style="color:#fb7185;font-weight:700;">EXPIRÉ depuis ${-days}j</span>`
      : `<span style="color:#f59e0b;font-weight:700;">expire dans ${days}j</span>`;
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #26262b;color:#fff;font-size:13px;">${_esc(c.name || '—')}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #26262b;color:#94a3b8;font-size:13px;font-family:monospace;">${_esc(c.email)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #26262b;color:#94a3b8;font-size:13px;">${when}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #26262b;font-size:12px;">${state}</td>
    </tr>`;
  }).join('');
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:18px;font-weight:700;">⏰ Abonnements à vérifier</p>
    <p style="margin:0 0 14px;">Voici les clients dont l'abonnement <strong style="color:#fff;">expire bientôt ou vient d'expirer</strong>. Pense à les renouveler (paiement Whop) dans l'admin.</p>
    <p style="margin:0 0 8px;color:#94a3b8;font-size:12px;">⚠️ Délai de grâce : ces clients gardent l'accès <strong style="color:#fff;">48h après expiration</strong>. Au-delà, leur connexion sera bloquée automatiquement.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f12;border:1px solid #26262b;border-radius:10px;margin:14px 0;border-collapse:collapse;">
      <tr><th style="padding:8px 10px;text-align:left;color:#6b7280;font-size:10px;text-transform:uppercase;border-bottom:1px solid #26262b;">Nom</th>
          <th style="padding:8px 10px;text-align:left;color:#6b7280;font-size:10px;text-transform:uppercase;border-bottom:1px solid #26262b;">Email</th>
          <th style="padding:8px 10px;text-align:left;color:#6b7280;font-size:10px;text-transform:uppercase;border-bottom:1px solid #26262b;">Échéance</th>
          <th style="padding:8px 10px;text-align:left;color:#6b7280;font-size:10px;text-transform:uppercase;border-bottom:1px solid #26262b;">État</th></tr>
      ${rows}
    </table>
    ${_button('Ouvrir le panel admin', APP_URL + '/admin')}
    <p style="margin:0;font-size:13px;">— Rappel automatique DataTradingPro</p>`;
  return { subject: `DataTradingPro — ${(clients || []).length} abonnement(s) à renouveler`, html: _layout('Rappel abonnements', body) };
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
    <p style="margin:0 0 14px;color:#ffffff;font-size:18px;font-weight:700;">✅ ${_esc(kind)}</p>
    <p style="margin:0 0 14px;">Un paiement Whop <strong style="color:#fff;">JOT DTP</strong> a été traité automatiquement :</p>
    ${_credBox([['Client', clientName || clientEmail], ['Email', clientEmail], ["Accès jusqu'au", end], ['Action', isNew ? 'Compte créé' : 'Abonnement renouvelé']])}
    <p style="margin:0;font-size:13px;color:#94a3b8;">Le compte a été ${isNew ? 'créé' : 'mis à jour'} et le client a été notifié par email. Aucune action de ta part.</p>`;
  return { subject: `DTP — ${kind} : ${clientEmail}`, html: _layout('Notification DTP', body) };
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
    { key: 'forgotNoSub',   audience: 'Client', label: 'MDP oublié — abonnement inactif',   trigger: '« Mot de passe oublié » sur un compte sans abonnement actif', ...buildForgotNoSub(s) },
    { key: 'trialUpsell',   audience: 'Client', label: 'Fin d\'essai gratuit',             trigger: 'Le jour où l\'essai 7 jours expire',          ...buildTrialUpsell(s) },
    { key: 'renewalFailed', audience: 'Client', label: 'Échec de renouvellement',          trigger: 'Abonnement non renouvelé → accès suspendu',   ...buildRenewalFailed(s) },
    { key: 'reactivated',   audience: 'Client', label: 'Compte réactivé',                  trigger: 'Compte remis en actif (paiement ou admin)',   ...buildReactivated(s) },
    { key: 'renewed',       audience: 'Client', label: 'Abonnement renouvelé',             trigger: 'Paiement Whop renouvelé',                     ...buildRenewed(s) },
    { key: 'reengagement',  audience: 'Client', label: 'Réengagement (inactif ~7j)',       trigger: 'Utilisateur inactif depuis ~7 jours',         ..._buildReengagement(s.name, 7) },
    { key: 'announcementV2', audience: 'Client', label: 'Annonce — v2 finalisée',           trigger: 'Broadcast manuel (admin) → tous les clients',  ...buildAnnouncementV2({ name: s.name }) },
    { key: 'campaignIntro', audience: 'Client + Whop', label: 'Campagne — intro hebdo',       trigger: 'Broadcast campagne (admin) → clients DTP + Whop', ...buildCampaignIntro({ name: s.name, email: s.to }) },
    { key: 'adminExpiry',   audience: 'Admin',  label: 'Rappel abonnements à renouveler',  trigger: 'Rappel automatique (→ toi)',                  ...buildAdminExpiryReminder({ clients: sampleClients }) },
    { key: 'adminRenewal',  audience: 'Admin',  label: 'Notif paiement / nouveau client',  trigger: 'Paiement Whop traité (→ toi)',                ...buildAdminRenewalNotice({ clientEmail: s.to, clientName: s.name, expiresAt: s.expiresAt, isNew: true }) },
    { key: 'referredWelcome',  audience: 'Client', label: 'Parrainage — bienvenue filleul',  trigger: 'Un filleul s\'inscrit via un parrain',          ...buildReferredWelcome({ name: s.name, referrerName: 'Alex' }) },
    { key: 'referralCredited', audience: 'Client', label: 'Parrainage — filleul confirmé', trigger: 'Un filleul s\'abonne via votre lien',          ...buildReferralCredited({ name: s.name, count: 1, untilNext: 2 }) },
    { key: 'referralReward',   audience: 'Client', label: 'Parrainage — mois offert',       trigger: '3 parrainages atteints → 1 mois offert',      ...buildReferralReward({ name: s.name, count: 3, newExpiresAt: now + 30 * 86400000 }) },
    { key: 'adminReferral',    audience: 'Admin',  label: 'Parrainage — mois crédité (→ toi)', trigger: 'Un membre débloque un mois offert',         ...buildAdminReferralReward({ refEmail: s.to, refName: s.name, count: 3, newExpiresAt: now + 30 * 86400000 }) },
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
    const audColor = e.audience === 'Admin' ? '#f7941d' : '#3f9280';
    return `<section style="background:#141417;border:1px solid #26262b;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;">
      <div style="padding:14px 16px;border-bottom:1px solid #26262b;">
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
<title>DataTradingPro — Aperçu des emails</title>
<style>
  *{box-sizing:border-box;}
  body{margin:0;background:#0a0a0c;color:#e6e9ef;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,sans-serif;padding:28px;}
  .hd{max-width:1320px;margin:0 auto 22px;}
  .hd h1{margin:0 0 4px;font-size:22px;font-weight:800;letter-spacing:-.02em;}
  .hd h1 .o{color:#f7941d;}
  .hd .sub{color:#8a8a90;font-size:13px;margin-bottom:14px;}
  .panel{background:#141417;border:1px solid #26262b;border-radius:12px;padding:14px 16px;display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;}
  .panel .lbl{font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.04em;}
  .panel .from{font-size:12.5px;color:#cbd5e1;font-family:monospace;}
  .grid{max-width:1320px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:18px;}
</style></head>
<body>
  <div class="hd">
    <h1>Data<span class="o">TradingPro</span> — Aperçu des emails</h1>
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
    <p style="margin:0 0 14px;color:#ffffff;font-size:18px;font-weight:700;">Nouveau filleul confirmé 🎉</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom}, un nouvel abonné vient de rejoindre <strong style="color:#fff;">DataTradingPro</strong> grâce à votre lien de parrainage. Merci !</p>
    ${_credBox([['Filleuls confirmés', String(count)], ['Avant 1 mois offert', restant]])}
    <p style="margin:0 0 14px;">Plus que <strong style="color:#f7941d;">${restant}</strong> et nous créditons <strong style="color:#fff;">1 mois d'accès offert</strong> sur votre compte.</p>
    ${_button('Voir mes parrainages', APP_URL)}
    ${_spamNote()}
    <p style="margin:0;font-size:13px;">À très vite,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: `DataTradingPro — nouveau filleul confirmé (${count})`, html: _layout('Parrainage', body) };
}
async function sendReferralCredited(d) { const m = buildReferralCredited(d); return _send(d.to, m.subject, m.html); }

// ── 10) Parrainage : mois offert débloqué (→ parrain) ────────────────────────
function buildReferralReward({ name, count, newExpiresAt }) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher client');
  const end = newExpiresAt ? new Date(newExpiresAt).toLocaleDateString('fr-FR') : '—';
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:18px;font-weight:700;">🎁 1 mois offert débloqué !</p>
    <p style="margin:0 0 14px;">Bravo ${prenom} — vous avez atteint <strong style="color:#fff;">${count} parrainages</strong>. Comme promis, nous ajoutons <strong style="color:#f7941d;">1 mois d'accès offert</strong> à votre abonnement DataTradingPro.</p>
    ${_credBox([['Récompense', "1 mois d'accès offert"], ['Accès prolongé jusqu\'au', end]])}
    <p style="margin:0 0 14px;font-size:13px;color:#9aa3b2;">Le mois est appliqué automatiquement à votre accès au terminal. Continuez à parrainer : chaque 3 parrainages = un mois de plus.</p>
    ${_button('Accéder au terminal', APP_URL)}
    ${_spamNote()}
    <p style="margin:0;font-size:13px;">Merci de faire grandir la communauté,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: `DataTradingPro — 🎁 mois offert débloqué (palier ${count})`, html: _layout('Récompense parrainage', body) };
}
async function sendReferralReward(d) { const m = buildReferralReward(d); return _send(d.to, m.subject, m.html); }

// ── 11) Parrainage : notif ADMIN (→ toi) ─────────────────────────────────────
function buildAdminReferralReward({ refEmail, refName, count, newExpiresAt }) {
  const end = newExpiresAt ? new Date(newExpiresAt).toLocaleDateString('fr-FR') : '—';
  const body = `
    <p style="margin:0 0 12px;color:#ffffff;font-size:17px;font-weight:700;">Mois offert crédité (parrainage)</p>
    <p style="margin:0 0 10px;">Un membre a atteint un palier de parrainage. <strong>1 mois d'accès DTP</strong> lui a été crédité automatiquement.</p>
    ${_credBox([['Membre', refName || refEmail], ['Email', refEmail], ['Parrainages', String(count)], ['Accès prolongé au', end]])}
    <p style="margin:0;font-size:13px;color:#9aa3b2;">Pour offrir aussi le mois côté <strong>facturation Whop</strong>, appliquez-le manuellement dans le tableau de bord Whop (le crédit ci-dessus ne touche que l'accès DTP, pas la facturation).</p>`;
  return { subject: `DTP — mois offert crédité · ${refEmail}`, html: _layout('Admin — parrainage', body) };
}
async function sendAdminReferralReward(d) { const m = buildAdminReferralReward(d); const to = d.to || process.env.ADMIN_EMAIL || SUPPORT_EMAIL; return _send(to, m.subject, m.html); }

// ── 12) Parrainage : bienvenue du FILLEUL (→ le parrainé) ────────────────────
function buildReferredWelcome({ name, referrerName }) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher trader');
  const par = referrerName ? _esc(referrerName) : 'votre parrain';
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:18px;font-weight:700;">Bienvenue 🤝 — et à vous de jouer</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom}, vous avez rejoint <strong style="color:#fff;">DataTradingPro</strong> grâce à ${par}. Vous pouvez maintenant en profiter à votre tour avec notre programme de parrainage.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:rgba(247,148,29,0.10);border:1px solid rgba(247,148,29,0.4);border-radius:12px;margin:18px 0;">
      <tr><td style="padding:18px 20px;text-align:center;">
        <div style="font-size:22px;font-weight:800;color:#f7941d;letter-spacing:-.01em;">3 inscrits&nbsp;=&nbsp;1 mois offert</div>
        <div style="font-size:13px;color:#f3d9b0;margin-top:6px;">Et ça se cumule : chaque palier de 3 filleuls ajoute un mois d'accès.</div>
      </td></tr>
    </table>
    <p style="margin:0 0 14px;">Partagez votre lien personnel : à chaque <strong style="color:#fff;">3ᵉ</strong> abonné venu grâce à vous, nous créditons <strong style="color:#f7941d;">1 mois d'accès offert</strong> sur votre compte. Votre lien se trouve dans <strong style="color:#fff;">Profil&nbsp;▸&nbsp;Parrainages</strong>.</p>
    ${_button('Voir mon lien de parrainage', APP_URL)}
    ${_spamNote()}
    <p style="margin:0;font-size:13px;">Bon trading,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: 'DataTradingPro — bienvenue 🎁 3 inscrits = 1 mois offert', html: _layout('Parrainage — bienvenue', body) };
}
async function sendReferredWelcome(d) { const m = buildReferredWelcome(d); return _send(d.to, m.subject, m.html); }

// Alerte ADMIN — monitoring IA (provider en rouge / quota proche épuisement). L'anti-spam (cooldown)
// est géré côté serveur ; ici on se contente d'envoyer via la chaîne habituelle (OVH→Gmail).
async function sendAdminAlert({ subject, html, to } = {}) {
  const dest = to || process.env.ADMIN_EMAIL || SUPPORT_EMAIL;
  const body = '<h2 style="color:#f7941d;margin:0 0 12px;">🚨 Alerte monitoring IA</h2>' + (html || '')
    + '<p style="color:#6b7280;font-size:12px;margin-top:16px;">Détails en direct : <a href="https://desk.datatradingpro.com/admin" style="color:#f7941d;">dashboard IA Monitor</a>.</p>';
  return _send(dest, '[DTP Alerte IA] ' + (subject || 'Alerte'), _layout('Alerte monitoring IA', body));
}

module.exports = {
  // envoi (API publique inchangée)
  sendWelcome, sendRenewalFailed, sendExpired, sendReactivated, sendRenewed, sendPasswordReset, sendForgotNoSub,
  sendTrialUpsell, sendReengagement, _buildReengagement, sendAdminExpiryReminder, sendAdminRenewalNotice,
  sendReferralCredited, sendReferralReward, sendAdminReferralReward, sendReferredWelcome,
  sendAnnouncementV2, sendGestureMonth, sendLaunchLive, sendCampaignIntro,
  // désinscription campagne (opt-out) — server.js vérifie le même jeton
  unsubToken, unsubUrl,
  // tracking ouvertures/clics — server.js vérifie mailer.trackToken
  trackToken, trackOpenUrl, trackClickUrl,
  // build (rendu sans envoi) — pour la preview
  buildWelcome, buildRenewalFailed, buildReactivated, buildRenewed, buildPasswordReset, buildForgotNoSub,
  buildTrialUpsell, buildReengagement, buildAdminExpiryReminder, buildAdminRenewalNotice,
  buildReferralCredited, buildReferralReward, buildAdminReferralReward, buildReferredWelcome,
  buildAnnouncementV2, buildGestureMonth, buildLaunchLive, buildCampaignIntro,
  // preview / doc
  getEmailCatalog, getProviderStatus, renderEmailGallery,
  // monitoring / vérification
  verifyGmail, getMailHealth, sendTest, sendAdminAlert,
};

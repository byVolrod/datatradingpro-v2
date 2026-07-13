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
  if (att && att.length) {
    const rel = 'rel_' + boundary;
    lines = [
      `From: ${fromHeader}`, `To: ${to}`, `Reply-To: ${SUPPORT_EMAIL}`,
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
      `From: ${fromHeader}`, `To: ${to}`, `Reply-To: ${SUPPORT_EMAIL}`,
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
  await _getGmailTransport().sendMail({ from: fromHeader, replyTo: SUPPORT_EMAIL, to, subject, html, text: _htmlToText(html), attachments: (att && att.length) ? att : undefined });
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
async function _sendOvhSmtp(to, subject, html, att) {
  if (!process.env.OVH_SMTP_USER || !process.env.OVH_SMTP_PASS) return false;
  const from = process.env.EMAIL_FROM || process.env.OVH_SMTP_USER;   // ex. "DataTradingPro <contact@datatradingpro.com>"
  await _getOvhTransport().sendMail({ from, replyTo: SUPPORT_EMAIL, to, subject, html, text: _htmlToText(html),   // texte+HTML (multipart) = meilleure délivrabilité
    attachments: (att && att.length) ? att : undefined,   // images INLINE (cid:) — affichage garanti Outlook (pas de fetch distant)
    headers: { 'List-Unsubscribe': '<mailto:' + SUPPORT_EMAIL + '?subject=Unsubscribe>' } });   // mail-tester / bonnes pratiques
  return true;
}

async function _send(to, subject, html, attachments) {
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
    <h2 style="color:#f3c344;margin:0 0 12px;">✅ Test d'envoi DataTradingPro</h2>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.6;">Si tu lis cet email <b>dans ta boîte de réception</b> (pas les spams),
    l'envoi fonctionne parfaitement. 🎉</p>
    <p style="color:#64748b;font-size:13px;">Email automatique de vérification, tu peux l'ignorer.</p>`);
  const provider = await _send(to, 'DataTradingPro : test d\'envoi ✅', html);   // string (canal) si OK, false sinon
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
          <div style="font-size:12px;font-weight:600;color:#f3c344;margin-top:4px;">Terminal de news &amp; d'analyse de marché en temps réel</div>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:28px 32px;color:#cbd5e1;font-size:15px;line-height:1.65;">
          ${bodyHtml}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:18px 32px;border-top:1px solid #26262b;color:#6b7280;font-size:12px;line-height:1.6;">
          DataTradingPro · Terminal de news & d'analyse en temps réel.<br>
          Besoin d'aide ? <a href="mailto:${SUPPORT_EMAIL}" style="color:#f3c344;text-decoration:none;">${SUPPORT_EMAIL}</a>
        </td></tr>
      </table>
      <div style="color:#4b5563;font-size:11px;margin-top:16px;">Cet email vous est envoyé automatiquement, merci de ne pas y répondre directement.</div>
    </td></tr>
  </table>
</body></html>`;
}

function _button(label, url) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr>
    <td style="background:#f3c344;border-radius:10px;">
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
    style="background:rgba(227,178,58,0.08);border:1px solid rgba(227,178,58,0.35);border-radius:10px;margin:20px 0;">
    <tr><td style="padding:14px 16px;color:#f3d9b0;font-size:13px;line-height:1.6;">
      <strong style="color:#f3c344;">📌 Note importante : pour ne plus rater nos emails</strong><br>
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
    <p style="margin:0 0 4px;font-size:13px;color:#94a3b8;">Connectez-vous avec l'email ci-dessus. Si vous n'avez pas (ou plus) votre mot de passe, cliquez sur « Mot de passe oublié » sur la page de connexion, ou répondez simplement à ce message, on vous aide.</p>`;
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:18px;font-weight:700;">Bienvenue, ${prenom} 👋</p>
    <p style="margin:0 0 14px;">Votre accès à <strong style="color:#fff;">DataTradingPro</strong> a été activé. Vous disposez désormais du flux de news en temps réel, du calendrier économique et des analyses institutionnelles.</p>
    <p style="margin:0 0 6px;color:#94a3b8;font-size:13px;">Vos identifiants de connexion :</p>
    ${creds}
    ${_button('Accéder au terminal', APP_URL)}
    ${_spamNote()}
    <p style="margin:0;font-size:13px;">Excellents trades,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: 'Bienvenue sur DataTradingPro : votre accès est activé', html: _layout('Bienvenue', body) };
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
  return { subject: 'DataTradingPro : échec du renouvellement de votre abonnement', html: _layout('Renouvellement', body) };
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
  return { subject: 'DataTradingPro : votre abonnement a expiré', html: _layout('Abonnement expiré', body) };
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
  return { subject: 'DataTradingPro : réinitialisation impossible : abonnement inactif', html: _layout('Abonnement inactif', body) };
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
  return { subject: 'DataTradingPro : votre accès est réactivé', html: _layout('Réactivation', body) };
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
  return { subject: 'DataTradingPro : votre abonnement est renouvelé', html: _layout('Renouvellement', body) };
}
async function sendRenewed(d) { const m = buildRenewed(d); return _send(d.to, m.subject, m.html); }

// ── 2d) Geste commercial : +1 mois offert (maintenance) ───────────────────────
function buildGestureMonth({ name, expiresAt }) {
  const prenom = _esc((name || '').split(' ')[0] || 'cher client');
  const end = expiresAt ? new Date(expiresAt).toLocaleDateString('fr-FR') : null;
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:18px;font-weight:700;">1 mois offert 🎁</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Pour la récente période de <strong style="color:#fff;">maintenance</strong>, et pour vous remercier de votre patience, nous vous offrons <strong style="color:#34d399;">1 mois supplémentaire</strong> sur votre abonnement DataTradingPro, c'est notre geste commercial.</p>
    ${end ? `<p style="margin:0 0 14px;">Votre accès est désormais valable jusqu'au <strong style="color:#fff;">${end}</strong>.</p>` : ''}
    ${_button('Accéder au terminal', APP_URL)}
    ${_spamNote()}
    <p style="margin:0;font-size:13px;">Merci de votre confiance,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: 'DataTradingPro : 1 mois offert pour la maintenance 🎁', html: _layout('Geste commercial', body) };
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
      <tr><td style="padding:6px 0;color:#cbd5e1;font-size:14px;line-height:1.55;">🎨 <strong style="color:#fff;">Nouvelle identité visuelle</strong> : design premium, plus lisible, pensé pour le trading.</td></tr>
      <tr><td style="padding:6px 0;color:#cbd5e1;font-size:14px;line-height:1.55;">🇫🇷 <strong style="color:#fff;">100% en français</strong> : chaque widget, chaque libellé.</td></tr>
      <tr><td style="padding:6px 0;color:#cbd5e1;font-size:14px;line-height:1.55;">⚡ <strong style="color:#fff;">Terminal plus clair</strong> : Smart Bias, calendrier, news priorisée, force des devises, COT, Week Ahead, taux & Copilote Macro IA.</td></tr>
    </table>
    <p style="margin:0 0 14px;">Vos <strong style="color:#fff;">identifiants restent les mêmes</strong> : connectez-vous, tout se charge en temps réel.</p>
    ${_button('Accéder à mon terminal →', APP_URL)}
    ${_spamNote()}
    <p style="margin:14px 0 0;font-size:13px;">À très vite sur le desk,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return { subject: 'DataTradingPro est de nouveau en ligne, nouvelle interface 🚀', html: _layout('De nouveau en ligne', body) };
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
  return { subject: 'DataTradingPro : votre mot de passe a été réinitialisé', html: _layout('Réinitialisation', body) };
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
    <p style="margin:0 0 14px;">Votre <strong style="color:#fff;">semaine d'accès offert</strong> à DataTradingPro vient de prendre fin${end ? ` (elle a expiré <strong style="color:#f3c344;">${end}</strong>)` : ''}. Vous avez pu tester en conditions réelles le flux de news en temps réel, le calendrier économique et nos analyses institutionnelles.</p>
    <p style="margin:0 0 14px;">Pour <strong style="color:#fff;">retrouver votre accès</strong> et continuer à trader avec les données qui font bouger les marchés, passez dès maintenant à l'<strong style="color:#fff;">abonnement mensuel</strong>, sans engagement et résiliable à tout moment :</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:18px 0;">
      <tr><td style="padding:6px 0;color:#cbd5e1;font-size:14px;">✅ News &amp; squawk en temps réel, sans délai</td></tr>
      <tr><td style="padding:6px 0;color:#cbd5e1;font-size:14px;">✅ Calendrier économique et résultats live</td></tr>
      <tr><td style="padding:6px 0;color:#cbd5e1;font-size:14px;">✅ Analyses institutionnelles &amp; Rapports de banques</td></tr>
      <tr><td style="padding:6px 0;color:#cbd5e1;font-size:14px;">✅ FX Weekly Recap &amp; FX Daily Recap</td></tr>
    </table>
    ${_button('Activer mon abonnement mensuel', WHOP_RENEW_URL)}
    <p style="margin:0 0 14px;font-size:13px;color:#94a3b8;">Abonnement mensuel sans engagement : votre accès est réactivé immédiatement après l'inscription.</p>
    ${_spamNote()}
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
  // Encart "Pour démarrer en 5 minutes" (bordure orange, à notre sauce)
  const startBox = `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
      style="background:#0f0f12;border:1px solid #26262b;border-left:3px solid #f3c344;border-radius:10px;margin:20px 0;">
      <tr><td style="padding:16px 18px;">
        <div style="color:#f3c344;font-size:15px;font-weight:700;margin-bottom:8px;">Pour démarrer en 5 minutes</div>
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
      <li>Quelque chose ne t'a pas plu : dans ce cas, <strong style="color:#fff;">réponds-moi</strong>, je lis tout</li>
    </ul>
    ${startBox}
    ${_button('Revenir sur le terminal →', APP_URL)}
    <p style="margin:18px 0 10px;color:#94a3b8;font-size:13px;">Et tout le reste t'attend aussi&nbsp;:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr><td style="padding:5px 0;color:#cbd5e1;font-size:13.5px;">📊 <strong style="color:#fff;">FX List</strong> : vue d'ensemble Forex (force, biais, momentum 1M/3M/12M)</td></tr>
      <tr><td style="padding:5px 0;color:#cbd5e1;font-size:13.5px;">🏛️ <strong style="color:#fff;">Rapports institutionnels</strong> : ING, MUFG, SEB, Scotiabank… avec AI Insights</td></tr>
      <tr><td style="padding:5px 0;color:#cbd5e1;font-size:13.5px;">📝 <strong style="color:#fff;">Session Recaps &amp; Weekly</strong> : le marché résumé, à ta place</td></tr>
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
    `<tr><td style="padding:7px 0;color:#cbd5e1;font-size:14px;line-height:1.55;">${ico} <strong style="color:#fff;">${t}</strong> : ${d}</td></tr>`
  ).join('');
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:20px;font-weight:800;">C'est officiel : la v2 est finalisée 🚀</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Ça y est. Après des mois de développement et d'écoute, <strong style="color:#fff;">la version 2 de DataTradingPro est officiellement finalisée.</strong></p>
    <p style="margin:0 0 14px;">Ce n'est plus une promesse : c'est le terminal le plus abouti qu'on ait livré. Tout ce qu'un trader macro attend, réuni et <strong style="color:#fff;">connecté sur un seul écran</strong> :</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 12px;">${feats}</table>
    <p style="margin:0 0 14px;color:#94a3b8;font-size:13px;">+ Live Squawk, jauge Risk Sentiment, saisonnalité, taux des banques centrales, journal de trading…</p>
    <p style="margin:14px 0 4px;color:#fff;font-size:15px;font-weight:700;">Arrêtez de deviner les mouvements. Commencez à les comprendre.</p>
    ${_button('Rejoindre DataTradingPro →', WHOP_RENEW_URL)}
    <p style="margin:0 0 14px;font-size:13px;color:#94a3b8;">Accès complet immédiat · sans engagement, résiliable en un clic.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:rgba(227,178,58,0.08);border:1px solid rgba(227,178,58,0.3);border-radius:10px;margin:6px 0 4px;">
      <tr><td style="padding:12px 15px;color:#f3d9b0;font-size:13.5px;line-height:1.6;">⏳ Le terminal est complet et déjà en ligne. Chaque session que vous manquez, c'est une longueur d'avance en moins : <strong style="color:#fff;">rejoignez le lancement maintenant.</strong></td></tr>
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

// Gabarit CAMPAGNE — IDENTITE FIDELE AU DESK : tokens reels du terminal (bg #0d0e11, panneau #16171b,
// filet #232429). OR DES MAILS = #f3c344 (dore du FAVICON/logo DTP, choix user 2026-07-11 pour la coherence
// identite visuelle : le #e3b23a du desk paraissait orange). N'utiliser QUE #f3c344 dans les mails (le desk
// garde #e3b23a). Degrade wordmark or #f0d27a->#cfa233->#b8860b. Le degrade est applique en
// TEXTE (wordmark) avec repli SOLIDE #f3c344 (Outlook ignore background-clip -> texte or plein, jamais
// invisible) + en bandeau haut (bgcolor #f3c344 de repli). Rendu premium, hierarchie du desk.
function _campaignLayout(title, bodyHtml, unsub) {
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>${_esc(title)}</title>
<style>@media (max-width:480px){ .dtp-pad{padding:20px 16px !important;} .dtp-wrap{padding:24px 8px !important;} }</style></head>
<body style="margin:0;padding:0;background:#0d0e11;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="dtp-wrap" style="background:#0d0e11;padding:30px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#16171b;border:1px solid #232429;border-radius:10px;overflow:hidden;">
        <tr><td bgcolor="#f3c344" height="3" style="height:3px;line-height:3px;font-size:0;background:linear-gradient(100deg,#f0d27a,#cfa233 55%,#b8860b);mso-line-height-rule:exactly;">&nbsp;</td></tr>
        <tr><td style="padding:24px 34px 16px;border-bottom:1px solid #232429;">
          <div style="font-size:22px;font-weight:700;letter-spacing:-0.01em;color:#f3c344;background:linear-gradient(100deg,#f0d27a,#cfa233 55%,#b8860b);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;">DataTradingPro</div>
          <div style="font-size:11px;font-weight:600;color:#9a9aa4;margin-top:6px;letter-spacing:.09em;text-transform:uppercase;">Terminal macro &amp; forex</div>
        </td></tr>
        <tr><td class="dtp-pad" style="padding:26px 34px;color:#c8ccd4;font-size:15px;line-height:1.66;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:18px 34px;border-top:1px solid #232429;color:#6f6f79;font-size:12px;line-height:1.6;">
          DataTradingPro &middot; terminal de news &amp; d'analyse de march&eacute;. Contenu informatif&nbsp;: n'ex&eacute;cute aucun ordre, ne donne aucun conseil personnalis&eacute;.<br>
          Une question&nbsp;? <a href="mailto:${SUPPORT_EMAIL}" style="color:#f3c344;text-decoration:none;">${SUPPORT_EMAIL}</a>
        </td></tr>
      </table>
      <div style="color:#565660;font-size:11px;margin-top:14px;line-height:1.7;max-width:600px;">
        Vous recevez cet email en tant que membre de l'&eacute;cosyst&egrave;me DataTradingPro (JustOneTrader).<br>
        <a href="${unsub}" style="color:#8b93a1;text-decoration:underline;">Se d&eacute;sabonner en un clic</a>
      </div>
    </td></tr>
  </table>
</body></html>`;
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
// Widget MAIL = VRAI widget du desk (rendu frais PNG, embarque en inline cid a l'envoi par _sendWithInlineWidgets).
// PAS d'intitule visible au-dessus (le contexte est deja donne par le texte du mail) ; l'`eyebrow` ne sert plus
// que d'alt (accessibilite + repli si image bloquee). Cadre aux tokens desk (#232429, coins 6px) ; responsive + Outlook.
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
function _widgetImg(type, eyebrow, maxW, period) {
  maxW = maxW || 532;
  const lbl = _esc(eyebrow || '');
  const per = period ? `&period=${encodeURIComponent(period)}` : '';
  return `<img src="${APP_URL}/api/email-widget/${type}.png?t=${Date.now()}${per}" width="${maxW}" alt="${lbl} DataTradingPro" style="display:block;width:100%;max-width:${maxW}px;height:auto;border:1px solid #232429;border-radius:6px;margin:16px 0;">`;
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
    if (e.dayLabel && e.dayLabel !== lastDay) { lastDay = e.dayLabel; out += `<tr><td colspan="4" style="padding:8px 10px 4px;background:#101012;color:#9aa3b2;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;">${_esc(e.dayLabel)}</td></tr>`; }
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
    <p style="margin:0 0 16px;">Merci de faire partie de l'aventure <strong style="color:#f3c344;">DataTradingPro</strong>. Chaque semaine, le desk vous &eacute;crit pour rendre le march&eacute; <strong>macro &amp; forex</strong> lisible, en fran&ccedil;ais. Voici votre <strong style="color:#fff;">semaine type</strong>&nbsp;:</p>
    <ul style="margin:0 0 20px;padding-left:20px;color:#cbd5e1;">
      <li style="margin:6px 0;">🗓️ <strong style="color:#fff;">Semaine &agrave; venir</strong>&nbsp;: chaque lundi, l'agenda tri&eacute; par le desk, vous savez o&ugrave; regarder avant que la semaine ne commence.</li>
      <li style="margin:6px 0;">🎓 <strong style="color:#fff;">Comprendre le march&eacute;</strong>&nbsp;: chaque mardi, un concept macro choisi selon l'actualit&eacute; et d&eacute;cod&eacute; simplement, comme au desk.</li>
      <li style="margin:6px 0;">📊 <strong style="color:#fff;">Point march&eacute;</strong>&nbsp;: chaque mercredi, le brief du desk, la s&eacute;ance, les chiffres &eacute;co et la force des devises, en clair.</li>
      <li style="margin:6px 0;">🧠 <strong style="color:#fff;">Mindset</strong>&nbsp;: chaque jeudi, psychologie et discipline, de quoi garder la t&ecirc;te froide quand le march&eacute; s'agite.</li>
      <li style="margin:6px 0;">📰 <strong style="color:#fff;">R&eacute;cap hebdo</strong>&nbsp;: chaque vendredi, la r&eacute;trospective de la semaine &eacute;coul&eacute;e, devise par devise, sans le bruit.</li>
    </ul>
    <p style="margin:0 0 6px;">Pour explorer le terminal quand vous voulez&nbsp;:</p>
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
        if (!re.test(html)) continue;   // widget non reference → NE PAS l'attacher
        re.lastIndex = 0;
        const png = await ew.renderWidgetPngSafe(wt, period ? { period } : {});
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

// ── Digest HEBDO (récurrent, AUTO-GÉNÉRÉ) — construit à partir des vraies données du Récap Hebdo du desk.
// `weekly` = objet _weekly {summary, insights, pairs:[{pair,bias,text}], centralBanks:[{bank,stance}]}.
// Renvoie null si aucune donnée (règle « pas de données → pas de mail »). 100% informatif.
function buildWeeklyDigest({ name, email, campaign, weekly } = {}) {
  campaign = campaign || 'weekly';
  const w = weekly || {};
  const _md = s => String(s == null ? '' : s).replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
  const insights = (Array.isArray(w.insights) ? w.insights : []).map(t => _md(typeof t === 'string' ? t : (t && t.text))).filter(Boolean);
  const cbList = (Array.isArray(w.centralBanks) ? w.centralBanks : []).filter(c => c && c.bank);
  const lead = _md(w.summary) || insights[0] || '';
  if (!lead && !insights.length) return null;
  const prenomRaw = (name || '').split(' ')[0] || '';
  const prenom = _esc(prenomRaw);
  const hello = prenom ? `Bonjour ${prenom},` : 'Bonjour,';
  const unsub = unsubUrl(email || '');
  // AVANT-GOUT du rapport Recap Hebdo (demande user : plus de cartes de paires) : les POINTS CLES de la semaine,
  // tires des insights REELS du rapport -> puces or, memes donnees que l'onglet Analystes.
  const keyPts = insights.slice(lead === insights[0] ? 1 : 0, (lead === insights[0] ? 1 : 0) + 4);
  const insightsHtml = keyPts.length
    ? `<p style="margin:0 0 6px;color:#9aa3b2;font-size:12.5px;">Les points clés de la semaine&nbsp;:</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">${keyPts.map(p => `<tr><td style="padding:4px 0;color:#cbd5e1;font-size:13.5px;line-height:1.55;"><span style="color:#f3c344;font-weight:700;">&bull;</span>&nbsp;${_esc(p).slice(0, 240)}</td></tr>`).join('')}</table>`
    : '';
  // Ton des banques centrales des 3 DEVISES VEDETTES (demande user) : 1 ligne = une phrase du président qui
  // montre le ton (hawkish/dovish). On ne montre QUE ces 3 banques (pas les 8), sans décision/guidance/prochaine réunion.
  const _cbBiasCol = b => /hawk/i.test(b) ? '#22c55e' : /dov/i.test(b) ? '#ef4444' : '#9aa3b2';   // SÉMANTIQUE : hawkish=haussier→vert · dovish=baissier→rouge · neutre=gris
  const _curSrc = (w.currencies && typeof w.currencies === 'object') ? w.currencies : {};
  const _curPick = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'].filter(c => _curSrc[c] && _curSrc[c].analysis && String(_curSrc[c].analysis).trim().length > 30).slice(0, 3);
  const _cbTone = _curPick.map(code => cbList.find(c => c.code === code)).filter(Boolean).slice(0, 3);
  const cbToneHtml = _cbTone.length ? `<p style="margin:16px 0 6px;color:#9aa3b2;font-size:12.5px;">Le ton des banques centrales des devises de la semaine&nbsp;:</p>
    <div style="border:1px solid #232429;border-radius:6px;overflow:hidden;margin:0 0 6px;background:#0d0e11;">
    ${_cbTone.map((c, i) => {
      const bias = _md(c.bias5 || c.stance || 'Neutre');
      const q = (c.quotes && c.quotes.length) ? c.quotes[0] : null;
      const line = q ? ('« ' + _esc(_md(q.quote)) + ' »') : (c.guidance ? _esc(_cutTxt(_md(c.guidance), 170)) : (c.narrative ? _esc(_cutTxt(_md(c.narrative), 170)) : ''));
      const est = (c.source && c.source !== 'market') ? ' <span style="color:#7b828f;font-size:9px;font-weight:700;">est.</span>' : '';
      return `<div style="padding:10px 12px;${i ? 'border-top:1px solid #1f1f24;' : ''}">
        <div><span style="color:#f3c344;font-weight:800;font-size:13px;">${_esc(_md(c.bank))}</span> <span style="color:${_cbBiasCol(bias)};font-weight:700;font-size:12px;">${_esc(bias)}</span>${est}</div>
        ${line ? `<div style="color:#cbd5e1;font-size:12.5px;line-height:1.55;margin-top:3px;font-style:italic;">${line}</div>` : ''}
      </div>`;
    }).join('')}
    </div>` : '';
  // EXTRAIT du rapport, PAR DEVISE (demande user, remplace la phrase force-des-devises) : 1-2 phrases de
  // l'analyse REELLE de 3 devises du Recap Hebdo, coupees proprement -> teaser fidele, sans noyer le mail.
  let curHtml = '';
  if (_curPick.length) {
    const rows = _curPick.map(c => `<tr><td style="padding:8px 0;border-top:1px solid #1f1f24;">
        <span style="color:#f3c344;font-weight:800;font-size:12.5px;">${c}</span>
        <div style="color:#cbd5e1;font-size:13px;line-height:1.55;margin-top:2px;">${_esc(_cutTxt(_md(_curSrc[c].analysis), 230))}</div>
      </td></tr>`).join('');
    curHtml = `<p style="margin:14px 0 4px;color:#9aa3b2;font-size:12.5px;">${_curPick.length === 1 ? 'Une devise de la semaine, lue' : _curPick.length + ' devises de la semaine, lues'} par le desk, sans entrer dans le détail&nbsp;:</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px;">${rows}</table>`;
  }
  // Table CALENDRIER À VENIR (v18) : les prochains rendez-vous majeurs de la semaine, du + proche au + éloigné.
  const _WD_ISO = { USD: 'us', EUR: 'eu', GBP: 'gb', JPY: 'jp', CHF: 'ch', CAD: 'ca', AUD: 'au', NZD: 'nz', CNY: 'cn' };
  const _wdFlag = ccy => { const c = String(ccy || '').toUpperCase(); const iso = _WD_ISO[c]; return (iso ? `<img src="https://flagcdn.com/w20/${iso}.png" width="16" height="12" alt="" style="vertical-align:middle;border-radius:2px;margin-right:4px;">` : '') + (c ? `<span style="color:#cbd5e1;font-weight:700;font-size:11px;">${_esc(c)}</span>` : ''); };
  const _wdTh = t => `<td style="padding:6px 10px;color:#8b93a1;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;${t === 'r' ? 'text-align:right;' : ''}">${t === 'd' ? 'Jour' : t === 'c' ? 'Devise' : t === 'e' ? 'Événement' : 'Prév.'}</td>`;
  const _calFlat = [];
  for (const d of ((w.calendar && Array.isArray(w.calendar.upcoming)) ? w.calendar.upcoming : [])) for (const e of (d.events || [])) _calFlat.push({ e, day: d.dayLabel });
  const _calRows = _calFlat.slice(0, 8);
  const calTableHtml = _calRows.length ? `<p style="margin:16px 0 6px;color:#9aa3b2;font-size:12.5px;">Les prochains rendez-vous majeurs, du plus proche au plus éloigné&nbsp;:</p>
    <div style="border:1px solid #232429;border-radius:6px;overflow:hidden;margin:0 0 6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#0d0e11;">
    <tr style="background:#101012;">${_wdTh('d')}${_wdTh('c')}${_wdTh('e')}${_wdTh('r')}</tr>
    ${_calRows.map(({ e, day }) => `<tr>
      <td style="padding:7px 10px;border-top:1px solid #1f1f24;color:#9aa3b2;font-size:11px;white-space:nowrap;">${_esc(day)}${e.time ? ' ' + _esc(e.time) : ''}</td>
      <td style="padding:7px 10px;border-top:1px solid #1f1f24;white-space:nowrap;">${_wdFlag(e.ccy)}</td>
      <td style="padding:7px 10px;border-top:1px solid #1f1f24;color:#e6e6ea;font-size:12.5px;">${_esc(e.title)}</td>
      <td style="padding:7px 10px;border-top:1px solid #1f1f24;color:#9aa3b2;font-size:11.5px;text-align:right;white-space:nowrap;">${_esc(e.forecast || '·')}</td>
    </tr>`).join('')}
    </table></div>` : '';
  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:#e6e6ea;">${hello}</p>
    <p style="margin:0 0 16px;">Voici un <strong style="color:#f3c344;">avant-goût du Récap Hebdo</strong> du desk : la rétrospective de la semaine, en clair.</p>
    ${lead ? `<p style="margin:0 0 16px;">${_esc(lead).slice(0, 520)}</p>` : ''}
    ${insightsHtml}
    ${curHtml}
    ${_widgetImg('strength', 'La force des devises')}
    ${cbToneHtml}
    <p style="margin:0 0 6px;">Ceci n'est qu'un extrait&nbsp;: le rapport complet (analyse par banque, guidance et propos, analyse par devise) vous attend sur le <strong style="color:#fff;">Desk</strong>&nbsp;:</p>
    ${_campaignBtn('Ouvrir DataTradingPro', trackClickUrl(campaign, email, LANDING_URL))}
    <p style="margin:0 0 4px;">Bonne semaine,</p>
    <p style="margin:0 0 16px;color:#9aa3b2;">L'&eacute;quipe DataTradingPro</p>
    <img src="${trackOpenUrl(campaign, email)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;overflow:hidden;">
  `;
  // Sujets ROTATIFS (déterministes par semaine) : accrocheurs, factuels, jamais deux fois de suite le même.
  const _wkR = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
  const _subsR = [
    '📰 Votre semaine de marché, relue par le desk',
    '🗞️ Ce que cette semaine a changé sur les marchés',
    '📰 La semaine en clair, devise par devise',
  ];
  const subject = _subsR[_wkR % _subsR.length];
  return { subject, html: _campaignLayout('Point de la semaine', body, unsub) };
}
async function sendWeeklyDigest(d) { d = d || {}; const m = buildWeeklyDigest({ name: d.name, email: d.email || d.to, campaign: d.campaign, weekly: d.weekly }); if (!m) return false; return _sendWithInlineWidgets(d.to, m.subject, m.html, ['strength']); }   // cb-tone RETIRE : le widget n'est plus dans le corps du digest → l'attacher creait une piece jointe orpheline (Gmail « Une piece jointe »). 0 PJ.

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
  { key: 'risk-on-off', theme: 'risk', eyebrow: 'SENTIMENT', title: 'Risk-on / risk-off : la boussole du marché', paras: [
    "En risk-on, les investisseurs cherchent le rendement : les actions et les devises pro-cycliques (dollar australien, néo-zélandais, canadien) montent, les valeurs refuges reculent.",
    "En risk-off, ils cherchent la sécurité : dollar américain, yen, franc suisse et or se renforcent, les actions souffrent.",
    "Savoir dans quel régime on se trouve évite de se battre contre le courant dominant du marché. C'est l'une des premières lectures du desk chaque matin.",
  ] },
];
// Selection PURE : choisit le concept selon le theme du contexte, en sautant les cles couvertes recemment.
function pickDecryptConcept(context, recentKeys) {
  recentKeys = Array.isArray(recentKeys) ? recentKeys : [];
  const theme = (context && context.theme) || 'calm';
  const byTheme = {}; for (const c of DECRYPT_CONCEPTS) (byTheme[c.theme] = byTheme[c.theme] || []).push(c);
  const order = { rates: ['rates', 'inflation', 'jobs'], inflation: ['inflation', 'jobs', 'growth'], jobs: ['jobs', 'inflation', 'growth'], growth: ['growth', 'jobs', 'risk'], risk: ['risk', 'growth', 'inflation'], calm: ['inflation', 'growth', 'jobs', 'risk', 'rates'] }[theme] || ['inflation', 'growth'];
  for (const th of order) { const cands = byTheme[th] || []; const fresh = cands.find(c => !recentKeys.includes(c.key)); if (fresh) return { concept: fresh, theme }; }
  // tout couvert recemment -> reprend le 1er du theme (mieux vaut un rappel pertinent qu'un hors-sujet)
  const cands = byTheme[theme] || byTheme.inflation || DECRYPT_CONCEPTS; return { concept: cands[0], theme };
}

// CTA adapte MEMBRE / NON-MEMBRE (validation user : tout le monde recoit, contenu adapte).
// Le bloc PS a ete RETIRE des templates (demande user) ; la mention informative vit desormais,
// discrete, dans le footer du layout (_campaignLayout).
function _campaignCta(isMember, campaign, email) {
  const url = trackClickUrl(campaign, email, LANDING_URL);
  if (isMember) return { btn: _campaignBtn('Ouvrir mon Desk', url) };
  return { btn: _campaignBtn('Découvrir le Desk en direct', url) };
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
// APERCU du RAPPORT QUOTIDIEN (Point marche) — carte facon rapport du desk : en-tete (titre reel du
// rapport + date), sections par theme (titre or + puces / paras / mini-tableau de donnees), puis mention
// « le rapport complet est sur le Desk ». Cape a 6 sections x 5 lignes. Zero invention.
function _dailyBriefBlock(sections, dateLabel, reportTitle, hasComments) {
  const secs = (Array.isArray(sections) ? sections : []).filter(s => s && s.title).slice(0, 6);
  if (!secs.length) return '';
  const intro = `<p style="margin:20px 0 8px;color:#9aa3b2;font-size:12.5px;">L'essentiel du rapport quotidien du desk, sans entrer dans le détail&nbsp;:</p>`;
  const head = `<div style="padding:13px 16px;border-bottom:1px solid #26262b;">
      <div style="color:#f3c344;font-weight:800;font-size:13.5px;letter-spacing:.01em;">${_esc(reportTitle || 'Point Marché : le rapport du jour')}</div>
      ${dateLabel ? `<div style="color:#8b93a1;font-size:11.5px;margin-top:3px;">${_esc(dateLabel)}</div>` : ''}
    </div>`;
  const blocks = secs.map(s => {
    const title = `<div style="margin:14px 0 4px;color:#f3c344;font-weight:800;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;">${_esc(s.title)}</div>`;
    if (s.kind === 'data' && Array.isArray(s.data) && s.data.length) {
      // VRAI tableau (demande user) : Devise (+ drapeau) | Publication | Réel | Att. | Préc. — façon calendrier
      // du desk. Le réel en blanc gras, attendu/précédent estompés → l'écart saute aux yeux. Drapeau à gauche.
      // COMPACT MOBILE : en-têtes courts, padding 5px, nowrap sur Devise et Réel.
      const _ISO = { USD: 'us', EUR: 'eu', GBP: 'gb', JPY: 'jp', CHF: 'ch', CAD: 'ca', AUD: 'au', NZD: 'nz', CNY: 'cn' };
      const _flag = ccy => { const c = String(ccy || '').toUpperCase(); const iso = _ISO[c]; return (iso ? `<img src="https://flagcdn.com/w20/${iso}.png" width="16" height="12" alt="" style="vertical-align:middle;border-radius:2px;margin-right:5px;">` : '') + (c ? `<span style="color:#cbd5e1;font-weight:700;">${_esc(c)}</span>` : ''); };
      // Couleur du RÉEL (demande user) : vert si valeur positive, rouge si négative (charte DTP risk-on/off),
      // blanc si nul / non chiffré (ex. « · », « 19.1B » reste vert car >0). Signe = 1er nombre + parenthèses compta.
      const _actColor = v => { const s = String(v == null ? '' : v).trim(); const n = parseFloat(s.replace(/[^0-9.\-]/g, '')); if (!s || s === '·' || isNaN(n) || n === 0) return '#ffffff'; return (n < 0 || /^\s*[-(]/.test(s)) ? '#ef4444' : '#22c55e'; };
      const _th = (label, right) => `<td${right ? ' align="right"' : ''} style="padding:6px 5px;color:#8b93a1;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;border-bottom:1px solid #26262b;">${label}</td>`;
      const rows = s.data.slice(0, 8).map(r => `<tr>
          <td style="padding:7px 5px;border-top:1px solid #1f1f24;white-space:nowrap;font-size:11.5px;">${_flag(r.ccy)}</td>
          <td style="padding:7px 5px;color:#e6e6ea;font-size:12.5px;line-height:1.4;border-top:1px solid #1f1f24;">${_esc(r.release || '')}</td>
          <td align="right" style="padding:7px 5px;color:${_actColor(r.actual)};font-weight:700;font-size:12.5px;border-top:1px solid #1f1f24;white-space:nowrap;">${_esc(r.actual || '·')}</td>
          <td align="right" style="padding:7px 5px;color:#9aa3b2;font-size:12.5px;border-top:1px solid #1f1f24;">${_esc(r.expected || '·')}</td>
          <td align="right" style="padding:7px 5px;color:#7b828f;font-size:12.5px;border-top:1px solid #1f1f24;">${_esc(r.previous || '·')}</td>
        </tr>`).join('');
      return rows ? title + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#101014;border:1px solid #26262b;border-radius:8px;border-collapse:separate;">
          <tr>${_th('Devise')}${_th('Publication')}${_th('Réel', true)}${_th('Att.', true)}${_th('Préc.', true)}</tr>
          ${rows}
        </table>` : '';
    }
    const arr = (s.kind === 'paras' ? s.paras : s.items) || [];
    const items = arr.slice(0, 5).map(x => `<tr><td style="padding:4px 0;color:#cbd5e1;font-size:13.5px;line-height:1.55;"><span style="color:#f3c344;font-weight:700;">&bull;</span>&nbsp;${_esc(String(x))}</td></tr>`).join('');
    return items ? title + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table>` : '';
  }).join('');
  if (!blocks) return '';
  return `${intro}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f12;border:1px solid #26262b;border-radius:10px;">
      <tr><td>${head}</td></tr>
      <tr><td style="padding:0 16px 14px;">${blocks}</td></tr>
    </table>
    ${hasComments
      ? `<p style="margin:8px 0 0;font-size:12.5px;color:#7b828f;">Ceci n'est qu'un aperçu. La pièce maîtresse du rapport, les <strong style="color:#f3c344;">Commentaires marquants</strong> (ce que disent réellement les analystes des grands desks), se lit en entier sur le <strong style="color:#9aa3b2;">Desk</strong>.</p>`
      : `<p style="margin:8px 0 0;font-size:12.5px;color:#7b828f;">Ceci n'est qu'un aperçu&nbsp;: le rapport complet (toutes les sections, les chiffres et le contexte) vous attend sur le <strong style="color:#9aa3b2;">Desk</strong>.</p>`}`;
}
// ── DÉCRYPTAGE CONTEXTUEL (S2) — moteur intelligent : choisit un concept selon le calendrier REEL de la semaine,
// l'explique en clair, puis liste les vrais temps forts a surveiller (prevision/precedent live). Anti-redondance
// via recentKeys. Repli evergreen (decodeur 4 familles) si aucune donnee. Renvoie aussi conceptKey (marquage).
function buildCampaignDecryptage({ name, email, campaign, context, recentKeys, isMember } = {}) {
  campaign = campaign || 'decryptage';
  const prenomRaw = (name || '').split(' ')[0] || '';
  const hello = prenomRaw ? `Bonjour ${_esc(prenomRaw)},` : 'Bonjour,';
  const unsub = unsubUrl(email || '');
  const cta = _campaignCta(isMember, campaign, email);
  const upcoming = (context && Array.isArray(context.upcoming)) ? context.upcoming : [];
  const majors = upcoming.filter(e => e.impact === 'High');
  const pick = pickDecryptConcept(context, recentKeys);
  const c = pick.concept;

  // Accroche ancree sur l'evenement VEDETTE du calendrier (context.featured = ce que le widget affiche en tete)
  // -> le mail vedette le MEME evenement que le calendrier affiche -> jamais de contradiction texte/calendrier.
  const featured = (context && context.featured) || majors[0] || upcoming[0] || null;
  let lead;
  if (featured) {
    const when = `${featured.dayLabel || ''}${featured.time ? ' à ' + featured.time : ''}`.trim();
    lead = `Cette semaine, le desk suit <strong style="color:#fff;">${upcoming.length} temps fort${upcoming.length > 1 ? 's' : ''}</strong> au calendrier. Le rendez-vous clé&nbsp;: <strong style="color:#f3c344;">${_esc(featured.title)}</strong>${when ? ' (' + _esc(when) + ')' : ''}.`;
  } else {
    lead = `Chaque semaine, le calendrier se remplit de sigles. Voici un fondamental à garder en tête pour les lire d'un coup d'œil.`;
  }

  const conceptHtml = `
    <div style="margin:20px 0 8px;">
      <div style="display:inline-block;color:#0a0a0c;background:#f3c344;font-weight:800;font-size:11px;letter-spacing:.06em;padding:4px 11px;border-radius:6px;">${_esc(c.eyebrow)}</div>
      <div style="color:#ffffff;font-weight:800;font-size:18px;line-height:1.3;margin:10px 0 2px;letter-spacing:-.01em;">${_esc(c.title)}</div>
    </div>
    ${c.paras.map(p => `<p style="margin:0 0 12px;">${_esc(p)}</p>`).join('')}`;

  // Agenda de la semaine = VRAI widget calendrier economique du desk (inline cid a l'envoi). Meme ordre que
  // l'accroche (evenement vedette en tete) -> coherent. Affiche seulement s'il y a des evenements a venir.
  const agendaHtml = upcoming.length
    ? `${_widgetImg('calendar', "L'agenda de la semaine")}<p style="margin:2px 0 0;font-size:12.5px;color:#7b828f;">Sur le Desk, chacune de ces publications est reprise, chiffrée et remise en contexte en direct.</p>`
    : '';

  // « Cette semaine, concretement » : rattache le concept educatif a l'evenement VEDETTE avec ses VRAIS chiffres
  // (prevision/precedent du calendrier) -> developpe le contenu, ancre dans le live, zero invention. Remplace
  // l'ancien bloc « grandes banques » (juge sans valeur ici par l'utilisateur).
  let appliedHtml = '';
  if (featured && featured.title) {
    const fwhen = `${featured.dayLabel || ''}${featured.time ? ' à ' + featured.time : ''}`.trim();
    const fnums = [];
    if (featured.forecast) fnums.push(`prévision <strong style="color:#cbd5e1;">${_esc(featured.forecast)}</strong>`);
    if (featured.previous) fnums.push(`précédent <strong style="color:#cbd5e1;">${_esc(featured.previous)}</strong>`);
    const fnumLine = fnums.length ? ` Le marché attend ${fnums.join(', ')}.` : '';
    appliedHtml = `<p style="margin:18px 0 12px;"><strong style="color:#f3c344;">Cette semaine, concrètement&nbsp;:</strong> le rendez-vous à surveiller est <strong style="color:#fff;">${_esc(featured.title)}</strong>${fwhen ? ' (' + _esc(fwhen) + ')' : ''}.${fnumLine} C'est exactement la mécanique décrite plus haut, à lire en direct&nbsp;: le marché compare le chiffre aux attentes, pas au niveau brut, et c'est l'écart qui fait bouger le dollar, l'or et les indices.</p>`;
  }

  // Repli evergreen (decodeur 4 familles) uniquement si vraiment aucune donnee calendrier
  const evergreen = (!upcoming.length) ? _DECRYPT_FAMILIES.map(fam => {
    const rows = fam.items.slice(0, 3).map(it => `<tr><td style="padding:9px 0 3px;border-top:1px solid #1f1f24;"><span style="color:#fff;font-weight:700;font-size:13.5px;">${_esc(it.k)}</span><div style="color:#aab2c0;font-size:12.5px;line-height:1.45;margin-top:2px;">${_esc(it.d)}</div><div style="color:#f3c344;font-size:11.5px;font-weight:600;margin-top:1px;">&rarr; ${_esc(it.a)}</div></td></tr>`).join('');
    return `<div style="margin:18px 0 4px;"><span style="display:inline-block;color:#0a0a0c;background:#f3c344;font-weight:800;font-size:11px;letter-spacing:.05em;padding:3px 10px;border-radius:6px;">${_esc(fam.name)}</span></div><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
  }).join('') : '';

  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:#e6e6ea;">${hello}</p>
    <p style="margin:0 0 6px;">${lead}</p>
    ${conceptHtml}
    ${agendaHtml}
    ${appliedHtml}
    ${evergreen}
    <div style="margin:22px 0 6px;">${cta.btn}</div>
    <p style="margin:0 0 4px;">À très vite,</p>
    <p style="margin:0 0 16px;color:#9aa3b2;">L'équipe DataTradingPro</p>
    <img src="${trackOpenUrl(campaign, email)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;overflow:hidden;">
  `;
  return { subject: '🎓 ' + c.title, html: _campaignLayout('Comprendre le marché', body, unsub), conceptKey: c.key, conceptTitle: c.title, theme: pick.theme };
}
async function sendCampaignDecryptage(d) { d = d || {}; const m = buildCampaignDecryptage({ name: d.name, email: d.email || d.to, campaign: d.campaign, context: d.context, recentKeys: d.recentKeys, isMember: d.isMember }); const prov = await _sendWithInlineWidgets(d.to, m.subject, m.html, ['calendar']); return prov ? { provider: prov, conceptKey: m.conceptKey } : false; }

// ── MINDSET (track psychologie/discipline) — bibliotheque de mails ORIGINAUX DTP (voix or, informatif, ZERO
// promesse de gains, aucun texte repris d'une newsletter existante). Structure : accroche -> croyance -> faille ->
// recadrage (puces) -> question reflexive. Rotation anti-repetition par recentKeys (marques cote serveur, KV
// campaign:mindset-history). Aucun widget -> envoi texte simple (_send).
const MINDSET_CONCEPTS = [
  { key: 'bruit-news', subject: "🔕 Tout suivre, ce n'est pas s'informer", paras: [
    "Beaucoup de traders confondent une chose : être présent partout et être réellement informé. On croit qu'un bon trader suit tout, lit tout, réagit à tout. 📰",
    "Pourtant, un titre qui claque n'est pas une information neuve. Le plus souvent, c'est une réaction déjà absorbée par le marché, déjà inscrite dans les prix.",
    "À force de courir après chaque alerte, tu ne t'informes plus : tu t'épuises. Ton attention, ta ressource la plus rare, se disperse ligne après ligne.",
    "L'avantage ne vient jamais du volume de nouvelles. Il vient de ta capacité à trier ce qui mérite ton regard. 🥇",
    "- Un titre qui crie fort n'est pas un titre qui pèse lourd.",
    "- Le calendrier économique désigne à l'avance ce qui mérite ton attention.",
    "- Trier, c'est décider avant l'ouverture ce qui changerait vraiment ta lecture.",
    "- Le silence entre deux nouvelles fait partie de l'analyse, pas du vide.",
    "Un feed calme n'est pas un feed pauvre. C'est un feed déjà passé au tamis.",
  ], closing: "La dernière nouvelle qui t'a fait réagir modifiait-elle vraiment ta lecture, ou comblait-elle seulement le silence ?" },
  { key: 'process-vs-prediction', subject: "🎯 Deviner juste ne prouve rien", paras: [
    "Il y a une envie difficile à taire chez le trader : deviner le prochain mouvement avant tout le monde, sentir le marché mieux que les autres. 🎯",
    "Peu à peu, on confond la qualité d'une décision avec le simple fait d'avoir vu juste.",
    "Mais le marché ne récompense pas les devins. Une prédiction juste posée sur une méthode fragile, c'est de la chance déguisée en talent, et la chance ne signe pas deux fois.",
    "Le vrai levier est ailleurs : une méthode que tu peux dérouler cent fois de la même manière, sans rien improviser. 🧭",
    "- Lire le contexte avant d'ouvrir un graphique, jamais l'inverse.",
    "- Poser tes règles à froid : conditions d'invalidation, événements à surveiller, plan de sortie.",
    "- Juger une décision sur la rigueur de sa méthode, pas sur son résultat isolé.",
    "- Accepter qu'une bonne décision puisse déplaire, et une mauvaise réussir par hasard.",
    "Une méthode solide te libère du besoin d'avoir raison : tu n'as plus à deviner, tu observes et tu exécutes. ✨",
  ], closing: "Et si, cette semaine, tu évaluais tes décisions à la rigueur de ta méthode plutôt qu'à leur seul résultat ?" },
  { key: 'serie-de-pertes', subject: "⚖️ Le marché ne te doit aucune revanche", paras: [
    "Après deux, trois, quatre pertes qui s'enchaînent, une pulsion monte : tout récupérer, immédiatement. 🔴",
    "Alors on force une entrée, on gonfle la taille, on réclame au marché une revanche.",
    "Le piège tient en une phrase : le marché ignore ton solde. Il ne te doit aucun remboursement.",
    "Vouloir effacer une perte, c'est laisser l'émotion choisir à la place de ton analyse.",
    "Sépare le score du geste. Une série rouge est une donnée, jamais un verdict sur ta valeur.",
    "- Une perte t'informe sur le marché, pas sur ce que tu vaux.",
    "- Le sur-risque après un revers, c'est de l'émotion déguisée en stratégie.",
    "- Une pause nette vaut mieux qu'une décision prise pour de mauvaises raisons.",
    "- Revenir à ta méthode apaise l'envie de te rattraper.",
    "Reprendre pied, c'est retrouver ta lecture avant de décider quoi que ce soit. 🪙",
  ], closing: "Ta prochaine position, tu la prends pour lire le marché, ou pour effacer la précédente ?" },
  { key: 'patience-vs-agitation', subject: "⏳ S'agiter n'est pas travailler", paras: [
    "Une idée colle à la peau : plus tu passes d'heures devant les écrans, plus tu progresserais. 🕰️",
    "Comme si l'agitation prouvait le sérieux, et le calme trahissait la paresse.",
    "Le marché, lui, ne paie jamais ta présence. Il ne répond qu'à la justesse de tes décisions.",
    "Multiplier les positions pour « ne rien manquer », c'est souvent manquer l'essentiel : le recul.",
    "- Une séance sans position peut être ta meilleure séance.",
    "- Attendre le bon scénario, c'est un travail, pas de l'inaction.",
    "- Ta discipline se lit aussi dans les trades que tu refuses.",
    "- La patience n'est pas de l'attente subie : c'est une décision, tenue. ⚙️",
    "Ta progression ne se mesure pas au nombre d'onglets ouverts, mais à la netteté de tes choix. 🟡",
  ], closing: "Et si tu jaugeais ta semaine non pas à tes heures d'écran, mais à la qualité de tes décisions ?" },
  { key: 'ego-avoir-tort', subject: "🥇 Ton ego pèse plus lourd que ton stop", paras: [
    "Une croyance s'accroche chez beaucoup de traders : couper une position, ce serait admettre qu'on s'est trompé. Alors on serre les dents et on espère. 🤔",
    "Le marché, pourtant, ignore ta fierté. Il ne sait même pas que tu existes.",
    "Espérer n'a jamais été un plan. C'est souvent l'ego qui refuse de rendre les clés.",
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
    "Ce qui construit un trader, ce n'est pas l'éclair isolé, mais la répétition propre du même geste.",
    "- Un geste que tu peux tenir cent fois vaut mieux qu'un éclair irremplaçable.",
    "- La régularité protège ton capital mental : moins d'euphorie, moins de tilt.",
    "- Le spectacle des réseaux se trie comme le reste : tu gardes le fond, tu laisses la mise en scène.",
    "- Une routine lisible se répète ; un coup de génie, non.",
    "L'or n'impressionne pas parce qu'il brille fort. Il compte parce qu'il dure. 🪙",
  ], closing: "Ton dernier « bon trade », était-ce un geste reproductible à froid, ou une exception que tu t'es racontée ?" },
  { key: 'preparation-contexte', subject: "🧭 L'avantage se gagne avant la première bougie", paras: [
    "On croit souvent que l'avantage d'un trader se joue dans l'instant : le bon setup, le réflexe éclair, le clic au bon moment. 🕰️",
    "C'est là que l'illusion s'installe. Réagir à un marché qu'on n'a pas préparé, c'est courir derrière un mouvement déjà lancé.",
    "Le vrai avantage se façonne avant l'ouverture, dans le calme de la préparation.",
    "Lire le contexte, c'est donner un sens au prix : un chiffre seul ne dit rien, c'est le cadre qui parle.",
    "- Ouvre le calendrier économique avant la séance, pas au milieu d'une bougie.",
    "- Repère à l'avance les événements capables de déplacer tes paires.",
    "- Distingue le signal du décor, sans t'y perdre.",
    "- Prépare des scénarios plutôt que de subir l'annonce.",
    "Se préparer, ce n'est pas prédire. C'est arriver lucide, une carte en main, quand d'autres avancent à l'aveugle.",
  ], closing: "Avant ta prochaine séance, sauras-tu dire ce que le calendrier réserve à tes paires, ou le découvriras-tu en pleine bougie ?" },
  { key: 'journal-erreurs', subject: "📓 Une erreur non écrite revient toujours", paras: [
    "Le réflexe le plus courant après une erreur ? La glisser dans un coin de la tête en se disant « leçon retenue ». 🧠",
    "Sauf que la mémoire réécrit tout. Sans trace, la même erreur revient plus tard, déguisée mais identique.",
    "Un journal n'est pas un carnet de regrets. C'est l'outil qui transforme une faute en information exploitable. ✍️",
    "- Note le contexte, pas seulement l'issue : la macro du jour, les événements, ton état d'esprit.",
    "- Distingue la décision de son résultat : une bonne méthode peut perdre, une mauvaise gagner par hasard.",
    "- Cherche le schéma qui se répète, pas l'anecdote isolée.",
    "- Relis-toi à froid, une fois par semaine, quand l'émotion est retombée.",
    "Une erreur n'est un problème que tant qu'elle reste invisible. Écrite, elle devient une étape. 🪙",
  ], closing: "Ta dernière erreur, l'as-tu vraiment analysée, ou seulement rangée ?" },
  { key: 'risque-taille', subject: "🛡️ Survivre d'abord, performer ensuite", paras: [
    "Une idée séduisante circule : pour gagner gros, il faudrait miser gros. Plus la taille est forte, plus le gain serait beau. 💰",
    "C'est oublier une évidence : sur le marché, tu ne joues pas une main, tu joues des centaines de mains d'affilée.",
    "Une position démesurée peut avoir raison une fois. Répétée, elle finit par croiser la perte de trop, celle qui efface tout.",
    "Le vrai sujet n'est pas « combien je peux gagner », mais « combien je peux perdre sans sortir du jeu ». 🧮",
    "- Ta taille de position se décide AVANT l'entrée, jamais dans l'émotion du moment.",
    "- Un risque fixe et modeste par trade rend une série perdante survivable.",
    "- Rester en jeu vaut mieux qu'avoir raison une fois : le capital est ton billet d'entrée.",
    "- Le sur-risque, c'est emprunter à ton futur pour un frisson présent.",
    "Durer n'est pas une ambition timide : c'est la condition de toutes les autres. 🛡️",
  ], closing: "Ta prochaine position te laisse-t-elle encore dans le jeu si elle tourne mal, ou joues-tu ton billet d'entrée ?" },
  { key: 'fomo-train', subject: "🚉 Le train raté n'est jamais le dernier", paras: [
    "Un mouvement démarre sans toi. Le prix s'envole, et une petite voix murmure : « vite, avant qu'il soit trop tard ». 🏃",
    "C'est la peur de manquer qui parle, pas ton analyse. Elle transforme un spectateur lucide en passager pressé.",
    "Sauter dans un train déjà lancé, c'est entrer sans plan, au pire endroit : là où ceux qui étaient à l'heure prennent leurs bénéfices.",
    "Le marché ne ferme jamais. Il y aura un autre setup, une autre séance, une autre occasion préparée. 🚉",
    "- Une opportunité qui exige la précipitation n'en est déjà plus une.",
    "- Entrer en retard, c'est offrir ton stop à ceux qui étaient là avant.",
    "- Rater un mouvement ne coûte rien ; le courir en coûte souvent beaucoup.",
    "- Ton avantage naît d'un plan, jamais d'une course.",
    "Manquer un train n'est pas un échec : forcer l'entrée dans le mauvais wagon, si. 🟡",
  ], closing: "Ta dernière entrée « avant qu'il soit trop tard », l'aurais-tu prise à froid, plan en main ?" },
  { key: 'comparaison', subject: "🪞 Ta courbe n'est pas la leur", paras: [
    "En regardant les autres, on finit par mesurer sa réussite à l'aune de la leur : leurs gains, leur rythme, leur capital. 🪞",
    "Mais tu ne vois d'eux qu'une vitrine : ni leur taille de compte, ni leur risque réel, ni leurs séances silencieuses.",
    "Se comparer pousse à copier des décisions qui ne collent ni à ton capital, ni à ton horizon, ni à ta tolérance au risque.",
    "Le seul étalon qui compte, c'est toi d'hier : ta discipline, ta régularité, tes erreurs corrigées. 📈",
    "- Le risque supportable dépend de TON compte, pas de celui d'un inconnu.",
    "- Copier une position sans son contexte, c'est hériter du risque sans la thèse.",
    "- Ta progression se lit sur ta propre courbe, pas sur celle d'un fil d'actualité.",
    "- Le trader d'à côté ne trade pas ta vie ; toi si.",
    "Avancer à ton rythme n'est pas prendre du retard : c'est rester aligné avec ce que tu peux tenir. 🧭",
  ], closing: "La dernière décision inspirée d'un autre, l'as-tu prise pour ta stratégie, ou pour ne pas rester sur le quai ?" },
  { key: 'probabilites', subject: "🎲 Penser en probabilités, pas en certitudes", paras: [
    "On cherche souvent une chose que le marché ne donne jamais : la certitude. Le trade « sûr », celui qui ne peut pas échouer. 🎯",
    "Sauf qu'aucune configuration n'est garantie. Même la meilleure lecture n'est qu'une probabilité, jamais une promesse.",
    "Croire à la certitude mène à deux pièges : sur-risquer quand on est « sûr », et s'effondrer quand le marché ose désobéir.",
    "Le trader mûr raisonne autrement : chaque trade est un pari mesuré parmi une longue série. 🎲",
    "- Un trade perdant ne prouve pas que la décision était mauvaise : il fait partie de la série.",
    "- On juge une méthode sur cent trades, pas sur le dernier.",
    "- Accepter l'incertitude libère du besoin de « toujours avoir raison ».",
    "- Le stop n'est pas un aveu d'erreur : c'est le prix connu d'un pari assumé.",
    "Trader sereinement, c'est accepter de ne pas savoir, tout en sachant quoi faire dans chaque cas. ✨",
  ], closing: "Ton dernier trade, l'as-tu vécu comme un pari mesuré, ou comme une certitude trahie ?" },
];
// Rend les paragraphes : les lignes « - … » consecutives deviennent une liste a puces or ; le reste = paragraphes.
function _mindsetParas(paras) {
  let html = '', bullets = [];
  const flush = () => { if (bullets.length) { html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 14px;">${bullets.map(b => `<tr><td style="padding:4px 0;color:#cbd5e1;font-size:14px;line-height:1.55;"><span style="color:#f3c344;font-weight:700;">&bull;</span>&nbsp;${_esc(b)}</td></tr>`).join('')}</table>`; bullets = []; } };
  for (const p of (paras || [])) {
    const s = String(p == null ? '' : p).trim();
    if (!s) continue;
    if (s.slice(0, 2) === '- ') { bullets.push(s.slice(2).trim()); continue; }
    flush();
    html += `<p style="margin:0 0 14px;font-size:15px;color:#e6e6ea;line-height:1.6;">${_esc(s)}</p>`;
  }
  flush();
  return html;
}
// Choisit un concept en evitant les recentKeys (rotation). Repli : tout le catalogue.
function pickMindsetConcept(recentKeys) {
  recentKeys = Array.isArray(recentKeys) ? recentKeys : [];
  const fresh = MINDSET_CONCEPTS.filter(c => !recentKeys.includes(c.key));
  const pool = fresh.length ? fresh : MINDSET_CONCEPTS;
  return pool[0] || null;
}
function buildCampaignMindset({ name, email, campaign, recentKeys, isMember, conceptKey } = {}) {
  campaign = campaign || 'mindset';
  const pick = (conceptKey && MINDSET_CONCEPTS.find(c => c.key === conceptKey)) || pickMindsetConcept(recentKeys);
  if (!pick) return null;
  const prenomRaw = (name || '').split(' ')[0] || '';
  const hello = prenomRaw ? `Salut ${_esc(prenomRaw)},` : 'Salut,';
  const unsub = unsubUrl(email || '');
  const cta = _campaignCta(isMember, campaign, email);
  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:#e6e6ea;">${hello}</p>
    ${_mindsetParas(pick.paras)}
    <p style="margin:16px 0 4px;font-size:15px;color:#ffffff;font-style:italic;">${_esc(pick.closing)}</p>
    <div style="margin:22px 0 6px;">${cta.btn}</div>
    <p style="margin:0 0 4px;">À très vite,</p>
    <p style="margin:0 0 16px;color:#9aa3b2;">L'équipe DataTradingPro</p>
    <img src="${trackOpenUrl(campaign, email)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;overflow:hidden;">
  `;
  return { subject: pick.subject, html: _campaignLayout('Mindset', body, unsub), conceptKey: pick.key, conceptTitle: pick.subject };
}
async function sendCampaignMindset(d) { d = d || {}; const m = buildCampaignMindset({ name: d.name, email: d.email || d.to, campaign: d.campaign, recentKeys: d.recentKeys, isMember: d.isMember, conceptKey: d.conceptKey }); if (!m) return false; const prov = await _send(d.to, m.subject, m.html); return prov ? { provider: prov, conceptKey: m.conceptKey } : false; }

// ── INVITATION (CONVERSION) — campagne MENSUELLE vers les MEMBRES NON ABONNES (segment != active). Offre :
// une SEMAINE d'accès offerte au Desk via DM Instagram. 3 variantes (pro / conviviale / performance) en
// ROTATION MENSUELLE (mois calendaire % 3) → anti-lassitude. 100% produit, ZERO promesse de gain (conforme
// au veto informatif : on vend l'OUTIL, jamais une position). CTA = Instagram. Or mail #f3c344.
const IG_URL = 'https://www.instagram.com/datatradingpro';
const _INVIT_VARIANTS = [
  { key: 'pro', eyebrow: 'INVITATION',
    subject: "Votre semaine d'accès au Desk DataTradingPro",
    lead: "Vous faites partie de la communauté DataTradingPro, mais vous n'avez pas encore ouvert le Desk. C'est l'outil que nos abonnés consultent chaque matin pour lire le marché macro et forex, sans y passer des heures.",
    benefits: [
      ['Analyse macro structurée', " : le contexte du jour, expliqué clairement."],
      ['Actualités de marché en temps réel', " : ce qui bouge, dès que ça bouge."],
      ["Outils d'aide à la décision", " : calendrier économique, force des devises, biais du marché."],
    ],
    exclu: "Ce mois-ci, nous ouvrons un nombre limité d'accès découverte, réservés à la communauté.",
    ctaLead: "Écrivez-nous sur Instagram et nous vous offrons une semaine complète d'accès au Desk, sans engagement.",
    ctaLabel: "Nous écrire sur Instagram", signoff: "Bien à vous," },
  { key: 'convivial', eyebrow: 'UNE SEMAINE OFFERTE',
    subject: "On vous ouvre le Desk pendant une semaine 👀",
    lead: "Petit message pour vous : vous êtes dans la communauté DataTradingPro, mais on ne vous a encore jamais montré le Desk de l'intérieur. C'est là que tout se passe, chaque matin.",
    benefits: [
      ['Le marché du jour, au clair', " : la macro et le forex résumés, sans jargon."],
      ['Les news en direct', " : ce qui compte vraiment, au moment où ça arrive."],
      ['Vos repères pour décider', " : calendrier, force des devises et biais, réunis au même endroit."],
    ],
    exclu: "On garde quelques accès offerts pour les membres curieux ce mois-ci.",
    ctaLead: "Envoyez-nous un petit message sur Instagram, et on vous offre une semaine sur le Desk. Aucune carte, aucun engagement.",
    ctaLabel: "Écrire sur Instagram", signoff: "À très vite," },
  { key: 'performance', eyebrow: 'GAGNEZ DU TEMPS',
    subject: "Lisez le marché en quelques minutes chaque matin",
    lead: "Combien de temps passez-vous à rassembler l'actu macro, le calendrier et le sentiment du marché ? Sur le Desk DataTradingPro, tout est réuni au même endroit, prêt à lire en quelques minutes.",
    benefits: [
      ['Le contexte macro, synthétisé', " : fini les dix onglets ouverts en parallèle."],
      ['Les news filtrées, en direct', " : le signal, pas le bruit."],
      ['De quoi décider vite et clair', " : force des devises, biais, calendrier économique."],
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
      <td style="padding:5px 10px 5px 0;vertical-align:top;width:12px;"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#f3c344;"></span></td>
      <td style="padding:4px 0;color:#cbd5e1;font-size:14px;line-height:1.55;"><strong style="color:#fff;">${b[0]}</strong>${b[1]}</td>
    </tr>`).join('');
  const body = `
    <div style="display:inline-block;color:#0a0a0c;background:#f3c344;font-weight:800;font-size:11px;letter-spacing:.06em;padding:4px 11px;border-radius:6px;">${v.eyebrow}</div>
    <p style="margin:16px 0 6px;font-size:15px;color:#e6e6ea;">${hello}</p>
    <p style="margin:0 0 14px;">${v.lead}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:2px 0 4px;">${benefitsHtml}</table>
    <p style="margin:16px 0 8px;color:#cbd5e1;">${v.exclu}</p>
    <p style="margin:0 0 2px;color:#e6e6ea;">${v.ctaLead}</p>
    <div style="margin:14px 0 4px;">${_campaignBtn(v.ctaLabel, igUrl)}</div>
    <p style="margin:6px 0 0;font-size:12px;color:#7b828f;">Ou retrouvez-nous directement sur Instagram : <a href="${igUrl}" style="color:#f3c344;text-decoration:none;font-weight:700;">@datatradingpro</a></p>
    <p style="margin:18px 0 4px;">${v.signoff}</p>
    <p style="margin:0 0 16px;color:#9aa3b2;">L'équipe DataTradingPro</p>
    <img src="${trackOpenUrl(campaign, email)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;overflow:hidden;">
  `;
  return { subject: v.subject, html: _campaignLayout('Invitation', body, unsub), variant: v.key };
}
async function sendCampaignInvitation(d) { d = d || {}; const m = buildCampaignInvitation({ name: d.name, email: d.email || d.to, campaign: d.campaign || 'invitation', variant: d.variant, isMember: d.isMember }); if (!m) return false; const prov = await _send(d.to, m.subject, m.html); return prov ? { provider: prov, variant: m.variant } : false; }

// ── POINT MARCHÉ (S3) — data-driven pur : contexte macro dominant + régime de risque + ce qui bouge (rapport
// quotidien du desk) + forces/faiblesses (Currency Strength) + biais du desk + événements à surveiller + widget
// Force des Devises. Règle « pas de données -> pas de mail » (renvoie null). 100% informatif, CTA adapté.
function buildCampaignPointMarche({ name, email, campaign, context, isMember } = {}) {
  campaign = campaign || 'point-hebdo';
  const ctx = context || {};
  const _md = s => String(s == null ? '' : s).replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
  const upcoming = Array.isArray(ctx.upcoming) ? ctx.upcoming : [];
  const daily = ctx.daily || null;         // { summary, insights[] } depuis _dtpd/_fxr
  const weekly = ctx.weekly || null;
  const bias = Array.isArray(ctx.bias) ? ctx.bias : [];   // [{ ccy, label, signal }]
  const cs = ctx.cs || null;               // { strong:[{ccy}], weak:[{ccy}] } ou { ranked:[ccy...] }
  const risk = ctx.risk || null;           // { label, description }
  const themeLabel = ctx.themeLabel || '';

  const moves = _md((daily && (daily.summary || (daily.insights && daily.insights[0]))) || (weekly && weekly.summary) || '');
  const hasData = !!(moves || bias.length || (cs && (cs.strong || cs.ranked)) || upcoming.length);
  if (!hasData) return null;   // pas de donnees -> pas de mail

  const prenomRaw = (name || '').split(' ')[0] || '';
  const hello = prenomRaw ? `Bonjour ${_esc(prenomRaw)},` : 'Bonjour,';
  const unsub = unsubUrl(email || '');
  const cta = _campaignCta(isMember, campaign, email);

  // Accroche editoriale : theme dominant + climat de risque tisses PROPREMENT (em-dashes -> grammaire OK pour tous
  // les themes ; label de risque reformule court -> plus de « regime de risque Risk-on (appetit pour le risque) »).
  const _riskClause = (() => {
    const l = String((risk && risk.label) || '').toLowerCase();
    if (/off|aversion/.test(l)) return 'où l\'<strong style="color:#fff;">aversion au risque</strong> reprend le dessus';
    if (/on|appétit|appetit/.test(l)) return 'porté par l\'<strong style="color:#fff;">appétit pour le risque</strong>';
    return 'sans biais de risque marqué';
  })();
  // Accroche COURTE une-ligne (structure de newsletter : un hook, une respiration, puis le fond) —
  // choisie selon le VRAI climat de risque du desk, jamais inventée.
  const _rl = String((risk && risk.label) || '').toLowerCase();
  const hook = /off|aversion/.test(_rl) ? 'Séance nerveuse sur les marchés.'
    : /on|appétit|appetit/.test(_rl) ? "L'appétit pour le risque est de retour."
    : 'Une séance à lire entre les lignes.';
  let lead = `Voici votre point marché, en clair, droit à l'essentiel, sans le bruit.`;
  if (themeLabel && risk && risk.label) {
    lead = `Le desk garde le cap sur un thème dominant, <strong style="color:#f3c344;">${_esc(themeLabel)}</strong>, dans un marché ${_riskClause}. Voici ce qu'il faut en retenir.`;
  } else if (themeLabel) {
    lead = `Le desk garde le cap sur un thème dominant : <strong style="color:#f3c344;">${_esc(themeLabel)}</strong>. Voici ce qu'il faut en retenir.`;
  } else if (risk && risk.label) {
    lead = `Un marché ${_riskClause}. Voici ce que le desk en retient.`;
  }

  // Resume du RECAP JOURNALIER : la SYNTHESE de seance UNIQUEMENT (daily.summary), coupee PROPREMENT en fin de
  // phrase (helper module _cutTxt), puis DECOUPEE en paragraphes courts (2 phrases max) : une idee par
  // paragraphe, lecture mobile rapide — structure de newsletter, texte 100 % desk, zero invention.
  const _movesTxt = moves ? _cutTxt(moves, 680) : '';
  // Split SANS PERTE : coupe apres .!? suivi d'espace + majuscule/guillemet (les decimales a point des
  // cotations « 1.1750 » ne coupent pas et ne perdent JAMAIS de texte, contrairement a un match glouton).
  const _sentences = _movesTxt ? _movesTxt.split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ«"'(])/).filter(Boolean) : [];
  const _paras = [];
  for (let i = 0; i < _sentences.length; i += 2) _paras.push(_sentences.slice(i, i + 2).join(' ').replace(/\s+/g, ' ').trim());
  const movesHtml = _paras.filter(Boolean).map((p, i) => `<p style="margin:${i === 0 ? '18px' : '0'} 0 12px;">${_esc(p)}</p>`).join('');

  // WIDGET REEL du desk (inline cid a l'envoi) : graphe multi-lignes Force des Devises sur LA JOURNEE (TD) —
  // coherent avec le brief de seance (le Point marche parle du jour, pas de la semaine).
  const strengthWidget = _widgetImg('strength', 'La force des devises', null, 'today');

  // « Brief de la seance » : le detail par theme tire du RAPPORT QUOTIDIEN (DTP Daily, onglet Analyst) — on brief la
  // journee. On RETIRE la section « DONNEES ECONOMIQUES » brute (kind:'data', sans date) : elle est REMPLACEE par le
  // VRAI widget calendrier du desk ci-dessous (demande user : « met le calendrier economique (le widget) du desk »).
  const _briefSections = (daily && Array.isArray(daily.sections)) ? daily.sections.filter(s => s && s.kind !== 'data') : (daily && daily.sections);
  const briefHtml = _dailyBriefBlock(_briefSections, daily && daily.dateLabel, daily && daily.title, daily && daily.hasComments);
  // CALENDRIER ECONOMIQUE DU DESK (widget PNG, 10 colonnes AVEC Heure + date par jour + REEL colore/prevision/precedent),
  // fenetre = LA SEMAINE EN COURS (period=thisweek) : les publications deja sorties (avec REEL) + le reste de la semaine.
  const calWidget = _widgetImg('calendar', "Le calendrier économique de la semaine", null, 'thisweek');

  // Ton des banques centrales : TEASER pur (demande user : ne RIEN dévoiler) → une phrase de curiosité
  // + bouton secondaire vers le Desk. Affiché uniquement s'il y a EU des tons lus cette semaine.
  const _cbs = (weekly && Array.isArray(weekly.centralBanks) ? weekly.centralBanks : []).filter(c => c && c.bank && c.stance);
  const tonesHtml = _cbs.length
    ? `<p style="margin:18px 0 2px;color:#cbd5e1;">Les banques centrales ont aussi parlé cette semaine. Le desk a lu leur ton pour vous, banque par banque, et vous l'explique simplement.</p>`
    : '';

  // Leçon de clôture (une idée, originale DTP) : pourquoi cette lecture compte — sans pousser de position.
  const lessonHtml = `<p style="margin:16px 0 14px;color:#cbd5e1;">🎯 Un chiffre seul ne dit rien&nbsp;: c'est l'écart avec l'attendu, et ce que les banques centrales en font, qui fait bouger les devises. Cette lecture-là, le desk vous la donne en direct.</p>`;

  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:#e6e6ea;">${hello}</p>
    <p style="margin:0 0 10px;font-size:15.5px;color:#ffffff;font-weight:700;">${hook}</p>
    <p style="margin:0 0 6px;">${lead}</p>
    ${movesHtml}
    ${strengthWidget}
    ${briefHtml}
    ${calWidget}
    ${tonesHtml}
    ${lessonHtml}
    <div style="margin:18px 0 6px;">${cta.btn}</div>
    <p style="margin:0 0 4px;">Bonne semaine,</p>
    <p style="margin:0 0 16px;color:#9aa3b2;">L'équipe DataTradingPro</p>
    <img src="${trackOpenUrl(campaign, email)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;overflow:hidden;">
  `;
  // Sujets ROTATIFS (déterministes par semaine) : accrocheurs façon newsletter, factuels façon DTP —
  // jamais deux mercredis de suite le même objet (délivrabilité + envie de cliquer).
  const _wk = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
  const _subs = themeLabel ? [
    `📊 ${themeLabel} : ce que le desk en retient`,
    `👀 ${themeLabel} mène la danse, voici pourquoi`,
    `🧭 Le point du desk : ${themeLabel} donne le ton`,
  ] : [
    '📊 Le point du desk : la séance en clair',
    "👀 Ce que le marché vous dit aujourd'hui",
    "🧭 Le point du desk, droit à l'essentiel",
  ];
  const subject = _subs[_wk % _subs.length];
  return { subject, html: _campaignLayout('Point marché', body, unsub) };
}
async function sendCampaignPointMarche(d) { d = d || {}; const m = buildCampaignPointMarche({ name: d.name, email: d.email || d.to, campaign: d.campaign, context: d.context, isMember: d.isMember }); if (!m) return false; return _sendWithInlineWidgets(d.to, m.subject, m.html, ['strength:today', 'calendar:thisweek']); }

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
  const when = featured ? `${featured.dayLabel || ''}${featured.time ? ' à ' + featured.time : ''}`.trim() : '';
  // On cadre sur les JOURS a fort impact du Week Ahead (evite le « 68 temps forts » peu parlant du calendrier brut).
  const count = hiDays || majors.length;
  const lead = `Voici la semaine qui s'ouvre sur les marchés${weekLabel ? ` (<strong style="color:#f3c344;">${_esc(weekLabel)}</strong>)` : ''}, <strong style="color:#fff;">jour par jour</strong>.${count ? ` ${count} séance${count > 1 ? 's' : ''} à fort impact se profile${count > 1 ? 'nt' : ''}` : ' Plusieurs temps forts se profilent'}${themeLabel ? `, sur fond d'<strong style="color:#f3c344;">${_esc(themeLabel)}</strong>` : ''}${featured && featured.title ? `. Le rendez-vous à ne pas manquer&nbsp;: <strong style="color:#f3c344;">${_esc(featured.title)}</strong>${when ? ' (' + _esc(when) + ')' : ''}` : ''}.`;
  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:#e6e6ea;">${hello}</p>
    <p style="margin:0 0 10px;">${lead}</p>
    <p style="margin:0 0 4px;">Pour chaque séance, le desk a isolé l'événement qui compte, expliqué son enjeu et évalué son impact attendu. <strong style="color:#fff;">L'idée&nbsp;: savoir à l'avance où regarder</strong>, pas quoi trader.</p>
    ${_widgetImg('week-ahead', 'La semaine à venir')}
    <p style="margin:2px 0 0;font-size:12.5px;color:#7b828f;">Le détail complet de chaque journée (chiffres attendus, contexte et lecture) se retrouve en direct sur le Desk.</p>
    <div style="margin:22px 0 6px;">${cta.btn}</div>
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
    <p style="margin:0 0 14px;color:#ffffff;font-size:18px;font-weight:700;">✅ ${_esc(kind)}</p>
    <p style="margin:0 0 14px;">Un paiement Whop <strong style="color:#fff;">JOT DTP</strong> a été traité automatiquement :</p>
    ${_credBox([['Client', clientName || clientEmail], ['Email', clientEmail], ["Accès jusqu'au", end], ['Action', isNew ? 'Compte créé' : 'Abonnement renouvelé']])}
    <p style="margin:0;font-size:13px;color:#94a3b8;">Le compte a été ${isNew ? 'créé' : 'mis à jour'} et le client a été notifié par email. Aucune action de ta part.</p>`;
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
    const audColor = e.audience === 'Admin' ? '#f3c344' : '#3f9280';
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
  .hd h1 .o{color:#f3c344;}
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
    <p style="margin:0 0 14px;">Plus que <strong style="color:#f3c344;">${restant}</strong> et nous créditons <strong style="color:#fff;">1 mois d'accès offert</strong> sur votre compte.</p>
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
    <p style="margin:0 0 14px;">Bravo ${prenom} — vous avez atteint <strong style="color:#fff;">${count} parrainages</strong>. Comme promis, nous ajoutons <strong style="color:#f3c344;">1 mois d'accès offert</strong> à votre abonnement DataTradingPro.</p>
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
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:rgba(227,178,58,0.10);border:1px solid rgba(227,178,58,0.4);border-radius:12px;margin:18px 0;">
      <tr><td style="padding:18px 20px;text-align:center;">
        <div style="font-size:22px;font-weight:800;color:#f3c344;letter-spacing:-.01em;">3 inscrits&nbsp;=&nbsp;1 mois offert</div>
        <div style="font-size:13px;color:#f3d9b0;margin-top:6px;">Et ça se cumule : chaque palier de 3 filleuls ajoute un mois d'accès.</div>
      </td></tr>
    </table>
    <p style="margin:0 0 14px;">Partagez votre lien personnel : à chaque <strong style="color:#fff;">3ᵉ</strong> abonné venu grâce à vous, nous créditons <strong style="color:#f3c344;">1 mois d'accès offert</strong> sur votre compte. Votre lien se trouve dans <strong style="color:#fff;">Profil&nbsp;▸&nbsp;Parrainages</strong>.</p>
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
  const body = '<h2 style="color:#f3c344;margin:0 0 12px;">🚨 Alerte monitoring IA</h2>' + (html || '')
    + '<p style="color:#6b7280;font-size:12px;margin-top:16px;">Détails en direct : <a href="https://desk.datatradingpro.com/admin" style="color:#f3c344;">dashboard IA Monitor</a>.</p>';
  return _send(dest, '[DTP Alerte IA] ' + (subject || 'Alerte'), _layout('Alerte monitoring IA', body));
}

module.exports = {
  // envoi (API publique inchangée)
  sendWelcome, sendRenewalFailed, sendExpired, sendReactivated, sendRenewed, sendPasswordReset, sendForgotNoSub,
  sendTrialUpsell, sendReengagement, _buildReengagement, sendAdminExpiryReminder, sendAdminRenewalNotice,
  sendReferralCredited, sendReferralReward, sendAdminReferralReward, sendReferredWelcome,
  sendAnnouncementV2, sendGestureMonth, sendLaunchLive, sendCampaignIntro, sendCampaignIntroPlain, sendWeeklyDigest, sendCampaignDecryptage, sendCampaignPointMarche, sendCampaignMindset, sendCampaignOutlook, sendCampaignInvitation,
  // désinscription campagne (opt-out) — server.js vérifie le même jeton
  unsubToken, unsubUrl,
  // tracking ouvertures/clics — server.js vérifie mailer.trackToken
  trackToken, trackOpenUrl, trackClickUrl,
  // build (rendu sans envoi) — pour la preview
  buildWelcome, buildRenewalFailed, buildReactivated, buildRenewed, buildPasswordReset, buildForgotNoSub,
  buildTrialUpsell, buildReengagement, buildAdminExpiryReminder, buildAdminRenewalNotice,
  buildReferralCredited, buildReferralReward, buildAdminReferralReward, buildReferredWelcome,
  buildAnnouncementV2, buildGestureMonth, buildLaunchLive, buildCampaignIntro, buildCampaignIntroPlain, buildWeeklyDigest, buildCampaignDecryptage, buildCampaignPointMarche, pickDecryptConcept, buildCampaignMindset, pickMindsetConcept, MINDSET_CONCEPTS, buildCampaignOutlook, buildCampaignInvitation,
  // preview / doc
  getEmailCatalog, getProviderStatus, renderEmailGallery,
  // monitoring / vérification
  verifyGmail, getMailHealth, sendTest, sendAdminAlert,
};

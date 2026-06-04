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

const RESEND_API_KEY     = process.env.RESEND_API_KEY || '';
const MAILJET_API_KEY    = process.env.MAILJET_API_KEY || '';
const MAILJET_SECRET_KEY = process.env.MAILJET_SECRET_KEY || '';
const GMAIL_USER         = process.env.GMAIL_USER || '';
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''); // les MDP d'app Gmail ont des espaces
const APP_URL            = process.env.APP_URL || 'https://datatradingpro.onrender.com';
const SUPPORT_EMAIL      = process.env.SUPPORT_EMAIL || 'datatradingpro.contact@gmail.com';
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
  _gmailTransport = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    family: 4,   // ⚠️ FORCE IPv4 : Render n'a pas d'IPv6 sortant → 'service:gmail' résolvait en IPv6 → ENETUNREACH → Gmail échouait TOUJOURS (repli silencieux sur Mailjet non délivré). IPv4 = Gmail fonctionne enfin.
    pool: true, maxConnections: 3, maxMessages: 50,   // mutualise les connexions → meilleur débit
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    connectionTimeout: 12000, greetingTimeout: 9000, socketTimeout: 15000,   // échec rapide → repli propre si souci
  });
  return _gmailTransport;
}

// ── Envois par fournisseur (chacun renvoie true/false ; une exception → on tente le suivant) ──
// Gmail SMTP : l'email part des serveurs Google AUTHENTIFIÉS comme l'expéditeur @gmail.com →
// SPF/DKIM alignés → délivrabilité FIABLE vers les boîtes Gmail. (Un From @gmail.com routé via un
// ESP tiers comme Mailjet n'est PAS aligné → Gmail le jette avant même les spams : c'est ce qui
// faisait que des clients ne recevaient « rien ».)
async function _sendGmail(to, subject, html) {
  const from = _parseFrom();
  const fromHeader = `${from.name || 'DataTradingPro'} <${GMAIL_USER}>`;   // expéditeur = compte authentifié (alignement garanti)
  await _getGmailTransport().sendMail({ from: fromHeader, replyTo: SUPPORT_EMAIL, to, subject, html });
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
// Ordre = Gmail (le plus délivrable pour un expéditeur @gmail.com) → Mailjet → Resend.
async function _send(to, subject, html) {
  if (!_validEmail(to)) { console.warn('[Mailer] destinataire invalide — email ignoré:', to); return false; }
  if (_isDuplicate(to, subject)) { console.warn(`[Mailer] doublon ignoré (<12s) → ${to}: "${subject}"`); return false; }
  const chain = [];
  if (GMAIL_USER && GMAIL_APP_PASSWORD)      chain.push(['Gmail',   _sendGmail]);
  if (MAILJET_API_KEY && MAILJET_SECRET_KEY) chain.push(['Mailjet', _sendMailjet]);
  if (RESEND_API_KEY)                        chain.push(['Resend',  _sendResend]);
  if (!chain.length) {
    console.warn('[Mailer] Aucun fournisseur configuré (GMAIL_*, MAILJET_* ou RESEND_API_KEY) — email non envoyé:', subject);
    return false;
  }
  for (const [nom, fn] of chain) {
    try { if (await fn(to, subject, html)) return true; }   // succès → on s'arrête
    catch (e) { console.error(`[Mailer] ${nom} erreur:`, e.message); }   // échec → fournisseur suivant
  }
  console.error(`[Mailer] ❌ Tous les fournisseurs ont échoué → ${to}: "${subject}"`);
  return false;
}

// ── Gabarit HTML commun (dark, professionnel — Prime Terminal) ────────────────
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
          <div style="font-size:12px;font-weight:600;color:#f7941d;margin-top:4px;">Boostez votre trading grâce à des données qui font bouger les graphiques !</div>
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
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:18px;font-weight:700;">Bienvenue, ${prenom} 👋</p>
    <p style="margin:0 0 14px;">Votre accès à <strong style="color:#fff;">DataTradingPro</strong> a été activé. Vous disposez désormais du flux de news en temps réel, du calendrier économique et des analyses institutionnelles.</p>
    <p style="margin:0 0 6px;color:#94a3b8;font-size:13px;">Vos identifiants de connexion :</p>
    ${_credBox([['Email', to], ['Mot de passe', password || '—'], ['Abonnement', `valide jusqu'au ${end}`]])}
    <p style="margin:0 0 4px;font-size:13px;color:#94a3b8;">Par sécurité, nous vous recommandons de changer votre mot de passe après votre première connexion.</p>
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
    { key: 'trialUpsell',   audience: 'Client', label: 'Fin d\'essai gratuit',             trigger: 'Le jour où l\'essai 7 jours expire',          ...buildTrialUpsell(s) },
    { key: 'renewalFailed', audience: 'Client', label: 'Échec de renouvellement',          trigger: 'Abonnement non renouvelé → accès suspendu',   ...buildRenewalFailed(s) },
    { key: 'reactivated',   audience: 'Client', label: 'Compte réactivé',                  trigger: 'Compte remis en actif (paiement ou admin)',   ...buildReactivated(s) },
    { key: 'renewed',       audience: 'Client', label: 'Abonnement renouvelé',             trigger: 'Paiement Whop renouvelé',                     ...buildRenewed(s) },
    { key: 'reengagement',  audience: 'Client', label: 'Réengagement (inactif ~7j)',       trigger: 'Utilisateur inactif depuis ~7 jours',         ..._buildReengagement(s.name, 7) },
    { key: 'adminExpiry',   audience: 'Admin',  label: 'Rappel abonnements à renouveler',  trigger: 'Rappel automatique (→ toi)',                  ...buildAdminExpiryReminder({ clients: sampleClients }) },
    { key: 'adminRenewal',  audience: 'Admin',  label: 'Notif paiement / nouveau client',  trigger: 'Paiement Whop traité (→ toi)',                ...buildAdminRenewalNotice({ clientEmail: s.to, clientName: s.name, expiresAt: s.expiresAt, isNew: true }) },
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

module.exports = {
  // envoi (API publique inchangée)
  sendWelcome, sendRenewalFailed, sendReactivated, sendRenewed, sendPasswordReset,
  sendTrialUpsell, sendReengagement, _buildReengagement, sendAdminExpiryReminder, sendAdminRenewalNotice,
  // build (rendu sans envoi) — pour la preview
  buildWelcome, buildRenewalFailed, buildReactivated, buildRenewed, buildPasswordReset,
  buildTrialUpsell, buildReengagement, buildAdminExpiryReminder, buildAdminRenewalNotice,
  // preview / doc
  getEmailCatalog, getProviderStatus, renderEmailGallery,
};

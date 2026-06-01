/**
 * mailer.js — Envoi d'emails transactionnels via Resend
 * Emails professionnels en français : bienvenue, renouvellement échoué, reset MDP.
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

function _parseFrom() {
  const m = EMAIL_FROM.match(/^(.*?)\s*<(.+)>$/);
  return m ? { name: m[1].trim() || 'DataTradingPro', email: m[2].trim() } : { name: 'DataTradingPro', email: EMAIL_FROM };
}

let _gmailTransport = null;
function _getGmailTransport() {
  if (_gmailTransport) return _gmailTransport;
  const nodemailer = require('nodemailer');
  _gmailTransport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
  return _gmailTransport;
}

// ── Envoi bas niveau (non bloquant, tolérant aux erreurs) ─────────────────────
// Priorité à Gmail (gratuit, envoie à tout le monde) ; sinon Resend.
async function _send(to, subject, html) {
  // Option A — Mailjet (gratuit, envoie à tous, sender vérifié sans domaine)
  if (MAILJET_API_KEY && MAILJET_SECRET_KEY) {
    try {
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
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        console.error(`[Mailer] Mailjet échec (${r.status}) → ${to}:`, t.slice(0, 400));
        return false;
      }
      console.log(`[Mailer] ✅ (Mailjet) "${subject}" → ${to}`);
      return true;
    } catch (e) {
      console.error('[Mailer] Mailjet erreur:', e.message);
      return false;
    }
  }
  // Option B — Gmail (gratuit, sans domaine)
  if (GMAIL_USER && GMAIL_APP_PASSWORD) {
    try {
      await _getGmailTransport().sendMail({ from: EMAIL_FROM, to, subject, html });
      console.log(`[Mailer] ✅ (Gmail) "${subject}" → ${to}`);
      return true;
    } catch (e) {
      console.error('[Mailer] Gmail échec:', e.message);
      return false;
    }
  }
  // Option B — Resend (nécessite un domaine vérifié pour écrire à des tiers)
  if (RESEND_API_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html }),
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        console.error(`[Mailer] Resend échec (${r.status}) → ${to}:`, txt.slice(0, 300));
        return false;
      }
      console.log(`[Mailer] ✅ (Resend) "${subject}" → ${to}`);
      return true;
    } catch (e) {
      console.error('[Mailer] Resend erreur:', e.message);
      return false;
    }
  }
  console.warn('[Mailer] Aucun fournisseur configuré (MAILJET_*, GMAIL_* ou RESEND_API_KEY) — email non envoyé:', subject);
  return false;
}

// ── Gabarit HTML commun (dark, professionnel — Prime Terminal) ────────────────
function _layout(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
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
      <a href="${url}" style="display:inline-block;padding:13px 28px;color:#0a0a0c;font-weight:700;font-size:14px;text-decoration:none;">${label}</a>
    </td></tr></table>`;
}

function _credBox(rows) {
  const items = rows.map(([k, v]) =>
    `<tr><td style="padding:6px 0;color:#94a3b8;font-size:13px;width:130px;">${k}</td>
         <td style="padding:6px 0;color:#ffffff;font-size:14px;font-weight:600;font-family:monospace;">${v}</td></tr>`
  ).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
    style="background:#0f0f12;border:1px solid #26262b;border-radius:10px;padding:14px 18px;margin:18px 0;">${items}</table>`;
}

// Encart "Note importante" : astuce anti-spam (à mettre dans tous les emails)
function _spamNote() {
  const sender = _parseFrom().email;
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

// ── 1) Email de bienvenue (création de compte) ────────────────────────────────
async function sendWelcome({ to, name, password, expiresAt }) {
  const prenom = (name || '').split(' ')[0] || 'cher client';
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
  return _send(to, 'Bienvenue sur DataTradingPro — votre accès est activé', _layout('Bienvenue', body));
}

// ── 2) Email de renouvellement échoué (abonnement non renouvelé) ──────────────
async function sendRenewalFailed({ to, name }) {
  const prenom = (name || '').split(' ')[0] || 'cher client';
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:18px;font-weight:700;">Renouvellement de votre abonnement</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Nous n'avons pas pu <strong style="color:#fff;">renouveler votre abonnement</strong> à DataTradingPro. Par conséquent, votre accès au terminal est actuellement <strong style="color:#e25563;">suspendu</strong>.</p>
    <p style="margin:0 0 14px;">Pour réactiver votre accès et reprendre le suivi des marchés en temps réel, il vous suffit de renouveler votre abonnement en un clic ci-dessous :</p>
    ${_button('Renouveler mon abonnement', WHOP_RENEW_URL)}
    <p style="margin:0 0 14px;font-size:13px;color:#9aa3b2;">Une question ? Écrivez-nous à <a href="mailto:${SUPPORT_EMAIL}" style="color:#ff7a1a;">${SUPPORT_EMAIL}</a>.</p>
    ${_spamNote()}
    <p style="margin:0;font-size:13px;">Nous restons à votre disposition,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return _send(to, 'DataTradingPro — échec du renouvellement de votre abonnement', _layout('Renouvellement', body));
}

// ── 2b) Email de réactivation (compte remis en actif) ────────────────────────
async function sendReactivated({ to, name, expiresAt }) {
  const prenom = (name || '').split(' ')[0] || 'cher client';
  const end = expiresAt ? new Date(expiresAt).toLocaleDateString('fr-FR') : null;
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:18px;font-weight:700;">Votre accès est réactivé ✅</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Bonne nouvelle : votre abonnement à <strong style="color:#fff;">DataTradingPro</strong> est de nouveau <strong style="color:#34d399;">actif</strong>. Vous avez à nouveau accès au flux de news en temps réel, au calendrier économique et aux analyses.${end ? ` Votre accès est valable jusqu'au <strong style="color:#fff;">${end}</strong>.` : ''}</p>
    ${_button('Accéder au terminal', APP_URL)}
    ${_spamNote()}
    <p style="margin:0;font-size:13px;">Bons trades,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return _send(to, 'DataTradingPro — votre accès est réactivé', _layout('Réactivation', body));
}

// ── 2c) Email de renouvellement réussi (paiement Whop renouvelé) ──────────────
async function sendRenewed({ to, name, expiresAt }) {
  const prenom = (name || '').split(' ')[0] || 'cher client';
  const end = expiresAt ? new Date(expiresAt).toLocaleDateString('fr-FR') : null;
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:18px;font-weight:700;">Abonnement renouvelé ✅</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Merci ! Votre abonnement à <strong style="color:#fff;">DataTradingPro</strong> a bien été <strong style="color:#34d399;">renouvelé</strong>${end ? ` jusqu'au <strong style="color:#fff;">${end}</strong>` : ''}. Votre accès au terminal continue sans interruption.</p>
    ${_button('Accéder au terminal', APP_URL)}
    ${_spamNote()}
    <p style="margin:0;font-size:13px;">Bons trades,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return _send(to, 'DataTradingPro — votre abonnement est renouvelé', _layout('Renouvellement', body));
}

// ── 3) Email de réinitialisation de mot de passe ──────────────────────────────
async function sendPasswordReset({ to, name, password }) {
  const prenom = (name || '').split(' ')[0] || 'cher client';
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:18px;font-weight:700;">Réinitialisation de votre mot de passe</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Votre mot de passe DataTradingPro a été réinitialisé. Voici votre nouveau mot de passe :</p>
    ${_credBox([['Email', to], ['Nouveau mot de passe', password || '—']])}
    <p style="margin:0 0 4px;font-size:13px;color:#94a3b8;">Pour votre sécurité, pensez à le modifier depuis votre profil après connexion. Si vous n'êtes pas à l'origine de cette demande, contactez-nous immédiatement.</p>
    ${_button('Me connecter', APP_URL)}
    ${_spamNote()}
    <p style="margin:0;font-size:13px;">L'équipe DataTradingPro</p>`;
  return _send(to, 'DataTradingPro — votre mot de passe a été réinitialisé', _layout('Réinitialisation', body));
}

// ── Rappel ADMIN : abonnements à renouveler (envoyé à datatradingpro.contact) ──
async function sendAdminExpiryReminder({ clients, to }) {
  if (!clients || !clients.length) return false;
  const admin = to || SUPPORT_EMAIL;
  const rows = clients.map(c => {
    const end  = new Date(c.expiresAt);
    const days = Math.ceil((end.getTime() - Date.now()) / 86400000);
    const when = end.toLocaleDateString('fr-FR');
    const state = days < 0
      ? `<span style="color:#fb7185;font-weight:700;">EXPIRÉ depuis ${-days}j</span>`
      : `<span style="color:#f59e0b;font-weight:700;">expire dans ${days}j</span>`;
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #26262b;color:#fff;font-size:13px;">${c.name || '—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #26262b;color:#94a3b8;font-size:13px;font-family:monospace;">${c.email}</td>
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
  return _send(admin, `DataTradingPro — ${clients.length} abonnement(s) à renouveler`, _layout('Rappel abonnements', body));
}

// ── Notif ADMIN : un paiement/renouvellement DTP a eu lieu (→ datatradingpro.contact) ──
async function sendAdminRenewalNotice({ clientEmail, clientName, expiresAt, isNew, to }) {
  const admin = to || SUPPORT_EMAIL;
  const end = expiresAt ? new Date(expiresAt).toLocaleDateString('fr-FR') : 'illimité';
  const kind = isNew ? 'Nouveau client DTP' : 'Renouvellement DTP';
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:18px;font-weight:700;">✅ ${kind}</p>
    <p style="margin:0 0 14px;">Un paiement Whop <strong style="color:#fff;">JOT DTP</strong> a été traité automatiquement :</p>
    ${_credBox([['Client', clientName || clientEmail], ['Email', clientEmail], ["Accès jusqu'au", end], ['Action', isNew ? 'Compte créé' : 'Abonnement renouvelé']])}
    <p style="margin:0;font-size:13px;color:#94a3b8;">Le compte a été ${isNew ? 'créé' : 'mis à jour'} et le client a été notifié par email. Aucune action de ta part.</p>`;
  return _send(admin, `DTP — ${kind} : ${clientEmail}`, _layout('Notification DTP', body));
}

module.exports = { sendWelcome, sendRenewalFailed, sendReactivated, sendRenewed, sendPasswordReset, sendAdminExpiryReminder, sendAdminRenewalNotice };

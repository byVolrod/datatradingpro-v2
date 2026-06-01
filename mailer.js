/**
 * mailer.js — Envoi d'emails transactionnels via Resend
 * Emails professionnels en français : bienvenue, renouvellement échoué, reset MDP.
 */
'use strict';

const RESEND_API_KEY     = process.env.RESEND_API_KEY || '';
const GMAIL_USER         = process.env.GMAIL_USER || '';
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''); // les MDP d'app Gmail ont des espaces
const APP_URL            = process.env.APP_URL || 'https://datatradingpro.onrender.com';
const SUPPORT_EMAIL      = process.env.SUPPORT_EMAIL || 'volrod.dev@gmail.com';
// Expéditeur : avec Gmail il DOIT correspondre au compte authentifié
const EMAIL_FROM = process.env.EMAIL_FROM
  || (GMAIL_USER ? `DataTradingPro <${GMAIL_USER}>` : 'DataTradingPro <onboarding@resend.dev>');

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
  // Option A — Gmail (gratuit, sans domaine)
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
  console.warn('[Mailer] Aucun fournisseur configuré (GMAIL_* ou RESEND_API_KEY) — email non envoyé:', subject);
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
          <div style="font-size:11px;font-weight:600;color:#f7941d;letter-spacing:0.18em;text-transform:uppercase;margin-top:2px;">Prime Terminal</div>
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

// ── 1) Email de bienvenue (création de compte) ────────────────────────────────
async function sendWelcome({ to, name, password, expiresAt }) {
  const prenom = (name || '').split(' ')[0] || 'cher client';
  const end = expiresAt ? new Date(expiresAt).toLocaleDateString('fr-FR') : 'Illimité';
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:18px;font-weight:700;">Bienvenue, ${prenom} 👋</p>
    <p style="margin:0 0 14px;">Votre accès à <strong style="color:#fff;">DataTradingPro — Prime Terminal</strong> a été activé. Vous disposez désormais du flux de news en temps réel, du calendrier économique et des analyses institutionnelles.</p>
    <p style="margin:0 0 6px;color:#94a3b8;font-size:13px;">Vos identifiants de connexion :</p>
    ${_credBox([['Email', to], ['Mot de passe', password || '—'], ['Abonnement', `valide jusqu'au ${end}`]])}
    <p style="margin:0 0 4px;font-size:13px;color:#94a3b8;">Par sécurité, nous vous recommandons de changer votre mot de passe après votre première connexion.</p>
    ${_button('Accéder au terminal', APP_URL)}
    <p style="margin:0;font-size:13px;">Excellents trades,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return _send(to, 'Bienvenue sur DataTradingPro — votre accès est activé', _layout('Bienvenue', body));
}

// ── 2) Email de renouvellement échoué (abonnement non renouvelé) ──────────────
async function sendRenewalFailed({ to, name }) {
  const prenom = (name || '').split(' ')[0] || 'cher client';
  const body = `
    <p style="margin:0 0 14px;color:#ffffff;font-size:18px;font-weight:700;">Renouvellement de votre abonnement</p>
    <p style="margin:0 0 14px;">Bonjour ${prenom},</p>
    <p style="margin:0 0 14px;">Nous n'avons pas pu <strong style="color:#fff;">renouveler votre abonnement</strong> à DataTradingPro — Prime Terminal. Par conséquent, votre accès au terminal est actuellement <strong style="color:#e25563;">suspendu</strong>.</p>
    <p style="margin:0 0 14px;">Pour réactiver votre accès et reprendre le suivi des marchés en temps réel, il vous suffit de régulariser votre abonnement.</p>
    ${_button('Renouveler mon accès', `mailto:${SUPPORT_EMAIL}?subject=Renouvellement%20abonnement%20DataTradingPro`)}
    <p style="margin:0;font-size:13px;">Nous restons à votre disposition,<br><strong style="color:#fff;">L'équipe DataTradingPro</strong></p>`;
  return _send(to, 'DataTradingPro — échec du renouvellement de votre abonnement', _layout('Renouvellement', body));
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
    <p style="margin:0;font-size:13px;">L'équipe DataTradingPro</p>`;
  return _send(to, 'DataTradingPro — votre mot de passe a été réinitialisé', _layout('Réinitialisation', body));
}

module.exports = { sendWelcome, sendRenewalFailed, sendPasswordReset };

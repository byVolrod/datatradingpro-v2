/**
 * preview-server.js — Serveur LOCAL de prévisualisation des emails (jamais déployé).
 * Rend la galerie mailer.renderEmailGallery() sur http://localhost:5099. N'ENVOIE AUCUN email.
 * Les env ci-dessous sont des PLACEHOLDERS (aucune vraie clé) : ils servent uniquement à refléter
 * l'ordre réel des fournisseurs (Gmail → Mailjet) dans le bandeau de la galerie.
 */
'use strict';
process.env.GMAIL_USER         = process.env.GMAIL_USER         || 'datatradingpro.contact@gmail.com';
process.env.GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || 'preview-placeholder';
process.env.MAILJET_API_KEY    = process.env.MAILJET_API_KEY    || 'preview-placeholder';
process.env.MAILJET_SECRET_KEY = process.env.MAILJET_SECRET_KEY || 'preview-placeholder';
process.env.EMAIL_FROM         = process.env.EMAIL_FROM         || 'DataTradingPro <datatradingpro.contact@gmail.com>';

const express = require('express');
const mailer  = require('./mailer');
const app = express();
app.get('/', (_req, res) => res.type('html').send(mailer.renderEmailGallery()));
app.listen(5099, () => console.log('[preview] Emails sur http://localhost:5099'));

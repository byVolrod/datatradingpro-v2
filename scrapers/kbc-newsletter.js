'use strict';
/**
 * scrapers/kbc-newsletter.js — Ingestion des newsletters MARCHÉS de KBC reçues par e-mail.
 *
 * « KBC Sunrise » (note du matin) et « KBC Weekly Overview / Aperçu hebdomadaire de KBC » sont
 * envoyées par markets@newsletter.kbc.be — PAR E-MAIL UNIQUEMENT (absentes du hub public
 * kbc.com/economics déjà scrapé). Ce module lit une boîte Gmail dédiée en IMAP READ-ONLY, repère
 * ces 2 newsletters et les ajoute à la source Institution « KBC » de DTP (même forme d'item que les
 * autres rapports de banque, branché dans _fetchBankResearch de server.js).
 *
 * ── SÉCURITÉ ──────────────────────────────────────────────────────────────────────────────────
 * On N'UTILISE JAMAIS le mot de passe du compte. Il faut un « App Password » Gmail (16 car.,
 * révocable, créé APRÈS activation de la validation en 2 étapes), placé en variable d'env (VPS) :
 *   KBC_MAIL_USER            ex. volrod.dev@gmail.com
 *   KBC_MAIL_PASS            App Password Gmail (16 car.) — JAMAIS commité
 *   KBC_MAIL_HOST            (optionnel, défaut imap.gmail.com)
 *   KBC_MAIL_PORT            (optionnel, défaut 993)
 *   KBC_MAIL_LOOKBACK_DAYS   (optionnel, défaut 21)
 * → DORMANT tant que KBC_MAIL_USER/PASS sont absents : renvoie [] / no-op. Ouverture EXAMINE
 *   (read-only) : ne marque AUCUN mail comme lu. Dépendances chargées en lazy-require (jamais de
 *   crash au boot si elles manquent).
 */

const SENDER = 'markets@newsletter.kbc.be';
// Sujets ciblés : « KBC Sunrise » et « (KBC) Weekly Overview / Aperçu hebdomadaire (de KBC) ».
const SUBJECT_RE = /kbc\s*sunrise|weekly\s*overview|aper[çc]u\s*hebdomadaire/i;

function _enabled() { return !!(process.env.KBC_MAIL_USER && process.env.KBC_MAIL_PASS); }

function _id(seed) {
  return 'kbcmail-' + Buffer.from(String(seed)).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(-18);
}

// Extrait le lien « version PDF » depuis le HTML d'un mail KBC (ancre « ...version PDF »,
// ou tout lien de tracking newsletter.kbc.be, ou un .pdf direct).
function _extractPdfLink(html) {
  if (!html) return '';
  let m = html.match(/<a[^>]+href=["']([^"']+)["'][^>]*>[^<]*(?:version\s*pdf|lire\s+la\s+version|pdf\s*version)[^<]*<\/a>/i);
  if (m) return m[1];
  m = html.match(/href=["'](https?:\/\/[^"']*newsletter\.kbc\.be\/r\/[^"']+)["']/i);
  if (m) return m[1];
  m = html.match(/href=["'](https?:\/\/[^"']+\.pdf(?:[?#][^"']*)?)["']/i);
  return m ? m[1] : '';
}

/** Lit la boîte Gmail en IMAP read-only et renvoie [{ title, url (lien PDF), date (ms) }]. Ne jette jamais. */
async function getKbcMailReports() {
  if (!_enabled()) return [];
  let ImapFlow, simpleParser;
  try {
    ({ ImapFlow } = require('imapflow'));
    ({ simpleParser } = require('mailparser'));
  } catch (e) {
    console.warn('[KBC-mail] dépendances absentes (imapflow/mailparser) :', e.message);
    return [];
  }

  const lookbackDays = parseInt(process.env.KBC_MAIL_LOOKBACK_DAYS, 10) || 21;
  const since = new Date(Date.now() - lookbackDays * 86400000);
  const client = new ImapFlow({
    host: process.env.KBC_MAIL_HOST || 'imap.gmail.com',
    port: parseInt(process.env.KBC_MAIL_PORT, 10) || 993,
    secure: true,
    auth: { user: process.env.KBC_MAIL_USER, pass: process.env.KBC_MAIL_PASS },
    logger: false,
    socketTimeout: 30000,
  });

  const out = [];
  try {
    await client.connect();
    await client.mailboxOpen('INBOX', { readOnly: true });   // EXAMINE → ne touche aucun flag (rien marqué « lu »)
    const uids = await client.search({ from: SENDER, since }, { uid: true });
    for (const uid of (uids || []).slice(-40)) {
      try {
        const msg = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const mail = await simpleParser(msg.source);
        const title = (mail.subject || '').trim();
        if (!title || !SUBJECT_RE.test(title)) continue;
        out.push({
          title,
          url: _extractPdfLink(mail.html || mail.textAsHtml || ''),
          date: mail.date ? mail.date.getTime() : Date.now(),
        });
      } catch (e) { console.warn('[KBC-mail] mail uid', uid, 'ignoré :', e.message); }
    }
  } catch (e) {
    console.warn('[KBC-mail] IMAP échec :', e.message);
  } finally {
    try { await client.logout(); } catch (_) {}
  }
  console.log(`[KBC-mail] ${out.length} newsletter(s) KBC trouvée(s) (${SENDER}, ${lookbackDays}j)`);
  return out;
}

/**
 * Branche les newsletters KBC dans la Map `merged` de _fetchBankResearch (server.js), au même format
 * d'item que les autres rapports Institution. No-op si désactivé. Ne jette jamais (capturé en amont aussi).
 */
async function fetchInto(merged) {
  if (!_enabled() || !merged || typeof merged.set !== 'function') return;
  const reports = await getKbcMailReports();
  let added = 0, skipped = 0;
  for (const r of reports) {
    if (!r.url) { skipped++; console.warn('[KBC-mail] lien « version PDF » introuvable pour :', r.title); continue; }
    const id = _id(r.url);
    if (merged.has(id)) continue;
    merged.set(id, {
      id,
      title: r.title,
      url: r.url,
      timestamp: r.date,
      categories: ['Macro'],
      description: '',
      institution: 'KBC',
      _source: 'kbc',
      _pdf: true,
      _viaMail: true,
    });
    added++;
  }
  if (added || skipped) console.log(`[KBC-mail] +${added} item(s) KBC ajouté(s)${skipped ? `, ${skipped} sans lien PDF (à diagnostiquer)` : ''}`);
}

module.exports = { getKbcMailReports, fetchInto };

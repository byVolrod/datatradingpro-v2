// campaignPreflight.js — Verifications AVANT chaque envoi de campagne (niveau production).
// PUR + injectable (aucun etat global, aucune I/O) => 100% testable avec des mocks (voir scripts/campaign-selftest.js).
// Le serveur rassemble les signaux (sante mail, audience, rendu template, donnees desk, widget, IA) et appelle preflight().
// Regle : une seule anomalie CRITIQUE => aucun envoi, workflow mis en pause, alerte admin. Les WARN laissent passer.
'use strict';

const _EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Valide un mail RENDU ({subject, html}) : detecte template invalide, HTML incomplet, variable non resolue,
// personnalisation cassee (undefined/NaN), desinscription manquante. `null` = saut propre (pas de donnees).
function checkTemplate(rendered) {
  if (rendered === null || rendered === undefined) return { ok: true, skip: true, detail: 'pas de mail (aucune donnee) — saut propre' };
  if (typeof rendered !== 'object' || typeof rendered.html !== 'string') return { ok: false, detail: 'template invalide (objet {subject,html} attendu)' };
  const html = rendered.html, subj = String(rendered.subject == null ? '' : rendered.subject);
  if (subj.trim().length < 3) return { ok: false, detail: 'sujet vide ou trop court' };
  if (html.length < 400) return { ok: false, detail: 'HTML trop court (' + html.length + ' car.) — rendu incomplet' };
  if (html.length > 400000) return { ok: false, detail: 'HTML anormalement long (' + html.length + ' car.)' };
  if (/\$\{/.test(html) || /\$\{/.test(subj)) return { ok: false, detail: 'variable de template NON RESOLUE (${...}) dans le rendu' };
  if (/\b(undefined|NaN)\b/.test(subj)) return { ok: false, detail: 'sujet contient undefined/NaN (personnalisation cassee)' };
  if (/>\s*(undefined|NaN)\s*</.test(html)) return { ok: false, detail: 'HTML contient undefined/NaN (variable manquante)' };
  if (!/unsubscribe|d[eé]sabonn|\/api\/unsub/i.test(html)) return { ok: false, detail: 'lien de desinscription ABSENT (obligatoire RGPD/anti-spam)' };
  return { ok: true, detail: 'sujet + HTML valides (' + html.length + ' car.)' };
}

// input = {
//   mailHealth,          // objet mailer.getMailHealth()
//   recipients,          // tableau [{email,...}] ou [email]
//   sample,              // resultat build*() d'un echantillon (objet {subject,html} | null) ; ou une FONCTION a executer
//   needsData, hasData,  // ce mail depend-t-il de donnees desk ? sont-elles la ?
//   needsWidget, widgetOk,
//   needsAI, aiBackoff,
// }
function preflight(input) {
  input = input || {};
  const checks = [];
  const add = (name, ok, level, detail) => checks.push({ name, ok: !!ok, level: level || 'critical', detail: detail || '' });

  // 1) Fournisseur mail configure (au moins un canal)
  const mh = input.mailHealth || {};
  const provOk = !!((mh.ovh && mh.ovh.configured) || (mh.gmailApi && mh.gmailApi.configured) || (mh.gmail && mh.gmail.configured));
  add('fournisseur-mail', provOk, 'critical', provOk ? 'au moins un fournisseur mail configure' : 'AUCUN fournisseur mail configure (OVH/Gmail)');

  // 1b) Sante des canaux verifies (si une info de verification existe et qu'AUCUN canal verifie n'est ok -> critique)
  const verifiable = [mh.gmailApi, mh.gmail].filter(x => x && typeof x.verified === 'boolean');
  if (verifiable.length && verifiable.every(x => x.verified === false) && !(mh.ovh && mh.ovh.configured)) {
    add('sante-canaux', false, 'critical', 'tous les canaux verifiables sont DOWN et OVH non configure');
  }

  // 2) Audience : tableau, non vide, e-mails valides, pas de doublon, pas de corruption
  const rcp = input.recipients;
  if (!Array.isArray(rcp)) {
    add('audience', false, 'critical', 'liste d\'audience CORROMPUE (tableau attendu, recu ' + (rcp === null ? 'null' : typeof rcp) + ')');
  } else {
    const emails = rcp.map(r => (r && typeof r === 'object' ? r.email : r)).map(e => String(e == null ? '' : e).toLowerCase().trim());
    const valid = emails.filter(e => _EMAIL_RE.test(e));
    const invalid = emails.length - valid.length;
    const dupes = emails.length - new Set(emails).size;
    if (!rcp.length) add('audience', false, 'critical', 'audience VIDE (0 destinataire)');
    else if (invalid > 0) add('audience', false, 'critical', invalid + ' e-mail(s) INVALIDE(s) dans l\'audience (liste corrompue)');
    else { add('audience', true, 'critical', rcp.length + ' destinataire(s) valides'); if (dupes > 0) add('audience-doublons', false, 'warn', dupes + ' doublon(s) d\'e-mail a dedupliquer'); }
  }

  // 3) Rendu du template (echantillon) — accepte un objet deja rendu OU une fonction a executer (try/catch)
  let rendered = input.sample, renderErr = null;
  if (typeof rendered === 'function') { try { rendered = rendered(); } catch (e) { renderErr = e; } }
  if (renderErr) add('template-rendu', false, 'critical', 'ERREUR de rendu HTML : ' + (renderErr && renderErr.message || renderErr));
  else { const t = checkTemplate(rendered); add('template-rendu', t.ok, 'critical', t.detail); }

  // 4) Donnees desk (si ce mail en depend) — absence = saut propre (WARN), jamais un envoi casse
  if (input.needsData) add('donnees-desk', !!input.hasData, 'warn', input.hasData ? 'donnees du desk presentes' : 'donnees du desk absentes — contenu saute (pas de mail, pas d\'erreur)');

  // 5) Widget embarque (non bloquant : repli image distante)
  if (input.needsWidget) add('widget', !!input.widgetOk, 'warn', input.widgetOk ? 'widget genere' : 'widget indisponible — repli image distante (mail expedie)');

  // 6) IA (si le contenu depend d'une generation IA au moment de l'envoi)
  if (input.needsAI) add('ia', !input.aiBackoff, 'warn', input.aiBackoff ? 'IA en backoff (tous fournisseurs epuises) — repli cache/data' : 'IA disponible');

  const crit = checks.filter(c => !c.ok && c.level === 'critical');
  const warns = checks.filter(c => !c.ok && c.level === 'warn');
  const level = crit.length ? 'critical' : (warns.length ? 'warn' : 'ok');
  return {
    ok: crit.length === 0,
    level,
    checks,
    critical: crit.map(c => c.name + ' — ' + c.detail),
    warnings: warns.map(c => c.name + ' — ' + c.detail),
    summary: crit.length ? ('BLOQUE : ' + crit.map(c => c.name).join(', ')) : (warns.length ? ('OK avec reserves : ' + warns.map(c => c.name).join(', ')) : 'Tous les controles au vert'),
  };
}

module.exports = { preflight, checkTemplate, _EMAIL_RE };

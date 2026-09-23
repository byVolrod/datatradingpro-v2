#!/usr/bin/env node
/**
 * scripts/bienvenue-verif.js — LE FILET D'ONBOARDING NE RÉINITIALISE PLUS JAMAIS UN CLIENT ÉTABLI
 * ------------------------------------------------------------------------------------------------
 * Incident du 22/09 à 03:00 (capture user) : « Bienvenue confirmée » — avec un MOT DE PASSE
 * RÉINITIALISÉ — envoyé à cinq clients installés depuis JUIN. Mesuré en base : tous avaient un
 * `last_login` (deux bien avant le 22/09), mais le filet les a lus sans, et comme ils dataient d'avant
 * les marqueurs `welcome:`/`welcomeok:`, aucune des deux gardes n'a tenu. Le défaut de fond : rien
 * n'empêchait le filet d'agir sur un compte vieux de trois mois.
 *
 * On EXÉCUTE le vrai `_welcomeAutoHeal` extrait de server.js (jamais une copie), avec une base et un
 * mailer simulés. Le scénario de l'incident est rejoué en régression, et un témoin retire la borne
 * d'âge pour prouver que le banc mord.
 *
 *   node scripts/bienvenue-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

const debut = SRV.indexOf('let _welcomeHealBusy = false;');
const fin = SRV.indexOf('// Planif : boot+120 s', debut);
const bloc = (debut >= 0 && fin > debut) ? SRV.slice(debut, fin) : null;

const JOUR = 24 * 3600 * 1000;
const NOW = Date.now();
const iso = ms => new Date(ms).toISOString();

// Monte le vrai filet sur une base simulée ; renvoie les comptes dont le mot de passe a été CHANGÉ.
async function jouer(code, users, marqueurs = new Set()) {
  const changes = [], envois = [];
  const auth = {
    getAllUsers: async () => users,
    emailLogHas: async k => marqueurs.has(k),
    emailLogAdd: async k => { marqueurs.add(k); },
    changePassword: async (id) => { changes.push(id); },
  };
  const mailer = { sendAdminAlert: async () => {} };
  const run = new Function('auth', 'mailer', '_sendWelcomeReliable', '_sendWelcomeChat', 'console', 'require',
    code + '\nreturn _welcomeAutoHeal;')(auth, mailer,
    async (o) => { envois.push(o.to); return { sent: true }; }, () => {}, { log() {}, warn() {}, error() {} }, require);
  const out = await run(true, 20);
  return { changes, envois, out };
}

(async () => {
  console.log('\n── 1. Le filet est extractible, et porte sa borne d\'âge ──');
  v('le bloc _welcomeAutoHeal est extractible de server.js', !!bloc);
  v('la fenêtre maximale est déclarée (7 jours)', /const _WELCOME_HEAL_FENETRE_MS = 7 \* 24 \* 3600 \* 1000;/.test(SRV));
  if (!bloc) { console.log('\n✗ banc interrompu\n'); process.exit(1); }

  const client = (id, email, ageMs, extra = {}) => ({ id, email, role: 'client', created_at: iso(NOW - ageMs), last_login: null, expires_at: iso(NOW + 30 * JOUR), ...extra });

  console.log('\n── 2. RÉGRESSION : le scénario exact du 22/09 ──');
  // Cinq clients de JUIN, lus SANS last_login (lecture glitchée), SANS marqueur (antérieurs au système).
  const incident = [
    client(1, 'axelajt2@gmail.com', 114 * JOUR),
    client(2, 'heikilea987@gmail.com', 112 * JOUR),
    client(3, 'anismessaoud05@gmail.com', 114 * JOUR),
    client(4, 'azedinerotchiz@gmail.com', 114 * JOUR),
    client(5, 'n.berthe@nbs95.fr', 103 * JOUR),
  ];
  const r = await jouer(bloc, incident);
  v('aucun des cinq clients de juin n\'a son mot de passe changé', r.changes.length === 0, 'changés : ' + r.changes.join(','));
  v('… et aucun ne reçoit de « Bienvenue confirmée »', r.envois.length === 0, r.envois.join(','));

  console.log('\n── 3. Le filet fait TOUJOURS son vrai travail (onboarding raté récent) ──');
  const r2 = await jouer(bloc, [client(10, 'nouveau@x.fr', 2 * JOUR)]);
  v('un client inscrit il y a 2 jours, jamais connecté, sans bienvenue → rattrapé', r2.changes.length === 1 && r2.envois[0] === 'nouveau@x.fr', JSON.stringify(r2.out));

  console.log('\n── 4. Les autres gardes tiennent toujours ──');
  const r3 = await jouer(bloc, [client(11, 'jeune@x.fr', 3 * 3600 * 1000)]);
  v('inscrit il y a 3 h → pas touché (onboarding en cours)', r3.changes.length === 0);
  const r4 = await jouer(bloc, [client(12, 'co@x.fr', 2 * JOUR, { last_login: iso(NOW - JOUR) })]);
  v('déjà connecté → pas touché', r4.changes.length === 0);
  const r5 = await jouer(bloc, [client(13, 'ok@x.fr', 2 * JOUR)], new Set(['welcomeok:ok@x.fr']));
  v('bienvenue déjà confirmée → pas touché', r5.changes.length === 0);
  const r6 = await jouer(bloc, [client(14, 'exp@x.fr', 2 * JOUR, { expires_at: iso(NOW - JOUR) })]);
  v('abonnement expiré → pas touché', r6.changes.length === 0);
  const r7 = await jouer(bloc, [{ id: 15, email: 'sansdate@x.fr', role: 'client', created_at: null, last_login: null }]);
  v('date de création inconnue → pas touché (âge incertain = prudence)', r7.changes.length === 0);
  const r8 = await jouer(bloc, [client(16, 'limite@x.fr', 8 * JOUR)]);
  v('inscrit il y a 8 jours (hors fenêtre de 7) → pas touché', r8.changes.length === 0);

  console.log('\n── 5. Témoin : sans la borne d\'âge, l\'incident se reproduit ──');
  const mut = bloc.replace('if (!created || now - created > _WELCOME_HEAL_FENETRE_MS) continue;', '');
  v('(témoin) la mutation retire bien la borne', mut !== bloc);
  if (mut !== bloc) {
    const t = await jouer(mut, incident);
    v('(témoin) sans elle, les cinq clients de juin voient leur mot de passe changé', t.changes.length === 5, t.changes.length + ' changé(s) — si 0, le témoin ne mord plus');
  }

  console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
  process.exit(ko ? 1 : 0);
})();

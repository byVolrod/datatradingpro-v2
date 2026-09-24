#!/usr/bin/env node
/**
 * scripts/lp-cta-verif.js — LA VITRINE COMPTE SES CLICS VERS L'ABONNEMENT, ANONYMEMENT (24/09)
 * ------------------------------------------------------------------------------------------------
 * Demande user (« oui ») : savoir si le référencement amène des abonnés. Chaque page de la vitrine
 * envoie un signal au clic sur un lien d'abonnement ; le serveur compte jour → page → zone.
 * On EXÉCUTE les vraies fonctions extraites de server.js, et on vérifie que CHAQUE page de la
 * vitrine qui porte un lien d'abonnement porte aussi le compteur (une page oubliée serait une page
 * dont on croirait qu'elle ne convertit pas).
 *
 *   node scripts/lp-cta-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(R, 'server.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

console.log('\n── 1. Le serveur : route publique, bornée, anonyme ──');
v('la route est publique (la vitrine est un autre domaine)', /_PUBLIC_PATHS\s*= new Set\(\['\/api\/lp-cta'/.test(SRV));
v('… corps limité à 1 Ko', /app\.post\('\/api\/lp-cta', express\.text\(\{ type: '\*\/\*', limit: '1kb' \}\)/.test(SRV));
v('… et la lecture est réservée à l\'admin', /app\.get\('\/api\/admin\/lp-cta', requireAdmin/.test(SRV));
v('aucune adresse IP gardée : seulement une empreinte tronquée, en mémoire', /createHash\('sha1'\)\.update\(String\(req\.ip \|\| ''\)\)\.digest\('hex'\)\.slice\(0, 10\)/.test(SRV) && !/aiCacheSet\('lpcta:v1', [^)]*ip/i.test(SRV));
const d = SRV.indexOf('const _LP_P_RX'), f = SRV.indexOf("app.post('/api/lp-cta'");
v('le bloc du compteur est extractible', d >= 0 && f > d);
if (d < 0 || f <= d) { console.log('\n✗ banc interrompu\n'); process.exit(1); }
const monter = () => new Function('auth', SRV.slice(d, f) + '\nreturn { _lpNote, _lpResume, etat: () => _lpCta };')({ aiCacheGet: () => Promise.resolve(null) });

console.log('\n── 2. Le comptage ──');
{
  const L = monter(), T = Date.UTC(2026, 8, 24, 10);
  v('un clic sur l\'accueil est compté', L._lpNote('/', 'hero', 'a1', T) === true);
  v('le même visiteur qui reclique dans la demi-heure ne compte pas deux fois', L._lpNote('/', 'hero', 'a1', T + 60e3) === false);
  v('… mais un autre visiteur, oui', L._lpNote('/', 'hero', 'b2', T + 60e3) === true);
  v('… et le même visiteur après la demi-heure, oui', L._lpNote('/', 'hero', 'a1', T + 31 * 60e3) === true);
  L._lpNote('/documentation/terminal-de-trading.html', 'section', 'c3', T);
  const r = L._lpResume(30, T + 3600e3);
  v('le résumé classe les pages par nombre de clics', r.total === 4 && r.parPage[0].k === '/' && r.parPage[0].n === 3, JSON.stringify(r));
  v('… et donne l\'emplacement du bouton', r.parZone.some(z => z.k === 'hero' && z.n === 3));
  v('une page hors motif est ignorée (jamais de texte libre stocké)', L._lpNote('/<script>', 'x', 'd4', T) === false && L._lpNote('http://evil', 'x', 'd4', T) === false);
  v('une zone hors motif retombe sur « page »', L._lpNote('/tarifs.html', 'X Y!', 'e5', T) === true && L.etat()['2026-09-24']['/tarifs.html'].page === 1);
  L._lpNote('/', 'hero', 'z9', T + 70 * 864e5);
  v('au-delà de 60 jours, les journées anciennes sont oubliées', !L.etat()['2026-09-24']);
}

console.log('\n── 3. Chaque page de la vitrine qui vend porte le compteur ──');
{
  const pages = [path.join(R, 'landing/index.html')].concat(fs.readdirSync(path.join(R, 'landing/documentation')).filter(x => x.endsWith('.html')).map(x => path.join(R, 'landing/documentation', x)));
  const manquantes = pages.filter(p => { const s = fs.readFileSync(p, 'utf8'); return /whop\.com/.test(s) && !/desk\.datatradingpro\.com\/api\/lp-cta/.test(s); });
  v('aucune page avec lien d\'abonnement sans compteur', manquantes.length === 0, manquantes.map(p => path.basename(p)).join(', '));
  const idx = fs.readFileSync(path.join(R, 'landing/index.html'), 'utf8');
  v('le signal part en sendBeacon (ne retarde jamais le clic)', /navigator\.sendBeacon\('https:\/\/desk\.datatradingpro\.com\/api\/lp-cta'/.test(idx));
  v('… sans cookie ni identifiant (page et zone seulement)', /JSON\.stringify\(\{p:location\.pathname\|\|'\/',z:/.test(idx) && !/document\.cookie/.test(idx.slice(idx.indexOf('/api/lp-cta') - 600, idx.indexOf('/api/lp-cta') + 400)));
  v('la section « Qui sommes-nous » est posée, sans nom inventé', /id="equipe"/.test(idx) && /Une équipe de traders et de développeurs\./.test(idx));
}

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);

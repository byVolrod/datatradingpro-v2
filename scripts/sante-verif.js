#!/usr/bin/env node
/**
 * scripts/sante-verif.js — DATA HEALTH : CHAQUE SOURCE DIT SI ELLE EST À JOUR (24/09, phase 1 V2)
 * ------------------------------------------------------------------------------------------------
 * On EXÉCUTE le vrai agrégateur extrait de server.js (pas une copie) sur des états contrôlés, et
 * on vérifie qu'il dit vrai : une source fraîche est verte, en retard orange, morte rouge ; un
 * calcul « à la demande » jamais produit est rouge, mais seulement âgé n'est pas une panne ; le
 * week-end, un fil calme n'est pas une panne ; une panne partielle (quelques banques) est orange.
 *
 *   node scripts/sante-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(R, 'server.js'), 'utf8');
const ADM = fs.readFileSync(path.join(R, 'public/js/admin.js'), 'utf8');
const HTML = fs.readFileSync(path.join(R, 'public/admin.html'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

const a = SRV.indexOf('function _santeEtat('), b = SRV.indexOf("app.get('/api/admin/data-health'");
v('l\'agrégateur est extractible de server.js', a > 0 && b > a);
if (!(a > 0 && b > a)) { console.log('\n✗ banc interrompu\n'); process.exit(1); }
const SRC = SRV.slice(a, b);
const NOMS = ['allNews', 'allCalendar', '_calFetchedAt', '_rpCache', 'RP_MAP', '_wtCache', '_fedWatch', '_rbaWatch', 'fetchCOTData', 'outlookTs', '_riskTs', '_riskData', '_csCache', '_fxlTs', '_fxlCache', '_fcEtat'];
const monter = e => new Function(...NOMS, SRC + '\nreturn _santeDonnees;')(...NOMS.map(n => e[n]));

const H = 3600e3, MERCREDI = Date.UTC(2026, 8, 23, 12), SAMEDI = Date.UTC(2026, 8, 26, 12);
const base = now => ({
  allNews: [{ timestamp: now - 5 * 60e3 }], allCalendar: [{}, {}], _calFetchedAt: now - H,
  _rpCache: { bankAt: { USD: now - H, EUR: now - H, GBP: now - H, JPY: now - H, CAD: now - H, AUD: now - H } },
  RP_MAP: { USD: 1, EUR: 1, GBP: 1, JPY: 1, CAD: 1, AUD: 1 },
  _wtCache: { at: now - 2 * H, banks: { CHF: {}, NZD: {} } }, _fedWatch: { at: now - H, meeting: '2026-10-28' }, _rbaWatch: { at: now - H, meeting: '2026-09-29' },
  fetchCOTData: async () => [{ reportDate: '2026-09-15' }], outlookTs: () => now - 30 * 60e3,
  _riskTs: now - 60e3, _riskData: { label: 'NEUTRAL', assets: [1, 2] }, _csCache: { today: { ts: now - 60e3 } }, _fxlTs: now - 60e3, _fxlCache: {},
  _fcEtat: () => ({ pose: true, capJour: 40, n: 5, okAt: now - H, err: '' }),
});
const etat = (r, nom) => (r.sources.find(x => x.nom.startsWith(nom)) || {}).etat;

(async () => {
  console.log('\n── 1. Tout est frais : tout est vert ──');
  {
    const r = await monter(base(MERCREDI))(MERCREDI);
    const rouges = r.sources.filter(x => x.etat !== 'ok').map(x => x.nom + '=' + x.etat);
    v('toutes les sources à jour', rouges.length === 0, rouges.join(' · '));
    v('le décompte est cohérent', r.compte.ok === r.sources.length && r.compte.panne === 0);
    v('chaque ligne a un nom, un groupe et un âge', r.sources.every(x => x.nom && x.groupe && (x.age == null || x.age >= 0)));
  }
  console.log('\n── 2. Les pannes sont dites, avec la bonne couleur ──');
  {
    const e = base(MERCREDI);
    e.allNews = [{ timestamp: MERCREDI - 2 * H }];                    // fil calme depuis 2 h un mercredi
    e._rpCache.bankAt.JPY = MERCREDI - 3 * 24 * H;                     // une banque en retard
    e._wtCache = { at: MERCREDI - 72 * H, banks: {}, err: 'page illisible (direct et Firecrawl)' };
    e.allCalendar = [];                                                // calendrier vide
    e._csCache = {};                                                   // force jamais calculée
    const r = await monter(e)(MERCREDI);
    v('fil calme 2 h en semaine → dégradé', etat(r, 'Fil') === 'degrade', etat(r, 'Fil'));
    v('une banque sur six en retard → dégradé, et elle est NOMMÉE', etat(r, 'rateprobability') === 'degrade' && /JPY/.test(r.sources.find(x => x.nom.startsWith('rateprobability')).detail));
    v('WatchTower muette depuis 3 jours → indisponible, avec sa dernière erreur', etat(r, 'WatchTower') === 'panne' && /page illisible/.test(r.sources.find(x => x.nom.startsWith('WatchTower')).detail));
    v('calendrier vide → indisponible', etat(r, 'Calendrier') === 'panne');
    v('force des devises jamais calculée → indisponible', etat(r, 'Force') === 'panne');
  }
  console.log('\n── 3. Ce qui n\'est PAS une panne ne le devient pas ──');
  {
    const e = base(SAMEDI);
    e.allNews = [{ timestamp: SAMEDI - 8 * H }];                       // samedi : marché fermé
    e._riskTs = SAMEDI - 3 * 24 * H;                                   // personne n'a demandé le risque depuis 3 j
    const r = await monter(e)(SAMEDI);
    v('le samedi, un fil calme depuis 8 h reste vert', etat(r, 'Fil') === 'ok', etat(r, 'Fil'));
    v('un calcul à la demande seulement âgé n\'est pas « indisponible »', etat(r, 'Sentiment') !== 'panne', etat(r, 'Sentiment'));
    const e2 = base(MERCREDI); e2._fcEtat = () => ({ pose: true, capJour: 40, n: 40, okAt: MERCREDI - H, err: '' });
    v('budget Firecrawl épuisé → dégradé (pas indisponible)', etat(await monter(e2)(MERCREDI), 'Firecrawl') === 'degrade');
    const e3 = base(MERCREDI); e3.fetchCOTData = async () => { throw new Error('réseau'); };
    v('une erreur de lecture du COT ne fait pas tomber tout le rapport', etat(await monter(e3)(MERCREDI), 'COT') === 'panne');
  }
  console.log('\n── 4. Branché et réservé à l\'admin ──');
  v('la route est derrière requireAdmin', /app\.get\('\/api\/admin\/data-health', requireAdmin/.test(SRV));
  v('le calendrier horodate ses remplissages réussis (deux chemins)', (SRV.match(/allCalendar = (?:items|ffCalItems); _calFetchedAt = Date\.now\(\);/g) || []).length === 2);
  v('le panneau admin affiche la carte et la rafraîchit chaque minute', /id="adm-sante"/.test(HTML) && /loadSante\(\);\s*\n\s*setInterval\(loadSante, 60000\)/.test(ADM));
  console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
  process.exit(ko ? 1 : 0);
})();

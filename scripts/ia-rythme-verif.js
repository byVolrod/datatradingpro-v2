#!/usr/bin/env node
/**
 * scripts/ia-rythme-verif.js — LE QUOTA IA SE DÉPENSE AU RYTHME DES CLIENTS, ET UN RAPPORT PLANIFIÉ
 * NE RETOMBE PLUS SUR SON REPLI PARCE QUE LA CHAÎNE EST EN PAUSE
 * ------------------------------------------------------------------------------------------------
 * 23/09, deux demandes du même jour :
 *   · « j'ai mis un système qui apprend dans le panneau admin, utilise-le pour ne pas fumer tout le
 *     quota bêtement, et utilise-le dans les pics d'utilisation des users » ;
 *   · capture d'un Récap Quotidien en « Version provisoire » : « ceci ne doit jamais arriver ».
 * On EXÉCUTE les vraies fonctions extraites de server.js (jamais une copie).
 *
 *   node scripts/ia-rythme-verif.js
 */
const fs = require('fs');
const path = require('path');
const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };
const fn = (nom) => {
  const d = SRV.indexOf('function ' + nom + '(');
  if (d < 0) return null;
  let prof = 0;
  for (let k = SRV.indexOf('{', d); k < SRV.length; k++) {
    if (SRV[k] === '{') prof++;
    else if (SRV[k] === '}') { prof--; if (prof === 0) return SRV.slice(d, k + 1); }
  }
  return null;
};

console.log('\n── 1. Le rythme de la journée suit la demande apprise ──');
const SRC = ['_aiDayFraction', '_aiDayFractionApprise', 'aiExpectedDemand'].map(fn);
v('les trois fonctions du rythme sont extractibles', SRC.every(Boolean));
if (SRC.every(Boolean)) {
  // Horloge de Paris simulée : mercredi (3), heure H
  const monter = (demande, heure, minute) => new Function('_aiDemand', '_aiParis', '_aiDemandSlot',
    SRC.join('\n') + '\nreturn { lin: _aiDayFraction, appris: _aiDayFractionApprise };')(
    demande, () => ({ getDay: () => 3, getHours: () => heure, getMinutes: () => minute || 0, getSeconds: () => 0 }), () => '3-' + heure);
  // Un mercredi appris : nuit quasi vide, pic 14h-17h
  const dem = {};
  for (let wd = 0; wd < 7; wd++) for (let h = 0; h < 24; h++) {
    const v2 = (h >= 14 && h < 18) ? 60 : (h >= 8 && h < 21 ? 10 : 1);
    dem[wd + '-' + h] = { _t: v2 };
  }
  const t6 = monter(dem, 6), t13 = monter(dem, 13), t18 = monter(dem, 18);
  v('à 6 h, la part autorisée est bien PLUS FAIBLE que la pendule (nuit creuse apprise)',
    t6.appris() < t6.lin() * 0.6, 'appris ' + t6.appris().toFixed(3) + ' / linéaire ' + t6.lin().toFixed(3));
  v('… mais jamais nulle : 30 % de linéaire gardés pour le préchauffage du matin', t6.appris() >= t6.lin() * 0.3 - 1e-9);
  const avant = monter(dem, 13, 59).appris(), apres = monter(dem, 17, 59).appris();
  v('pendant le pic appris (14 h-18 h), la part autorisée grimpe vite', apres - avant > 0.35,
    'de ' + avant.toFixed(3) + ' à ' + apres.toFixed(3) + ' en quatre heures');
  v('… et la journée se termine à 100 % (le plafond du jour reste le même)', Math.abs(monter(dem, 23, 59).appris() - monter(dem, 23, 59).lin()) < 0.02);
  // bootstrap : apprentissage trop maigre → linéaire pur
  const maigre = monter({ '3-10': { _t: 3 } }, 13);
  v('apprentissage trop maigre (< 24 créneaux) → retour au linéaire, sans surprise', maigre.appris() === maigre.lin());
  v('aiAllowed rythme bien ses tâches de fond sur la demande apprise',
    /const pacedCeil = Math\.ceil\(cap \* _aiDayFractionApprise\(\)\) \+ AI_BURST;/.test(SRV));
}

console.log('\n── 2. Un rapport planifié a la voie ──');
const pr = fn('_aiPrioriteRapport');
v('_aiPrioriteRapport existe', !!pr);
v('aiAllowed fait céder le FOND pendant la voie prioritaire, jamais l\'utilisateur',
  /if \(prio === 'background' && Date\.now\(\) < _aiPrioriteJusqua\) return false;/.test(SRV));
v('le Récap Quotidien ET le Point Marché ouvrent la voie avant de rédiger',
  (SRV.match(/_aiPrioriteRapport\(\);\n    \{/g) || []).length === 2);

console.log('\n── 3. En pause, la rédaction tente la passe COURTE au lieu de publier le repli ──');
/* Avant : `if (backoff) raison = … ; else { passe complète ; passe courte }` — la pause sautait les
   DEUX passes, et le repli (« Version provisoire ») sortait pour tout le créneau. */
v('Récap Quotidien : la pause ne saute plus que la passe complète',
  /const _tenterPlein = !_fxrEnPause && /.test(SRV) && !/_fxrRaison = 'cha\\u00eene IA en pause[^\n]*\n    else \{/.test(SRV));
v('Point Marché : idem', /if \(!_dtpdEnPause\) try \{/.test(SRV) && !/_dtpdRaison = 'cha\\u00eene IA en pause[^\n]*\n    else \{/.test(SRV));
v('… et la raison reste écrite (le moniteur dit toujours pourquoi la passe complète manque)',
  /if \(_fxrEnPause\) _fxrRaison = 'cha\\u00eene IA en pause/.test(SRV) && /if \(_dtpdEnPause\) _dtpdRaison = 'cha\\u00eene IA en pause/.test(SRV));

console.log('\n── 4. Le quota va là où les clients sont, le fil d\'actualité en premier (24/09) ──');
{
  // aiAllowed a un paramètre par défaut `opts = {}` : l'extracteur par accolades s'arrêterait dessus.
  // On le découpe donc jusqu'à la fonction suivante, aiNote.
  const _dA = SRV.indexOf('function aiAllowed('), _fA = SRV.indexOf('\nfunction aiNote(', _dA);
  const src = ['_aiVueCategorie', '_aiVueNote', '_aiPoidsCategorie'].map(fn).concat(_dA >= 0 && _fA > _dA ? SRV.slice(_dA, _fA) : null);
  const rx = SRV.slice(SRV.indexOf('const _AI_VUES_ROUTES = ['), SRV.indexOf('const _AI_VUES_CATS'));
  const cats = (SRV.match(/const _AI_VUES_CATS = (\[[^\]]*\]);/) || [])[1];
  v('le compteur d\'usage, le poids et aiAllowed sont extractibles', src.every(Boolean) && rx.length > 50 && !!cats);
  v('le compteur est branché AVANT les routes (juste après requireAuth)',
    /app\.use\(requireAuth\);\n[^\n]*\n[^\n]*\napp\.use\(\(req, _res, next\) => \{ try \{ _aiVueNote\(req\); \} catch \{\} next\(\); \}\);/.test(SRV));
  const monter = (aiSrc, etat) => new Function('_aiReset', '_aiPrioriteJusqua', '_aiQuietHours', '_aiDailyCap', '_aiUsage', 'ai',
    '_aiDayFractionApprise', 'AI_BURST', '_aiIsWeekend', '_aiParis', '_aiDemandSlot', 'auth', 'setTimeout',
    rx + '\nconst _AI_VUES_CATS = ' + cats + ';\nlet _aiVues = ' + JSON.stringify(etat.vues || {}) + ';\nconst _aiVuesVus = new Set(); let _aiVuesTranche = 0, _aiVuesSaveT = null;\n'
    + src.slice(0, 3).join('\n') + '\n' + aiSrc + '\nreturn { aiAllowed, _aiVueNote, _aiPoidsCategorie, vues: () => _aiVues };')(
    () => {}, 0, () => false, () => 1000, { dayCounts: etat.counts || {} }, { setQuotaPressure() {} },
    () => 1, 18, () => false, () => ({ getDay: () => 3, getHours: () => 14, getMinutes: () => 0, getSeconds: () => 0 }), () => '3-14',
    { aiCacheSet: () => Promise.resolve() }, () => 0);
  if (src.every(Boolean)) {
    const AA = src[3];
    // Journée tendue : 920 appels sur un plafond de 1 000, dont 300 au fil
    const T = monter(AA, { counts: { news: 300, analyst: 400, bank: 220 } });
    v('à 92 % du plafond, le fil passe encore (priorité n°1)', T.aiAllowed('news', { important: true, priority: 'user' }) === true);
    v('… et une autre fonction non planifiée, même demandée par un client, cède', T.aiAllowed('analyst', { priority: 'user' }) === false);
    v('… mais le contenu PLANIFIÉ garde sa voie', T.aiAllowed('bias', { scheduled: true }) === true);
    const B = monter(AA, { counts: { news: 300, analyst: 200, bank: 200 } });   // 70 %
    v('à 70 %, le fond du FIL passe (traductions anticipées)', B.aiAllowed('news', { important: true, priority: 'background' }) === true);
    v('… le fond des autres fonctions cède (réserve des 40 % inchangée pour elles)', B.aiAllowed('analyst', { priority: 'background' }) === false);
    // Poids : cet après-midi, les clients lisent surtout Analystes, jamais Institutions
    const vues = { '3-14': { news: 40, analyst: 50, bank: 0, bias: 5 }, '3-15': { news: 30, analyst: 45 }, '3-16': { news: 20, analyst: 30 } };
    const P = monter(AA, { vues, counts: {} });
    const pa = P._aiPoidsCategorie('analyst'), pb = P._aiPoidsCategorie('bank');
    v('la fonction la plus lue à cette heure reçoit une part PLUS grande (≤ 1,4)', pa > 1.2 && pa <= 1.4, String(pa));
    v('une fonction que personne n\'ouvre garde 60 % de sa part (jamais éteinte)', pb === 0.6, String(pb));
    const M = monter(AA, { vues: { '3-14': { analyst: 3 } } });
    v('moins de 20 observations → poids neutre (on n\'invente pas une préférence)', M._aiPoidsCategorie('analyst') === 1 && M._aiPoidsCategorie('bank') === 1);
    // Effet réel sur la part : Institutions à 0,45 × 0,6 = 27 % → refusée à 300 appels ; Analystes à 0,45 × 1,4 → acceptée à 550
    const S = monter(AA, { vues, counts: { bank: 300, analyst: 550 } });
    v('… et ce poids change bien la part accordée (Institutions refusée à 30 %, Analystes acceptées à 55 %)',
      S.aiAllowed('bank', { scheduled: true }) === false && S.aiAllowed('analyst', { scheduled: true }) === true);
    v('le fil n\'est jamais modulé À LA BAISSE', /const _poids = _estFil \? Math\.max\(1, _aiPoidsCategorie\(category\)\)/.test(AA));
    // Compteur : un client × une fonction × 10 min = 1 ; le personnel ne compte pas
    const C = monter(AA, {});
    const rq = (path, user) => ({ path, session: { userId: user.id, user } });
    const cli = { id: 'c1', role: 'user' };
    for (let i = 0; i < 30; i++) C._aiVueNote(rq('/api/news', cli));   // un onglet ouvert qui se rafraîchit
    C._aiVueNote(rq('/api/session-wraps', cli));
    C._aiVueNote(rq('/api/news', { id: 'a1', role: 'admin' }));
    C._aiVueNote(rq('/api/calendar-events', cli));
    const c = C.vues()['3-14'] || {};
    v('trente rafraîchissements du fil par le même client = UNE lecture', c.news === 1, JSON.stringify(c));
    v('l\'admin et le support ne comptent pas, une route sans IA non plus', c.analyst === 1 && Object.keys(c).length === 2, JSON.stringify(c));
    // Témoin : sans la réserve du fil, le fil cède comme les autres à 92 %
    const mut = AA.replace("if (!opts.scheduled && !_estFil && dayTotal >= Math.floor(cap * 0.90)) return false;", "if (!opts.scheduled && dayTotal >= Math.floor(cap * 0.90)) return false;");
    v('(témoin) la mutation retire bien la réserve', mut !== AA);
    v('(témoin) sans elle, le fil est refusé à 92 %', monter(mut, { counts: { news: 300, analyst: 400, bank: 220 } }).aiAllowed('news', { important: true, priority: 'user' }) === false);
  }
  v('le moniteur admin expose l\'usage réel et les poids', /usageClients: _aiVuesEtat\(\)/.test(SRV));
}

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);

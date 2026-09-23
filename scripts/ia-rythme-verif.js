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

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);

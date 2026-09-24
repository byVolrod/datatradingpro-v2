#!/usr/bin/env node
/**
 * scripts/journal-envois-verif.js — LE JOURNAL DES ENVOIS NOMME CE QUI EST PARTI, ET RIEN D'AUTRE (24/09)
 * ------------------------------------------------------------------------------------------------
 * Capture user : « AUTRE : RFAIL, c'est quoi ? ». `rfail:` est un envoi réel (paiement du
 * renouvellement refusé, signalé par Whop), `arnoff:` aussi (renouvellement auto désactivé) : ils
 * doivent porter un nom. À l'inverse, une FUSION de comptes pose des clés `rfail:`/`expired:` qui
 * sont des verrous, pas des envois : elles ne doivent pas apparaître. On EXÉCUTE les vraies fonctions.
 *
 *   node scripts/journal-envois-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };
const a = SRV.indexOf('const _DRIP_DAY_LBL'), b = SRV.indexOf('\n}', SRV.indexOf('function _mailLogType(')) + 2;
v('les fonctions du journal sont extractibles', a > 0 && b > a);
const api = new Function(SRV.slice(a, b) + '\nreturn { _mailLogType, _estEnvoi, _estVerrouFusion };')();
const ID = '8b28b812-3cfb-4c72-95ea-0e67a0cc37f4';
v('« rfail » est nommé : paiement du renouvellement refusé', api._mailLogType('rfail:' + ID + ':2026-09-24T09:21:54Z') === 'Paiement du renouvellement refusé');
v('« arnoff » est nommé : renouvellement automatique désactivé', api._mailLogType('arnoff:' + ID + ':1790241714000') === 'Renouvellement automatique désactivé');
v('une clé inconnue garde son préfixe (rien ne se cache derrière « Autre »)', api._mailLogType('nouveau:x:y') === 'Autre : nouveau');
const all = { ['rfail:' + ID + ':x']: 1, ['expired:abs-1:x']: 1, ['rfail:abs-1:x']: 1, 'fusionmark:abs-1': 1 };
v('un vrai « rfail » reste listé', !api._estVerrouFusion('rfail:' + ID + ':x', all) && api._estEnvoi('rfail:' + ID + ':x'));
v('les verrous d\'une fusion (rfail/expired du compte absorbé) ne sont pas listés', api._estVerrouFusion('rfail:abs-1:x', all) && api._estVerrouFusion('expired:abs-1:x', all));
v('le marqueur de fusion lui-même n\'est pas un envoi', !api._estEnvoi('fusionmark:abs-1'));
v('la fusion pose le marqueur, et la liste applique le filtre', /emailLogAdd\(`fusionmark:\$\{uDe\.id\}`\)/.test(SRV) && /if \(_estVerrouFusion\(key, all\)\) continue;/.test(SRV));
console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);

#!/usr/bin/env node
/**
 * scripts/sessions-verif.js — UN CLIENT, UNE SESSION ; L'ADMINISTRATEUR, DEUX.
 * ------------------------------------------------------------------------------------------------
 * 25/09, demande user : « l'admin peut se connecter 2 fois en même temps » (le poste de travail et
 * le téléphone). La session unique (anti-partage d'identifiants) tient sur DEUX verrous, qui
 * doivent dire la même chose :
 *   1. le JETON posé à la connexion (registre `_sessionEpoch`, persistant) ;
 *   2. le NAVIGATEUR qui réclame le compte au chargement (`_sessionDevice`, en mémoire).
 * Élargir l'un sans l'autre ne sert à rien : la seconde session serait éjectée par le verrou oublié,
 * vingt secondes plus tard, sans que personne comprenne pourquoi. Ce banc rejoue le VRAI code
 * d'`server.js` (tranches extraites, pas une copie) sur les deux verrous, pour un client et pour
 * l'admin, avec le témoin qui mord : sans les deux places, la première session de l'admin tombe.
 */
const fs = require('fs');
const path = require('path');
const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
let ok = 0, ko = 0;
const v = (nom, cond, detail) => { if (cond) { ok++; console.log('  ✓ ' + nom); } else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); } };
const ligne = nom => { const m = new RegExp('const ' + nom + ' = [^\\n]+').exec(SRV); return m ? m[0] : ''; };
const fn = nom => { const m = new RegExp('function ' + nom + '\\([\\s\\S]*?\\n\\}').exec(SRV); return m ? m[0] : ''; };

console.log('\n── Les deux verrous de session, pour un client et pour l\'admin ──');
const tranche = ['_SESSIONS_ADMIN', '_placesDe', '_jetonValide', '_jetonsApres', '_devConnu'].map(ligne);
v('les règles de places sont extractibles', tranche.every(Boolean), tranche.map(x => x ? 1 : 0).join(''));
v('_devReclamer est extractible', !!fn('_devReclamer'));
function monter(source) {
  return new Function('const _sessionDevice = new Map(); const _DEV_MAX_COMPTES = 5000;\n' + source.join('\n') + '\n' + fn('_devReclamer')
    + '\nreturn { _placesDe, _jetonValide, _jetonsApres, _devReclamer, _devConnu, _sessionDevice };')();
}
const S = monter(tranche);

// Verrou 1 : le jeton.
let reg = '';
reg = S._jetonsApres(reg, 'A', S._placesDe('client'));
reg = S._jetonsApres(reg, 'B', S._placesDe('client'));
v('client : la seconde connexion évince la première (anti-partage intact)', !S._jetonValide(reg, 'A') && S._jetonValide(reg, 'B'), reg);
let adm = '';
adm = S._jetonsApres(adm, 'P', S._placesDe('admin'));
adm = S._jetonsApres(adm, 'T', S._placesDe('admin'));
v('admin : poste ET téléphone restent connectés', S._jetonValide(adm, 'P') && S._jetonValide(adm, 'T'), adm);
adm = S._jetonsApres(adm, 'X', S._placesDe('admin'));
v('… une troisième connexion évince la plus ancienne, pas les deux autres', !S._jetonValide(adm, 'P') && S._jetonValide(adm, 'T') && S._jetonValide(adm, 'X'), adm);
v('le support garde une seule place', S._placesDe('support') === 1);
v('un registre d\'avant (jeton seul) reste lu', S._jetonValide('Z', 'Z') && !S._jetonValide('Z', 'Y') && !S._jetonValide('', 'Y'));
v('se reconnecter avec un jeton déjà connu ne le duplique pas', S._jetonsApres('T|P', 'T', 2) === 'T|P');

// Verrou 2 : le navigateur.
S._devReclamer('c1', 'nav-pc-000001', S._placesDe('client'));
const rep = S._devReclamer('c1', 'nav-tel-00001', S._placesDe('client'));
v('client : un autre navigateur reprend le compte, le premier n\'est plus reconnu', rep === true && !S._devConnu(S._sessionDevice.get('c1'), 'nav-pc-000001'));
S._devReclamer('a1', 'nav-pc-000001', S._placesDe('admin'));
const rep2 = S._devReclamer('a1', 'nav-tel-00001', S._placesDe('admin'));
const d = S._sessionDevice.get('a1');
v('admin : le téléphone s\'ajoute SANS couper le poste', rep2 === false && S._devConnu(d, 'nav-pc-000001') && S._devConnu(d, 'nav-tel-00001'), JSON.stringify(d));
const rep3 = S._devReclamer('a1', 'nav-tab-00001', S._placesDe('admin'));
v('… un troisième navigateur évince le plus ancien (et le signale pour couper son flux)', rep3 === true && !S._devConnu(S._sessionDevice.get('a1'), 'nav-pc-000001') && S._devConnu(S._sessionDevice.get('a1'), 'nav-tel-00001'));

// Les points de contrôle lisent bien la liste, partout.
v('la garde de requête lit les deux listes', /!_jetonValide\(ep, req\.session\.stoken\)/.test(SRV) && /!_devConnu\(dv, mien\)/.test(SRV));
v('/me lit les deux listes et réclame avec les places du rôle', /!_jetonValide\(_mep, req\.session\.stoken\)/.test(SRV) && /_devReclamer\(_uidS, _dev, _placesDe\(fresh\.role\)\)/.test(SRV) && /!_devConnu\(_det, _dev\)/.test(SRV));
v('la connexion garde les places du rôle et ne coupe que les flux évincés', /_jetonsApres\(_sessionEpoch\.get\(String\(user\.id\)\), _stok, _placesDe\(user\.role\)\)/.test(SRV)
  && /!_jetonValide\(_sessionEpoch\.get\(String\(user\.id\)\), c\._stoken\)/.test(SRV));
v('plus aucune comparaison directe de jeton ou de navigateur', !/stoken !== |\.dev !== (mien|_dev)|_mep !== /.test(SRV));

// TÉMOIN : une seule place pour l'admin → la première session tombe. Si ce contrôle ne mord pas,
// ceux du dessus ne prouvent rien.
const T = monter(tranche.map(l => l.replace(/const _SESSIONS_ADMIN = \d+/, 'const _SESSIONS_ADMIN = 1')));
const t = T._jetonsApres(T._jetonsApres('', 'P', T._placesDe('admin')), 'T', T._placesDe('admin'));
v('TÉMOIN — avec une seule place, le poste de l\'admin serait éjecté', !T._jetonValide(t, 'P'), t);

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);

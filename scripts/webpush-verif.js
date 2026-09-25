#!/usr/bin/env node
/* ═══ WEBPUSH-VERIF — une notification Web Push arrive-t-elle LISIBLE sur le téléphone ? ════════════
   Le chiffrement et la signature ne se relisent pas : une erreur d'un octet dans une étiquette HKDF
   donne un message que le téléphone jette EN SILENCE (aucun code d'erreur côté serveur, le service de
   push répond 201 quand même). On joue donc le rôle du TÉLÉPHONE : on crée un vrai abonnement (clés
   P-256 + secret), on chiffre avec le VRAI module, et on DÉCHIFFRE selon la RFC 8291, écrite ici
   indépendamment. Même chose pour VAPID : la signature est vérifiée avec la clé publique annoncée.
   Témoins : un secret d'authentification faux doit faire échouer le déchiffrement. */
'use strict';
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const wp = require(path.join(__dirname, '..', 'webpush.js'));

let ok = 0, ko = 0;
const t = (nom, cond) => { if (cond) { ok++; console.log('  ✓ ' + nom); } else { ko++; console.log('  ✗ ' + nom); } };
const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function hkdf(salt, ikm, info, len) {
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  return crypto.createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, len);
}

// Le « téléphone » : ses clés d'abonnement.
const tel = crypto.createECDH('prime256v1'); const telPub = tel.generateKeys();
const telAuth = crypto.randomBytes(16);
const abonnement = { endpoint: 'https://web.push.apple.com/QGZ-essai', keys: { p256dh: b64u(telPub), auth: b64u(telAuth) } };

function dechiffrer(corps, authSecret) {
  const sel = corps.subarray(0, 16);
  const rs = corps.readUInt32BE(16);
  const idlen = corps[20];
  const asPub = corps.subarray(21, 21 + idlen);
  const chiffre = corps.subarray(21 + idlen);
  const partage = tel.computeSecret(asPub);
  const ikm = hkdf(authSecret, partage, Buffer.concat([Buffer.from('WebPush: info\0'), telPub, asPub]), 32);
  const cek = hkdf(sel, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(sel, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(chiffre.subarray(chiffre.length - 16));
  const clair = Buffer.concat([d.update(chiffre.subarray(0, chiffre.length - 16)), d.final()]);
  let fin = clair.length - 1; while (fin >= 0 && clair[fin] === 0) fin--;
  return { rs, delim: clair[fin], texte: clair.subarray(0, fin).toString('utf8') };
}

console.log('\n── Chiffrement RFC 8291 (aes128gcm) ──');
const msg = { title: 'DataTradingPro', body: 'Test : la BCE laisse ses taux inchangés — 2,00%', url: '/' };
const corps = wp.chiffrer(abonnement, JSON.stringify(msg));
let lu = null;
try { lu = dechiffrer(corps, telAuth); } catch (e) { lu = null; }
t('le téléphone déchiffre le message', !!lu);
t('… et retrouve exactement le texte envoyé (accents compris)', lu && lu.texte === JSON.stringify(msg));
t('… enregistrement unique terminé par le délimiteur 0x02', lu && lu.delim === 2);
t('… taille d\'enregistrement annoncée : 4096', lu && lu.rs === 4096);
t('deux envois du même message ne se ressemblent pas (sel et clé éphémère neufs)', !wp.chiffrer(abonnement, 'x').equals(wp.chiffrer(abonnement, 'x')));
// Vecteur officiel de la RFC 8291, annexe A : le corps doit être IDENTIQUE à l'octet près.
const rfc = wp.chiffrer({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' } },
  'When I grow up, I want to be a watermelon', { privee: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', sel: 'DGv6ra1nlYgDCS1FRnbzlw' });
t('vecteur officiel RFC 8291 (annexe A) reproduit à l\'octet près', b64u(rfc) === 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
let temoin = false; try { dechiffrer(corps, crypto.randomBytes(16)); } catch { temoin = true; }
t('témoin : un secret d\'authentification faux fait échouer le déchiffrement', temoin);

console.log('\n── VAPID RFC 8292 (ES256) ──');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vapid-'));
const sauv = { p: process.env.DTP_VAPID_PUBLIC, s: process.env.DTP_VAPID_PRIVATE };
delete process.env.DTP_VAPID_PUBLIC; delete process.env.DTP_VAPID_PRIVATE;
const cles = wp.chargerCles(dir);
t('clés générées au premier appel, publique de 65 octets', cles.origine === 'generee' && deB64u(cles.publique).length === 65);
const cles2 = wp.chargerCles(dir);
t('… et RELUES du volume au suivant (sinon chaque redémarrage casserait les abonnements)', cles2.origine === 'fichier' && cles2.publique === cles.publique);
process.env.DTP_VAPID_PUBLIC = cles.publique; process.env.DTP_VAPID_PRIVATE = cles.privee;
t('l\'environnement prime sur le fichier', wp.chargerCles(path.join(dir, 'absent')).origine === 'env');
if (sauv.p) process.env.DTP_VAPID_PUBLIC = sauv.p; else delete process.env.DTP_VAPID_PUBLIC;
if (sauv.s) process.env.DTP_VAPID_PRIVATE = sauv.s; else delete process.env.DTP_VAPID_PRIVATE;
const jwt = wp.jetonVapid(abonnement.endpoint, cles, 'https://datatradingpro.com');
const [h, c, s] = jwt.split('.');
const pub = deB64u(cles.publique);
const clePub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' });
t('la signature se vérifie avec la clé publique annoncée', crypto.verify('sha256', Buffer.from(h + '.' + c), { key: clePub, dsaEncoding: 'ieee-p1363' }, deB64u(s)));
const claims = JSON.parse(deB64u(c).toString());
t('audience = origine du service de push (Apple ici)', claims.aud === 'https://web.push.apple.com');
t('expiration ≤ 24 h (Apple et Google refusent au-delà)', claims.exp - Date.now() / 1000 <= 86400 && claims.exp > Date.now() / 1000);
t('sujet https ou mailto (exigé par Apple)', /^(https:|mailto:)/.test(claims.sub));

console.log('\n── Abonnements acceptés ──');
t('Apple, Google et Mozilla acceptés', ['https://web.push.apple.com/x', 'https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x']
  .every(e => wp.abonnementValide({ endpoint: e, keys: abonnement.keys })));
t('une adresse arbitraire est refusée (pas de requête signée vers n\'importe où)', !wp.abonnementValide({ endpoint: 'https://exemple.com/push', keys: abonnement.keys }));
t('un abonnement sans clés valides est refusé', !wp.abonnementValide({ endpoint: 'https://web.push.apple.com/x', keys: { p256dh: 'abc', auth: 'def' } }));

console.log('\n── Guetteur des publications par catégorie (tranche réelle de server.js) ──');
{
  const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const a = SRV.indexOf('const _pushVus = {};'), b = SRV.indexOf('setInterval(() => { try { const ev = _pushGuetter()');
  t('la tranche du guetteur est extractible', a > 0 && b > a);
  const env = { _swCache: [], allNews: [], _brCache: [], allCalendar: [] };
  const G = new Function('env', 'const _calKeyDated = (c, t, ts) => c + "|" + t + "|" + ts; let _swCache = env._swCache, allNews = env.allNews, _brCache = env._brCache, allCalendar = env.allCalendar;'
    + SRV.slice(a, b) + '; return { passe: () => { _swCache = env._swCache; allNews = env.allNews; _brCache = env._brCache; allCalendar = env.allCalendar; return _pushGuetter(); } };')(env);
  const n = Date.now();
  env._swCache = [{ id: 'w1', title: 'Ancien récap', timestamp: n - 3600e3 }];
  env._brCache = [{ id: 'b1', title: 'Old note', institution: 'ING', timestamp: n - 3600e3 }];
  t('premier passage : il apprend l’existant, rien ne part (un redémarrage ne spamme pas)', G.passe().length === 0);
  env._swCache = [{ id: 'w2', aiTitle: 'Wall Street finit en hausse', timestamp: n }, ...env._swCache];
  env._brCache = [{ id: 'b2', title: 'EUR/USD : vers 1,20', institution: 'Goldman Sachs', timestamp: n }, { id: 'b0', title: 'Archive', institution: 'X', timestamp: n - 40 * 3600e3 }, ...env._brCache];
  env.allNews = [{ id: 'r1', _briefing: true, _reportType: 'DTP Daily', headline: 'Récap du jour', timestamp: n }];
  env.allCalendar = [{ currency: 'USD', title: 'CPI m/m', impact: 'High', actual: '0.4%', forecast: '0.3%', timestamp: n - 60000 },
                     { currency: 'EUR', title: 'Low thing', impact: 'Low', actual: '1', timestamp: n - 60000 },
                     { currency: 'GBP', title: 'GDP', impact: 'High', actual: '', timestamp: n + 3600e3 }];
  const ev = G.passe();
  const cles = ev.map(e => e.cat).sort().join(',');
  t('second passage : un récap analyste, un rapport DTP, une note de banque, un chiffre du calendrier', cles === 'analystes,analystes,banques,eco', cles);
  t('… l’archive de 40 h n’est pas notifiée (seul le frais part)', !ev.some(e => /Archive/.test(e.body)));
  t('… impact faible et chiffre pas encore publié : écartés', ev.filter(e => e.cat === 'eco').length === 1);
  const cal = ev.find(e => e.cat === 'eco') || {};
  t('… le chiffre du calendrier porte réel et prévision, à la française', /^Publié 0,4% · attendu 0,3%\./.test(cal.body || ''), cal.body);
  t('… et dit s’il bat le consensus', /Au-dessus du consensus\./.test(cal.body || ''), cal.body);
  t('… sous un titre rédigé', /^Calendrier économique · /.test(cal.title || ''), cal.title);
  const dtp = ev.find(e => e.id === 'rap:r1') || {};
  t('… le rapport DTP est nommé en français', dtp.title === 'Analystes · Point marché', dtp.title);
  const br = ev.find(e => e.cat === 'banques') || {};
  t('… la note de banque nomme la banque', br.title === 'Banques · Goldman Sachs', br.title);
  t('troisième passage sans rien de neuf : rien ne repart', G.passe().length === 0);
}

console.log('\n── Envoi (service de push simulé) ──');
(async () => {
  let recu = null;
  const faux = async (url, init) => { recu = { url, init }; return { status: 201 }; };
  const r = await wp.envoyer(abonnement, msg, cles, { fetch: faux });
  t('201 → envoi réussi', r.ok && r.statut === 201);
  t('en-têtes : aes128gcm, TTL, urgence haute, Authorization vapid t=…, k=…', recu && recu.init.headers['Content-Encoding'] === 'aes128gcm'
    && /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/.test(recu.init.headers.Authorization) && recu.init.headers.Urgency === 'high' && +recu.init.headers.TTL > 0);
  t('le corps reçu par le service est déchiffrable par le téléphone', (() => { try { return dechiffrer(recu.init.body, telAuth).texte === JSON.stringify(msg); } catch { return false; } })());
  const r410 = await wp.envoyer(abonnement, msg, cles, { fetch: async () => ({ status: 410 }) });
  t('410 → abonnement mort, à retirer', !r410.ok && r410.mort);
  const rLent = await wp.envoyer(abonnement, msg, cles, { delaiMs: 50, fetch: (u, i) => new Promise((_, rej) => i.signal.addEventListener('abort', () => { const e = new Error('abort'); e.name = 'AbortError'; rej(e); })) });
  t('service muet → délai borné, pas de blocage', !rLent.ok && rLent.erreur === 'délai dépassé');
  console.log(ko ? '\n✗ ' + ko + ' contrôle(s) en échec' : '\n✓ ' + ok + ' contrôles au vert');
  process.exit(ko ? 1 : 0);
})();

/* ═══ WEB PUSH — notifications du téléphone sans application native (24/09) ═══════════════════════
   Demande user : « recevoir sur mon iPhone la notif comme si c'était une app installée, idem Android,
   jusqu'à l'écran verrouillé ». L'envoi existant ne servait que l'app Expo (jetons ExponentPushToken) :
   un téléphone qui utilise DTP depuis l'écran d'accueil n'avait AUCUN chemin.

   Le Web Push est le standard que les trois services acceptent : Apple (web.push.apple.com, iPhone
   iOS 16.4+ quand DTP est ajouté à l'écran d'accueil), Google (FCM, Android et Chrome ordinateur),
   Mozilla. Deux RFC suffisent, implémentées ici avec le module `crypto` de Node, sans dépendance :
     · RFC 8291 : chiffrement du message (aes128gcm) pour la clé publique de l'abonnement ;
     · RFC 8292 : VAPID, un jeton ES256 qui prouve que l'envoi vient bien du serveur qui a abonné.

   ⚠️ LES CLÉS VAPID NE SONT PAS DES SECRETS D'UN FOURNISSEUR, mais la privée reste privée : elle vit
   dans l'environnement (`DTP_VAPID_PUBLIC` / `DTP_VAPID_PRIVATE`) ou, à défaut, est générée UNE fois
   et gardée dans le volume de données (DATA_DIR/vapid.json), jamais dans le dépôt. Changer de clé
   invalide tous les abonnements : le client s'en aperçoit (clé différente) et se réabonne seul. */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const b64u = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64u = s => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function _hkdf(salt, ikm, info, len) {
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  // Un seul bloc suffit (len ≤ 32) : T(1) = HMAC(PRK, info || 0x01).
  return crypto.createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, len);
}

/* Clés VAPID : environnement d'abord, fichier du volume ensuite, génération en dernier recours. */
function chargerCles(dataDir) {
  const pub = process.env.DTP_VAPID_PUBLIC, priv = process.env.DTP_VAPID_PRIVATE;
  if (pub && priv && deB64u(pub).length === 65 && deB64u(priv).length === 32) return { publique: pub, privee: priv, origine: 'env' };
  const fichier = path.join(dataDir, 'vapid.json');
  try {
    const d = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    if (d && deB64u(d.publique).length === 65 && deB64u(d.privee).length === 32) return { publique: d.publique, privee: d.privee, origine: 'fichier' };
  } catch {}
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const brute = Buffer.concat([Buffer.from([4]), deB64u(jwk.x), deB64u(jwk.y)]);
  const cles = { publique: b64u(brute), privee: jwk.d };
  try { fs.writeFileSync(fichier, JSON.stringify(cles), { mode: 0o600 }); } catch {}
  void publicKey;
  return Object.assign(cles, { origine: 'generee' });
}

function _clePriveeVapid(cles) {
  const pub = deB64u(cles.publique);
  return crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: cles.privee, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
}

function jetonVapid(endpoint, cles, sujet, maintenant) {
  const aud = new URL(endpoint).origin;
  const t0 = Math.floor((maintenant || Date.now()) / 1000);
  const tete = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const corps = b64u(JSON.stringify({ aud, exp: t0 + 12 * 3600, sub: sujet }));
  const sig = crypto.sign('sha256', Buffer.from(tete + '.' + corps), { key: _clePriveeVapid(cles), dsaEncoding: 'ieee-p1363' });
  return tete + '.' + corps + '.' + b64u(sig);
}

/* RFC 8291 : un seul enregistrement, délimiteur 0x02, taille d'enregistrement 4096. */
// `_fixe` (bancs uniquement) : clé éphémère et sel imposés, pour rejouer le vecteur de la RFC 8291.
function chiffrer(abonnement, charge, _fixe) {
  const uaPub = deB64u(abonnement.keys.p256dh);
  const authSecret = deB64u(abonnement.keys.auth);
  if (uaPub.length !== 65 || authSecret.length !== 16) throw new Error('clés d\'abonnement invalides');
  const ecdh = crypto.createECDH('prime256v1');
  let asPub;
  if (_fixe && _fixe.privee) { ecdh.setPrivateKey(deB64u(_fixe.privee)); asPub = ecdh.getPublicKey(); } else asPub = ecdh.generateKeys();
  const partage = ecdh.computeSecret(uaPub);
  const ikm = _hkdf(authSecret, partage, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32);
  const sel = (_fixe && _fixe.sel) ? deB64u(_fixe.sel) : crypto.randomBytes(16);
  const cek = _hkdf(sel, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = _hkdf(sel, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const chiffre = Buffer.concat([c.update(Buffer.concat([Buffer.from(charge), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([sel, rs, Buffer.from([asPub.length]), asPub, chiffre]);
}

// Services de push connus : un abonnement qui pointe ailleurs est refusé (on n'envoie pas de requêtes
// signées vers une adresse arbitraire fournie par un navigateur).
const HOTES_OK = /(^|\.)(push\.apple\.com|fcm\.googleapis\.com|googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/i;
function abonnementValide(a) {
  try {
    if (!a || typeof a.endpoint !== 'string' || !a.keys) return false;
    const u = new URL(a.endpoint);
    if (u.protocol !== 'https:' || !HOTES_OK.test(u.hostname)) return false;
    return deB64u(a.keys.p256dh).length === 65 && deB64u(a.keys.auth).length === 16;
  } catch { return false; }
}

/* Envoi d'UNE notification. Rend { ok, statut, mort } : `mort` = l'abonnement n'existe plus
   (404/410), à retirer du compte. Délai borné : un service lent ne retient pas le serveur. */
async function envoyer(abonnement, message, cles, opts) {
  const o = opts || {};
  const corps = chiffrer(abonnement, JSON.stringify(message));
  const ac = new AbortController();
  const minuteur = setTimeout(() => ac.abort(), o.delaiMs || 8000);
  try {
    const r = await (o.fetch || fetch)(abonnement.endpoint, {
      method: 'POST', signal: ac.signal,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'TTL': String(o.ttl || 6 * 3600),
        'Urgency': o.urgence || 'high',
        'Authorization': 'vapid t=' + jetonVapid(abonnement.endpoint, cles, o.sujet || 'https://datatradingpro.com') + ', k=' + cles.publique,
      },
      body: corps,
    });
    return { ok: r.status >= 200 && r.status < 300, statut: r.status, mort: r.status === 404 || r.status === 410 };
  } catch (e) {
    return { ok: false, statut: 0, mort: false, erreur: e.name === 'AbortError' ? 'délai dépassé' : e.message };
  } finally { clearTimeout(minuteur); }
}

module.exports = { chargerCles, envoyer, chiffrer, jetonVapid, abonnementValide, b64u, deB64u, _hkdf };

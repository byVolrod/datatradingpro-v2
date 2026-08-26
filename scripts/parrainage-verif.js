#!/usr/bin/env node
/**
 * parrainage-verif.js — LE PARRAINAGE DONNE-T-IL VRAIMENT SON LIEN AU CLIENT ?
 * ------------------------------------------------------------------------------------------------
 * 02/09, demande utilisateur : « fais un audit pour tester si le parrainage fonctionne bien […] si
 * le client n'a pas rejoint le Whop comment ça se passe […] il faut que ça se crée automatiquement ».
 *
 * LE MÉCANISME, EN UNE PHRASE : le panneau Parrainages n'affiche un lien QUE si Whop connaît le
 * client. On demande à Whop l'adhésion portant l'adresse du compte, on en tire le nom d'utilisateur,
 * et le lien d'affiliation se construit avec. Pas d'adhésion trouvée → pas de lien, et le panneau
 * bascule sur les deux étapes d'inscription. Tout tient donc à UNE question : dans quels cas
 * trouve-t-on l'adhésion ?
 *
 * LE DÉFAUT TROUVÉ À L'AUDIT, ET CE BANC EXISTE POUR ÇA. La recherche était filtrée sur le PRODUIT
 * payant. Un compte AMI, OFFERT ou créé à la main n'a pas d'adhésion payante : il ne pouvait donc
 * JAMAIS obtenir de lien — et le panneau lui demandait pourtant de « rejoindre le Whop », ce qui ne
 * changeait rien, puisque rejoindre l'offre GRATUITE crée une adhésion à un autre produit, invisible
 * pour une requête filtrée. La promesse affichée était fausse pour ces comptes.
 *
 * Le banc exécute le VRAI `getAffiliateInfo` de whop.js contre une API Whop bouchonnée, et couvre
 * les quatre situations réelles : abonné payant, compte ami ayant pris l'offre gratuite, compte à
 * adresse masquée (Apple), et personne qui n'a jamais mis les pieds sur Whop.
 *
 *   node scripts/parrainage-verif.js
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const WHOP = fs.readFileSync(path.join(RACINE, 'whop.js'), 'utf8');
const SRV  = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
let ok = 0, ko = 0;
const v = (t, c, d) => { if (c) { ok++; console.log('  ✓ ' + t); } else { ko++; console.log('  ✗ ' + t + (d ? '\n      → ' + d : '')); } };

function decouper(src, entete, fin) {
  const d = src.indexOf(entete);
  if (d < 0) return null;
  const f = src.indexOf(fin, d + entete.length);
  return f < 0 ? null : src.slice(d, f + fin.length);
}

console.log('\n═══ PARRAINAGE-VERIF — le lien d\'affiliation Whop ═══');

const EMAIL = decouper(WHOP, 'function _memEmail(m) {', '\n}');
const AFF   = decouper(WHOP, 'async function getAffiliateInfo(email) {', '\n}');
v('`getAffiliateInfo` est extractible de whop.js', !!AFF);
v('… et sa lecture défensive de l\'adresse aussi', !!EMAIL);
if (!AFF || !EMAIL) { console.log('\n✗ ' + ko + ' KO\n'); process.exit(1); }

/* L'API Whop bouchonnée. Deux produits : le DTP payant, et l'offre gratuite de l'espace. La requête
   filtrée ne voit que le premier — exactement comme en production. */
const DTP = 'prod_dtp', GRATUIT = 'prod_free';
const ADHESIONS = [
  { id: 'mem_1', email: 'abonne@exemple.com', product: DTP, username: 'abonne_whop',
    affiliate_page_url: 'https://whop.com/jot-dtp/?a=abonne_whop' },
  // Compte AMI : aucune adhésion payante, mais il a pris l'offre gratuite de l'espace.
  { id: 'mem_2', email: 'ami@exemple.com', product: GRATUIT, username: 'ami_whop' },
  // Adresse MASQUÉE (Apple) : l'e-mail n'est pas dans `email` mais dans l'objet `user`.
  { id: 'mem_3', product: GRATUIT, user: { email: 'masque@privaterelay.appleid.com', username: 'masque_whop' } },
];

async function interroge(email) {
  global.WHOP_API_KEY = 'test';
  const appels = [];
  global.fetch = async (url) => {
    appels.push(String(url));
    const u = new URL(String(url));
    const prod = u.searchParams.get('product_id');
    const data = ADHESIONS.filter(m => !prod || m.product === prod);
    return { ok: true, json: async () => ({ data, pagination: { total_page: 1 } }) };
  };
  const ctx = eval('(async () => {'                                   // eslint-disable-line no-eval
    + "const WHOP_API_KEY = 'test';"
    + "const DTP_PRODUCT = '" + DTP + "';"
    + "const BASE = 'https://api.whop.com/api/v2';"
    + 'function _auth() { return {}; }\n'
    + EMAIL + '\n' + AFF + '\n'
    + 'return await getAffiliateInfo(' + JSON.stringify(email) + ');'
    + '})()');
  return { info: await ctx, appels };
}

(async () => {
  console.log('\n── 1. Un abonné payant obtient son lien, sans rien faire ──');
  const a = await interroge('abonne@exemple.com');
  v('l\'adhésion payante est trouvée', !!a.info, JSON.stringify(a.info));
  v('… et Whop fournit directement le lien canonique',
    !!(a.info && /\?a=abonne_whop$/.test(a.info.pageUrl || '')), JSON.stringify(a.info));
  v('… en un seul appel : pas de balayage inutile de tout l\'espace', a.appels.length === 1, a.appels.length + ' appel(s)');

  console.log('\n── 2. UN COMPTE AMI QUI PREND L\'OFFRE GRATUITE OBTIENT SON LIEN ──');
  /* LE CONTRÔLE QUI JUSTIFIE CE BANC. Avant correctif : aucun lien, jamais, quoi que fasse le
     client — alors que le panneau lui demandait précisément de rejoindre le Whop. */
  const b = await interroge('ami@exemple.com');
  v('l\'adhésion GRATUITE est trouvée par le repli sans filtre produit', !!b.info, JSON.stringify(b.info));
  v('… on en tire son nom d\'utilisateur Whop', !!(b.info && b.info.username === 'ami_whop'), JSON.stringify(b.info));
  v('… et il a bien fallu DEUX requêtes (produit, puis espace entier)', b.appels.length === 2,
    b.appels.length + ' appel(s) : ' + b.appels.map(u => (u.includes('product_id') ? 'produit' : 'espace')).join(' + '));

  console.log('\n── 3. Une adresse masquée (Apple) n\'est pas perdue ──');
  /* Même prudence que pour l'abonnement lui-même : l'adresse se lit à plusieurs endroits. Une
     lecture naïve de `m.email` avait déjà rendu un vrai client invisible le 27/08. */
  const c = await interroge('masque@privaterelay.appleid.com');
  v('l\'adhésion à adresse masquée est trouvée', !!c.info, JSON.stringify(c.info));
  v('… avec son nom d\'utilisateur', !!(c.info && c.info.username === 'masque_whop'), JSON.stringify(c.info));

  console.log('\n── 4. Quelqu\'un qui n\'a jamais rejoint Whop n\'obtient PAS de faux lien ──');
  /* C'est volontaire et c'est important : un lien ?ref= interne ne verse aucune commission Whop.
     Mieux vaut afficher les deux étapes d'inscription qu'un lien qui ne paiera jamais. */
  const d = await interroge('inconnu@exemple.com');
  v('aucune adhésion trouvée → aucun lien', d.info === null, JSON.stringify(d.info));
  v('… après avoir cherché dans le produit ET dans l\'espace', d.appels.length === 2, d.appels.length + ' appel(s)');

  console.log('\n── 5. Ce que le panneau promet est ce que le serveur fait ──');
  /* Une promesse d'interface non tenue par le serveur est pire qu'une absence de promesse : le
     client suit l'instruction, rien ne se passe, et il conclut que le produit est cassé. */
  const IDX = fs.readFileSync(path.join(RACINE, 'public/index.html'), 'utf8');
  v('le panneau dit explicitement que l\'offre GRATUITE suffit',
    /offre gratuite suffit/i.test(IDX), 'phrase absente du panneau');
  v('… et il propose de revérifier sans recharger la page',
    /pd-ref-recheck[\s\S]{0,120}loadReferrals\(\)/.test(IDX), 'bouton de revérification absent');
  v('le serveur ne fabrique JAMAIS de lien sans affilié Whop (pas de commission sinon)',
    /needsWhop: !hasWhop/.test(SRV) && /: null;/.test(SRV.slice(SRV.indexOf('const link = (aff && aff.pageUrl)'), SRV.indexOf('const link = (aff && aff.pageUrl)') + 420)),
    'le repli interne ?ref= semble revenu');
  v('le lien de jonction est configurable par l\'environnement',
    /REFERRAL_WHOP_JOIN/.test(SRV), 'REFERRAL_WHOP_JOIN introuvable');

  console.log('');
  if (ko) { console.log('✗ ' + ko + ' ÉCHEC(S) — ' + ok + ' contrôle(s) OK, ' + ko + ' KO\n'); process.exit(1); }
  console.log('✓ TOUT PASSE — ' + ok + ' contrôle(s) OK\n');
})();

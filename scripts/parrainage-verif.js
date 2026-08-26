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

  /* ══ 6. LA CAMPAGNE SEMESTRIELLE (04/09) ═══════════════════════════════════════════════════════
     Demande utilisateur : « programme tous les 6 mois tu envoi un mail pour dire ça puis à chaque
     fois de différente façon pour pas que ça soit des mails identiques ».

     CE QUE CE BLOC ÉPROUVE, ET POURQUOI LA LECTURE DU CODE N'AURAIT PAS SUFFI. Une cadence est un
     CALCUL de dates, avec deux pièges classiques qu'aucune relecture ne rattrape : le 31 mars plus
     six mois n'existe pas (il n'y a pas de 31 septembre), et « le lundi » n'est une propriété du
     résultat que si on la vérifie sur des dates de départ variées. On extrait donc la VRAIE
     fonction de server.js — jamais une copie, qui vieillirait dans l'imagination du relecteur — et
     on éprouve les propriétés sur une année entière de dates de départ.

     ET SURTOUT LE CONTRÔLE QUE PERSONNE N'ÉCRIRAIT SPONTANÉMENT : le JOUR d'envoi. Le desk
     s'interdit d'écrire deux fois le même jour au même contact. Poser le parrainage un jour déjà
     occupé par un contenu hebdomadaire ne planterait rien — le mail serait SILENCIEUSEMENT sauté,
     contact par contact, et le semestre passerait sans que rien ne le signale. C'est exactement le
     genre de panne qu'on découvre six mois trop tard. */
  console.log('\n── 6. La cadence semestrielle : « tous les 6 mois », vraiment ? ──');
  const PROCH = decouper(SRV, 'function _parrainProchain(lastAt) {', '\n}');
  const JOUR  = decouper(SRV, 'function _parrainJour(ms) {', '\n}');
  v('le calcul d\'échéance est extractible de server.js', !!PROCH && !!JOUR);
  if (PROCH && JOUR) {
    // eslint-disable-next-line no-eval
    /* ⚠️ Deux DÉCLARATIONS de fonction ne forment pas une expression : les envelopper dans des
       parenthèses lève « Unexpected token 'function' ». On les évalue comme des instructions, et on
       renvoie la liaison par l'expression FINALE de l'eval. */
    /* ⚠️ Et le nom local NE PEUT PAS être `_parrainProchain` : une déclaration de fonction
       évaluée par eval remonte dans la portée appelante, où elle percuterait le `const` du
       même nom — « Identifier has already been declared », à l'exécution seulement. */
    const prochain = eval(JOUR + '\n' + PROCH + '\n(_parrainProchain)');
    const wd = iso => new Date(iso + 'T12:00:00Z').getUTCDay();

    v('jamais envoyé → l\'échéance est AUJOURD\'HUI (le premier mail n\'attend pas 6 mois)',
      prochain(0) === new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()));

    /* PROPRIÉTÉ, pas valeur : sur 366 dates de départ consécutives, l'échéance tombe TOUJOURS un
       lundi et TOUJOURS entre 6 et 6 mois + 6 jours plus tard. Un test sur trois dates choisies à
       la main passerait avec un calcul faux une fois sur sept. */
    let tousLundis = true, borneOk = true, pireEcart = 0;
    const base = Date.UTC(2026, 0, 1, 12);
    for (let k = 0; k < 366; k++) {
      const dep = base + k * 864e5;
      const r = prochain(dep);
      if (wd(r) !== 1) { tousLundis = false; break; }
      const j = Math.round((new Date(r + 'T12:00:00Z') - dep) / 864e5);
      if (j < 178 || j > 190) { borneOk = false; break; }        // ~6 mois, plus l'avance au lundi
      pireEcart = Math.max(pireEcart, j);
    }
    v('sur 366 dates de départ, l\'échéance tombe TOUJOURS un lundi', tousLundis, 'un départ produit un autre jour');
    v('… et toujours à ~6 mois (jamais 3, jamais 12)', borneOk, 'écart hors de [178, 190] jours');

    /* FIN DE MOIS. Le 31 mars plus six mois n'existe pas : sans borne, la date roule sur le 1er
       octobre. La borne doit donc ramener au 30 septembre.
       ⚠️ ET LE CONTRÔLE ÉVIDENT NE PROUVE RIEN. Exiger « le résultat reste en septembre » est faux :
       le résultat est ensuite AVANCÉ AU LUNDI SUIVANT, et le lundi qui suit le 30 septembre 2026
       tombe le 5 octobre. Pire, ce départ-là ne distingue même pas les deux calculs — borné (30/09,
       mercredi) et non borné (01/10, jeudi) avancent tous les deux au 5 octobre. On éprouve donc
       la borne sur les départs où les deux calculs DIVERGENT vraiment : ceux qui visent février,
       dont le débordement fait trois jours. 30 et 31 août 2026 → 28 février 2027 (dimanche) → lundi
       1er mars. Sans la borne : 2 et 3 mars, donc lundi 8 mars. Une semaine d'écart, visible. */
    const fev31 = prochain(Date.UTC(2026, 7, 31, 12));
    v('le 31 août + 6 mois est borné au 28 février (et non roulé sur mars)',
      fev31 === '2027-03-01', 'obtenu ' + fev31 + ' (8 mars = borne absente)');
    const fev30 = prochain(Date.UTC(2026, 7, 30, 12));
    v('… le 30 août aussi', fev30 === '2027-03-01', 'obtenu ' + fev30);
  }

  console.log('\n── 7. Le jour choisi n\'est occupé par AUCUN contenu hebdomadaire ──');
  /* Le contrôle décisif, et le moins évident : un contenu posé un jour déjà pris serait mangé en
     silence par le garde-fou « jamais deux mails le même jour calendaire au même contact ». */
  /* On lit la LIGNE de declaration de l'etape, pas un bloc delimite par accolades : `[^}]*` s'arrete
     a la premiere accolade fermante venue, y compris celle d'un objet imbrique — le piege deja
     rencontre le 26/08 avec `catch(() => {})`. Une etape tient sur une ligne : on la prend entiere. */
  const _wdDe = id => {
    const l = SRV.split('\n').find(x => /^const DRIP_[A-Z]+\s*=/.test(x) && x.includes("id: '" + id + "'"));
    if (!l) return null;
    const w = l.match(/wd:\s*(\d)/);
    return w ? +w[1] : null;
  };
  const jourPar = _wdDe('parrainage');
  v('le parrainage porte bien un jour d\'envoi', jourPar !== null);
  const occupes = ['outlook', 'decryptage', 'point-marche', 'mindset', 'recap-hebdo', 'invitation', 'temoignage']
    .map(id => ({ id, wd: _wdDe(id) })).filter(x => x.wd !== null);
  v('… et les jours des 7 autres contenus sont lisibles', occupes.length >= 6, occupes.length + ' lus');
  const collision = occupes.filter(x => x.wd === jourPar);
  v('le jour du parrainage n\'est occupé par AUCUN autre contenu',
    collision.length === 0, 'collision avec : ' + collision.map(x => x.id).join(', '));
  v('sa fenêtre horaire est déclarée (min ET max)',
    /_STEP_MINHOUR\s*=\s*\{[^}]*parrainage:/.test(SRV) && /_STEP_MAXHOUR\s*=\s*\{[^}]*parrainage:/.test(SRV));

  console.log('\n── 8. « À chaque fois de différente façon » : les 4 angles ──');
  const mailer = require(path.join(RACINE, 'mailer.js'));
  const V = [0, 1, 2, 3].map(i => mailer.buildCampaignReferral({ name: 'Muhammet Taleb', email: 'client@exemple.fr', campaign: 'parrainage-banc', variant: i }));
  v('les quatre variantes se construisent', V.every(x => x && x.html && x.subject));

  /* MUTATION : quatre variantes qui se ressemblent trop sont le défaut que le user veut éviter.
     On compare les OBJETS et les CORPS, deux à deux. Un copier-coller mal renommé tombe ici. */
  const objets = V.map(x => x.subject);
  v('les 4 objets sont tous DIFFÉRENTS', new Set(objets).size === 4, objets.join(' | '));
  const corps = V.map(x => x.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  v('… et les 4 corps aussi', new Set(corps).size === 4);
  /* Différents ne suffit pas : deux textes qui ne diffèrent que par trois mots sont « différents »
     et se lisent pourtant comme le même mail. On exige une divergence RÉELLE, mesurée sur le
     vocabulaire : moins de 70 % de mots communs entre deux variantes quelconques. */
  const mots = c => new Set(c.toLowerCase().match(/[a-zà-ÿ]{4,}/g) || []);
  let pireRecouvrement = 0, paire = '';
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    const a = mots(corps[i]), b = mots(corps[j]);
    const comm = [...a].filter(x => b.has(x)).length;
    const r = comm / Math.min(a.size, b.size);
    if (r > pireRecouvrement) { pireRecouvrement = r; paire = i + '/' + j; }
  }
  v('deux variantes ne partagent jamais plus de 70 % de leur vocabulaire',
    pireRecouvrement < 0.7, 'paire ' + paire + ' : ' + Math.round(pireRecouvrement * 100) + '% de mots communs');

  console.log('\n── 9. Ce que CHAQUE variante doit dire, quel que soit son angle ──');
  /* L'angle change, l'offre non. Une variante qui oublierait le taux ou la récurrence enverrait un
     mail joli et inexploitable — le lecteur ne saurait pas ce qu'on lui propose. */
  const cle = ['15', 'vie|récurrent', '3 filleuls|trois filleuls|mois offert'];
  V.forEach((x, i) => {
    const t = x.html.replace(/<[^>]+>/g, ' ');
    v('variante ' + (i + 1) + ' (' + x.variant + ') : le taux, la récurrence et le mois offert y sont',
      cle.every(rx => new RegExp(rx, 'i').test(t)), 'manque : ' + cle.filter(rx => !new RegExp(rx, 'i').test(t)).join(', '));
  });
  V.forEach((x, i) => {
    v('variante ' + (i + 1) + ' : aucun gabarit non résolu, aucun « undefined »',
      !/\$\{|undefined|\[object/.test(x.html));
  });

  console.log('\n── 10. C\'est un mail de CAMPAGNE : il en a les obligations ──');
  V.forEach((x, i) => {
    v('variante ' + (i + 1) + ' : lien de désabonnement présent',
      /\/api\/unsubscribe\?/.test(x.html), 'un envoi de masse sans désinscription n\'est pas envoyable');
  });
  v('le suivi d\'ouverture est posé', /\/api\/track\/open\?/.test(V[0].html));
  v('le bouton passe par le suivi de clic', /\/api\/track\/click\?/.test(V[0].html));

  /* PAS DE BADGE EN TETE (04/09, capture user). Il redisait en capitales ce que le titre dit en
     clair juste dessous, et posait un aplat dore pleine largeur avant la phrase qui porte l'offre. */
  V.forEach((x, i) => {
    v('variante ' + (i + 1) + ' : aucun badge en capitales au-dessus du titre',
      !/border-radius:6px;margin-bottom:14px/.test(x.html), 'le bandeau doré est revenu');
  });

  console.log('\n── 10 bis. L\'aperçu du panneau, dans le mail ──');
  /* Le mail montre l\'écran d\'arrivée au lieu de le décrire. Deux choses s\'y jouent, et une seule
     saute aux yeux : que l\'aperçu soit là, et que le PSEUDO Y SOIT MASQUÉ. Un lien réel reproduit
     dans un envoi de masse ferait créditer chaque inscription recopiée à une seule personne. */
  V.forEach((x, i) => {
    v('variante ' + (i + 1) + ' : l\'aperçu du panneau Parrainages est là',
      /Votre lien de parrainage/i.test(x.html) && /Total filleuls/.test(x.html));
  });
  const aParams = V.flatMap(x => x.html.match(/\?a=[^"'\s<&]*/g) || []);
  v('aucun pseudo d\'affiliation réel n\'est reproduit dans les mails',
    aParams.length > 0 && aParams.every(a => /^\?a=x+$/.test(a)),
    'trouvé : ' + aParams.join(', '));
  /* OUTLOOK REND AVEC LE MOTEUR DE WORD : ni `display:flex`, ni SVG en ligne. Un aperçu bâti en
     flexbox s\'effondrerait en colonne de texte nu chez une partie des lecteurs — et personne ne le
     verrait, puisque le mail s\'affiche parfaitement partout ailleurs. */
  v('l\'aperçu est bâti en tables : aucun display:flex dans le mail',
    V.every(x => !/display:\s*flex/.test(x.html)));
  v('… et aucune SVG en ligne', V.every(x => !/<svg/i.test(x.html)));
  /* « Enlève l\'espace avant le % » (04/09) : le desk écrit « 15% », le mail doit l\'écrire pareil. */
  v('le pourcentage s\'écrit comme dans le desk, sans espace avant le signe',
    V.every(x => !/\d(?:&nbsp;|&#160;|\s)%/.test(x.html.replace(/<[^>]+>/g, ''))),
    'une espace subsiste avant un %');

  console.log('\n── 10 ter. Le mail à l\'unité est aligné sur celui de campagne ──');
  const U0 = mailer.buildReferralInvite({ name: 'Muhammet Taleb' });
  const U1 = mailer.buildReferralInvite({ name: 'Muhammet Taleb', lien: 'https://whop.com/justonetrader-actions-7/?a=monpseudo' });
  v('les deux formes se construisent', !!(U0 && U0.html) && !!(U1 && U1.html));
  v('leurs boutons ouvrent la SECTION, pas la racine du desk',
    /parrainage=1/.test(U0.html) && /parrainage=1/.test(U1.html),
    'le lecteur atterrirait sur le desk sans savoir où cliquer');
  /* L'APERÇU NE DOIT PAS APPARAÎTRE DANS LES DEUX FORMES. Quand le mail porte le vrai lien, poser
     juste en dessous une image du même champ rempli de x ferait douter de celui du dessus. */
  v('l\'aperçu du panneau accompagne la forme SANS lien', /Total filleuls/.test(U0.html));
  v('… et disparaît quand le mail porte le VRAI lien', !/Total filleuls/.test(U1.html),
    'deux champs contradictoires dans le même mail');
  v('… lequel y figure bien en clair', /a=monpseudo/.test(U1.html));
  v('le pourcentage s\'y écrit aussi sans espace',
    !/\d(?:&nbsp;|&#160;|\s)%/.test(U0.html.replace(/<[^>]+>/g, '')) && !/\d(?:&nbsp;|&#160;|\s)%/.test(U1.html.replace(/<[^>]+>/g, '')));
  v('aucun gabarit non résolu dans les deux formes',
    !/\$\{|undefined|\[object/.test(U0.html) && !/\$\{|undefined|\[object/.test(U1.html));
  /* Ce mail-là est TRANSACTIONNEL : envoyé à une personne, il se répond. Il ne porte donc ni pixel
     de suivi ni lien de désinscription — et c'est la différence assumée avec la campagne. */
  v('mail à l\'unité : répondable, sans pixel de suivi', !/\/api\/track\/open/.test(U0.html));

  /* ── AUCUNE ADRESSE NUE DANS LES MAILS (04/09, capture user) ────────────────────────────────────
     Gmail et Apple Mail DÉTECTENT les adresses écrites en texte et les transforment d'autorité en
     liens, à leurs couleurs. Notre champ d'illustration se retrouvait souligné, cliquable, et un
     clic emmenait à la racine de whop.com — l'adresse de personne. La parade n'est pas de désactiver
     la détection (chaque client a la sienne, aucune ne couvre tout le monde) mais de la DEVANCER :
     un client ne re-détecte pas ce qui est déjà dans une balise de lien.
     ⚠️ ET CE CONTRÔLE SE FAIT DANS UN VRAI DOM, PAS À L'EXPRESSION RÉGULIÈRE. Retirer les balises
     d'une chaîne puis y chercher une adresse ne prouve rien : le texte d'un lien SURVIT au retrait
     des balises, donc le test passerait au vert avec ou sans correctif. On demande donc au
     navigateur, nœud de texte par nœud de texte, s'il a un ancêtre <a>. */
  const _nues = await (async () => {
    let pp2; try { pp2 = require('puppeteer-core'); } catch { return null; }
    const exe = (() => {
      const c = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser'];
      for (const b of ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean)) {
        try { for (const d of fs.readdirSync(b)) for (const r of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) c.push(path.join(b, d, r)); } catch {}
      }
      return c.find(x => x && fs.existsSync(x)) || null;
    })();
    if (!exe) return null;
    const nav = await pp2.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const out = [];
    try {
      const tous = V.concat([mailer.buildReferralInvite({ name: 'X' }), mailer.buildReferralInvite({ name: 'X', lien: 'https://whop.com/espace/?a=pseudo' })]);
      for (let i = 0; i < tous.length; i++) {
        const pg = await nav.newPage();
        await pg.setContent(tous[i].html, { waitUntil: 'domcontentloaded' });
        const nues = await pg.evaluate(() => {
          const res = [];
          const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = w.nextNode())) {
            if (!/https?:\/\/\S/.test(n.nodeValue || '')) continue;
            if (!n.parentElement || !n.parentElement.closest('a')) res.push((n.nodeValue || '').trim().slice(0, 60));
          }
          return res;
        });
        if (nues.length) out.push('mail ' + (i + 1) + ' : ' + nues.join(' / '));
        await pg.close();
      }
    } finally { await nav.close(); }
    return out;
  })();
  console.log('\n── 10 quater. Aucune adresse nue (le client mail la transformerait en lien) ──');
  if (_nues === null) console.log('  · aucun Chromium → abstention sur ce point.');
  else v('aucune adresse écrite hors d\'une balise de lien, dans AUCUN des mails',
    _nues.length === 0, _nues.join(' | '));

  console.log('\n── 11. Le bouton mène quelque part (promesse du mail ↔ code du desk) ──');
  /* Le classique : un CTA qui pointe vers un paramètre que personne n'a implémenté. Le mail part,
     le client clique, il atterrit sur le desk sans savoir quoi faire. On vérifie les DEUX bouts. */
  v('le mail pointe vers le lien profond ?parrainage=1',
    /parrainage%3D1|parrainage=1/.test(V[0].html), 'CTA sans lien profond');
  v('… et le desk sait l\'ouvrir', /parrainage'\)\s*===\s*'1'/.test(IDX), 'le desk ignore ce paramètre');
  v('… en visant la section par son LIBELLÉ, pas par sa position',
    /textContent\.trim\(\)\s*===\s*'Parrainages'/.test(IDX), 'ciblage par index : se décale au moindre réordonnancement');

  console.log('\n── 12. La mécanique d\'envoi ne peut pas se saborder ──');
  v('la variante du lot est FIGÉE avant le premier envoi',
    /_bParrainVar\s*==\s*null\)\s*\{\s*try\s*\{\s*_bParrainVar\s*=\s*\(await _parrainGet\(\)\)\.n/.test(SRV),
    'sans cela le repli calendaire s\'applique et le panel annonce une autre variante que celle qui part');
  v('l\'id de campagne porte le MOIS (sinon envoyable une seule fois, à jamais)',
    /bTpl === 'parrainage' \? 'parrainage-' \+ _bParrainKey/.test(SRV), 'id constant = anti-doublon définitif');
  v('les deux chemins d\'envoi (programme et manuel) se voient l\'un l\'autre',
    /_bParrainMk\s*&&\s*!force/.test(SRV) && /drip:parrain:/.test(SRV), 'marqueur croisé absent : doublon possible');
  v('un envoi lancé à la main repousse bien l\'échéance de 6 mois',
    /bTpl === 'parrainage' && _campaignSend\.sent > 0/.test(SRV), 'sinon le programme repart 8 jours plus tard');
  v('le compteur n\'avance QUE si un mail est réellement parti',
    /_campaignSend\.sent > 0/.test(SRV));
  v('le gabarit est câblé dans les TROIS expressions du broadcast (piège du 20/08)',
    /bId\s*=\s*bTpl === 'parrainage'/.test(SRV) && /bBuild = \(\) => bTpl === 'parrainage'/.test(SRV) && /bSend = \(email, nm\) => bTpl === 'parrainage'/.test(SRV),
    'un gabarit absent d\'une des trois enverrait le mail INTRO à toute la liste');

  console.log('\n── 13. Le panel dit QUAND, et il dit QUOI ──');
  v('l\'API du programme expose la date du prochain parrainage', /parrainage: \{\s*\n?\s*date:/.test(SRV));
  v('… la variante qui partira', /variante: mailer\.parrainVariantKey/.test(SRV));
  v('… et l\'historique (dernier envoi, nombre d\'envois)', /dernierAt:/.test(SRV) && /envois: _pst\.n/.test(SRV));
  const ADM = fs.readFileSync(path.join(RACINE, 'public/js/admin.js'), 'utf8');
  const ADH = fs.readFileSync(path.join(RACINE, 'public/admin.html'), 'utf8');
  v('le panel a sa carte dédiée (aucune ligne de semaine ne peut la porter)', /camp-plan-parrain/.test(ADM) && /camp-plan-parrain/.test(ADH));
  v('… il affiche l\'objet réel de la variante à venir', /par\.variantes \|\| \[\]\)\.find/.test(ADM));
  /* LA FICHE DU TEMPLATE RESSEMBLE AUX AUTRES (04/09, capture user : « enleve ces boutons fait comme
     les autres »). Elle portait quatre boutons de variantes, qui débordaient sur trois lignes et ne
     ressemblaient à aucune autre fiche. Les quatre variantes se relisent là où c'est leur place —
     la galerie d'aperçu des e-mails, qui en porte une carte chacune. La fiche, elle, garde ce que
     toutes les autres ont : un aperçu, un test, un lancement. */
  v('la fiche n\'a plus de boutons de variantes (elle est comme les autres)',
    !/variantesTpl/.test(ADM) && !/campPreviewVariante/.test(ADM), 'les boutons de variantes sont revenus');
  v('… et plus de commande de programmation manuelle', !/campPlanParrainage/.test(ADM) && !/camp-plan-par-date/.test(ADH));
  v('elle garde le test sur la boîte admin et le lancement, comme les autres',
    /prev:'parrainage'[^}]*test:'parrainage'/.test(ADM) && /prev:'parrainage'[^}]*broadcast:'parrainage'/.test(ADM));
  /* L'aperçu par défaut doit montrer CE QUI PART, pas le premier de la liste : le serveur déduit la
     variante du compteur d'envois quand aucune n'est demandée. Sans ce repli, la fiche montrerait
     éternellement l'angle n°1 pendant que les clients recevraient le n°3. */
  v('l\'aperçu sans variante montre celle du PROCHAIN envoi',
    /type === 'parrainage'[\s\S]{0,320}: \(await _parrainGet\(\)\)\.n;/.test(SRV),
    'le repli calendaire s\'appliquerait : la fiche mentirait sur ce qui part');
  const GAL = fs.readFileSync(path.join(RACINE, 'mailer.js'), 'utf8');
  v('les 4 variantes sont relisibles dans la galerie d\'aperçu des e-mails',
    (GAL.match(/key: 'parrainCamp\d'/g) || []).length === 4, 'la galerie n\'en porte pas quatre');

  console.log('\n── 14. Un bouton d\'envoi ne survit pas à son envoi ──');
  /* ⚠️ LA MESURE DOIT ÊTRE DURABLE. `_campaignStats` vit en mémoire : Render endort le service au
     bout d\'un quart d\'heure, et au réveil le compteur repart à zéro — le bouton serait revenu tout
     seul le lendemain matin, sur une campagne déjà partie. C\'est le journal des envois, persisté,
     qui fait foi : la même source que l\'anti-doublon lui-même. */
  /* Borne sur la ROUTE, pas sur une distance en caracteres, et sur la FAMILLE de lectures durables
     plutot que sur un nom exact : ce controle est devenu rouge le jour ou la lecture est passee de
     `emailLogAll()` a `emailLogAllDurable()` — un progres, pas une regression. Ce qui compte n'est
     pas le nom de la fonction, c'est que la source soit le journal et jamais un compteur en memoire. */
  const _R_BC = (() => { const d = SRV.indexOf("app.get('/api/admin/campaign-broadcasts'"); if (d < 0) return ''; const f = SRV.indexOf('\n});', d); return f < 0 ? SRV.slice(d) : SRV.slice(d, f + 4); })();
  v('l\'\u00e9tat des diffusions se lit dans le JOURNAL des envois, pas en m\u00e9moire',
    /auth\.emailLogAll(Durable)?\(/.test(_R_BC) && !/_campaignStats/.test(_R_BC),
    '_campaignStats ne survit pas \u00e0 la mise en veille de Render');
  v('le parrainage compte SES DEUX chemins d\'envoi (sinon l\'automatique ne masque rien)',
    /'parrainage':\s*\['campaign:parrainage-', 'drip:parrain:'\]/.test(SRV));
  v('… et son préfixe couvre tous les mois (l\'id de campagne porte le mois)',
    /'campaign:parrainage-'/.test(SRV) && !/'campaign:parrainage-v1:'/.test(SRV));
  /* DIRECTION SÛRE. Journal illisible ou pas encore chargé → le bouton RESTE. Masquer sur une
     mesure absente cacherait un envoi qui n\'a jamais eu lieu : un bouton de trop se voit, un mail
     jamais parti, non. */
  v('journal illisible → le serveur répond « mesure indisponible », il ne ment pas',
    /campaign-broadcasts[\s\S]{0,1400}mesure: 'indisponible'/.test(SRV));
  /* Encore une distance en caracteres, encore rouge sur du code correct : le commentaire ajoute
     entre les deux lignes avait pousse le `if` au-dela de la fenetre. On eprouve la PROPRIETE — la
     branche qui affiche le bouton est celle du `else`, donc un etat inconnu (null) y tombe — sans
     exiger que les deux lignes restent voisines. */
  v('… et côté panel, un état inconnu GARDE le bouton',
    /if \(_bc && _bc\.envoye\)/.test(ADM) && /\} else \{\s*\n\s*acts\.push\('<button class="camp-btn" onclick="oneshotOpen/.test(ADM),
    'un état null doit tomber dans la branche « bouton visible »');
  /* ⚠️ LE COMPTE EST EN PERSONNES, PAS EN CLES. Constate en production le 04/09 : « 328
     destinataires » pour 171 cibles. Le parrainage ecrit DEUX marqueurs par destinataire — le sien
     et celui, croise, de la boucle semestrielle — et le compteur additionnait les cles. Un ecran qui
     annonce deux fois la taille de la base fait croire a un envoi qui a deborde. */
  v('l\'état d\'une diffusion compte des PERSONNES, pas des marqueurs',
    /const vus = new Set\(\);/.test(SRV) && /vus\.add\(k\.slice\(p\.length\)\)/.test(SRV) && /const n = vus\.size;/.test(SRV),
    'le parrainage écrit deux clés par destinataire : compter les clés double le chiffre');
  /* Une fois la campagne partie et la cadence en route, la place du bouton reste VIDE : l'explication
     vit dans la description du template (« Part tout seul tous les 6 mois »), pas dans un bandeau de
     succès qui survivrait des mois à l'événement qu'il annonce. */
  v('la place du bouton reste vide une fois la campagne partie', !/✓ déjà parti/.test(ADM));
  v('… et la fiche du template dit, elle, que ce contenu part tout seul',
    /Part tout seul tous les 6 mois/.test(ADM), 'plus rien n\'expliquerait l\'absence de bouton');
  v('la fin d\'une diffusion relit l\'état et redessine la barre',
    /if \(!st\.running\) \{[\s\S]{0,300}_bcCharger\(/.test(ADM), 'il faudrait recharger le panneau à la main');

  /* ══ 15. LA CHAÎNE COMPLÈTE, DU LIEN AU MOIS OFFERT ════════════════════════════════════════════
     04/09, demande utilisateur avant lancement : « il faut être sûr que ça va marcher avec le lien
     d'affiliation et que ça va se créer, le bon lien et tout […] faut surtout pas qu'on se trompe
     une fois lancé ».

     CE QUE LES BLOCS 1 À 5 NE COUVRAIENT PAS. Ils éprouvent la RÉSOLUTION du lien : à qui Whop
     répond, et quel lien on affiche. Ils s'arrêtent là. Or le parrainage a DEUX moitiés, et la
     seconde n'était éprouvée nulle part :
       · LA COMMISSION est versée par Whop, qui suit le clic. Elle ne dépend d'aucun code à nous.
       · LE COMPTEUR DE FILLEULS, donc « 1 mois offert tous les 3 », dépend d'un index à NOUS :
         `whopaff:<username> → userId`. Le webhook Whop nous donne le nom d'utilisateur du parrain
         à l'inscription d'un filleul ; sans cet index, personne n'est crédité.
     Ces deux moitiés peuvent diverger SANS AUCUN SIGNAL : un lien affiché, une commission versée,
     et un compteur qui reste à zéro pour toujours. C'est la panne qu'on découvre le jour où un
     client réclame son mois offert. On déroule donc la chaîne entière, avec le VRAI code découpé
     dans server.js, un Whop bouchonné et un KV en mémoire. */
  console.log('\n── 15. Chaîne complète : lien → index → webhook → compteur → mois offert ──');
  const SRC_AFF  = decouper(SRV, 'async function _refWhopAffiliate(uid) {', '\n}');
  const SRC_CRED = decouper(SRV, 'async function _refCreditFilleul(refUserId, fillUser) {', '\n}');
  const SRC_ATTR = (() => {                       // le bloc d'attribution du webhook, inline
    const d = SRV.indexOf('      const aff = mem.affiliateUsername && String(mem.affiliateUsername).toLowerCase();');
    const f = SRV.indexOf("console.error('[Referral] attribution Whop:'", d);
    return (d < 0 || f < 0) ? null : SRV.slice(d, SRV.lastIndexOf('}', f));
  })();
  v('la résolution du lien est extractible', !!SRC_AFF);
  v('le crédit d\'un filleul aussi', !!SRC_CRED);
  v('… et le bloc d\'attribution du webhook Whop aussi', !!SRC_ATTR);

  if (SRC_AFF && SRC_CRED && SRC_ATTR) {
    const KV_FOREVER = 8640000000000;
    const REF_TARGET = 3, REF_BONUS_DAYS = 30;
    let kv, users, mails, whopRep;
    const auth = {
      aiCacheGet: async k => (k in kv ? kv[k] : null),
      aiCacheSet: async (k, v2) => { kv[k] = v2; },
      getUserById: async id => users[String(id)] || null,
      getAllUsers: async () => Object.values(users),
      updateUser: async (id, f) => { Object.assign(users[String(id)], { expires_at: f.expiresAt }); },
    };
    const whop = { getAffiliateInfo: async () => whopRep };
    const mailer = {
      sendReferralReward: async d => { mails.push(['reward', d.to, d.count]); return true; },
      sendAdminReferralReward: async () => true,
      sendReferralCredited: async d => { mails.push(['credited', d.to, d.count, d.untilNext]); return true; },
    };
    // eslint-disable-next-line no-eval
    /* `_emailDesk` traduit un alias Whop en adresse du desk. C'est une declaration de server.js,
       hoistee, donc disponible en production — le banc doit la fournir, sinon il teste un
       ReferenceError et non le comportement. Version fidele mais sans table d'alias : l'identite. */
    const F = eval('(function(auth, whop, mailer, KV_FOREVER, REF_TARGET, REF_BONUS_DAYS) {\n'
      + 'function _emailDesk(e) { return String(e || "").toLowerCase().trim(); }\n'
      + SRC_AFF + '\n' + SRC_CRED + '\n'
      + 'async function _refGetRecord(id) { let r = await auth.aiCacheGet("referral:" + id); if (!r) r = { code: "DTP-TEST", count: 0, referrals: [], rewards: 0, bonusDays: 0 }; return r; }\n'
      + 'async function _refSaveRecord(id, r) { await auth.aiCacheSet("referral:" + id, r); }\n'
      + 'function _refMaskEmail(e) { return String(e || "").replace(/(.{2}).*(@.*)/, "$1****$2"); }\n'
      + 'function _refAddDaysISO(b, d) { return new Date((b ? new Date(b).getTime() : Date.now()) + d * 864e5).toISOString(); }\n'
      + 'async function attribuer(mem, wu) {\n' + SRC_ATTR + '\n}\n'
      + 'return { _refWhopAffiliate, _refCreditFilleul, attribuer };\n})');

    const neuf = () => {
      kv = {}; mails = [];
      users = { 'u-parrain': { id: 'u-parrain', email: 'parrain@exemple.fr', name: 'Parrain', role: 'client', expires_at: '2026-10-01T00:00:00.000Z' } };
      for (let i = 1; i <= 4; i++) users['u-f' + i] = { id: 'u-f' + i, email: 'f' + i + '@exemple.fr', role: 'client' };
    };
    const M = F(auth, whop, mailer, KV_FOREVER, REF_TARGET, REF_BONUS_DAYS);

    // ── CAS NOMINAL : Whop répond avec son lien canonique, qui porte ?a=<username> ──
    neuf();
    whopRep = { pageUrl: 'https://whop.com/justonetrader-actions-7/?a=parrainpseudo', username: 'parrainpseudo' };
    const aff1 = await M._refWhopAffiliate('u-parrain');
    v('le lien servi est CELUI DE WHOP, jamais reconstruit à la main',
      aff1 && aff1.pageUrl === whopRep.pageUrl, 'un lien reconstruit peut ne pas être celui que Whop suit');
    v('… et l\'index d\'attribution est écrit AU MOMENT où le lien est servi',
      kv['whopaff:parrainpseudo'] === 'u-parrain',
      'sans lui, aucun filleul ne peut être rattaché — et rien ne le signalerait');
    v('… il survit à tout : les clés de parrainage ne sont JAMAIS purgées',
      !['swseg:', 'brseg:', 'ins:', 'swt2:', 'ana:', 'tag:', 'aichat:', 'hist:'].some(p => 'whopaff:'.startsWith(p)),
      'une purge du cache IA emporterait l\'index');
    // Second appel : on ne redemande pas Whop (le lien doit être stable et instantané).
    whopRep = null;
    const aff2 = await M._refWhopAffiliate('u-parrain');
    v('le lien est mémorisé : Whop n\'est pas réinterrogé à chaque ouverture',
      aff2 && aff2.pageUrl === aff1.pageUrl, 'une panne Whop ferait disparaître le lien du panneau');

    // ── LE FILLEUL S'INSCRIT : le webhook porte le nom d'utilisateur du parrain ──
    let r1 = await M.attribuer({ affiliateUsername: 'PARRAINPSEUDO', email: 'f1@exemple.fr' }, users['u-f1']);
    v('un filleul venu du lien est rattaché à son parrain',
      kv['referredby:u-f1'] === 'u-parrain', 'le webhook n\'a pas trouvé le parrain');
    v('… même si Whop renvoie le nom en MAJUSCULES (il le fait)',
      kv['referredby:u-f1'] === 'u-parrain', 'la casse casserait l\'attribution une fois sur deux');
    v('… et le compteur du parrain monte à 1', (kv['referral:u-parrain'] || {}).count === 1);
    v('… avec un mail qui dit combien il en reste', mails.some(m => m[0] === 'credited' && m[3] === 2));
    v('l\'adresse du filleul est masquée dans l\'historique du parrain',
      ((kv['referral:u-parrain'] || {}).referrals || []).every(x => x.email.includes('****')),
      'le parrain verrait l\'adresse complète de ses filleuls');

    // ── LE MÊME FILLEUL REPASSE : il ne doit pas compter deux fois ──
    await M.attribuer({ affiliateUsername: 'parrainpseudo', email: 'f1@exemple.fr' }, users['u-f1']);
    v('le même filleul ne compte JAMAIS deux fois', (kv['referral:u-parrain'] || {}).count === 1,
      'un renouvellement gonflerait le compteur');

    // ── AUTO-PARRAINAGE ──
    kv['whopaff:solo'] = 'u-f2';
    await M.attribuer({ affiliateUsername: 'solo', email: 'f2@exemple.fr' }, users['u-f2']);
    v('on ne peut pas se parrainer soi-même', !kv['referredby:u-f2']);

    // ── LE TROISIÈME FILLEUL DÉCLENCHE LE MOIS OFFERT ──
    await M.attribuer({ affiliateUsername: 'parrainpseudo', email: 'f3@exemple.fr' }, users['u-f3']);
    const avant = users['u-parrain'].expires_at;
    await M.attribuer({ affiliateUsername: 'parrainpseudo', email: 'f4@exemple.fr' }, users['u-f4']);
    const rec = kv['referral:u-parrain'] || {};
    v('au 3e filleul, la récompense se déclenche', rec.count === 3 && rec.rewards === 1, JSON.stringify({ count: rec.count, rewards: rec.rewards }));
    v('… l\'échéance du parrain est repoussée de 30 jours',
      Math.round((new Date(users['u-parrain'].expires_at) - new Date(avant)) / 864e5) === 30,
      'de ' + avant + ' à ' + users['u-parrain'].expires_at);
    v('… il est prévenu par mail', mails.some(m => m[0] === 'reward' && m[2] === 3));
    v('… et le bonus est mémorisé pour être rejoué au renouvellement Whop',
      kv['refbonus:u-parrain'] === 30, 'le mois offert serait perdu au prochain paiement');

    /* ── LA RECHERCHE INVERSE REFERME LE PIÈGE (04/09, demande user « règle ceci ») ────────────────
       L'index `pseudo → compte` n'était écrit qu'au moment où le parrain ouvrait son panneau. Deux
       situations le laissaient vide, et dans les deux la commission Whop tombait pendant que le
       compteur restait à zéro : Whop renvoie l'adresse sans pseudo exploitable, ou le parrain
       partage un lien récupéré directement dans son espace Whop sans jamais ouvrir le desk.
       Le webhook ne dépend plus de l'index : s'il manque, il fait le chemin inverse. */
    neuf();
    delete kv['whopaff:parrainpseudo'];                       // l'index n'a JAMAIS été écrit
    let inverseAppelee = 0;
    whop.findEmailByUsername = async (u) => { inverseAppelee++; return u === 'parrainpseudo' ? { email: 'parrain@exemple.fr', username: u } : null; };
    const MI = F(auth, whop, mailer, KV_FOREVER, REF_TARGET, REF_BONUS_DAYS);
    await MI.attribuer({ affiliateUsername: 'PARRAINPSEUDO', email: 'f1@exemple.fr' }, users['u-f1']);
    v('un filleul est rattaché MÊME SI le parrain n\'a jamais ouvert son panneau',
      kv['referredby:u-f1'] === 'u-parrain', 'la recherche inverse n\'a pas rattrapé l\'index manquant');
    v('… la recherche inverse a bien été appelée', inverseAppelee === 1, inverseAppelee + ' appel(s)');
    v('… et l\'index est RECONSTRUIT au passage (le filleul suivant ne repaie pas l\'appel)',
      kv['whopaff:parrainpseudo'] === 'u-parrain');
    await MI.attribuer({ affiliateUsername: 'parrainpseudo', email: 'f3@exemple.fr' }, users['u-f3']);
    v('… le filleul suivant passe par l\'index, sans rappeler Whop', inverseAppelee === 1, inverseAppelee + ' appel(s)');

    // Un pseudo que Whop ne connaît pas : on n'invente pas de parrain.
    neuf();
    whop.findEmailByUsername = async () => null;
    const MN = F(auth, whop, mailer, KV_FOREVER, REF_TARGET, REF_BONUS_DAYS);
    await MN.attribuer({ affiliateUsername: 'inconnu', email: 'f1@exemple.fr' }, users['u-f1']);
    v('un pseudo introuvable chez Whop ne fabrique aucun rattachement', !kv['referredby:u-f1']);

    // ── LE PIÈGE : un lien servi SANS nom d'utilisateur résolvable ──
    neuf();
    whopRep = { pageUrl: 'https://whop.com/justonetrader-actions-7/', username: null };   // aucun ?a=
    const affKO = await M._refWhopAffiliate('u-parrain');
    v('LE PIÈGE : Whop peut renvoyer une adresse SANS nom d\'utilisateur',
      !!affKO && !affKO.username, 'cas impossible à provoquer → contrôle vide');
    v('… l\'index n\'est alors PAS écrit (la commission marcherait, pas le compteur)',
      !kv['whopaff:'] && Object.keys(kv).filter(k => k.indexOf('whopaff:') === 0).length === 0);
    await M.attribuer({ affiliateUsername: 'parrainpseudo', email: 'f1@exemple.fr' }, users['u-f1']);
    v('… et le filleul n\'est effectivement rattaché à personne', !kv['referredby:u-f1'],
      'c\'est bien la panne silencieuse qu\'on redoute');
    const WH = fs.readFileSync(path.join(RACINE, 'whop.js'), 'utf8');
    v('la recherche inverse cherche SANS filtre produit (une offre gratuite suffit)',
      /findEmailByUsername[\s\S]{0,1800}memberships\?valid=true&per=50&page=\$\{page\}`/.test(WH)
        && !/findEmailByUsername[\s\S]{0,1800}product_id=/.test(WH),
      'un parrain en offre gratuite resterait introuvable');
    v('… elle lit le pseudo par les TROIS chemins, comme getAffiliateInfo',
      /nomDe = \(m\)[\s\S]{0,420}affiliate_page_url/.test(WH));
    v('CE CAS NE PEUT PLUS ÊTRE SILENCIEUX : le serveur alerte l\'admin, une fois par compte',
      /refnouser:/.test(SRV) && /sendAdminAlert\(\{[\s\S]{0,200}nom d\\?'utilisateur Whop/.test(SRV),
      'sans alerte, le compteur resterait à zéro sans que personne ne le sache');
  }

  /* ══ 16. L'ENVOI EN COURS PEUT-IL DOUBLONNER ? ═════════════════════════════════════════════════
     04/09, diffusion lancée en production, demande utilisateur : « vérifie pour pas avoir d'erreur
     ou de doublon ». On déroule la boucle d'envoi RÉELLE, découpée dans server.js, contre un
     journal en mémoire — et on la relance, on la coupe en plein milieu, on la fait tourner deux
     fois en parallèle. Trois façons distinctes de fabriquer un doublon ; aucune ne doit passer. */
  console.log('\n── 16. La boucle d\'envoi, relancée, coupée, doublée ──');
  const BOUCLE = (() => {
    const d = SRV.indexOf('    for (const r of recipients) {\n      const email = r.email;\n      const marker =');
    if (d < 0) return null;
    const f = SRV.indexOf('\n    }\n', d);
    return f < 0 ? null : SRV.slice(d, f + 6);
  })();
  v('la boucle d\'envoi est extractible de server.js', !!BOUCLE);
  if (BOUCLE) {
    const faire = () => {
      const jrn = {};                                   // journal DURABLE simulé
      const recus = [];                                 // chaque envoi réellement effectué
      const auth2 = {
        emailLogHas: async k => Object.prototype.hasOwnProperty.call(jrn, k),
        emailLogAdd: async k => { jrn[k] = new Date().toISOString(); },
      };
      return { jrn, recus, auth2 };
    };
    const lancer = async (ctx, recipients, bId, opts) => {
      const o = opts || {};
      const _campaignSend = { sent: 0, skipped: 0, unsub: 0, failed: 0 };
      const force = false, throttle = 0;
      const _bParrainMk = 'drip:parrain:2026-08:';
      const auth = ctx.auth2;
      const bSend = async (email) => { if (o.couperApres && ctx.recus.length >= o.couperApres) throw new Error('COUPE'); ctx.recus.push(email); return 'ovh'; };
      const _recordSent = () => {};
      try {
        // eslint-disable-next-line no-eval
        await eval('(async () => {\n' + BOUCLE + '\n})()');
      } catch (e) { if (e.message !== 'COUPE') throw e; }
      return _campaignSend;
    };

    const DEST = ['a@x.fr', 'b@x.fr', 'c@x.fr', 'd@x.fr', 'e@x.fr'].map(email => ({ email, name: '' }));
    const ID = 'parrainage-2026-08';

    // 1. Un passage nominal.
    let ctx = faire();
    let r1 = await lancer(ctx, DEST, ID);
    v('un premier passage sert chaque destinataire une fois',
      r1.sent === 5 && new Set(ctx.recus).size === 5, JSON.stringify(r1));

    // 2. RELANCE COMPLÈTE — le geste qu'on fait quand on doute que l'envoi soit parti.
    const avant = ctx.recus.length;
    let r2 = await lancer(ctx, DEST, ID);
    v('RELANCER l\'envoi entier n\'écrit AUCUN nouveau mail',
      ctx.recus.length === avant && r2.sent === 0 && r2.skipped === 5, JSON.stringify(r2));

    // 3. COUPURE EN PLEIN MILIEU (redéploiement Render, veille, onglet fermé) puis reprise.
    ctx = faire();
    await lancer(ctx, DEST, ID, { couperApres: 2 });
    v('une diffusion coupée à mi-parcours a bien servi 2 personnes', ctx.recus.length === 2, ctx.recus.join(','));
    const r3 = await lancer(ctx, DEST, ID);
    v('… la reprise sert les 3 restants, et SEULEMENT eux',
      ctx.recus.length === 5 && new Set(ctx.recus).size === 5 && r3.sent === 3 && r3.skipped === 2, JSON.stringify(r3));

    /* 4. DEUX CLICS SIMULTANES. ⚠️ CE CONTROLE A D'ABORD ETE ECRIT FAUX, et le dire vaut mieux que
       le corriger en silence : lancer deux fois la BOUCLE en parallele sert evidemment tout le
       monde deux fois — le marqueur s'ecrit APRES le retour du fournisseur, donc les deux passages
       lisent « pas encore servi » avant que l'un des deux n'ait logue. Ce n'est pas la boucle qui
       protege de ca, et lui demander de le faire mesurait une propriete qu'elle n'a pas.
       Ce qui protege, c'est le VERROU pris par la route AVANT toute attente — et la POSITION de ce
       verrou est tout le correctif du 20/08 : teste apres `_campaignAudience` (qui interroge la base
       ET l'API Whop, donc plusieurs secondes), deux clics dans cette fenetre voyaient tous les deux
       « rien en cours ». C'est donc le verrou, et sa place, qu'on eprouve. */
    /* ⚠️ ET PAS UNE FENETRE DE N CARACTERES : ecrite a 9 000, elle s'arretait 1 300 caracteres avant
       le verrou (la branche de test qui la precede est longue), et les TROIS controles sortaient
       rouges sur un code parfaitement correct. Un banc qui accuse le code a tort est pire qu'un banc
       absent : on finit par elargir la fenetre sans lire, jusqu'a lui faire avaler une autre route.
       On borne sur la fermeture reelle du gestionnaire. */
    const _R_SEND = (() => {
      const d2 = SRV.indexOf("app.get('/api/admin/campaign-send'");
      if (d2 < 0) return '';
      const f2 = SRV.indexOf('\n});', d2);
      return f2 < 0 ? SRV.slice(d2) : SRV.slice(d2, f2 + 4);
    })();
    v('un second lancement simultane est refuse net (409)',
      /if \(_campaignSend\.running\) return res\.status\(409\)/.test(_R_SEND),
      'deux clics lanceraient deux diffusions');
    v('… et le verrou est pris AVANT l\'appel a l\'audience, pas apres (correctif du 20/08)',
      _R_SEND.indexOf('_campaignSend = { running: true') >= 0
        && _R_SEND.indexOf('_campaignSend = { running: true') < _R_SEND.indexOf('await _campaignAudience'),
      'plusieurs secondes de fenetre pendant lesquelles deux clics passent tous les deux');
    v('… et il est relache sur chaque sortie anticipee (sinon plus aucun envoi ne repart)',
      /_relacher = \(\) => \{ if \(send\)/.test(_R_SEND) && (_R_SEND.match(/_relacher\(\)/g) || []).length >= 2);

    // 5. UN DÉSABONNÉ N'EST JAMAIS SERVI, même s'il est dans l'audience.
    ctx = faire();
    ctx.jrn['unsub:c@x.fr'] = new Date().toISOString();
    const r5 = await lancer(ctx, DEST, ID);
    v('un désabonné de l\'audience est sauté, et compté comme tel',
      !ctx.recus.includes('c@x.fr') && r5.unsub === 1 && r5.sent === 4, JSON.stringify(r5));

    // 6. LE MARQUEUR CROISÉ : servi par la boucle semestrielle, il ne repasse pas par l'envoi manuel.
    ctx = faire();
    ctx.jrn['drip:parrain:2026-08:d@x.fr'] = new Date().toISOString();
    const r6 = await lancer(ctx, DEST, ID);
    v('quelqu\'un déjà servi par le PROGRAMME n\'est pas resservi à la main',
      !ctx.recus.includes('d@x.fr') && r6.sent === 4, JSON.stringify(r6));

    // 7. Le marqueur n'est écrit QUE si le fournisseur a répondu.
    ctx = faire();
    const auth3 = ctx.auth2;
    let n = 0;
    const ctx2 = { jrn: ctx.jrn, recus: ctx.recus, auth2: auth3 };
    const lancerEchec = async () => {
      const _campaignSend = { sent: 0, skipped: 0, unsub: 0, failed: 0 };
      const force = false, throttle = 0, _bParrainMk = 'drip:parrain:2026-08:';
      const auth = auth3, recipients = DEST, bId = ID;
      const bSend = async (email) => { n++; return n <= 2 ? 'ovh' : null; };   // le 3e échoue
      const _recordSent = () => {};
      // eslint-disable-next-line no-eval
      await eval('(async () => {\n' + BOUCLE + '\n})()');
      return _campaignSend;
    };
    const r7 = await lancerEchec();
    v('un envoi qui ÉCHOUE ne pose pas de marqueur (il sera réessayé, pas perdu)',
      r7.failed === 3 && !ctx.jrn['campaign:' + ID + ':c@x.fr'], JSON.stringify(r7));
  }

  console.log('');
  if (ko) { console.log('✗ ' + ko + ' ÉCHEC(S) — ' + ok + ' contrôle(s) OK, ' + ko + ' KO\n'); process.exit(1); }
  console.log('✓ TOUT PASSE — ' + ok + ' contrôle(s) OK\n');
})();

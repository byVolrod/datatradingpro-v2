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

  console.log('');
  if (ko) { console.log('✗ ' + ko + ' ÉCHEC(S) — ' + ok + ' contrôle(s) OK, ' + ko + ' KO\n'); process.exit(1); }
  console.log('✓ TOUT PASSE — ' + ok + ' contrôle(s) OK\n');
})();

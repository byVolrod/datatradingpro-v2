#!/usr/bin/env node
/* ═══ LA CHAÎNE DE NOTIFICATIONS PUSH DE L'APP MOBILE ══════════════════════════════════════════
   09/09. La coquille native savait déjà demander l'autorisation de notifier et produire un jeton
   Expo — mais PERSONNE ne le ramassait : ni le desk, ni le serveur. Le jeton naissait et mourait
   dans la WebView. Aucune alerte ne pouvait donc arriver écran verrouillé, alors que c'est la
   raison d'être de l'app ET la capacité native sur laquelle repose son passage en revue Apple.

   ⚠️ CE BANC EXTRAIT LES VRAIES FONCTIONS de server.js et lit le VRAI App.js. Il n'en recopie
   aucune : une copie resterait verte le jour où l'original change.
   ⚠️ IL VÉRIFIE AUSSI CE QUI N'EST PAS DANS UN SEUL FICHIER — l'accord entre le canal Android
   déclaré par la coquille et celui que le serveur envoie. Un désaccord ne lève AUCUNE erreur :
   la notification part, arrive, et atterrit dans le canal par défaut, sans le son ni l'importance
   HIGH qu'on a pris soin de configurer. C'est exactement le genre de défaut qu'aucun des deux
   fichiers ne peut voir tout seul. */
const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
const NAT = fs.readFileSync(path.join(RACINE, 'mobile/App.js'), 'utf8');
let ok = 0, ko = 0;
const _attentes = [];
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + String(d).slice(0, 300) : '')); } };
const fn = (src, nom) => { const m = new RegExp('function ' + nom + '\\([\\s\\S]*?\\n\\}').exec(src); return m ? m[0] : null; };
const cst = (src, nom) => { const m = new RegExp('const ' + nom + ' = ([^;\\n]+);').exec(src); return m ? m[1] : null; };
// Une constante qui s'étend sur plusieurs lignes (objet littéral) : jusqu'au « }; » qui la ferme.
const cstBloc = (src, nom) => { const m = new RegExp('const ' + nom + ' = (\\{[\\s\\S]*?\\});').exec(src); return m ? m[1] : null; };

console.log('\n── 1. Le jeton : ce qu\'on accepte de stocker ──');
const srcRx = cst(SRV, '_PUSH_RX_JETON');
v('_PUSH_RX_JETON est extractible', !!srcRx);
if (srcRx) {
  const rx = eval('(' + srcRx + ')');
  v('un vrai jeton Expo passe', rx.test('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]'));
  v('… sous sa forme moderne aussi', rx.test('ExpoPushToken[AbC-123_x.y%z]'));
  /* Le jeton finit dans un JSON envoyé à un tiers ET dans une clé KV : tout ce qui n'est pas un
     jeton doit être refusé À L'ENTRÉE, pas assaini plus loin. */
  v('une chaîne quelconque est refusée', !rx.test('bonjour'));
  v('un préfixe approchant est refusé', !rx.test('ExpoToken[abc]') && !rx.test('PushToken[abc]'));
  v('une tentative d\'injection est refusée', !rx.test('ExponentPushToken[a"],{"to":"b'));
  v('un jeton non fermé est refusé', !rx.test('ExponentPushToken[abc'));
  v('le vide est refusé', !rx.test('') && !rx.test('ExponentPushToken[]'));
}

console.log('\n── 2. Le plafond horaire : on se tait plutôt que de vider une batterie ──');
const srcPlafond = fn(SRV, '_pushSousPlafond'), srcMax = cst(SRV, 'PUSH_MAX_HEURE');
v('_pushSousPlafond est extractible', !!srcPlafond && !!srcMax);
if (srcPlafond && srcMax) {
  const PUSH_MAX_HEURE = eval(srcMax);
  const _pushHoraire = new Map();
  const _pushSousPlafond = eval('(' + srcPlafond + ')');
  v('le plafond est un nombre raisonnable', PUSH_MAX_HEURE >= 1 && PUSH_MAX_HEURE <= 20, String(PUSH_MAX_HEURE));
  v('une première alerte passe', _pushSousPlafond('u1', 1) === 1);
  /* On demande PLUS que le plafond d'un coup : la fonction doit rendre la place RESTANTE, pas
     tout accepter ni tout refuser. C'est le jour de FOMC + NFP + CPI. */
  const reste = _pushSousPlafond('u2', PUSH_MAX_HEURE + 5);
  v('une rafale est écrêtée au plafond, pas rejetée', reste === PUSH_MAX_HEURE, String(reste));
  v('… et le compte est ensuite saturé', _pushSousPlafond('u2', 1) === 0);
  v('un AUTRE compte n\'est pas affecté', _pushSousPlafond('u3', 1) === 1);
  /* La fenêtre est GLISSANTE et purgée à la lecture : sans ça le compte reste saturé à vie. */
  _pushHoraire.set('u4', Array.from({ length: PUSH_MAX_HEURE }, () => Date.now() - 3700000));
  v('des envois vieux d\'une heure ne comptent plus', _pushSousPlafond('u4', 1) === 1);
  /* ⚠️ JAMAIS DE NÉGATIF. L'appelant teste `if (!place) continue` : un nombre négatif est TRUTHY,
     donc un compte au-delà du plafond franchirait le plafond. C'est ce que garde la sortie
     anticipée, qui a l'air redondante avec le `Math.min` et ne l'est pas. */
  _pushHoraire.set('u5', Array.from({ length: PUSH_MAX_HEURE + 3 }, () => Date.now()));
  const negatif = _pushSousPlafond('u5', 1);
  v('un compte au-delà du plafond rend 0, jamais un négatif', negatif === 0, String(negatif));
  v('… et la mémoire ne garde pas les périmés', (_pushHoraire.get('u4') || []).length === 1, JSON.stringify(_pushHoraire.get('u4')));
}

console.log('\n── 3. Le texte et la catégorie ──');
const srcTexte = fn(SRV, '_pushTexte');
const _mClef = /const _pushClef = (it => \{[\s\S]*?\n\});/.exec(SRV), _mRx = /const _PUSH_RX_DONNEE = (\/.*\/i);/.exec(SRV);
const srcClef = _mClef && _mRx ? '(() => { const _PUSH_RX_DONNEE = ' + _mRx[1] + '; return ' + _mClef[1] + '; })()' : null;
v('_pushTexte est extractible', !!srcTexte);
if (srcTexte) {
  // _pushTexte s'appuie sur _pushClef et la table des thèmes : on les extrait avec lui.
  const _pushTexte = new Function('const _looksFr = t => /[éèàùçêâô]|\\b(le|la|les|des|du|une?)\\b/i.test(t); const _pushClef = ' + (srcClef || '() => "news"') + '; const _PUSH_THEME = ' + (cstBloc(SRV, '_PUSH_THEME') || '{}') + '; ' + (fn(SRV, '_pushProvenance') || '') + '; return (' + srcTexte + ');')();
  const premiere = t => String(t.body).split('\n')[0];
  const court = _pushTexte({ headline: 'US CPI 3.2% vs 3.1% expected' });
  /* Format « notification d'app » (25/09, capture de référence « URGENT / Alerte pour NZDCHF ») : le
     téléphone affiche déjà le nom de l'app, le titre dit la NATURE de l'alerte, puis son thème quand
     il renseigne (« rédige bien le nom des notifs »). */
  /* TITRE = NOM DU WIDGET + DESCRIPTION (25/09, « faut nom du widget + description ») : le titre dit
     d'abord QUEL widget du desk porte l'alerte, puis sa nature. */
  v('une donnée chiffrée s’intitule « Fil d’actualité · Chiffre »', court.title === 'Fil d’actualité · Chiffre', court.title);
  v('une dépêche urgente s’intitule « Fil d’actualité · Urgent »', _pushTexte({ headline: 'Iran closes Hormuz', urgent: true }).title === 'Fil d’actualité · Urgent');
  v('… avec son thème quand il renseigne', _pushTexte({ headline: 'Iran closes Hormuz', urgent: true, category: 'Geopolitical' }).title === 'Fil d’actualité · Urgent · Géopolitique');
  v('une autre dépêche majeure : « Fil d’actualité · Actualité majeure »', _pushTexte({ headline: 'Trump parle de l’Iran' }).title === 'Fil d’actualité · Actualité majeure');
  v('… « Fil d’actualité · Énergie » pour une dépêche énergie', _pushTexte({ headline: 'Opec cuts output', category: 'Energy & Power' }).title === 'Fil d’actualité · Énergie');
  v('une catégorie générique n’ajoute rien au titre', _pushTexte({ headline: 'Trump parle', category: 'Global News' }).title === 'Fil d’actualité · Actualité majeure');
  /* LA DESCRIPTION suit le titre de la dépêche, en français seulement. */
  const avecDesc = _pushTexte({ headline: 'Gold falls in India', _descFr: 'Le prix de l’or en Inde a baissé vendredi.' }, 'L’or recule en Inde');
  v('la description traduite suit la dépêche (2e ligne)', avecDesc.body.split('\n')[1] === 'Le prix de l’or en Inde a baissé vendredi.', avecDesc.body);
  v('… et la provenance reste la dernière ligne', avecDesc.body.split('\n')[2] === 'Fil d’actualité DTP', avecDesc.body);
  const descEn = _pushTexte({ headline: 'Gold falls', _descFr: 'Gold price in India fell on Friday.' }, 'L’or recule', null);
  v('une description anglaise ne part JAMAIS', !/Gold price/.test(descEn.body), descEn.body);
  const redite = _pushTexte({ headline: 'US and Iran agree', _descFr: 'Les États-Unis et l’Iran ont conclu un accord de paix pour mettre fin à la guerre.' }, 'Les États-Unis et l’Iran s’accordent sur un accord de paix pour mettre fin à la guerre');
  v('une description qui redit le titre ne prend pas de ligne (capture du 25/09)', redite.body.split('\n').length === 2, redite.body);
  v('le corps porte la dépêche', premiere(court) === 'US CPI 3.2% vs 3.1% expected', court.body);
  /* PROVENANCE (25/09, capture user : six notifications sans source). Un média nommé en suffixe
     quitte le texte et passe sur sa propre ligne ; sans média, la provenance est le fil DTP. */
  const rt = _pushTexte({ headline: 'Trump says tariffs on China will rise - Reuters' });
  v('un média en suffixe devient la provenance (« Source : Reuters »)', rt.body.split('\n')[1] === 'Source : Reuters', rt.body);
  v('… et quitte le texte de la dépêche', premiere(rt) === 'Trump says tariffs on China will rise', rt.body);
  v('« according to Bloomberg » est reconnu, la phrase reste intacte', /Source : Bloomberg$/.test(_pushTexte({ headline: 'Fed to cut in December, according to Bloomberg survey' }).body));
  v('sans média nommé : « Fil d’actualité DTP »', court.body.split('\n')[1] === 'Fil d’actualité DTP', court.body);
  v('la traduction passée en second argument est celle qui s’affiche', premiere(_pushTexte({ headline: 'Oil jumps' }, 'Le pétrole bondit')) === 'Le pétrole bondit');
  v('… en français quand la traduction est prête', premiere(_pushTexte({ headline: 'Oil jumps', _titreFr: 'Le pétrole bondit' })) === 'Le pétrole bondit');
  /* iOS tronque une notification longue SANS prévenir : mieux vaut couper nous-mêmes et le dire
     par une ellipse que laisser le système couper au milieu d'un chiffre. */
  const long = _pushTexte({ headline: 'x'.repeat(400) });
  v('une dépêche trop longue est coupée', premiere(long).length <= 150, String(premiere(long).length));
  v('… et la coupe se voit', /…$/.test(premiere(long)));
  v('les retours à la ligne du titre sont aplatis', premiere(_pushTexte({ headline: 'a\n\n  b' })) === 'a b');
  v('un item sans titre ne produit pas de corps fantôme', _pushTexte({}).body === '');
}
if (srcClef) {
  const _pushClef = eval('(' + srcClef + ')');
  /* ⚠️ ON NE RECOPIE PAS `_npKind` CÔTÉ SERVEUR : une copie de la taxonomie client aurait divergé.
     Le push ne peut porter QUE deux des cinq clés, et le contrôle l'épingle. */
  const clefs = new Set([{ headline: 'US CPI 3.2%' }, { headline: 'Trump parle de l\'Iran' }, {}].map(_pushClef));
  v('le push ne projette que sur « eco » et « news »', [...clefs].every(k => k === 'eco' || k === 'news'), [...clefs].join(','));
  v('une dépêche chiffrée est « eco »', _pushClef({ headline: 'US CPI 3.2%' }) === 'eco');
  v('une dépêche sans chiffre est « news »', _pushClef({ headline: 'Trump parle de l\'Iran' }) === 'news');
  /* Capture du 25/09 : un nombre ne fait pas une publication de donnée. */
  v('« Gold slides 3% as Middle East escalation… » n’est PAS un chiffre économique', _pushClef({ headline: 'Gold slides 3% as Middle East escalation fuels inflation, rate-hike concerns' }) === 'news');
  v('« Convergence mondiale des risques… septembre » non plus', _pushClef({ headline: 'Global market risk convergence in September: Fed, BOJ and ECB decisions the same week' }) === 'news');
  v('… mais « US Core PCE 2.9% vs expected 2.8% » en est un', _pushClef({ headline: 'US Core PCE 2.9% vs expected 2.8%' }) === 'eco');
}

console.log('\n── 4. L\'envoi : ce qui part, et ce qui ne part jamais deux fois ──');
const srcEnvoi = fn(SRV, '_pushEnvoyer') || '';
v('_pushEnvoyer est extractible', !!srcEnvoi);
v('seul le tier-1 déclenche un push', /_highImpact === true/.test(srcEnvoi), srcEnvoi.slice(0, 200));
/* Le cycle de news REDIFFUSE un item quand il est enrichi (analyse, impact, traduction) : sans
   verrou, la même publication réveillerait le téléphone trois fois dans l'heure. */
v('un item n\'est poussé qu\'une fois', /_pushDejaVus\.has\(it\.id\)/.test(srcEnvoi) && /_pushDejaVus\.add\(it\.id\)/.test(srcEnvoi));
v('… et l\'ensemble des vus est borné', /_pushDejaVus\.size > \d+/.test(srcEnvoi));
/* Depuis le 25/09, les dépêches et les publications passent par UN routeur commun (_pushRouter) :
   réglages du compte, familles choisies, pauses, plafond. On l'éprouve ici. */
const srcRouteur = fn(SRV, '_pushRouter') || '';
v('_pushEnvoyer confie l’envoi au routeur commun', /_pushRouter\(evts\)/.test(srcEnvoi));
v('le réglage du compte est respecté', /cfg\.enabled === false \|\| cfg\.push === false/.test(srcRouteur));
v('… et les familles cochées par le client', /prefs\.cats\.includes\(e\.cat\)/.test(srcRouteur));
v('… sans préférence, les catégories coupées au panneau Filtre valent toujours', /catsOff/.test(fn(SRV, '_pushPrefs') || ''));
v('le plafond horaire s’applique après le tri', /_pushSousPlafond\(uid, directs\.length\)/.test(srcRouteur));
v('un jeton mort est retiré du compte', /DeviceNotRegistered/.test(SRV) && /morts/.test(fn(SRV, '_pushExpedier') || ''));
v('l\'annuaire n\'est JAMAIS énuméré à l\'envoi', !/getAllUsers/.test(srcEnvoi + srcRouteur), srcRouteur.slice(0, 200));
v('… c\'est un index dédié qui est lu', /_pushIndex\(\)/.test(srcRouteur) && /pushusers/.test(SRV));
v('un chiffre du calendrier frais n’est pas doublé par sa dépêche', /cat === 'eco' && _pushCalFrais\(\)/.test(srcEnvoi));
v('un verrou de réentrance protège le cycle', /_pushBusy/.test(srcEnvoi));
v('l\'appel à Expo porte un délai de garde', /AbortController/.test(fn(SRV, '_pushExpo') || ''));
v('l\'envoi est branché sur le cycle de news', /_pushEnvoyer\(added\)\.catch/.test(SRV));
v('… hors du chemin de diffusion (il ne retarde pas le fil)', /broadcast\(\{ type: 'news_update', items: added[\s\S]{0,400}?_pushEnvoyer\(added\)\.catch/.test(SRV));
v('les deux routes d\'abonnement existent', /app\.post\('\/api\/push\/token'/.test(SRV) && /app\.post\('\/api\/push\/stop'/.test(SRV));
/* TEMPS RÉEL (25/09, « il y a un décalage quand la news sort ») : les dépêches FinancialJuice arrivent
   par le WebSocket et deux boucles rapides, qui DIFFUSAIENT au desk sans jamais notifier ; seul le
   cycle de 60 s notifiait, et il ne voyait plus ces dépêches (déjà fusionnées). */
{
  const chemins = [/console\.log\(`\[FJ LIVE →\][^\n]*\n\s*_pushEnvoyer\(added\)/, /\[FJ fast-poll\][^\n]*\n\s*_pushEnvoyer\(added\)/, /startFFNewsPoll\([\s\S]{0,260}?_pushEnvoyer\(added\)/, /_pushEnvoyer\(added\)\.catch\(\(\) => \{\}\);\n\n  \/\* ORDRE D'APPEL/];
  v('les QUATRE chemins d’arrivée notifient (WebSocket FJ, boucle FJ, boucle FF-News, cycle complet)', chemins.every(r => r.test(SRV)), chemins.map(r => r.test(SRV) ? 1 : 0).join(''));
  const srcA = fn(SRV, '_pushAlertable');
  v('_pushAlertable est extractible', !!srcA);
  if (srcA) {
    const T0 = Date.now();
    const al = new Function('const PUSH_FRAICHEUR_MS = 15 * 60e3; const _pushDemarrage = ' + (T0 - 3600e3) + '; return (' + srcA + ');')();
    v('une dépêche de 2 min part', al({ headline: 'Fed hikes rates', timestamp: T0 - 120e3 }, T0));
    v('une dépêche de 3 h ne part JAMAIS (l’accord États-Unis/Iran « maintenant », capture)', !al({ headline: 'US, Iran reach peace deal', timestamp: T0 - 3 * 3600e3 }, T0));
    v('… ni une dépêche sans date', !al({ headline: 'x' }, T0));
    v('… ni une analyse de fond (titre de plus de 170 caractères)', !al({ headline: 'x'.repeat(200), timestamp: T0 - 60e3 }, T0));
    const alBoot = new Function('const PUSH_FRAICHEUR_MS = 15 * 60e3; const _pushDemarrage = ' + (T0 - 30e3) + '; return (' + srcA + ');')();
    v('juste après un redémarrage, ce qui précède le démarrage est appris, pas renvoyé', !alBoot({ headline: 'Oil falls', timestamp: T0 - 5 * 60e3 }, T0));
    v('… mais ce qui arrive après le démarrage part', alBoot({ headline: 'Oil falls', timestamp: T0 - 5e3 }, T0));
  }
  const srcE = fn(SRV, '_pushEnvoyer') || '';
  v('français ou rien : sans traduction après deux essais, la dépêche ne part pas', /if \(!_looksFr\(fr\)\) fr = await _pushFr\(it\)/.test(srcE) && /if \(!_looksFr\(fr\)\) \{[^}]*continue; \}/.test(srcE));
}
/* PLUS D'ABONNEMENT = PLUS DE NOTIFICATION (25/09). Même règle que la connexion : actif, échéance
   + 24 h de grâce, l'équipe jamais coupée. On JOUE la vraie fonction, avec ses témoins. */
{
  const srcAb = fn(SRV, '_pushAbonneDe');
  v('_pushAbonneDe est extractible', !!srcAb);
  if (srcAb) {
    const auth = { isStaff: r => r === 'admin' };
    const ab = new Function('auth', 'const PUSH_GRACE_MS = 24 * 3600e3; return (' + srcAb + ');')(auth);
    const n = Date.now(), jour = 24 * 3600e3;
    v('un abonné actif à échéance future reçoit', ab({ active: true, expires_at: new Date(n + 5 * jour).toISOString() }, n) === true);
    v('un compte SUSPENDU ne reçoit plus rien', ab({ active: false, expires_at: new Date(n + 5 * jour).toISOString() }, n) === false);
    v('un abonnement EXPIRÉ depuis 2 jours ne reçoit plus rien', ab({ active: true, expires_at: new Date(n - 2 * jour).toISOString() }, n) === false);
    v('… mais la grâce de 24 h vaut comme à la connexion', ab({ active: true, expires_at: new Date(n - 3600e3).toISOString() }, n) === true);
    v('l’équipe n’est jamais coupée', ab({ role: 'admin', active: false, expires_at: new Date(n - 9 * jour).toISOString() }, n) === true);
    v('un compte introuvable (supprimé) ne reçoit rien', ab(null, n) === false);
  }
  v('le routeur trie les comptes sur leur abonnement', /await _pushAbonne\(uid\)/.test(srcRouteur));
  v('… et un récap de fin de pause aussi', /_pushAbonne\(uid\)/.test(fn(SRV, '_pushVider') || ''));
  v('les appareils Web Push sont servis en parallèle', /Promise\.all\(envois/.test(fn(SRV, '_pushExpedier') || ''));
}
v('… et exigent une session', (SRV.match(/app\.post\('\/api\/push\/(?:token|stop)'[\s\S]{0,160}?req\.session\?\.userId/g) || []).length === 2);

console.log('\n── 4 bis. Pas d’inondation : doublons, pauses, regroupement, son et vibreur ──');
{
  const PUSH_CATS = eval('(' + cstBloc(SRV, 'PUSH_CATS') + ')');
  v('cinq familles, et seulement celles demandées', Object.keys(PUSH_CATS).join(',') === 'news,eco,risque,banques,analystes', Object.keys(PUSH_CATS).join(','));
  const _PUSH_CATS_K = Object.keys(PUSH_CATS);
  const mPP = /const _pushPrefsPropres = (b => \(\{[\s\S]*?\}\));/.exec(SRV);
  v('_pushPrefsPropres est extractible', !!mPP);
  // Les listes de valeurs admises font partie de la tranche : sans elles, le banc éprouverait une
  // fonction amputée de ses dépendances (contrat d'extraction, CLAUDE.md du 10/09).
  const mFil = /const _PUSH_FIL = [^\n]+/.exec(SRV);
  v('les valeurs admises des réglages fins sont extractibles', !!mFil);
  const _pushPrefsPropres = new Function('_PUSH_CATS_K', (mFil ? mFil[0] : '') + '\nreturn (' + (mPP ? mPP[1] : '() => ({})') + ');')(_PUSH_CATS_K);
  v('sans réglage, tout est coché, son et vibreur compris, réglages fins au plus large',
    JSON.stringify(_pushPrefsPropres({})) === JSON.stringify({ cats: _PUSH_CATS_K, son: true, vibreur: true, fil: 'tout', recaps: 'tous', banques: [] }), JSON.stringify(_pushPrefsPropres({})));
  v('… un réglage fin inconnu retombe sur le plus large (on reçoit trop, jamais rien)', _pushPrefsPropres({ fil: 'pirate', recaps: 3 }).fil === 'tout' && _pushPrefsPropres({ recaps: 3 }).recaps === 'tous');
  v('… la liste de banques est nettoyée et bornée', JSON.stringify(_pushPrefsPropres({ banques: ['ING', 'ING', '<b>x</b>', 7, ''] }).banques) === '["ING","bx/b"]', JSON.stringify(_pushPrefsPropres({ banques: ['ING', 'ING', '<b>x</b>', 7, ''] }).banques));
  v('une famille inconnue envoyée par un client est écartée', _pushPrefsPropres({ cats: ['news', 'pirate'] }).cats.join() === 'news');
  v('son et vibreur se coupent', _pushPrefsPropres({ son: false, vibreur: false }).son === false && _pushPrefsPropres({ vibreur: false }).vibreur === false);

  /* `_pushLien` (25/09 : un toucher sur la notification ouvre l'élément) est appelé par `_pushResume` :
     il doit entrer dans l'assemblage, sans quoi le banc éprouve une fonction amputée de sa dépendance. */
  const outils = new Function(fn(SRV, '_pushMots') + '\nconst _pushRecents = [];\n' + fn(SRV, '_pushDoublon') + '\nconst PUSH_CATS = ' + cstBloc(SRV, 'PUSH_CATS') + ';\nconst _pushLien = ' + cst(SRV, '_pushLien') + ';\n' + fn(SRV, '_pushResume') + '\n' + fn(SRV, '_pushMessage') + '\nreturn { _pushDoublon, _pushResume, _pushMessage };')();
  const t0 = Date.now();
  const e1 = { cat: 'news', id: 'a', body: 'Iran and United States resume talks over Strait of Hormuz shipping deal' };
  const e2 = { cat: 'news', id: 'b', body: 'United States and Iran resume talks over Hormuz shipping deal, sources say' };
  const e3 = { cat: 'news', id: 'c', body: 'Bank of Japan keeps policy rate unchanged at 0.75 percent' };
  v('une première dépêche passe', !outils._pushDoublon(e1, t0));
  v('la même nouvelle, reformulée par une autre source, ne sonne pas deux fois', outils._pushDoublon(e2, t0 + 60e3));
  v('un autre sujet passe', !outils._pushDoublon(e3, t0 + 90e3));
  v('une dépêche URGENTE passe toujours', !outils._pushDoublon(Object.assign({}, e2, { urgent: true }), t0 + 120e3));
  v('trois heures plus tard, le sujet peut revenir', !outils._pushDoublon(Object.assign({}, e2, { id: 'd' }), t0 + 4 * 3600e3));
  const lot = outils._pushResume('banques', [{ id: '1', court: 'Goldman Sachs', body: 'EUR/USD' }, { id: '2', court: 'ING', body: 'GBP' }, { id: '3', court: 'Nomura', body: 'JPY' }]);
  v('trois rapports de banques pendant la pause → une seule notification', lot.title === 'Banques · 3 rapports de banques', lot.title);
  v('… qui les nomme', lot.body === 'Goldman Sachs · ING · Nomura', lot.body);
  v('… et qui ouvre la bonne rubrique au toucher', lot.url === '/?ouvrir=banques', String(lot.url));
  v('… et une seule publication reste elle-même', outils._pushResume('banques', [e3]) === e3);
  const avec = outils._pushMessage(e3, { son: true, vibreur: true }).web, sans = outils._pushMessage(e3, { son: false, vibreur: true }).web, muet = outils._pushMessage(e3, { son: true, vibreur: false }).web;
  v('son + vibreur : le navigateur vibre', avec.silent === false && Array.isArray(avec.vibrate) && avec.vibrate.length > 0);
  v('son coupé : notification silencieuse, et JAMAIS « silent » avec « vibrate » (Chrome la refuserait)', sans.silent === true && !('vibrate' in sans));
  v('vibreur coupé : aucune vibration', muet.silent === false && Array.isArray(muet.vibrate) && muet.vibrate.length === 0);
  v('l’app native reçoit le son choisi', outils._pushMessage(e3, { son: false }).expo.sound === null && outils._pushMessage(e3, { son: true }).expo.sound === 'default');

  const srcR = fn(SRV, '_pushRouter') || '';
  v('une pause par famille met de côté au lieu de sonner', /_pushAttente\.set\(k, f\)/.test(srcR) && /PUSH_PAUSE_MS\[pk\]/.test(srcR) && /const pk = e\.pause \|\| e\.cat/.test(srcR));
  v('… une urgence a sa propre pause, courte (une rafale d’urgences ne sonne pas six fois)', /urgente \? PUSH_PAUSE_URGENT_MS/.test(srcR) && +cst(SRV, 'PUSH_PAUSE_URGENT_MS').replace(/\s*\*\s*60e3/, '') * 60e3 <= 3 * 60e3);
  v('… et la suite d’une histoire déjà notifiée perd son passe-droit', /e\.urgent && !e\.suite/.test(srcR));
  const sujet = new Function(fn(SRV, '_pushEntites') + '\nconst _pushHistoires = [];\n' + fn(SRV, '_pushMemeSujet') + '\nreturn { _pushEntites, _pushMemeSujet };')();
  const T = Date.now(), cap = ['US, Iran reach peace deal, signing set for Friday, Pakistan says', 'U.S. and Iran agree on peace deal to end the war, Pakistan Prime Minister Shehbaz Sharif says', 'World leaders welcome U.S.-Iran deal as Europe signals sanctions relief, urges Hormuz reopening', 'ECB\'s Nagel says no inflation relief in sight even if Hormuz Strait reopens soon'];
  v('capture du 25/09 : la première dépêche ouvre l’histoire', !sujet._pushMemeSujet(sujet._pushEntites(cap[0]), T));
  v('… la même nouvelle par une autre source est reconnue comme sa suite', sujet._pushMemeSujet(sujet._pushEntites(cap[1]), T + 1000));
  v('… un sujet sans rapport ouvre sa propre histoire', !sujet._pushMemeSujet(sujet._pushEntites('Bank of Japan keeps rates unchanged, Ueda signals patience'), T + 2000));
  v('… et 45 minutes plus tard, l’histoire est close', !sujet._pushMemeSujet(sujet._pushEntites(cap[1]), T + 50 * 60e3));
  v('… et ce qui a été mis de côté part en récapitulatif', /_pushResume\(cat, f\.lot\)/.test(fn(SRV, '_pushVider') || '') && /setInterval\(\(\) => \{ _pushVider\(\)/.test(SRV));
  const PAUSE = eval('(' + cst(SRV, 'PUSH_PAUSE_MS') + ')');
  v('un chiffre du calendrier n’attend jamais (chacun est distinct)', PAUSE.eco === 0);
  /* LE FIL PARTAGE UNE PAUSE (25/09, capture : quatre notifications « maintenant » d'un coup). */
  v('le fil (actualités ET chiffres du fil) partage une seule pause de 5 min', PAUSE.fil === 5 * 60e3 && /pause: 'fil'/.test(fn(SRV, '_pushEnvoyer') || ''));
  v('… et son récapitulatif retrouve sa vraie famille', /cat === 'fil'/.test(fn(SRV, '_pushResume') || ''));
  v('les rapports de banques et d’analystes sont regroupés', PAUSE.banques >= 15 * 60e3 && PAUSE.analystes >= 15 * 60e3);

  const _RISK_NIV = eval('(' + cstBloc(SRV, '_RISK_NIV') + ')');
  const _pushBascule = new Function('_RISK_NIV', 'return (' + fn(SRV, '_pushBascule') + ');')(_RISK_NIV);
  const H = 3600e3;
  v('neutre → risk-off : bascule franche, notifiée', _pushBascule('NEUTRAL', 'RISK-OFF', 10 * H, 0));
  v('risk-on → risk-off marqué : notifiée', _pushBascule('RISK-ON', 'STRONG RISK-OFF', 10 * H, 0));
  v('neutre → risk-off léger : pas assez franc, tu', !_pushBascule('NEUTRAL', 'WEAK RISK-OFF', 10 * H, 0));
  v('risk-off → risk-off marqué : même camp, tu', !_pushBascule('RISK-OFF', 'STRONG RISK-OFF', 10 * H, 0));
  v('au plus une alerte toutes les 2 h', !_pushBascule('RISK-ON', 'RISK-OFF', 10 * H, 8.5 * H) && _pushBascule('RISK-ON', 'RISK-OFF', 10 * H, 7.9 * H));
  // 25/09, « risk-on / risk-off / neutre, quand ça bouge beaucoup » : le retour au neutre compte aussi.
  v('risk-on marqué → neutre : gros mouvement, notifié', _pushBascule('STRONG RISK-ON', 'NEUTRAL', 10 * H, 0) && _pushBascule('RISK-OFF', 'NEUTRAL', 10 * H, 0));
  v('… mais d’un « léger » à l’autre, tu', !_pushBascule('WEAK RISK-ON', 'WEAK RISK-OFF', 10 * H, 0));
  v('… et un retour d’un cran vers le neutre, tu', !_pushBascule('WEAK RISK-OFF', 'NEUTRAL', 10 * H, 0));
  const tic = fn(SRV, '_pushRisqueTic') || '';
  v('l’écart se mesure sur trois heures de relevés, pas d’un relevé à l’autre (glissement cran par cran)',
    /_pushRisqueHist\.find\(r => _pushBascule\(r\.label, d\.label/.test(tic) && /3 \* 3600e3/.test(tic), tic.slice(0, 160));
  const _RISK_NOM = eval('(' + cstBloc(SRV, '_RISK_NOM') + ')');
  const tb = new Function('_RISK_NOM', 'return (' + fn(SRV, '_pushTexteBascule') + ');')(_RISK_NOM)('NEUTRAL', { label: 'RISK-OFF', assets: [{ label: 'VIX', chg: 12.4 }, { label: 'S&P 500', chg: -2.1 }, { label: 'Or', chg: 0.4 }, { label: 'AUD', chg: -0.2 }] });
  v('la bascule s’intitule en français', tb.title === 'Sentiment de risque · bascule en risk-off', tb.title);
  const tn = new Function('_RISK_NOM', 'return (' + fn(SRV, '_pushTexteBascule') + ');')(_RISK_NOM)('STRONG RISK-OFF', { label: 'NEUTRAL', assets: [] });
  v('… et le retour au calme se dit « retour au neutre »', tn.title === 'Sentiment de risque · retour au neutre', tn.title);
  v('… et nomme ses trois premiers moteurs', tb.body === 'Le marché passe de neutre à risk-off. Moteurs : VIX +12,4%, S&P 500 -2,1%, Or +0,4%.', tb.body);
}

console.log('\n── 4 quater. Rapports de banques et récaps de séance : en français, jamais en anglais ──');
{
  /* Capture user du 25/09 : « Asia FX Weekly », « CNB Minutes: Inflationary risks… » et un récap de
     séance arrivés en anglais. On rejoue la VRAIE fonction avec un traducteur simulé. */
  const src = fn(SRV, '_pushFrNotif');
  const mTv = /const _traductionFrValide = (t => \{[^\n]*\});/.exec(SRV);
  v('_pushFrNotif, _looksFr, _RX_NON_FR et _traductionFrValide sont extractibles', !!src && !!cst(SRV, '_looksFr') && !!cst(SRV, '_RX_NON_FR') && !!mTv);
  const repli = cstBloc(SRV, '_PUSH_REPLI_FR');
  const fabrique = traducteur => new Function('traducteur', 'const _looksFr = ' + cst(SRV, '_looksFr') + ';\nconst _RX_NON_FR = ' + cst(SRV, '_RX_NON_FR')
    + ';\nconst _traductionFrValide = ' + mTv[1] + ';\nconst _PUSH_REPLI_FR = ' + repli
    + ';\nconst _pushFrLot = async (t, ok) => { let r = null; try { r = await traducteur(t[0]); } catch (e) {} return [r && r !== t[0] && ok(r) ? r : t[0]]; };\nasync ' + src + '\nreturn _pushFrNotif;')(traducteur);
  _attentes.push((async () => {
    let appels = 0;
    const ident = fabrique(async t => { appels++; return t; });
    const fr0 = await ident('Semaine à venir en ECE et CCA : données d’inflation en Pologne', 'banques');
    v('un titre déjà français part tel quel, sans appel au traducteur', fr0 === 'Semaine à venir en ECE et CCA : données d’inflation en Pologne' && appels === 0, fr0 + ' · ' + appels);
    const court = await fabrique(async () => 'Hebdo FX Asie')('Asia FX Weekly', 'banques');
    v('une traduction COURTE sans accent ni article est acceptée (« Hebdo FX Asie »)', court === 'Hebdo FX Asie', court);
    const longue = await fabrique(async () => 'Compte rendu de la CNB : les risques inflationnistes commencent à se matérialiser')('CNB Minutes: Inflationary risks are starting to materialise', 'banques');
    v('un titre long est traduit', /^Compte rendu de la CNB/.test(longue), longue);
    appels = 0;
    const rate = await ident('Asia FX Weekly', 'banques');
    v('traducteur muet (renvoie l’anglais) : deux essais, puis une phrase française, jamais l’anglais', rate === 'Nouvelle note de recherche, à lire dans l’onglet Banques.' && appels === 2, rate + ' · ' + appels);
    const ita = await fabrique(async () => 'Le esportazioni della Corea sono in aumento')('Korea exports rise', 'analystes');
    v('une traduction dans une AUTRE langue est refusée', ita === 'Nouveau récap de séance, à lire dans l’onglet Analystes.', ita);
    const panne = await fabrique(async () => { throw new Error('quota'); })('USD/JPY falls below 158.00 as Takaichi says Trump flagged weak yen', 'analystes');
    v('traducteur en panne : phrase française aussi', panne === 'Nouveau récap de séance, à lire dans l’onglet Analystes.', panne);
  })().catch(e => v('4 quater se termine', false, e.message)));
  v('le diffuseur passe TOUT ce qui est marqué « à traduire » par _pushFrNotif', /_pushFrNotif\(e\.body, e\.cat\)/.test(fn(SRV, '_pushDiffuser') || ''));
  const guet = fn(SRV, '_pushGuetter') || '';
  v('les récaps de séance sont marqués « à traduire » (titre et libellé court)', /title: 'Analystes · Récap de séance'[^\n]*trad: true, courtFr: true/.test(guet));
  v('… les notes de banques aussi', /title: 'Banques · ' \+ inst[^\n]*trad: true/.test(guet));
}

console.log('\n── 4 quinquies. Ce qui sonne (25/09) : calendrier de la fiche, parole, réglages fins, titres ──');
{
  // Le VRAI classement du calendrier, extrait tel quel du serveur.
  const debut = SRV.indexOf('const _PUSH_FICHE_RX = ['), fin = SRV.indexOf('function _pushRdv(e) {');
  v('le classement du calendrier est extractible', debut > 0 && fin > debut);
  const C = new Function(SRV.slice(debut, fin) + '\nreturn { _pushCalFamille };')();
  const f = (c, t, i) => C._pushCalFamille({ currency: c, title: t, impact: i });
  v('fiche : JOLTS noté « moyen » sonne pour le dollar', f('USD', 'JOLTS Job Openings', 'Medium') === 'chiffre');
  v('… le PPI américain aussi, même noté « faible »', f('USD', 'PPI m/m', 'Low') === 'chiffre');
  v('… mais le PPI suisse « faible » reste au calendrier', f('CHF', 'PPI m/m', 'Low') === null);
  v('… le CPI allemand « moyen » sonne (même famille, autre devise)', f('EUR', 'German Prelim CPI m/m', 'Medium') === 'chiffre');
  v('impact « élevé » : sonne, hors fiche compris', f('USD', 'Unemployment Claims', 'High') === 'chiffre');
  v('une donnée ordinaire « faible » ne sonne pas', f('CAD', 'Building Permits m/m', 'Low') === null);
  v('décision de taux : un chiffre, pas une prise de parole', f('USD', 'Federal Funds Rate', 'High') === 'chiffre' && f('AUD', 'RBA Cash Rate', 'High') === 'chiffre');
  v('parole : discours de Powell, conférence du FOMC, minutes', f('USD', 'Fed Chair Powell Speaks', 'High') === 'parole' && f('USD', 'FOMC Press Conference', 'High') === 'parole' && f('USD', 'FOMC Meeting Minutes', 'High') === 'parole');
  v('… un membre noté « moyen » aussi', f('USD', 'FOMC Member Waller Speaks', 'Medium') === 'parole' && f('JPY', 'BOJ Gov Ueda Speaks', 'Medium') === 'parole');
  v('… mais une intervention notée « faible » reste au calendrier (rafale d’orateurs)', f('USD', 'FOMC Member Bowman Speaks', 'Low') === null);
  const guet = fn(SRV, '_pushGuetter') || '';
  v('les chiffres passent par ce classement (plus seulement « high »)', /_pushCalFamille\(e\) === 'chiffre'/.test(guet) && !/\/\^high\$\/i\.test/.test(guet));
  v('la parole sonne quand elle COMMENCE (quart d’heure qui suit l’heure), apprise au premier passage', /_pushCalFamille\(e\) === 'parole' && maint >= \(\+e\.timestamp \|\| 0\) && maint - \(\+e\.timestamp \|\| 0\) < 15 \* 60e3/.test(guet) && /_pushNouveaux\('parole'/.test(guet));
  // Réglages fins : la vraie fonction.
  const A = new Function('return (' + fn(SRV, '_pushPrefAccepte') + ');')();
  const P = { fil: 'geo', recaps: 'hebdo', banques: ['ING'] };
  v('fil « géopolitique seule » : une dépêche économique du fil est tue', !A(P, { cat: 'news', pause: 'fil', nature: 'eco' }) && A(P, { cat: 'news', pause: 'fil', nature: 'geo' }));
  v('… sans toucher au calendrier (qui n’est pas le fil)', A(P, { cat: 'eco', nature: 'eco' }));
  v('récaps « hebdo seul » : le récap de séance quotidien est tu', !A(P, { cat: 'analystes', rythme: 'quotidien' }) && A(P, { cat: 'analystes', rythme: 'hebdo' }));
  v('banques choisies : les autres établissements sont tus (casse ignorée)', !A(P, { cat: 'banques', banque: 'Goldman Sachs' }) && A(P, { cat: 'banques', banque: 'ing' }));
  v('réglages au plus large : tout passe', A({ fil: 'tout', recaps: 'tous', banques: [] }, { cat: 'banques', banque: 'X' }));
  v('le routeur applique les réglages fins', /prefs\.cats\.includes\(e\.cat\) \|\| !_pushPrefAccepte\(prefs, e\)/.test(fn(SRV, '_pushRouter') || ''));
  v('le fil porte la nature de chaque dépêche, les récaps leur rythme, les notes leur banque',
    /nature: _pushNature\(it\)/.test(fn(SRV, '_pushEnvoyer') || '') && /rythme: 'quotidien'/.test(guet) && /banque: String\(b\.institution/.test(guet));
  // « ABÉCÉDAIRE » (capture du 25/09) : l'étiquette « PRIMER: » ne passe ni avant ni après traduction.
  const sa = new Function(SRV.match(/const _PUSH_AMORCE_RX = [^\n]+/)[0] + '\n' + SRV.match(/const _pushSansAmorce = [^\n]+/)[0] + '\nreturn _pushSansAmorce;')();
  v('« ABÉCÉDAIRE : Résumé de la session de Londres » perd son étiquette', sa('ABÉCÉDAIRE : Résumé de la session de Londres') === 'Résumé de la session de Londres');
  v('… « PRIMER: London Session Recap » aussi', sa('PRIMER: London Session Recap') === 'London Session Recap');
  v('… un titre ordinaire reste intact', sa('Le dollar recule avant le NFP') === 'Le dollar recule avant le NFP');
  const R = eval('(' + cstBloc(SRV, '_PUSH_RAPPORTS_FR') + ')');
  v('les récaps de séance portent un nom français', R['London Session Recap'] === 'Récap séance de Londres' && R['Asia Session Recap'] && R['US Session Recap']);
  v('le diffuseur retire l’étiquette après traduction', /_pushSansAmorce\(await _pushFrNotif\(e\.body, e\.cat\)\)/.test(fn(SRV, '_pushDiffuser') || ''));
}

console.log('\n── 4 sexies. Le panneau Alertes du desk : un menu déroulant « Notifications » ──');
{
  const IDX = fs.readFileSync(path.join(RACINE, 'public/index.html'), 'utf8');
  const bloc = (IDX.match(/<details class="np-pp"[\s\S]*?<\/details>/) || [''])[0];
  v('le réglage est un menu déroulant, replié par défaut (il ne prend plus la place du fil d’alertes)', !!bloc && !/<details[^>]*\bopen\b/.test(bloc), bloc.slice(0, 120));
  v('… titré « Notifications » (le choix vaut pour tous les appareils, pas « votre téléphone »)', /<span>Notifications<\/span>/.test(bloc) && !/Ce qui peut sonner/.test(IDX) && /tous vos appareils/.test(bloc));
  v('… avec l’étiquette « Nouveau » et un résumé sur la ligne', /np-neuf/.test(bloc) && /np-pp-resume/.test(bloc));
  v('le bouton « Tester » a disparu du desk et de l’app', !/npTesterPush|np-wp-test/.test(IDX + APP) && !/wptest/.test(fs.readFileSync(path.join(RACINE, 'public/js/v2/app-mobile.js'), 'utf8')));
  const clic = (APP.match(/function npPpClic\(ev\) \{[\s\S]*?\n\}/) || [''])[0];
  v('les réglages fins se cochent au desk (type de dépêches, rythme des récaps, banques)', /data-fil/.test(APP) && /_pp\.fil = b\.dataset\.fil/.test(clic) && /_pp\.recaps = b\.dataset\.recaps/.test(clic) && /_pp\.banques = x === '\*' \? \[\]/.test(clic));
  v('l’étiquette « Nouveau » s’éteint seule après trois mois', /_PP_NOUVEAU_JUSQUA = Date\.UTC\(2026, 11, 26\)/.test(APP));
}

console.log('\n── 4 ter. Le desk ne double plus le serveur ──');
{
  const i = APP.indexOf('function npPush('), bloc = i >= 0 ? APP.slice(i, APP.indexOf('\n}\n', i)) : '';
  v('un appareil abonné au Web Push ne reçoit plus la notification du desk (capture du 25/09)', /!_wpActif && !_npCoquille\(\)/.test(bloc));
  v('… l’état de l’abonnement est relu au chargement', /_wpLireActif\(\)/.test(APP) && /pushManager\.getSubscription\(\)\.then|getSubscription\(\)\)\.then\(sub => \{ _wpActif/.test(APP));
  v('en repli, le desk écrit au format du serveur (titre rédigé, provenance)', /_npNotifTexte\(hi\)/.test(bloc) && /Fil d’actualité DTP/.test(APP));
  v('… et ne notifie pas en rafale', /_npNotifSousPause\(hi\)/.test(bloc));
  v('le titre fixe « DataTradingPro » a disparu', !/showNotification\('DataTradingPro'/.test(APP) && !/new Notification\('DataTradingPro'/.test(APP));
}

console.log('\n── 5. Le desk et la coquille se parlent vraiment ──');
v('le desk détecte la coquille', /window\.ReactNativeWebView/.test(APP));
/* DANS L'APP, `Notification` N'EXISTE PAS : l'API Web Notifications n'est pas implémentée par les
   WebView. Sans branche dédiée, l'interrupteur « Push » ne faisait RIEN, sans le dire. */
v('l\'interrupteur Push passe par la coquille dans l\'app', /if \(_npCoquille\(\)\) \{ _npPushCoquilleDemander\(\); return; \}/.test(APP));
v('… et par l\'API Web au navigateur', /Notification\.requestPermission\(\)/.test(APP));
v('couper l\'interrupteur retire l\'appareil', /_npPushCoquilleStop/.test(APP) && /'\/api\/push\/stop'/.test(APP));
v('le jeton reçu est envoyé au serveur', /'\/api\/push\/token'/.test(APP));
v('… une seule fois tant qu\'il ne change pas', /t === _npJetonPose/.test(APP));
/* Un refus système est DÉFINITIF : on ne demande au démarrage que si le compte a déjà accepté. */
v('aucune fenêtre système au démarrage à froid', /if \(_npEnabled && _npPush && _npCoquille\(\)\) _npPushCoquilleDemander\(\)/.test(APP));
v('la coquille répond bien à l\'ordre « dtp:push »', /m\.type === 'dtp:push'/.test(NAT));
v('… et rend le jeton par l\'événement que le desk écoute',
  /dtp:pushtoken/.test(NAT) && /addEventListener\('dtp:pushtoken'/.test(APP));
/* ⚠️ LE CANAL ANDROID. Déclaré par la coquille, nommé par le serveur : un désaccord ne lève aucune
   erreur, la notification atterrit simplement dans le canal par défaut et perd son importance. */
const canalNat = (/setNotificationChannelAsync\('([^']+)'/.exec(NAT) || [])[1];
const canalSrv = (/channelId: '([^']+)'/.exec(SRV) || [])[1];
v('le canal Android du serveur est celui que la coquille crée', !!canalNat && canalNat === canalSrv,
  'coquille=' + canalNat + ' / serveur=' + canalSrv);
v('… et il est créé en importance HIGH', /AndroidImportance\.HIGH/.test(NAT));
v('le serveur envoie en priorité haute', /priority: 'high'/.test(SRV));

// Les contrôles asynchrones (traducteur simulé) sont ATTENDUS : sortir avant eux les rendait muets.
Promise.all(_attentes).then(() => {
  console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec' : '✓ ' + ok + ' contrôles au vert'));
  process.exit(ko ? 1 : 0);
});

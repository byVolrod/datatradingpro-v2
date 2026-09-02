#!/usr/bin/env node
/**
 * scripts/ouverture-verif.js — LES NOUVEAUTÉS DU DESK SONT-ELLES OUVERTES À TOUS ?
 *
 * POURQUOI (02/09/2026, demande user : « publie les mises à jour du desk qui étaient uniquement sur
 * compte admin pour tous les users »).
 *
 * CE QUE L'AUDIT A TROUVÉ, ET QUI EST LE VRAI SUJET DE CE BANC. Dans le code, Accueil et Mon Desk
 * sont ouverts à TOUS depuis le 06/08 : le défaut serveur vaut `true`. Mais TROIS commentaires
 * affirmaient encore « admin uniquement » — dans index.html et deux fois dans widgets.js. Ils ont
 * fait exactement ce que le projet redoute : ils ont menti avec l'autorité du code, au point
 * d'égarer la relecture qui les lisait. C'est pourquoi ce banc contrôle AUSSI la prose.
 *
 * ET LE SEUL CAS OÙ UN CLIENT POUVAIT NE RIEN VOIR : un drapeau posé à `false` dans le KV lors
 * d'une fermeture d'urgence passée. Il PRIME sur le défaut, survit aux livraisons, et reste
 * INVISIBLE depuis le compte admin — qui garde l'accès quoi qu'il arrive, par conception. Une
 * fermeture oubliée ne peut donc pas se constater depuis le compte qui l'a posée.
 * D'où l'ouverture unique, marquée, éprouvée ici sur ses quatre chemins.
 *
 *   node scripts/ouverture-verif.js
 */
const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
const HTML = fs.readFileSync(path.join(RACINE, 'public/index.html'), 'utf8');
const WDG = fs.readFileSync(path.join(RACINE, 'public/js/widgets.js'), 'utf8');
const CH = fs.readFileSync(path.join(RACINE, 'public/js/charts.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

/* ══ 1. LE DÉFAUT SERVEUR EST OUVERT ═══════════════════════════════════════════════════════════ */
console.log('\n── Le défaut : ouvert à tous ──');
v('Accueil et Mon Desk sont ouverts par défaut',
  /let _newFeat = \{ accueil: true, mondesk: true \};/.test(SRV),
  'un défaut à false fermerait la fonctionnalité pour tout compte non-admin');
v('le drapeau est bien servi au navigateur par /api/auth/me',
  (SRV.match(/loggedIn: true, user[^}]*feat: _newFeat/g) || []).length >= 2);
v('le client ouvre sur le drapeau, pas sur le rôle',
  /window\._pdMonDesk = !!\(window\._pdIsAdmin \|\| _f\.mondesk\);/.test(HTML)
  && /window\._pdAccueil = !!\(window\._pdIsAdmin \|\| _f\.accueil\);/.test(HTML),
  'l\'admin garde l\'accès en propre : sans ça, refermer après un incident enfermerait dehors celui qui doit diagnostiquer');
v('l\'amorçage de Mon Desk attend le DRAPEAU et non le rôle',
  /if \(window\._pdMonDesk\) \{ clearInterval\(iv\); boot\(\); \}/.test(WDG)
  && !/if \(window\._pdIsAdmin\) \{ clearInterval\(iv\); boot\(\); \}/.test(WDG));
v('la garde de vue suit la même règle', /view === 'widgets' && !window\._pdMonDesk/.test(CH));

/* ══ 2. AUCUN WIDGET N'EST RÉSERVÉ AU STAFF ════════════════════════════════════════════════════ */
console.log('\n── Le catalogue de widgets ──');
const staffs = (WDG.match(/^\s*staff: true/gm) || []).length;
v('aucun widget du catalogue n\'est marqué « staff »', staffs === 0,
  staffs + ' widget(s) encore réservé(s) aux comptes admin/support');
v('… le mécanisme reste disponible pour un futur palier', /function _wBientot\(w\)/.test(WDG),
  'on ne supprime pas l\'outil, on constate qu\'il ne ferme rien aujourd\'hui');

/* ══ 3. PLUS AUCUNE PROSE NE DIT « ADMIN UNIQUEMENT » ══════════════════════════════════════════ */
console.log('\n── La prose ne ment plus (elle a menti un mois) ──');
/* Ces trois affirmations ont survécu 27 jours à la règle qu'elles décrivaient. Les chercher
   textuellement est le seul moyen d'empêcher qu'une quatrième réapparaisse à la faveur d'un
   copier-coller : un commentaire ne casse aucun test, il n'égare que des humains. */
const menteurs = [
  ['index.html', HTML, /onglet créé par widgets\.js pour l'ADMIN\s+uniquement/],
  ['widgets.js (amorçage)', WDG, /L'ICÔNE n'est créée QUE pour l'admin/],
  ['widgets.js (poll)', WDG, /portée limitée à l'admin/],
];
menteurs.forEach(([qui, src, rx]) => v('« ' + qui +' » ne dit plus admin-only', !rx.test(src)));
v('… et l\'ouverture à tous y est écrite noir sur blanc',
  /OUVERT À TOUS LES COMPTES depuis le 06\/08/.test(HTML)
  && /L'ICÔNE est posée pour TOUT COMPTE CONNECTÉ/.test(WDG));

/* ══ 4. L'OUVERTURE UNIQUE, ÉPROUVÉE SUR SES QUATRE CHEMINS ════════════════════════════════════ */
console.log('\n── L\'ouverture unique : elle lève une fois, et une seule ──');
const SRC = (() => {
  const d = SRV.indexOf('const _FEAT_OUVERT_KEY');
  const f = SRV.indexOf('\n}', SRV.indexOf('async function _featOuvertureUnique'));
  return d < 0 || f < 0 ? null : SRV.slice(d, f + 2);
})();
v('`_featOuvertureUnique` est extractible de server.js', !!SRC);
/* ⚠️ ET SURTOUT : ELLE EST APPELÉE. Le contrôle négatif l'a montré — en commentant son appel dans
   `_featLoad`, tout ce banc restait VERT : il éprouvait une fonction parfaite que plus personne
   n'exécutait. Une fonction non câblée ne lève aucun drapeau, et le client ne voit toujours rien. */
/* ⚠️ ET L'APPEL DOIT ÊTRE VIVANT, PAS COMMENTÉ. Deuxième leçon du même contrôle négatif : mon
   premier motif cherchait la chaîne `await _featOuvertureUnique();`… qu'un `// ` devant laisse
   parfaitement intacte. Le banc restait donc vert sur un appel neutralisé. On exige une ligne dont
   le début n'est pas un commentaire. */
const _appel = (SRV.match(/^[^\n]*await _featOuvertureUnique\(\);/gm) || [])
  .filter(l => !/^\s*(\/\/|\*)/.test(l));
v('… et elle est bien APPELÉE au chargement des drapeaux (appel vivant, non commenté)',
  _appel.length === 1 && SRV.indexOf(_appel[0]) > SRV.indexOf('async function _featLoad()'),
  _appel.length + ' appel(s) actif(s) — sans cet appel, l\'ouverture n\'a jamais lieu');
v('… après la lecture du KV, jamais avant (sinon on lèverait un drapeau qu\'on n\'a pas encore lu)',
  _appel.length === 1 && SRV.indexOf(_appel[0]) > SRV.indexOf('_newFeat = { accueil: !!v.accueil, mondesk: !!v.mondesk }'));
if (SRC) {
  const bac = (kv, feat) => {
    const magasin = Object.assign({}, kv);
    const journal = [];
    const auth = {
      aiCacheGet: async (k) => (k in magasin ? magasin[k] : null),
      aiCacheSet: async (k, v2) => { magasin[k] = v2; journal.push(k); },
    };
    let _newFeat = Object.assign({}, feat);
    const f = new Function('auth', '_FEAT_TTL', 'console', 'getFeat', 'setFeat',
      SRC.replace(/_newFeat = \{ accueil: true, mondesk: true \};/, 'setFeat({ accueil: true, mondesk: true });')
         .replace(/!_newFeat\.accueil \|\| !_newFeat\.mondesk/, '!getFeat().accueil || !getFeat().mondesk')
         .replace(/auth\.aiCacheSet\(_FEAT_KEY, _newFeat\)/, 'auth.aiCacheSet("feat:v1", getFeat())')
      + '\nreturn _featOuvertureUnique;');
    return { run: f(auth, 1e9, { log() {} }, () => _newFeat, (x) => { _newFeat = x; }),
             magasin, journal, feat: () => _newFeat };
  };
  /* CHEMIN 1 — un KV FERMÉ est levé, et le marqueur est posé. */
  (async () => {
    const b = bac({ 'feat:v1': { accueil: false, mondesk: false } }, { accueil: false, mondesk: false });
    const r = await b.run();
    v('un drapeau FERMÉ est levé pour tous', r === true && b.feat().mondesk === true && b.feat().accueil === true,
      JSON.stringify(b.feat()));
    v('… le KV est réécrit', JSON.stringify(b.magasin['feat:v1']) === JSON.stringify({ accueil: true, mondesk: true }),
      JSON.stringify(b.magasin['feat:v1']));
    v('… et un marqueur est posé pour ne jamais recommencer', !!b.magasin['feat:ouverture-generale-20260902']);

    /* CHEMIN 2 — LA MOITIÉ QUI COMPTE : une fermeture POSTÉRIEURE est RESPECTÉE. Sans ce contrôle,
       on aurait pu « ouvrir à tous » en supprimant purement et simplement le levier d'urgence. */
    const b2 = bac({ 'feat:v1': { accueil: false, mondesk: false },
                     'feat:ouverture-generale-20260902': { at: 1 } }, { accueil: false, mondesk: false });
    const r2 = await b2.run();
    v('une fermeture décidée APRÈS l\'ouverture n\'est pas réécrite', r2 === false && b2.feat().mondesk === false,
      'le marqueur existe → on ne touche à rien, la fermeture d\'urgence reste souveraine');
    v('… et rien n\'est écrit dans le KV à ce tour', b2.journal.length === 0, b2.journal.join(' · '));

    /* CHEMIN 3 — déjà ouvert : on pose le marqueur et on ne réécrit pas le KV pour rien. */
    const b3 = bac({}, { accueil: true, mondesk: true });
    const r3 = await b3.run();
    v('rien à lever quand tout est déjà ouvert', r3 === false && b3.feat().mondesk === true);
    v('… le marqueur est tout de même posé (l\'ouverture ne se rejouera pas)',
      !!b3.magasin['feat:ouverture-generale-20260902'] && !b3.journal.includes('feat:v1'),
      'écritures : ' + b3.journal.join(' · '));

    /* CHEMIN 4 — le KV est injoignable : on ne doit ni jeter, ni prétendre avoir ouvert. */
    const f4 = new Function('auth', '_FEAT_TTL', 'console', 'getFeat', 'setFeat',
      SRC.replace(/_newFeat = \{ accueil: true, mondesk: true \};/, 'setFeat({ accueil: true, mondesk: true });')
         .replace(/!_newFeat\.accueil \|\| !_newFeat\.mondesk/, '!getFeat().accueil || !getFeat().mondesk')
         .replace(/auth\.aiCacheSet\(_FEAT_KEY, _newFeat\)/, 'auth.aiCacheSet("feat:v1", getFeat())')
      + '\nreturn _featOuvertureUnique;');
    let etat = { accueil: false, mondesk: false };
    const r4 = await f4({ aiCacheGet: async () => { throw new Error('KV injoignable'); }, aiCacheSet: async () => {} },
      1e9, { log() {} }, () => etat, (x) => { etat = x; })();
    v('un KV injoignable ne lève rien et ne jette pas', r4 === false);

    console.log('\n' + '─'.repeat(70));
    console.log(ko === 0 ? `✅ ouverture-verif : ${ok} contrôle(s) au vert.` : `❌ ouverture-verif : ${ko} échec(s) sur ${ok + ko}.`);
    process.exit(ko === 0 ? 0 : 1);
  })();
} else {
  console.log('\n' + '─'.repeat(70));
  console.log(`❌ ouverture-verif : ${ko} échec(s) sur ${ok + ko}.`);
  process.exit(1);
}

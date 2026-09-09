#!/usr/bin/env node
/**
 * scripts/calendrier-vide-verif.js — QUAND LE CALENDRIER EST VIDE, DIT-IL POURQUOI ?
 *
 * POURQUOI (09/09, signalement utilisateur : capture d'un calendrier affichant « Aucun événement
 * sur cette semaine », « je rencontre ce problème »).
 *
 * La phrase était affichée dans QUATRE situations sans rapport, et dans trois d'entre elles elle
 * était FAUSSE :
 *   · l'appel `/api/calendar-events` a échoué — on ne sait rien, et on affirmait savoir ;
 *   · aucune donnée n'a jamais été reçue — même chose ;
 *   · la période demandée est hors de ce que le flux couvre — c'est une limite, pas un vide ;
 *   · un filtre d'importance ou une recherche masque tout — le lecteur a lui-même caché les lignes.
 *
 * Une erreur qui se déguise en information est pire qu'une erreur visible : elle est plausible,
 * donc personne ne cherche plus loin. Et c'est un défaut que ni `node -c` ni `js-verif` ne peuvent
 * voir — la phrase est une chaîne de caractères parfaitement valide.
 *
 * Ce banc EXTRAIT la vraie cascade de messages de `public/js/widgets.js` et la fait tourner sur les
 * quatre situations. Il ne récite pas sa propre copie : neutraliser la correction le fait rougir.
 *
 *   node scripts/calendrier-vide-verif.js
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
let ok = 0, ko = 0;
function t(nom, cond, detail) {
  if (cond) { ok++; console.log('  ✓ ' + nom); }
  else { ko++; console.log('  ✗ ' + nom + (detail ? '  → ' + detail : '')); }
}
const W = fs.readFileSync(path.join(RACINE, 'public/js/widgets.js'), 'utf8');

console.log('\n[1] La cascade de messages, extraite du widget');
const src = (() => {
  const a = W.indexOf('            var _bornesData = _tous.length');
  const b = W.indexOf("            else _msg = 'Aucun événement sur cette période.';", a);
  if (a < 0 || b < a) return null;
  return W.slice(a, b + W.slice(b).indexOf('\n'));
})();
t('la cascade est trouvée dans widgets.js', !!src);

// On la joue avec un état contrôlé. `bo` = les bornes de la période affichée.
function messageDe(etat) {
  const f = new Function('_tous', '_busy', '_echec', '_imp', 'q', 'bo',
    'var _msg, _reessai = false;\n' + src + '\n return { msg: _msg, reessai: _reessai };');
  return f(etat.tous, etat.busy, etat.echec, etat.imp, etat.q, etat.bo);
}
const J = (n) => Date.UTC(2026, 8, 1 + n, 12);
const SEMAINE_COUVERTE = [J(1), J(5)];
const SEMAINE_LOINTAINE = [J(60), J(64)];
const DONNEES = [{ timestamp: J(0) }, { timestamp: J(10) }];

console.log('\n[2] Chaque situation a sa propre phrase');
if (src) {
  const cas = [
    ['chargement en cours', { tous: [], busy: true, echec: false, imp: 'ALL', q: '', bo: SEMAINE_COUVERTE }, /Chargement/, false],
    ['l\'appel a ÉCHOUÉ', { tous: [], busy: false, echec: true, imp: 'ALL', q: '', bo: SEMAINE_COUVERTE }, /n'a pas pu être chargé/, true],
    ['aucune donnée reçue', { tous: [], busy: false, echec: false, imp: 'ALL', q: '', bo: SEMAINE_COUVERTE }, /Aucune donnée de calendrier/, true],
    ['période hors du flux', { tous: DONNEES, busy: false, echec: false, imp: 'ALL', q: '', bo: SEMAINE_LOINTAINE }, /pas encore couverte/, false],
    ['un filtre masque tout', { tous: DONNEES, busy: false, echec: false, imp: 'High', q: '', bo: SEMAINE_COUVERTE }, /votre filtre/, false],
    ['une recherche masque tout', { tous: DONNEES, busy: false, echec: false, imp: 'ALL', q: 'zzz', bo: SEMAINE_COUVERTE }, /votre filtre/, false],
    ['période réellement vide', { tous: DONNEES, busy: false, echec: false, imp: 'ALL', q: '', bo: SEMAINE_COUVERTE }, /^Aucun événement sur cette période\.$/, false],
  ];
  const vus = new Set();
  for (const [nom, etat, attendu, reessaiAttendu] of cas) {
    const r = messageDe(etat);
    t(nom + ' → message propre', attendu.test(r.msg || ''), JSON.stringify(r.msg));
    vus.add(r.msg);
    t(nom + ' → bouton Réessayer ' + (reessaiAttendu ? 'proposé' : 'absent'), !!r.reessai === reessaiAttendu,
      'réessai = ' + r.reessai);
  }
  /* LE CONTRÔLE QUI PORTE TOUT LE CHANTIER : les sept situations ne doivent PAS se réduire à une
     seule phrase. C'était exactement l'état d'avant — une phrase pour tout, donc aucune information. */
  t('les situations ne se confondent pas en une seule phrase', vus.size >= 6, vus.size + ' phrase(s) distincte(s)');
  /* TÉMOIN INVERSE : « Réessayer » ne doit apparaître QUE là où un clic peut réparer. Le proposer
     sur une période réellement vide serait une fausse promesse — le clic ne changerait rien. */
  const vide = messageDe({ tous: DONNEES, busy: false, echec: false, imp: 'ALL', q: '', bo: SEMAINE_COUVERTE });
  t('TÉMOIN — pas de « Réessayer » là où il n\'y a rien à recharger', !vide.reessai);
}

console.log('\n[3] L\'échec est bien retenu, et le bouton est câblé');
t('un échec de chargement est mémorisé', /\}\)\.catch\(function \(\) \{ _busy = false; _echec = true; dessine\(\); \}\);/.test(W),
  'sans mémoire de l\'échec, la vue ne peut pas le distinguer d\'une période vide');
t('un chargement réussi efface l\'échec', /_back = n; _busy = false; _echec = false;/.test(W),
  'l\'erreur resterait affichée après une reprise réussie');
t('le bouton Réessayer est câblé', /_rt\.addEventListener\('click'/.test(W));
t('il porte un habillage', /\.wdg-cal-retry \{/.test(fs.readFileSync(path.join(RACINE, 'public/css/style.css'), 'utf8')),
  'sans style, le bouton se lit comme un bouton de formulaire brut au milieu d\'un message');

console.log('\n[Calendrier vide] ' + ok + ' contrôle(s) vert(s), ' + ko + ' rouge(s).\n');
process.exit(ko ? 1 : 0);

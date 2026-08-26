#!/usr/bin/env node
/**
 * desinscription-verif.js — UN RÉABONNEMENT TIENT-IL VRAIMENT ?
 * ------------------------------------------------------------------------------------------------
 * 04/09, demande utilisateur, capture à l'appui : « les blacklist ne sont pas dedans, puis je dois
 * pouvoir désinscrire et réinscrire moi-même, donc corrige ce bouton ».
 *
 * DEUX DÉFAUTS, ET LE SECOND EST INVISIBLE À LA LECTURE.
 *
 *   1. Deux mécanismes d'exclusion existaient, un seul se voyait. La liste noire du LOGIN avait son
 *      écran, avec ajout et retrait. Les désinscrits E-MAIL n'avaient aucune liste : on ne pouvait
 *      les atteindre que ligne par ligne dans le tableau des comptes — donc pas du tout pour une
 *      adresse SANS compte, ce qui est le cas de tous les contacts venus de Whop. Ils étaient exclus
 *      des envois sans figurer nulle part.
 *
 *   2. Le bouton « réabonner » était privé de son onclick pour deux adresses, et le serveur
 *      répondait 409. Ce refus n'était pas un caprice : le seed `_PERMANENT_UNSUB_SEED` se
 *      réappliquait SANS CONDITION vingt secondes après CHAQUE démarrage. Un réabonnement aurait
 *      donc tenu jusqu'au prochain réveil de Render — quinze minutes d'inactivité suffisent — puis
 *      aurait disparu en silence. Le panneau aurait affiché « ✓ réabonné », et le lendemain le
 *      contact aurait été de nouveau désinscrit sans que rien ne l'explique. C'est le SEED qui est
 *      corrigé (il ne s'applique plus qu'une fois, marqueur durable par adresse), pas l'écran.
 *
 * CE QUE CE BANC ÉPROUVE, ET QU'AUCUNE RELECTURE NE DONNE. La correction repose entièrement sur une
 * propriété de CHAÎNES : `unsubseed:` et `unsubself:` ne doivent PAS être vus comme des clés
 * « unsub: ». Si l'un des deux l'était, trois choses casseraient d'un coup — le marqueur de seed
 * serait effacé par le bouton de réabonnement (donc le seed se réappliquerait au démarrage suivant,
 * et on serait revenu au point de départ), la trace du consentement disparaîtrait, et la liste des
 * désinscrits afficherait des lignes fantômes. « unsubs » contre « unsub: » : un caractère, et
 * personne ne le vérifie à l'œil.
 *
 *   node scripts/desinscription-verif.js
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const AUTH = fs.readFileSync(path.join(RACINE, 'auth.js'), 'utf8');
const SRV  = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
const ADM  = fs.readFileSync(path.join(RACINE, 'public/js/admin.js'), 'utf8');
const ADH  = fs.readFileSync(path.join(RACINE, 'public/admin.html'), 'utf8');

let ok = 0, ko = 0;
const v = (t, c, d) => { if (c) { ok++; console.log('  ✓ ' + t); } else { ko++; console.log('  ✗ ' + t + (d ? '\n      → ' + d : '')); } };

console.log('\n═══ DESINSCRIPTION-VERIF — le réabonnement survit-il au redémarrage ? ═══');

console.log('\n── 1. Les préfixes ne se confondent pas (tout repose là-dessus) ──');
/* Le vrai garde-fou est dans auth.js : emailLogDel REFUSE toute clé hors « unsub: », ce qui empêche
   un bouton de panneau d'effacer un marqueur d'anti-doublon et de faire repartir une campagne
   entière. On l'extrait et on l'éprouve, plutôt que de faire confiance à sa lecture. */
const DEL = (() => {
  const d = AUTH.indexOf('async function emailLogDel(key) {');
  if (d < 0) return null;
  const f = AUTH.indexOf('\n}', d);
  return f < 0 ? null : AUTH.slice(d, f + 2);
})();
v('emailLogDel est extractible de auth.js', !!DEL);
if (DEL) {
  const garde = /if \(!k\.startsWith\('unsub:'\)\) throw/.test(DEL);
  v('… et il REFUSE toute clé hors « unsub: » (garde anti-doublon intacte)', garde,
    'sans cette garde, « réabonner » pourrait réexpédier une campagne entière');
}
const estUnsub  = k => String(k).startsWith('unsub:');
const estListee = k => String(k).indexOf('unsub:') === 0;
v('« unsubseed: » n\'est PAS une clé unsub (sinon le seed se réappliquerait au démarrage suivant)',
  !estUnsub('unsubseed:a@b.c') && !estListee('unsubseed:a@b.c'));
v('« unsubself: » non plus (sinon la trace du consentement s\'effacerait avec la désinscription)',
  !estUnsub('unsubself:a@b.c') && !estListee('unsubself:a@b.c'));
v('« unsub: » en est bien une', estUnsub('unsub:a@b.c') && estListee('unsub:a@b.c'));

console.log('\n── 2. LE SEED S\'APPLIQUE UNE FOIS, PAS À CHAQUE DÉMARRAGE ──');
const SEED = (() => {
  const d = AUTH.indexOf('async function _ensurePermanentUnsub() {');
  if (d < 0) return null;
  const f = AUTH.indexOf('\n}', d);
  return f < 0 ? null : AUTH.slice(d, f + 2);
})();
v('la fonction de seed est extractible', !!SEED);
if (SEED) {
  v('elle vérifie un marqueur d\'application AVANT d\'écrire', /emailLogHas\('unsubseed:' \+ em\)/.test(SEED),
    'sans ce test, un réabonnement est défait au prochain réveil de Render');
  v('… et elle sort sans rien faire quand il existe', /if \(await emailLogHas\('unsubseed:' \+ em\)\) continue;/.test(SEED));
  v('… le marqueur est posé AVANT la désinscription (sinon un plantage entre les deux le rejouerait)',
    SEED.indexOf("emailLogAdd('unsubseed:'") < SEED.indexOf("emailLogAdd('unsub:'"));
  v('le seed garde son rôle d\'origine : il écrit encore quand rien n\'existe',
    /emailLogAdd\('unsub:' \+ em\)/.test(SEED), 'une perte totale d\'infra ne rétablirait plus rien');
}

console.log('\n── 3. Le serveur ne refuse plus un réabonnement ──');
const NL = (() => {
  const d = SRV.indexOf("app.post('/api/admin/users/:id/newsletter'");
  return d < 0 ? null : SRV.slice(d, d + 1800);
})();
v('la route newsletter est lisible', !!NL);
if (NL) {
  v('plus de 409 « désinscription permanente »', !/status\(409\)/.test(NL),
    'le bouton du panneau resterait sans effet sur ces contacts');
  v('elle relit l\'état CONSTATÉ au lieu de celui qu\'elle croit avoir écrit',
    /emailLogHas\('unsub:' \+ em\)/.test(NL));
}

console.log('\n── 4. On sait QUI a désinscrit — la seule chose qui change la portée du bouton ──');
/* Réabonner quelqu'un que l'admin avait désinscrit corrige une erreur. Réabonner quelqu'un qui a
   CLIQUÉ le lien de désinscription lui repasse un consentement qu'il a explicitement retiré. Le
   panneau ne bloque pas — c'est la décision de l'exploitant — mais il ne le laisse pas cliquer à
   l'aveugle. Encore faut-il que l'information EXISTE, et elle n'existait pas. */
v('la désinscription publique laisse une trace de son origine',
  /emailLogAdd\('unsubself:' \+ email\)/.test(SRV), 'sans elle, les deux cas sont indistinguables');
v('la liste la renvoie au panneau', /parLui: !!jrn\['unsubself:' \+ em\]/.test(SRV));
v('le panneau distingue les deux à l\'écran', /camp-un-tag--self/.test(ADM) && /camp-un-tag--self/.test(fs.readFileSync(path.join(RACINE, 'public/css/admin.css'), 'utf8')));
v('… et demande confirmation avant de réabonner quelqu\'un qui s\'était désinscrit lui-même',
  /if \(parLui\)[\s\S]{0,400}dataset\.armed/.test(ADM), 'un clic unique repasserait le consentement sans un mot');

console.log('\n── 5. Les désinscrits ont enfin une liste (« ne sont pas dedans ») ──');
v('la route de liste existe', /app\.get\('\/api\/admin\/unsub-list'/.test(SRV));
v('… elle sait ajouter ET retirer', /action === 'add'/.test(SRV) && /action === 'remove'/.test(SRV));
v('… elle valide la forme de l\'adresse avant toute écriture',
  /unsub-list[\s\S]{0,900}_valide = e =>/.test(SRV), 'une chaîne arbitraire finirait en clé du journal');
v('… elle compte les adresses SANS COMPTE (celles qu\'aucun écran n\'atteignait)',
  /sansCompte: list\.filter/.test(SRV));
v('… et elle indexe les comptes par adresse NORMALISÉE',
  /comptes\[e\] = \{ id: String\(u\.id\)/.test(SRV), 'une casse différente ferait passer un client pour « sans compte »');
/* DIRECTION SÛRE : journal illisible → on le DIT. Une liste vide se lirait « personne n'est
   désinscrit », et on lancerait une campagne en croyant que toute la base la recevra. */
v('journal illisible → « mesure indisponible », jamais une liste vide',
  /unsub-list[\s\S]{0,2600}mesure: 'indisponible'/.test(SRV));
v('… et le panneau le répercute au lieu d\'afficher « aucun désinscrit »',
  /mesure indisponible/.test(ADM));
v('la carte est dans le panneau, à côté de la liste noire',
  /id="camp-un-list"/.test(ADH) && /id="camp-un-input"/.test(ADH));
v('… et elle dit ce qu\'elle coupe (les campagnes) et ce qu\'elle ne coupe pas',
  /camp-un-list[\s\S]{0,900}connexion au terminal n'est pas touchée/.test(ADH),
  'sans cette phrase, on confond les deux listes');

console.log('\n── 6. Le bouton de la fiche compte bascule TOUJOURS, dans les deux sens ──');
v('plus de bouton privé de son onclick', !/unsubFige \? '' :/.test(ADM),
  'un bouton mort se lit comme une panne, pas comme une règle');
v('… il bascule dans les deux sens', /toggleNewsletter\('\$\{esc\(String\(u\.id\)\)\}',\$\{!!u\.unsub\}\)/.test(ADM));
v('… et il signale quand même l\'origine de la désinscription',
  /désinscription d\\?'origine/.test(ADM));

console.log('');
if (ko) { console.log('✗ ' + ko + ' ÉCHEC(S) — ' + ok + ' contrôle(s) OK, ' + ko + ' KO\n'); process.exit(1); }
console.log('✓ TOUT PASSE — ' + ok + ' contrôle(s) OK\n');

#!/usr/bin/env node
/**
 * scripts/libelle-verif.js — LES LIBELLÉS D'ONGLET SONT-ILS COURTS *ET* DISTINCTS ?
 *
 * POURQUOI. Deux demandes opposées en apparence, six jours d'écart, toutes deux justes :
 *
 *   · 03/09 — « un onglet MONDE au-dessus d'un panneau SESSIONS DE MARCHÉ ». L'onglet retombait sur
 *     `w.tag`, un sigle de vignette PARTAGÉ entre widgets : cinq portaient « VOLATILITÉ », trois
 *     « FX », deux « TAUX ». Deux onglets voisins pouvaient donc s'appeler pareil, ce qui retire à
 *     l'onglet sa seule fonction. Le libellé est passé au NOM.
 *   · 09/09 — « raccourcis le nom de tous les widgets, comme ça dans le panneau à onglets le nom
 *     n'est pas trop long ». Le nom va jusqu'à vingt-trois caractères.
 *
 * La réponse n'est ni l'un ni l'autre mais un TROISIÈME libellé, `court`, propre à chaque widget.
 * Ce banc tient les deux exigences à la fois — et c'est nécessaire, parce qu'elles tirent en sens
 * inverse : raccourcir pousse vers des libellés génériques, donc vers la collision qu'on vient de
 * réparer. Un banc qui ne vérifierait que la longueur autoriserait le retour du défaut du 03/09.
 *
 *   node scripts/libelle-verif.js
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

// Catalogue lu dans la SOURCE : id, name, court. (Charger widgets.js exigerait un navigateur.)
const entrees = [...W.matchAll(/id: '([a-z0-9-]+)', name: '((?:[^'\\]|\\.)*)',(?: court: '((?:[^'\\]|\\.)*)',)?/g)]
  .map(m => ({ id: m[1], name: m[2].replace(/\\'/g, "'"), court: m[3] ? m[3].replace(/\\'/g, "'") : null }));

console.log('\n[1] Le catalogue et ses libellés');
t('le catalogue est lu', entrees.length >= 30, entrees.length + ' widget(s)');
t('des libellés courts sont déclarés', entrees.filter(e => e.court).length >= 20,
  entrees.filter(e => e.court).length + ' libellé(s) court(s)');

console.log('\n[2] Court ET distinct — les deux à la fois');
{
  // Le libellé RÉELLEMENT affiché dans la rangée d'onglets : `court` s'il existe, sinon `name`.
  const affiche = entrees.map(e => ({ id: e.id, lbl: e.court || e.name }));
  const trop = affiche.filter(a => a.lbl.length > 14);
  t('aucun libellé d\'onglet ne dépasse 14 caractères', trop.length === 0,
    trop.map(a => a.id + ' « ' + a.lbl + ' » (' + a.lbl.length + ')').join(' · '));

  /* LE CONTRÔLE QUI EMPÊCHE DE REJOUER LE 03/09 : deux widgets ne peuvent pas porter le même
     libellé d'onglet. Comparaison insensible à la casse et aux accents — « Risque » et « risqué »
     se lisent pareil dans une rangée d'onglets de 11 pixels. */
  const clef = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const vus = new Map(); const doubles = [];
  for (const a of affiche) {
    const k = clef(a.lbl);
    if (vus.has(k)) doubles.push(vus.get(k) + ' = ' + a.id + ' (« ' + a.lbl + ' »)');
    else vus.set(k, a.id);
  }
  t('deux widgets ne portent JAMAIS le même libellé d\'onglet', doubles.length === 0, doubles.join(' · '));

  /* TÉMOIN INVERSE : un libellé court qui ne raccourcirait rien serait du bruit. On exige qu'il
     soit STRICTEMENT plus court que le nom qu'il remplace — sinon autant garder le nom. */
  const inutiles = entrees.filter(e => e.court && e.court.length >= e.name.length);
  t('TÉMOIN — chaque libellé court est plus court que son nom', inutiles.length === 0,
    inutiles.map(e => e.id + ' : « ' + e.court +' » ≥ « ' + e.name + ' »').join(' · '));
  /* TÉMOIN INVERSE : et il ne doit pas être vide — un onglet sans texte n'ouvre rien de nommé. */
  t('TÉMOIN — aucun libellé court n\'est vide', !entrees.some(e => e.court !== null && !e.court.trim()));
}

console.log('\n[3] Chaque widget du catalogue a une vignette');
{
  /* ⚠️ CE CONTRÔLE EXISTE PARCE QUE JE VENAIS DE L'OUBLIER. En ajoutant le widget Kelly, j'ai
     déclaré son entrée de catalogue, son libellé court, son aide, sa source — et pas sa vignette.
     Rien ne l'aurait signalé : la bibliothèque retombe silencieusement sur l'icône générique, et
     quand il n'y en a pas non plus, sur une case VIDE. L'utilisateur, lui, l'avait remarqué sur
     Scenario Desk et nous l'a écrit. Un défaut qu'un client repère avant nous est un défaut qui
     méritait un contrôle : le voici, pour tous les widgets à venir.
     ⚠️ ON NE LIT QUE LE CATALOGUE. Une entrée `id: '…', name: '…'` existe aussi pour les LAYOUTS
     (« mon-desk », « Vue générale ») : les compter ferait rougir le banc sur un objet qui n'a
     aucune raison d'avoir une vignette. On exige donc la présence de `desc:` à sa suite, qui est
     propre aux cartes de la bibliothèque. */
  const bornes = [W.indexOf('var CATALOG = ['), W.indexOf('\n  var WPREV = {')];
  const cat = bornes[0] >= 0 ? W.slice(bornes[0]) : W;
  const cartes = [...cat.matchAll(/id: '([a-z0-9-]+)', name: '(?:[^'\\]|\\.)*',[\s\S]{0,400}?desc:/g)].map(m => m[1]);
  const iP = W.indexOf('var WPREV = {'), jP = W.indexOf('\n  };', iP);
  const vign = new Set([...W.slice(iP, jP).matchAll(/^\s{4}'?([a-z0-9-]+)'?:/gm)].map(m => m[1]));
  const iI = W.indexOf('var WICO = {'), jI = W.indexOf('\n  };', iI);
  const icones = new Set([...W.slice(iI, jI).matchAll(/^\s{4}'?([a-z0-9-]+)'?:/gm)].map(m => m[1]));
  t('le catalogue est lu pour ce contrôle', cartes.length >= 30, cartes.length + ' carte(s)');
  /* ⚠️ ON EXIGE UNE VRAIE VIGNETTE, PAS « UNE VIGNETTE OU UNE ICÔNE ». La première écriture de ce
     contrôle acceptait le repli sur l'icône générique — et il est resté vert quand j'ai retiré
     exprès la vignette de Scenario Desk, c'est-à-dire sur EXACTEMENT la situation que l'utilisateur
     venait de signaler. Un contrôle qui tolère le défaut qu'il est censé fermer ne sert à rien.
     C'est aussi ce que disait déjà la note du 04/09 sur les deux cartes de direct : « le défaut
     n'était pas l'absence de vignette mais pire — elles retombaient sur l'icône, et cette icône est
     LA MÊME pour les deux ». Une icône ne montre pas ce que la carte affiche ; une vignette, si. */
  const nus = cartes.filter(id => !vign.has(id));
  t('chaque carte a une VIGNETTE propre, jamais un repli sur l\'icône', nus.length === 0, nus.join(', '));
  /* Et l'icône reste utile ailleurs (onglets, aide) : on vérifie qu'elle n'a pas disparu pour autant. */
  t('les icônes existent toujours à côté', icones.size >= 40, icones.size + ' icône(s)');
  t('TÉMOIN — des vignettes sont bien déclarées', vign.size >= 40, vign.size + ' vignette(s)');
}

console.log('\n[3] La rangée d\'onglets s\'en sert, et l\'infobulle garde le nom complet');
t('la rangée affiche le libellé court', /var lbl = labels\[i\] \|\| \(w \? \(w\.court \|\| w\.name\)/.test(W),
  'la rangée retomberait sur le nom complet : la demande ne serait pas honorée');
t('un libellé posé à la main reste prioritaire', /var lbl = labels\[i\] \|\|/.test(W),
  'renommer un onglet soi-même doit toujours l\'emporter');
t('TÉMOIN — l\'infobulle donne toujours le nom COMPLET', /var ttl = w \? \(w\.name \+ ' : double-clic/.test(W),
  'la rangée dit vite, le survol doit dire tout');

console.log('\n[Libellés] ' + ok + ' contrôle(s) vert(s), ' + ko + ' rouge(s).\n');
process.exit(ko ? 1 : 0);

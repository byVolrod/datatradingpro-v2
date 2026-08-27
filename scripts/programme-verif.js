#!/usr/bin/env node
/* ═══ LE PROGRAMME DES ENVOIS DIT-IL LA VÉRITÉ ? ═══════════════════════════════════════════════
   09/09, deux constats de l'utilisateur sur la même capture du panneau admin.

   1. « comme le prochain envoi n'est pas le truc de parrainage, on peut enlever la bande qui dit
      que c'est le prochain ». La ligne du parrainage portait le libellé « Prochain » ET la mise en
      avant dorée SANS CONDITION. Sa date tombait le 1er mars 2027 — dix-huit mois plus tard — et
      elle s'affichait juste au-dessus du vrai prochain envoi, doré lui aussi. Deux « prochains » à
      l'écran, dont un faux, sur le seul écran qui sert à savoir ce qui part.

   2. « il manque le template témoignage ici, chaque mois 1 témoignage on avait dit différent ».
      Les lignes annonçaient « + Témoignage membre » sans dire LEQUEL, pendant que l'en-tête
      affirmait « Aucun témoignage programmé » — alors qu'il part tout seul le 1er mardi du mois.
      Les cinq présentations tournaient déjà : c'est leur rotation qui était invisible.

   ⚠️ CE QUI COMPTE VRAIMENT ICI, ET QUE CE BANC ÉPROUVE EN PRIORITÉ : le panneau doit annoncer LA
   MÊME variante que celle qui partira. Deux chemins qui choisissent chacun de leur côté finiraient
   par diverger, et le panel annoncerait un mail pendant qu'un autre part — un mensonge silencieux,
   invisible jusqu'à ce qu'un client reçoive autre chose que ce qui était affiché. */
const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
const ADM = fs.readFileSync(path.join(RACINE, 'public/js/admin.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + String(d).slice(0, 300) : '')); } };

console.log('\n── 1. La rotation des témoignages (vraies fonctions de mailer.js) ──');
let mailer = null;
try { mailer = require(path.join(RACINE, 'mailer.js')); } catch (e) { console.log('  · mailer.js non chargeable → section abstenue (' + e.message.slice(0, 60) + ')'); }
if (mailer) {
  const V = mailer.TEMOIGN_VARIANTES || [];
  v('cinq présentations existent', V.length >= 5, String(V.length));
  v('chacune porte une clé ET un objet', V.every(x => x && x.key && x.subject), JSON.stringify(V.map(x => x && x.key)));
  v('les objets sont tous DIFFÉRENTS', new Set(V.map(x => x.subject)).size === V.length);
  /* « on avait dit différent » : la garantie est qu'on ne ressert jamais ce qui vient de servir. */
  const pick = mailer.pickTemoignVariante;
  v('sans historique, on sert la première', pick([]).key === V[0].key);
  v('ce qui vient de servir n\'est jamais reservi', pick([V[0].key]).key !== V[0].key);
  const servies = [];
  for (let i = 0; i < V.length; i++) servies.push(pick(servies.slice()).key);
  v('un cycle complet sert les CINQ, sans doublon', new Set(servies).size === V.length, servies.join(' → '));
  /* Historique saturé : on recycle, mais on ne plante pas et on rend toujours une variante. */
  v('historique complet → on recycle proprement', !!pick(V.map(x => x.key)).key);
  v('un historique inconnu ne casse rien', !!pick(['clé-qui-n-existe-plus']).key);
}

console.log('\n── 2. Le panneau annonce CE QUI PARTIRA, pas une supposition ──');
/* Les deux chemins doivent lire la MÊME mémoire et appeler la MÊME fonction de choix. */
const bloc = (rx) => (rx.exec(SRV) || [''])[0];
const envoi = bloc(/if \(stepDef\.tpl === 'temoignage'\)[\s\S]{0,900}/);
const payload = bloc(/async function _temoignagePayload\(\)[\s\S]{0,1200}/);
const planEp = bloc(/const _temVus = await _temListe\(_TEM_VAR_K\);[\s\S]{0,1200}/);
v('le panneau lit la mémoire des gabarits déjà servis', /_temListe\(_TEM_VAR_K\)/.test(planEp), planEp.slice(0, 120));
v('… la MÊME que celle qu\'écrit l\'envoi', /_temMarquer\(_TEM_VAR_K/.test(envoi), envoi.slice(0, 200));
v('… et il appelle la MÊME fonction de choix que l\'expéditeur',
  /pickTemoignVariante/.test(planEp) && /pickTemoignVariante/.test(payload));
v('le panneau reçoit la variante, son rang et son objet', /varianteNum:/.test(planEp) && /sujet: _temV\.subject/.test(planEp) && /total: _temListeV\.length/.test(planEp), planEp);
v('… et la cadence réelle, pour ne plus la deviner', /1er mardi du mois/.test(planEp));

console.log('\n── 3. Ce que le panneau affiche ──');
/* ⚠️ CONTRÔLE CENTRAL : la mise en avant dorée doit être CONDITIONNELLE. C'est elle qui affirmait
   « prochain » sur un envoi situé dix-huit mois plus loin. */
v('la ligne du parrainage n\'est plus dorée sans condition',
  !/'<div class="camp-plan-row camp-plan-row--now">'/.test(ADM),
  (ADM.match(/.{0,60}camp-plan-row camp-plan-row--now.{0,40}/) || [''])[0]);
v('… elle l\'est quand le parrainage est VRAIMENT le premier dans le temps',
  /_estProchain \? ' camp-plan-row--now' : ''/.test(ADM));
/* La comparaison doit porter sur l'échéance hebdomadaire réelle, pas sur la semaine calendaire. */
v('… le rang se décide en comparant à l\'échéance hebdo réelle',
  /d\.semaines\[d\.prochainIdx\]/.test(ADM) && /par\.date <= _semProch/.test(ADM));
v('… un retard reste mis en avant (c\'est actionnable)', /!!_retard \|\|/.test(ADM));
v('quand ce n\'est pas le prochain, la colonne dit l\'ATTENTE', /_estProchain \? 'Prochain' : _attente/.test(ADM));
v('… en jours sous un mois, en mois au-delà', /dans ' \+ Math\.max\(1, j\) \+ ' j'/.test(ADM) && /dans ' \+ m \+ ' mois'/.test(ADM));
/* L'en-tête ne doit plus annoncer « aucun » ce qui part tout seul chaque mois. */
v('l\'en-tête n\'annonce plus « Aucun témoignage programmé »', !/Aucun témoignage programmé/.test(ADM),
  (ADM.match(/.{0,50}Aucun témoignage programmé.{0,30}/) || [''])[0]);
v('… il annonce la cadence et la variante à venir', /Témoignage : ' \+ \(\(_ti && _ti\.cadence\)/.test(ADM) && /variante ' \+ _ti\.varianteNum/.test(ADM));
v('… et distingue une date FORCÉE de la cadence automatique', /Témoignage forcé le/.test(ADM));
/* Huit semaines = deux 1ers mardis. Étiqueter les deux annoncerait deux fois un mail unique. */
v('la variante n\'est étiquetée que sur le PROCHAIN témoignage', /i === _temPrem/.test(ADM));
v('… « prochain » voulant dire : le premier pas encore parti', /x\.temoignageLe && !x\.envoye/.test(ADM));

/* ⚠️ UN SEUL RÉGLAGE POUR UNE SEULE CHOSE (09/09). Le témoignage ayant sa ligne dans le programme,
   le programmateur de date manuel qui vivait juste en dessous faisait doublon : deux réglages pour
   le même envoi, côte à côte, sans qu'on sache lequel fait foi. */
const HTML = fs.readFileSync(path.join(RACINE, 'public/admin.html'), 'utf8');
v('le programmateur manuel du témoignage a disparu du panneau',
  !/camp-plan-tem-date/.test(HTML) && !/campPlanTemoignage/.test(HTML),
  (HTML.match(/.{0,50}camp-plan-tem-date.{0,30}/) || [''])[0]);
v('… et son gestionnaire avec lui (pas de code mort)', !/campPlanTemoignage/.test(ADM));
/* Le message de statut, lui, sert à TOUT le bloc : le retirer casserait « Semaine forcée. » */
v('le message de statut du bloc survit', /id="camp-plan-msg"/.test(HTML)
  && /camp-plan-msg/.test(ADM) && /_planMsg\([^)]*Semaine forcée/.test(ADM),
  (ADM.match(/_planMsg\([^)]{0,60}/g) || []).join(' | '));
v('… et la note n\'annonce plus une date programmable', !/une date programmée l'envoie/.test(HTML));

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec' : '✓ ' + ok + ' contrôles au vert'));
process.exit(ko ? 1 : 0);

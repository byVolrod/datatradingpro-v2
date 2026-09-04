#!/usr/bin/env node
/**
 * scripts/fraicheur-verif.js — LE TABLEAU FX DIT-IL QUAND SES PRIX NE SONT PLUS D'ACTUALITÉ ?
 * ------------------------------------------------------------------------------------------------
 * 04/09, audit demandé : « fiabilité des données et temps réel » sur l'onglet FX.
 *
 * CE QUE L'AUDIT A TROUVÉ. Le bloc qui écrivait « MAJ HH:MM » était MORT depuis le 04/08 :
 * l'élément `#fxl-updated` a été retiré de la page ce jour-là, à la demande de l'utilisateur
 * (« l'heure occupait le coin droit sans être consultée »), et le code s'est neutralisé tout seul
 * sur son `if (upd && …)`. Personne ne l'a vu, parce qu'un code qui ne fait rien ne casse rien.
 * Résultat : le tableau ne disait PLUS RIEN de son âge, et il a trois raisons d'être vieux —
 *   · le WEEK-END, le serveur sert délibérément la photo de vendredi et coupe le rafraîchissement
 *     des cotations. Un dimanche à 15 h on lit des prix de vendredi 22 h, sans un mot ;
 *   · un rafraîchissement en échec laisse le tableau précédent en place, sans un mot ;
 *   · un conteneur réveillé sert son dernier instantané persisté, qui peut dater.
 * Les prix ne sont pas FAUX : ce sont les VRAIS prix d'un autre moment, affichés comme s'ils
 * étaient de maintenant. C'est précisément ce qu'un desk ne doit pas faire.
 *
 * LA RÈGLE ÉPROUVÉE ICI, ET POURQUOI ELLE N'EST PAS « REMETTRE L'HORODATAGE ». Le retrait du
 * 04/08 était une bonne décision, pour la bonne raison : un indicateur qu'on lit tous les jours
 * sans jamais rien y voir cesse d'être lu — la leçon du keep-alive vert qui ne pinguait rien. On
 * applique donc la règle que ce desk suit DÉJÀ sur le graphique de réaction : le cas ordinaire
 * n'écrit rien, le cas anormal garde sa phrase.
 *
 * ⚠️ LES QUATRE CAS VONT PAR PAIRES, ET C'EST TOUT L'INTÉRÊT :
 *   · « rien quand c'est frais » serait vert sur un code qui n'écrit JAMAIS rien — c'est-à-dire sur
 *     le défaut d'origine. Il faut donc aussi « quelque chose quand c'est vieux » ;
 *   · « quelque chose quand c'est vieux » serait vert sur un code qui parle TOUJOURS — la nuisance
 *     que l'utilisateur a fait retirer. Il faut donc aussi le RETOUR à la normale, qui efface.
 *
 *   node scripts/fraicheur-verif.js
 *
 * Sans Chromium, le banc S'ABSTIENT (code 0) pour la phase rendue ; les contrôles de source, eux,
 * tournent toujours.
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
let ko = 0;
const v = (nom, cond, detail) => {
  if (cond) console.log('  ✓ ' + nom);
  else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); }
};

const CH = fs.readFileSync(path.join(RACINE, 'public/js/charts.js'), 'utf8');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');

/* ══ 1. QUI DÉCIDE QUE LE MARCHÉ EST FERMÉ ═══════════════════════════════════════════════════ */
console.log('\n── « Marché fermé » a une seule source de vérité ──');
v('le serveur joint l\'état du marché à la réponse', /marcheFerme: _fxlWeekendNow\(\)/.test(SRV));
/* ⚠️ AU MOMENT DE LA RÉPONSE, PAS À LA FABRICATION. Le week-end, l'instantané servi a été calculé
   un jour OUVRÉ : poser le drapeau dans `_computeFxListFresh` le figerait à « ouvert » pour tout le
   week-end — exactement l'inverse de ce qu'il doit dire. */
const iFresh = SRV.indexOf('async function _computeFxListFresh()');
const finFresh = SRV.indexOf('\n}', SRV.indexOf('return { pairs: valid', iFresh));
v('… au moment de la RÉPONSE, pas à la fabrication de l\'instantané',
  iFresh > 0 && SRV.slice(iFresh, finFresh).indexOf('marcheFerme') < 0,
  'un drapeau posé au calcul dirait « ouvert » tout le week-end, puisque l\'instantané date d\'un jour ouvré');
/* Le cache est partagé ET persisté sur disque : y écrire un drapeau propre à une requête l'enverrait
   dans le fichier, où il serait relu au boot suivant comme s'il était de ce moment-là. */
v('… sans écrire ce drapeau dans le cache partagé (qui est persisté)',
  /res\.json\(\{ \.\.\.data, marcheFerme:/.test(SRV),
  'on étale dans un objet neuf plutôt que de muter `_fxlCache`');
/* Et le client ne rejoue pas la règle : une seconde source de vérité diverge le jour où l'une des
   deux change — la faute réparée le 04/09 sur les couleurs de devises. */
const iEtat = CH.indexOf('function _fxlEtatFraicheur()');
const finEtat = iEtat < 0 ? -1 : CH.indexOf('\n}', CH.indexOf('el.textContent = txt;', iEtat));
const CORPS = iEtat < 0 ? '' : CH.slice(iEtat, finEtat);
v('le client LIT cet état au lieu de recalculer le week-end de son côté',
  /_fxlData && _fxlData\.marcheFerme/.test(CORPS) && !/getDay\(\)/.test(CORPS),
  'deux règles de week-end finiraient par diverger');

/* ══ 2. LES QUATRE CAS, DANS UN VRAI NAVIGATEUR ══════════════════════════════════════════════ */
(async () => {
  if (iEtat < 0) { v('la fonction d\'état est trouvable dans charts.js', false); process.exit(1); }
  let outils; try { outils = require('./mobile-apercu.js'); } catch { outils = null; }
  const bin = outils && outils.trouverNavigateur ? outils.trouverNavigateur() : null;
  if (!bin) { console.log('\n[Fraîcheur] aucun Chromium → phase rendue abstenue.\n'); process.exit(ko ? 1 : 0); }
  let pp; try { pp = require('puppeteer-core'); }
  catch { console.log('\n[Fraîcheur] puppeteer-core absent → phase rendue abstenue.\n'); process.exit(ko ? 1 : 0); }

  /* On extrait la VRAIE fonction, avec sa constante de seuil : une copie resterait verte le jour où
     l'original changerait. */
  const iSeuil = CH.indexOf('const _FXL_FRAIS_MS');
  const SRC = CH.slice(iSeuil, CH.indexOf('\n', iSeuil)) + '\n' + CORPS + '\n}\n'
    + '\nwindow._fxlEtatFraicheur = _fxlEtatFraicheur;';

  const H = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const vendredi = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 2) % 7 || 7)); d.setHours(22, 58, 0, 0); return d; })();
  const CAS = [
    { nom: 'donnée fraîche → le tableau ne dit RIEN', data: { updatedAt: new Date().toISOString(), marcheFerme: false },
      attendu: (r) => r.present === false },
    { nom: 'donnée de trois heures → il le DIT, avec l\'âge', data: { updatedAt: new Date(Date.now() - 3 * 3600e3).toISOString(), marcheFerme: false },
      attendu: (r) => r.present === true && /il y a 3 h/.test(r.txt) && r.ferme === false },
    { nom: 'marché fermé → il NOMME le jour de clôture', data: { updatedAt: vendredi.toISOString(), marcheFerme: true },
      attendu: (r) => r.present === true && /vendredi/i.test(r.txt) && new RegExp(H(vendredi)).test(r.txt) && r.ferme === true },
  ];

  let nav;
  try {
    nav = await pp.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await nav.newPage();
    await page.setContent('<html><body><div class="fxl-toolbar"></div></body></html>');
    await page.evaluate((src) => { (0, eval)(src); }, SRC);
    const jouer = (d) => page.evaluate((d2) => {
      window._fxlData = d2;
      window._fxlEtatFraicheur();
      const el = document.getElementById('fxl-etat');
      return { present: !!el, txt: el ? el.textContent : null, ferme: el ? el.classList.contains('fxl-etat--ferme') : null };
    }, d);

    console.log('\n── Ce que le tableau dit de sa fraîcheur ──');
    for (const c of CAS) {
      const r = await jouer(c.data);
      v(c.nom, c.attendu(r), 'rendu : ' + JSON.stringify(r));
    }
    /* ⚠️ LE RETOUR À LA NORMALE EFFACE. Sans ce contrôle, une ligne « il y a 3 h » survivrait au
       rafraîchissement suivant et deviendrait le mensonge inverse — une donnée fraîche annoncée
       vieille. C'est aussi lui qui interdit d'écrire la ligne EN PERMANENCE pour passer les trois
       cas ci-dessus, ce qui ramènerait la nuisance retirée le 04/08. */
    const retour = await jouer({ updatedAt: new Date().toISOString(), marcheFerme: false });
    v('… et le retour à la normale EFFACE la ligne', retour.present === false, 'rendu : ' + JSON.stringify(retour));
    await page.close();
  } catch (e) {
    v('la phase rendue s\'exécute', false, e && e.message);
  } finally { if (nav) await nav.close(); }

  console.log(ko === 0 ? '\n[Fraîcheur] tout est vert.\n' : '\n[Fraîcheur] ' + ko + ' contrôle(s) au rouge.\n');
  process.exit(ko ? 1 : 0);
})();

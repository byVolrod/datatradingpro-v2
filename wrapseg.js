'use strict';
/**
 * wrapseg.js — LE RAPPORT DE SÉANCE, MIS EN PAGE.
 *
 * C'est CE rendu que l'utilisateur lit dans le lecteur de rapports d'analystes : le récap de séance
 * segmenté en rubriques (Géopolitique · Macro · Analyse de séance · À surveiller). L'IA fournit les
 * sections ; TOUT le reste — l'ordre, le classement par famille, la complétion par notre calendrier,
 * l'anti-doublon, le HTML — est fait ICI, de façon déterministe.
 *
 * Séparé de server.js pour une seule raison : ce module est PUR, donc éprouvable ligne à ligne
 * (scripts/seance-verif.js). Un rapport faux se voit désormais en test, plus en production.
 */
const _SEA = require('./seance');
const _WA  = require('./walabels');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const estMacro = sec => /^macro$/i.test(String((sec && sec.section) || '').trim());

/* L'HEURE DE PARIS, celle du desk. Un chiffre daté de son heure UTC dans un rapport français fait
   douter de toutes les autres heures de la page. */
function heureParis(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(':', 'h');
}

/* « enlève le terme source met directement » (26/08, capture : « Sources BCE : les décideurs sont
   prêts à augmenter les taux en septembre → … »). Un desk NOMME sa source, il ne l'annonce pas :
   « **BCE** : … » dit la même chose en deux mots de moins, et c'est le style de toutes les autres
   puces. La règle est DÉTERMINISTE — la consigne est aussi dans le prompt, mais on ne compte pas
   sur la mémoire du modèle pour une règle de style : on corrige à la sortie.
   ELLE N'AGIT QUE SUR UN VRAI « Sources X : … » : il faut le deux-points, et ce qui le précède doit
   ressembler à un NOM D'INSTITUTION (majuscule initiale, trois mots au plus). Sans cette preuve,
   « Sources d'énergie renouvelables en hausse » perdrait son sujet, et « Source proche de la BCE :
   … » perdrait la BCE — le mot y porte l'information, il n'est pas un tic de rédaction. */
const _SRC_GRAS = /^\s*\*\*\s*[Ss]ources?\s*\*\*\s*/;              // « **Sources** … »
const _SRC_NU   = /^\s*[Ss]ources?\s*/;                            // « Sources … »
// Un nom d'institution : un mot capitalisé, puis jusqu'à trois mots capitalisés OU de liaison
// (« Banque de France », « Bank of England »). Le premier mot DOIT porter la majuscule — c'est ce
// qui distingue « Sources BCE : … » de « Source proche de la BCE : … », où le mot porte l'info.
const _SRC_INST = /^(\*{0,2}[A-ZÀ-Þ][\wÀ-ÿ&.'’-]*(?:\s+(?:[A-ZÀ-Þ][\wÀ-ÿ&.'’-]*|de|du|des|la|le|les|of|and|et|d['’])){0,3}\*{0,2})?\s*[:：]\s+/;
function sansSource(t) {
  const s = String(t == null ? '' : t);
  const tete = _SRC_GRAS.exec(s) || _SRC_NU.exec(s);
  if (!tete) return s;
  const reste = s.slice(tete[0].length);
  const m = _SRC_INST.exec(reste);
  if (!m) return s;                             // pas un « Sources X : … » → on ne touche à rien
  const r = reste.slice(m[0].length);
  if (!r) return s;                             // rien derrière : mieux vaut la puce telle quelle
  if (m[1]) return m[1] + ' : ' + r;            // l'institution reste, et devient le sujet de la puce
  return /^[a-zà-ÿ]/.test(r) ? r.charAt(0).toUpperCase() + r.slice(1) : r;
}

/* CE QUE NOTRE CALENDRIER AJOUTE À LA RUBRIQUE MACRO (26/08 : « check les news sorties durant la
   session, classe les dans leur catégories de la partie macro »). L'IA ne peut restituer que ce que
   l'article contenait ; notre calendrier, lui, sait ce qui est RÉELLEMENT tombé pendant la fenêtre
   de la séance. On ajoute ce qui manque — chiffré, au format du desk. Rien n'est inventé : chaque
   ligne vient d'une publication du calendrier AVEC son résultat. Ce qui est déjà raconté par l'IA
   n'est jamais répété (_SEA.dejaDit). */
function completerMacro(items, macroCal) {
  const entrees = (items || []).map(i => ({ titre: sansSource(i), ligne: sansSource(i) }));
  let ajouts = 0;
  for (const e of (macroCal || [])) {
    if (_SEA.dejaDit(e, items || [])) continue;
    const titre = _WA.intituleAffiche(e);
    const ligne = _SEA.ligneMacroMd({ currency: e.currency, ctry: e.ctry, title: titre, actual: e.actual, forecast: e.forecast, previous: e.previous }, heureParis(e.timestamp));
    if (ligne) { entrees.push({ titre, ligne, _cal: true }); ajouts++; }
  }
  return { entrees, ajouts };
}

/* LA RUBRIQUE MACRO EXISTE DÈS QUE LE CALENDRIER A DES CHIFFRES. Si l'article ne parlait d'aucune
   donnée, l'IA n'a pas produit de rubrique Macro — et la séance la plus chargée en publications
   serait justement celle qui n'en montrerait aucune. On la crée alors à sa place canonique : après
   Géopolitique, sinon après le LEAD, jamais en fin de rapport. */
function poserMacro(arr, macroCal) {
  const out = (arr || []).slice();
  if (!(macroCal || []).length || out.some(estMacro)) return out;
  // Géopolitique D'ABORD : `findIndex` sur une alternative rendait le LEAD, toujours en tête, et
  // plaçait la Macro AVANT la Géopolitique — l'ordre des rubriques du Récap Quotidien est fixe.
  // Le repli couvre les DEUX noms de la rubrique d'ouverture : « Synthèse » aujourd'hui, « LEAD »
  // dans les rapports déjà en cache. Sans le second, une Macro créée de toutes pièces se serait
  // glissée AVANT la synthèse sur ces rapports-là.
  const ou = t => out.findIndex(x => x && t.test(String(x.section || '').trim()));
  let i = ou(/^g[ée]opolitique$/i);
  if (i < 0) i = ou(/^(?:synth[èe]se|lead)$/i);
  out.splice(i < 0 ? out.length : i + 1, 0, { section: 'Macro', items: [] });
  return out;
}

/* « À SURVEILLER » PORTE LE CALENDRIER DE LA SÉANCE SUIVANTE (26/08 : « met le calendrier des
   prochaines news de la prochaine session »). L'IA n'y met que ce que l'article laissait deviner —
   « la réaction continue du marché aux rumeurs », « les prochaines déclarations de la Fed » : du
   prospectif sans heure ni chiffre, donc inactionnable. Le calendrier, lui, sait ce qui tombe et
   quand. Ses lignes viennent EN TÊTE de la rubrique : une échéance datée passe avant un fil ouvert.
   La rubrique est CRÉÉE si elle manque, et en DERNIER — c'est sa place canonique, le rapport doit
   se terminer dessus. */
const estSurv = sec => /^[àa] surveiller$/i.test(String((sec && sec.section) || '').trim());
function poserSurveiller(arr, surv) {
  const out = (arr || []).slice();
  if (!surv || !(surv.lignes || []).length || out.some(estSurv)) return out;
  out.push({ section: 'À surveiller', items: [] });
  return out;
}
function completerSurveiller(items, surv) {
  const lignes = (surv && surv.lignes) || [];
  if (!lignes.length) return (items || []).map(String);
  // Un intitulé de séance en tête : le lecteur sait de QUELLE fenêtre on parle sans avoir à deviner.
  const tete = surv.nom ? [`**Séance de ${surv.nom}** — le calendrier :`] : [];
  return tete.concat(lignes.map(String), (items || []).map(String));
}
/* LE VRAI TABLEAU DU CALENDRIER, PAS DES PHRASES (26/08 : « met une partie du calendrier éco du desk
   direct »). Le Récap Quotidien rend déjà ses échéances sous la forme du calendrier du desk —
   séparateurs de jours, heure, drapeau, points d'impact, cellules de valeurs, ligne cliquable vers
   le Décryptage. Le récap de séance servait les mêmes rendez-vous en texte.
   On ne construit PAS ce tableau ici : le HTML a besoin des briques du navigateur (drapeaux,
   points d'impact, cellule de réel colorée). On dépose donc les ÉVÉNEMENTS, et le lecteur appelle la
   même fabrique que le Quotidien. Une balise inerte porte les données : elle ne rend rien par
   elle-même, donc un lecteur qui ne la connaîtrait pas n'affiche simplement pas de tableau — jamais
   du JSON en clair. */
function calSurveiller(surv) {
  const evs = (surv && surv.evs) || [];
  if (!evs.length) return '';
  const json = JSON.stringify(evs).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
  return `<aside class="dtp-cal" data-evs='${json}'></aside>`;
}

/* LA SYNTHÈSE OUVRE LE RAPPORT (26/08 : « fais une synthèse de la session comme on a dans le récap
   quotidien »). Elle se pose EN PREMIER : le lecteur reçoit d'abord ce que la séance a fait, puis le
   récit. C'est l'ordre du Récap Quotidien, et celui des récaps déterministes du desk.

   LE RÉCIT D'ABORD, LES MESURES ENSUITE (28/08, capture du Récap Quotidien à l'appui : « il manque
   ce type de synthèse dans les récap session »). Ce que le user montrait n'était pas mon bloc
   chiffré — c'était le PARAGRAPHE NARRATIF du Quotidien : « Un accord de cessez-le-feu entre les
   États-Unis et l'Iran a fait chuter le pétrole et les rendements obligataires… ». Le récap de
   séance ouvrait, lui, sur « Séance de Londres : 7 publications, 3 hors consensus » — un décompte,
   pas une lecture. Les deux ont leur place, dans cet ordre : le paragraphe donne le sens, les deux
   lignes mesurées l'étayent. Le paragraphe vient du modèle (rubrique « Synthèse » du prompt), les
   lignes sont calculées.

   ⚠️ « LEAD » EST LA MÊME CHOSE SOUS UN AUTRE NOM, ET IL DEVIENT LA SYNTHÈSE. Le prompt réclamait
   jusqu'ici un « LEAD » rendu SANS titre : ses puces se collaient en tête du rapport, en texte nu,
   là où le Quotidien encadre les siennes d'un liseré doré. Le prompt demande désormais « Synthèse » ;
   la reprise du LEAD reste ici pour les rapports déjà en cache et pour un modèle qui retomberait sur
   l'ancien nom — dans les deux cas le lecteur voit le même encadré, jamais une entrée en matière nue. */
const _estSynth = x => x && /^(?:synth[èe]se|lead)$/i.test(String(x.section || '').trim());
function poserSynthese(arr, synth) {
  const out = (arr || []).slice();
  const mes = (synth || []).slice();
  const i = out.findIndex(_estSynth);
  if (i >= 0) { out[i] = { section: 'Synthèse', items: (out[i].items || []).concat(mes) }; return out; }
  if (!mes.length) return out;
  out.unshift({ section: 'Synthèse', items: mes });
  return out;
}

/* MACRO RANGÉE PAR FAMILLE, COMME LE RÉCAP QUOTIDIEN (26/08, retour utilisateur, capture à l'appui :
   « dans macro je vois pas les news sorties dans leur catégorie comme quotidien »). Le classement est
   DÉTERMINISTE et fait avec la MÊME table que le Quotidien (_SEA.famille) : on ne demande pas à l'IA
   de ranger, on range nous-mêmes ce qu'elle a écrit — elle ne peut donc ni inventer une famille ni
   en oublier une.
   AUCUNE LIGNE SANS CATÉGORIE, AUCUN GROUPE SANS INTITULÉ (26/08, deux retours successifs, captures
   à l'appui : « il manque la classification comme la 2è image », puis « ici il manque une
   catégorie »). Deux arbitrages à moi tombaient l'un après l'autre : « intituler un groupe unique
   n'apprend rien » effaçait la classification les jours homogènes ; et rendre ce qui sort des
   quatre rubriques du Radar sans titre — repris du Quotidien, où ces lignes voisinent toujours avec
   des groupes intitulés — laissait une puce nue quand elles étaient les SEULES de la rubrique.
   Toute famille présente porte donc son intitulé, même seule, y compris Commerce et Autres. */
function html(arr, macroCal, surv, synth) {
  const sections = poserSynthese(poserSurveiller(poserMacro(arr, macroCal), surv), synth);
  let out = '', ajouts = 0;
  for (const sec of sections) {
    if (!sec || !sec.section || !Array.isArray(sec.items)) continue;
    if (estMacro(sec)) {
      const r = completerMacro(sec.items.map(sansSource), macroCal);
      ajouts += r.ajouts;
      if (!r.entrees.length) continue;
      const groupes = _SEA.parFamilleMacro(r.entrees);
      out += `<strong>${esc(sec.section)}</strong>`;
      for (const g of groupes) out += `<em>${esc(g.famille)}</em><ul>${g.lignes.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`;
      continue;
    }
    if (estSurv(sec)) {
      /* Le TABLEAU d'abord — les échéances datées et chiffrées —, puis les fils ouverts que la
         rédaction a relevés : une échéance passe avant une attente vague. Les phrases du calendrier
         ne sont écrites QUE si le tableau n'a pas pu l'être (vieux lecteur, aucune donnée brute) :
         sinon le lecteur lirait deux fois les mêmes rendez-vous. */
      const tbl = calSurveiller(surv);
      const l = tbl ? (sec.items || []).map(sansSource) : completerSurveiller(sec.items.map(sansSource), surv);
      if (!tbl && !l.length) continue;
      out += `<strong>${esc(sec.section)}</strong>`;
      if (tbl) out += `<em>Séance de ${esc((surv && surv.nom) || '')}</em>` + tbl;
      if (l.length) out += `<ul>${l.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
      continue;
    }
    /* « ANALYSE DE SÉANCE » RANGÉE PAR CLASSE D'ACTIF (28/08 : « classe bien par catégories ici pour
       que ce soit propre »). La rubrique alignait DXY, NZD, CHF, le Canada, les matières premières,
       les obligations et les actions dans une seule liste : sept sujets sans rapport à la suite.
       Même mécanique que la Macro — Devises · Obligations · Matières premières · Actions · Crypto ·
       Commerce · Autres —, et même principe : c'est NOUS qui rangeons ce que le modèle a écrit.
       Une seule classe présente → aucun sous-titre : la rubrique EST déjà cette classe. C'est la
       différence avec la Macro, où l'intitulé porte l'information même seul (« Inflation » dit ce
       que le chiffre mesure) ; ici « Devises » au-dessus de trois lignes de devises ne dit rien. */
    if (/^analyse de s[ée]ance$/i.test(String(sec.section).trim()) && sec.items.length) {
      const g = _SEA.parFamilleActif(sec.items.map(sansSource));
      out += `<strong>${esc(sec.section)}</strong>`;
      if (g.length > 1) for (const f of g) out += `<em>${esc(f.famille)}</em><ul>${f.lignes.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`;
      else out += `<ul>${sec.items.map(i => `<li>${esc(sansSource(i))}</li>`).join('')}</ul>`;
      continue;
    }
    if (!sec.items.length) continue;   // une rubrique vide s'efface — Macro et « À surveiller » sont traitées ci-dessus
    // Le style vaut pour TOUTES les rubriques, pas seulement la Macro : le tic vient du modèle, pas
    // d'une section en particulier.
    out += `<strong>${esc(sec.section)}</strong><ul>${sec.items.map(i => `<li>${esc(sansSource(i))}</li>`).join('')}</ul>`;
  }
  return { html: out, ajouts, sections: sections.length };
}

module.exports = { html, poserMacro, completerMacro, poserSurveiller, completerSurveiller, calSurveiller, poserSynthese, sansSource, heureParis, esc };

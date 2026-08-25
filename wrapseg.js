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

/* CE QUE NOTRE CALENDRIER AJOUTE À LA RUBRIQUE MACRO (26/08 : « check les news sorties durant la
   session, classe les dans leur catégories de la partie macro »). L'IA ne peut restituer que ce que
   l'article contenait ; notre calendrier, lui, sait ce qui est RÉELLEMENT tombé pendant la fenêtre
   de la séance. On ajoute ce qui manque — chiffré, au format du desk. Rien n'est inventé : chaque
   ligne vient d'une publication du calendrier AVEC son résultat. Ce qui est déjà raconté par l'IA
   n'est jamais répété (_SEA.dejaDit). */
function completerMacro(items, macroCal) {
  const entrees = (items || []).map(i => ({ titre: String(i), ligne: String(i) }));
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
  const ou = t => out.findIndex(x => x && t.test(String(x.section || '').trim()));
  let i = ou(/^g[ée]opolitique$/i);
  if (i < 0) i = ou(/^lead$/i);
  out.splice(i < 0 ? out.length : i + 1, 0, { section: 'Macro', items: [] });
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
function html(arr, macroCal) {
  const sections = poserMacro(arr, macroCal);
  let out = '', ajouts = 0;
  for (const sec of sections) {
    if (!sec || !sec.section || !Array.isArray(sec.items)) continue;
    if (estMacro(sec)) {
      const r = completerMacro(sec.items, macroCal);
      ajouts += r.ajouts;
      if (!r.entrees.length) continue;
      const groupes = _SEA.parFamilleMacro(r.entrees);
      out += `<strong>${esc(sec.section)}</strong>`;
      for (const g of groupes) out += `<em>${esc(g.famille)}</em><ul>${g.lignes.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`;
      continue;
    }
    if (!sec.items.length) continue;   // une rubrique vide s'efface — sauf la Macro, traitée ci-dessus
    out += `<strong>${esc(sec.section)}</strong><ul>${sec.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
  }
  return { html: out, ajouts, sections: sections.length };
}

module.exports = { html, poserMacro, completerMacro, heureParis, esc };

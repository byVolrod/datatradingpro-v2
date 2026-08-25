/**
 * seance.js — RÉCAP DE SÉANCE FABRIQUÉ PAR LE DESK.
 *
 * POURQUOI (26/08, décision utilisateur). Les récaps de séance étaient montés à partir des TITRES du
 * fil, rangés par catégorie : une liste, pas un récit. L'alternative envisagée était de reprendre les
 * wraps d'un fournisseur tiers ; l'utilisateur a tranché autrement, et il a raison — le desk possède
 * de la matière que ce fournisseur n'a pas : le calendrier avec réel/attendu, le Radar de Biais, le
 * pricing des banques centrales, la force des devises, les notes institutionnelles, et la
 * performance mesurée des actifs sur la fenêtre de la séance.
 *
 * Un récap DTP peut donc écrire une CHAÎNE DE FAITS MESURÉS là où un rédacteur écrit de la prose :
 *   « CPI allemand 2,3 % contre 2,1 % attendu (+0,2 pt) · EUR/USD +0,4 % sur la séance ·
 *     le biais EUR passe à Légèrement haussier · Goldman s'y attendait hier ».
 *
 * Ce module ne contient QUE du calcul et de la mise en forme — aucun accès réseau, aucun état. Il est
 * donc éprouvé en entier par scripts/seance-verif.js, y compris sur les cas tordus (pas de consensus,
 * valeurs en K/M/B, pourcentages, chômage où « plus haut » est une mauvaise nouvelle).
 */
'use strict';

/* FENÊTRES DE SÉANCE, en heures de PARIS. Ce sont les heures de la séance elle-même — à ne pas
   confondre avec _SEANCE_SUIVANTE (server.js), qui décrit la séance À VENIR pour « À surveiller ». */
const FENETRES = {
  'Asia Session Recap':   { nom: 'Asie',      debut: 0,  fin: 9,  dev: ['JPY', 'AUD', 'NZD', 'CNY'] },
  'London Session Recap': { nom: 'Londres',   debut: 8,  fin: 18, dev: ['EUR', 'GBP', 'CHF'] },
  'US Session Recap':     { nom: 'New York',  debut: 14, fin: 23, dev: ['USD', 'CAD'] },
};

/* ACTIFS SUIVIS PAR SÉANCE. On ne montre pas les mêmes marchés selon l'heure : un récap d'Asie qui
   parlerait du S&P 500 raconterait une séance qui n'a pas encore eu lieu. Les symboles sont ceux que
   le desk interroge déjà ailleurs (SNAP_GROUPS / MOVE_ASSETS), plus les indices régionaux. */
const ACTIFS = {
  'Asia Session Recap': [
    { sym: 'USDJPY=X', label: 'USD/JPY' }, { sym: 'AUDUSD=X', label: 'AUD/USD' },
    { sym: '^N225', label: 'Nikkei 225' }, { sym: '^HSI', label: 'Hang Seng' },
    { sym: 'DX-Y.NYB', label: 'DXY' }, { sym: 'GC=F', label: 'Or' },
  ],
  'London Session Recap': [
    { sym: 'EURUSD=X', label: 'EUR/USD' }, { sym: 'GBPUSD=X', label: 'GBP/USD' },
    { sym: '^GDAXI', label: 'DAX' }, { sym: '^FTSE', label: 'FTSE 100' },
    { sym: 'DX-Y.NYB', label: 'DXY' }, { sym: 'BZ=F', label: 'Brent' },
  ],
  'US Session Recap': [
    { sym: '^GSPC', label: 'S&P 500' }, { sym: '^IXIC', label: 'Nasdaq' },
    { sym: 'EURUSD=X', label: 'EUR/USD' }, { sym: 'DX-Y.NYB', label: 'DXY' },
    { sym: '^TNX', label: '10 ans US', bp: true }, { sym: 'GC=F', label: 'Or' },
  ],
};

// ── Nombres du calendrier ───────────────────────────────────────────────────────────────────────
/* Le calendrier rend des chaînes formatées : « 2.3% », « 104K », « -8.0M », « 3.2B », « 53.9 ».
   Pour mesurer un écart il faut les ramener à un nombre COMPARABLE — et ne comparer que ce qui est
   comparable : un « 104K » face à un « 75K » se soustrait, un « 2.3% » face à « 75K » n'a aucun sens
   et ne produit donc aucun écart. */
const _MULT = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
function nombre(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  const m = /^(-?)\s*([\d.,]+)\s*([KMBT])?\s*(%)?$/i.exec(s.replace(/\s/g, ''));
  if (!m) return null;
  const n = parseFloat(m[2].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const mult = m[3] ? _MULT[m[3].toUpperCase()] : 1;
  return { valeur: (m[1] === '-' ? -1 : 1) * n * mult, pct: !!m[4], echelle: m[3] ? m[3].toUpperCase() : '' };
}
/* INDICATEURS INVERSÉS : pour le chômage, les inscriptions au chômage ou les stocks de pétrole,
   « au-dessus des attentes » est une MAUVAISE nouvelle. Sans cette liste, un chômage en hausse
   serait annoncé comme une surprise favorable — l'erreur classique d'un récap automatique. */
const INVERSES = /unemployment|jobless|claimant|claims|inventories|stocks? change|deficit/i;

/* ÉCART AU CONSENSUS. Rend de quoi écrire une phrase, jamais une interprétation de marché : on dit
   ce que le chiffre est et de combien il s'écarte, pas ce que le marché « devrait » en faire. */
function ecart(ev) {
  const a = nombre(ev && ev.actual), f = nombre(ev && ev.forecast);
  if (!a) return null;
  if (!f || a.pct !== f.pct || a.echelle !== f.echelle) return { actual: String(ev.actual).trim(), sansConsensus: true };
  const d = a.valeur - f.valeur;
  const inverse = INVERSES.test(String((ev && ev.title) || ''));
  const seuil = Math.max(Math.abs(f.valeur) * 0.005, 1e-9);       // en deçà, on parle de « conforme »
  const sens = Math.abs(d) <= seuil ? 'conforme' : ((d > 0) !== inverse ? 'au-dessus' : 'en dessous');
  return {
    actual: String(ev.actual).trim(), forecast: String(ev.forecast).trim(),
    previous: ev && ev.previous ? String(ev.previous).trim() : '',
    delta: d, sens, inverse, sansConsensus: false,
  };
}
// Écart affichable : on garde l'unité du chiffre, jamais un nombre nu sorti de nulle part.
function ecartTexte(e) {
  if (!e || e.sansConsensus || e.sens === 'conforme') return '';
  const a = nombre(e.actual), f = nombre(e.forecast);
  if (!a || !f) return '';
  const d = a.valeur - f.valeur;
  const abs = Math.abs(d);
  const signe = d > 0 ? '+' : '−';
  if (a.echelle) return `${signe}${_court(abs / (_MULT[a.echelle] || 1))}${a.echelle}`;
  if (a.pct) return `${signe}${_court(abs)} pt`;
  return `${signe}${_court(abs)}`;
}
function _court(n) {
  const r = Math.abs(n) >= 100 ? Math.round(n) : Math.abs(n) >= 10 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100;
  return String(r).replace('.', ',');
}
/* UN RENDEMENT NE SE MESURE PAS EN POURCENTAGE. Dire « le 10 ans US +2,1 % » quand il passe de
   4,10 à 4,19 est faux dans le vocabulaire du marché : on dit « +9 points de base ». Les actifs
   marqués `bp` sont donc rendus en points de base, à partir de la variation ABSOLUE. */
function bps(delta) {
  if (delta == null || !Number.isFinite(delta)) return '';
  const b = Math.round(delta * 100);
  if (b === 0) return 'inchangé';
  return (b > 0 ? '+' : '−') + Math.abs(b) + ' pb';
}
// Pourcentage de séance, à une décimale, signe explicite. Le zéro n'est ni positif ni négatif.
function pct(p) {
  if (p == null || !Number.isFinite(p)) return '';
  const r = Math.round(p * 100) / 100;
  if (Math.abs(r) < 0.005) return 'stable';
  return (r > 0 ? '+' : '−') + String(Math.abs(r).toFixed(2)).replace('.', ',') + ' %';
}

// ── Lignes du rapport ───────────────────────────────────────────────────────────────────────────
/* PHOTO DE SÉANCE : une seule ligne, les actifs qui ont réellement bougé en tête. Un actif sans
   donnée est OMIS, jamais rendu avec un tiret : une ligne vide dans un récap chiffré fait douter de
   toutes les autres. */
function lignePerf(perfs, mini) {
  const seuil = mini == null ? 0.05 : mini;
  const util = (perfs || []).filter(p => p && Number.isFinite(p.pct));
  if (!util.length) return '';
  const tri = util.slice().sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const bouge = tri.filter(p => Math.abs(p.pct) >= seuil);
  const gardes = (bouge.length ? bouge : tri).slice(0, 6);
  return gardes.map(p => `${p.label} ${p.bp && Number.isFinite(p.delta) ? bps(p.delta) : pct(p.pct)}`).join(' · ');
}
/* LIGNE MACRO : l'heure, la devise, l'intitulé, le réel, l'attendu, l'écart. Rien d'autre —
   l'interprétation appartient à la rubrique d'analyse, pas au constat. */
function ligneMacro(ev, heure) {
  const e = ecart(ev);
  if (!e) return '';
  const nom = String((ev && ev.title) || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const tete = `${heure ? heure + ' ' : ''}${ev.currency || ''} · ${nom}`.trim();
  if (e.sansConsensus) return `${tete} : ${e.actual}${e.previous ? ` (préc. ${e.previous})` : ''}`;
  if (e.sens === 'conforme') return `${tete} : ${e.actual}, conforme aux attentes${e.previous ? ` (préc. ${e.previous})` : ''}`;
  const et = ecartTexte(e);
  return `${tete} : ${e.actual} contre ${e.forecast} attendu${et ? ` (${et})` : ''}${e.previous ? `, préc. ${e.previous}` : ''}`;
}

/* SYNTHÈSE DE SÉANCE : une phrase de tête, déduite des chiffres. Elle ne qualifie que ce qui est
   mesuré — combien de publications, combien ont surpris, et le mouvement le plus marqué. */
function synthese(nomSeance, perfs, macros) {
  const util = (perfs || []).filter(p => p && Number.isFinite(p.pct));
  const fort = util.slice().sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))[0];
  const surprises = (macros || []).map(m => ecart(m)).filter(e => e && !e.sansConsensus && e.sens !== 'conforme');
  const bouts = [];
  if (macros && macros.length) {
    bouts.push(`${macros.length} publication${macros.length > 1 ? 's' : ''} sur la séance${surprises.length ? `, dont ${surprises.length} hors consensus` : ', toutes conformes aux attentes'}`);
  }
  if (fort && Math.abs(fort.pct) >= 0.05) bouts.push(`plus fort mouvement : ${fort.label} ${pct(fort.pct)}`);
  if (!bouts.length) return `Séance ${nomSeance} sans publication majeure ni mouvement notable.`;
  return `Séance ${nomSeance} : ` + bouts.join(' · ') + '.';
}

module.exports = { FENETRES, ACTIFS, nombre, ecart, ecartTexte, pct, bps, lignePerf, ligneMacro, synthese, INVERSES };

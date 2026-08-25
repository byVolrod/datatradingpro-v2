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

/* FAMILLES — LES MÊMES QUE LE RÉCAP QUOTIDIEN (26/08, retour utilisateur : « dans macro je vois pas
   les news sorties dans leur catégorie comme quotidien »). Le Quotidien range ses chiffres par
   famille — Inflation, Croissance économique, Emploi, Politique monétaire, Commerce — et le récap de
   séance sortait une liste plate. Deux rapports qui se lisent à la suite le même jour doivent ranger
   pareil, sinon le lecteur se réoriente à chaque fois.
   ⚠️ LES NOMS ET L'ORDRE SONT CEUX DE `_ORDRE_FAM` (public/js/app.js, mailer.js) et doivent le
   rester. La table est dupliquée et c'est STRUCTUREL, pas un oubli : le Quotidien classe des puces
   françaises rédigées par l'IA, côté navigateur et côté mail ; ici on classe des intitulés de
   calendrier, en anglais, côté serveur. Le projet n'a pas d'étape de build, un module Node ne peut
   donc pas être partagé avec app.js. Ce qui compte pour le lecteur — les noms et l'ordre — est
   identique ; si on renomme une famille, il faut la renommer aux TROIS endroits. */
const ORDRE_FAM = ['Inflation', 'Croissance économique', 'Emploi', 'Politique monétaire', 'Commerce', 'Autres'];
const FAM_RX = [
  ['Politique monétaire', /rate decision|interest rate decision|\bfomc\b|rate statement|policy rate|federal funds|official bank rate|refinancing rate|overnight rate|cash rate|loan prime rate|monetary policy|meeting minutes|press conference|economic projections|\bboe\b|\becb\b|\bboj\b|\brba\b|\brbnz\b|\bboc\b|\bsnb\b|\bpboc\b|speaks|speech/i],
  ['Inflation', /\bcpi\b|\bppi\b|\bpce\b|\bhicp\b|inflation|consumer price|producer price|price index|deflator|wage growth|hourly earnings|average earnings/i],
  ['Emploi', /\bnfp\b|non[-\s]?farm|payroll|employment|unemployment|jobless|claimant|\bjolts\b|job openings|labou?r/i],
  ['Croissance économique', /\bgdp\b|gross domestic|\bpmi\b|\bism\b|industrial production|manufacturing|services|retail sales|personal spending|household spending|durable goods|factory orders|confidence|sentiment|climate|\bifo\b|\bzew\b|tankan|activity index|housing|building permits|home sales|construction/i],
  ['Commerce', /trade balance|balance of trade|exports?|imports?|current account|tariff|customs/i],
];
/* L'ordre de la table n'est PAS l'ordre d'affichage : « Politique monétaire » est testée en premier
   parce qu'un « ECB Press Conference » contient « conference » et serait sinon happé par une autre
   règle. L'affichage, lui, suit ORDRE_FAM. */
function famille(titre) {
  const t = String(titre || '');
  const m = FAM_RX.find(([, rx]) => rx.test(t));
  return m ? m[0] : 'Autres';
}
// Range des lignes déjà rédigées par famille, dans l'ordre d'affichage. Une famille vide ne sort pas.
function parFamille(entrees) {
  const par = new Map();
  for (const e of (entrees || [])) {
    if (!e || !e.ligne) continue;
    const f = famille(e.titre);
    if (!par.has(f)) par.set(f, []);
    par.get(f).push(e.ligne);
  }
  return ORDRE_FAM.filter(f => (par.get(f) || []).length).map(f => ({ famille: f, lignes: par.get(f) }));
}

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
/* UN RENDEMENT NE SE CLASSE PAS AVEC LES AUTRES. Trier tout le monde sur la variation en
   pourcentage mettait le dix ans US en tête avec « +2,10 % » (4,10 → 4,19) devant un Nasdaq à
   −0,94 % : neuf points de base ne sont pas un plus gros mouvement qu'un pour cent d'indice, les
   deux grandeurs ne se comparent tout simplement pas. Les taux sont donc rendus À PART, en fin de
   ligne, comme contexte — et ils ne concourent pas au « plus fort mouvement ». */
function _estTaux(p) { return !!(p && p.bp); }
function lignePerf(perfs, mini) {
  const seuil = mini == null ? 0.05 : mini;
  const util = (perfs || []).filter(p => p && Number.isFinite(p.pct));
  if (!util.length) return '';
  const marches = util.filter(p => !_estTaux(p)).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const taux = util.filter(_estTaux);
  const bouge = marches.filter(p => Math.abs(p.pct) >= seuil);
  const gardes = (bouge.length ? bouge : marches).slice(0, 5).concat(taux);
  return gardes.map(p => `${p.label} ${_estTaux(p) && Number.isFinite(p.delta) ? bps(p.delta) : pct(p.pct)}`).join(' · ');
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
  // Le « plus fort mouvement » se cherche parmi les marchés comparables entre eux : un taux, mesuré
  // en points de base, n'entre pas dans ce classement (voir lignePerf).
  const util = (perfs || []).filter(p => p && Number.isFinite(p.pct) && !_estTaux(p));
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

module.exports = { FENETRES, ACTIFS, ORDRE_FAM, famille, parFamille, nombre, ecart, ecartTexte, pct, bps, lignePerf, ligneMacro, synthese, INVERSES };

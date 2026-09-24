'use strict';
/* ═══ DTP V3 · SAISONNALITÉ COMPLÈTE D'UNE PAIRE (vue paire en grille, UX n° 3) ═══════════════════════
   Calculs PURS (aucun I/O) sur des clôtures MENSUELLES réelles (Yahoo Finance, 15 ans au plus) :
     · tableSaisonniere : rendement de chaque mois de chaque année (carte de chaleur mois × années) ;
     · courbes : trajectoire cumulée MOYENNE d'une année type sur 5, 10 et 15 ans ;
     · statMois : pour un mois donné, part d'années haussières, moyenne, médiane, meilleur, pire.
   Rien n'est extrapolé : un mois sans deux clôtures consécutives reste vide, et une courbe n'est
   calculée que si l'historique couvre réellement son horizon. C'est une STATISTIQUE du passé,
   libellée comme telle à l'écran, jamais une prévision. */
function rendementsMensuels(ts, closes) {
  const fin = new Map();   // "AAAA-M" → dernière clôture du mois
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i]; if (!(c > 0)) continue;
    const d = new Date(ts[i] * 1000);
    fin.set(d.getUTCFullYear() * 12 + d.getUTCMonth(), c);
  }
  const cles = [...fin.keys()].sort((a, b) => a - b);
  const out = [];
  for (let k = 1; k < cles.length; k++) {
    if (cles[k] - cles[k - 1] !== 1) continue;               // deux mois consécutifs, sinon rien
    const r = (fin.get(cles[k]) / fin.get(cles[k - 1]) - 1) * 100;
    if (Number.isFinite(r)) out.push({ annee: Math.floor(cles[k] / 12), mois: cles[k] % 12, r: +r.toFixed(3) });
  }
  return out;
}
function tableSaisonniere(rend) {
  const t = {};
  for (const x of rend) { (t[x.annee] = t[x.annee] || Array(12).fill(null))[x.mois] = x.r; }
  return t;
}
function courbe(table, annees, anneeCourante) {
  const ans = Object.keys(table).map(Number).filter(a => a < anneeCourante).sort((a, b) => b - a).slice(0, annees);
  if (ans.length < annees) return null;                      // historique trop court pour cet horizon
  const moy = Array(12).fill(0).map((_, m) => {
    const v = ans.map(a => table[a][m]).filter(x => x != null);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0;
  });
  let acc = 0;
  return moy.map(x => +(acc += x).toFixed(3));
}
function statMois(table, mois, anneeCourante) {
  const v = Object.keys(table).map(Number).filter(a => a < anneeCourante).map(a => table[a][mois]).filter(x => x != null);
  if (!v.length) return null;
  const tri = [...v].sort((a, b) => a - b);
  const med = tri.length % 2 ? tri[(tri.length - 1) / 2] : (tri[tri.length / 2 - 1] + tri[tri.length / 2]) / 2;
  return { annees: v.length, hausse: v.filter(x => x > 0).length, moyenne: +(v.reduce((s, x) => s + x, 0) / v.length).toFixed(3),
           mediane: +med.toFixed(3), meilleur: +tri[tri.length - 1].toFixed(3), pire: +tri[0].toFixed(3) };
}
function saisonnalite(ts, closes, maintenant) {
  const d = new Date(maintenant || Date.now()), an = d.getUTCFullYear();
  const table = tableSaisonniere(rendementsMensuels(ts, closes));
  return { table, courbes: { a5: courbe(table, 5, an), a10: courbe(table, 10, an), a15: courbe(table, 15, an) },
           moisCourant: d.getUTCMonth(), stat: statMois(table, d.getUTCMonth(), an), annees: Object.keys(table).length };
}

/* ── ÉCHELLE JOURNALIÈRE (captures de référence : courbes 5/10/15 ans au jour près, projection) ──
   Mêmes principes : clôtures réelles, rien d'extrapolé, un horizon n'est calculé que s'il a assez
   d'années derrière lui. La PROJECTION est une distribution des rendements PASSÉS observés à la même
   date du calendrier : elle dit « voilà ce qui s'est produit les années précédentes à partir d'ici »,
   jamais « voilà ce qui va se produire ». L'écran l'écrit en toutes lettres. */
const JOUR = 86400e3;
function serieJournaliere(ts, closes) {
  const out = [];
  for (let i = 0; i < ts.length; i++) { const c = closes[i]; if (c > 0 && Number.isFinite(c)) out.push({ t: ts[i] * 1000, c }); }
  out.sort((a, b) => a.t - b.t);
  return out;
}
// Dernière clôture À OU AVANT l'instant t (recherche dichotomique) ; null si la série commence après.
function clotureAvant(serie, t) {
  let lo = 0, hi = serie.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (serie[m].t <= t) { r = m; lo = m + 1; } else hi = m - 1; }
  return r < 0 ? null : serie[r];
}
function _quantile(tri, q) {
  if (!tri.length) return null;
  const pos = (tri.length - 1) * q, b = Math.floor(pos), f = pos - b;
  return tri[b] + (tri[Math.min(b + 1, tri.length - 1)] - tri[b]) * f;
}
// Trajectoire cumulée d'une année civile, jour par jour (0..364), depuis la dernière clôture de l'année d'avant.
function cheminAnnee(serie, annee, jusqua) {
  const debut = Date.UTC(annee, 0, 1), base = clotureAvant(serie, debut - 1);
  if (!base || base.t < debut - 10 * JOUR) return null;       // pas de clôture de fin d'année précédente
  const out = [];
  for (let j = 0; j < 365; j++) {
    const t = debut + j * JOUR + JOUR - 1;
    if (jusqua && debut + j * JOUR > jusqua) break;          // le jour en cours compte (dernière clôture connue)
    const c = clotureAvant(serie, t);
    out.push(+((c.c / base.c - 1) * 100).toFixed(3));
  }
  return out;
}
function cheminsJournaliers(serie, maintenant) {
  const d = new Date(maintenant || Date.now()), an = d.getUTCFullYear();
  const premier = serie.length ? new Date(serie[0].t).getUTCFullYear() : an;
  const parAnnee = {};
  for (let a = an - 1; a >= Math.max(premier + 1, an - 15); a--) { const c = cheminAnnee(serie, a); if (c && c.length === 365) parAnnee[a] = c; }
  const moyenne = n => {
    const ans = Object.keys(parAnnee).map(Number).sort((x, y) => y - x).slice(0, n);
    if (ans.length < n) return null;
    return Array.from({ length: 365 }, (_, j) => +(ans.reduce((s, a) => s + parAnnee[a][j], 0) / n).toFixed(3));
  };
  return { a5: moyenne(5), a10: moyenne(10), a15: moyenne(15), cetteAnnee: cheminAnnee(serie, an, maintenant || Date.now()),
           jourCourant: Math.min(364, Math.floor((Date.UTC(an, d.getUTCMonth(), d.getUTCDate()) - Date.UTC(an, 0, 1)) / JOUR)) };
}
const HORIZONS = [5, 12, 19, 26, 33, 40, 47, 54];
function projection(serie, maintenant, opts) {
  const o = opts || {}, jours = o.jours || 54, minAnnees = o.minAnnees || 5;
  if (serie.length < 300) return null;
  const der = serie[serie.length - 1], d0 = new Date(der.t), an = d0.getUTCFullYear();
  const bandes = [], tableau = [];
  for (let h = 1; h <= jours; h++) {
    const r = [];
    for (let a = an - 1; a >= an - 15; a--) {
      const ancre = Date.UTC(a, d0.getUTCMonth(), d0.getUTCDate(), 23, 59);
      const c0 = clotureAvant(serie, ancre), c1 = clotureAvant(serie, ancre + h * JOUR);
      if (!c0 || !c1 || c0.t < ancre - 6 * JOUR || c1.t <= c0.t) continue;
      r.push((c1.c / c0.c - 1) * 100);
    }
    if (r.length < minAnnees) return null;
    const tri = r.slice().sort((x, y) => x - y), px = q => +(der.c * (1 + _quantile(tri, q) / 100)).toFixed(5);
    const b = { h, t: der.t + h * JOUR, p50: px(0.5), p16: px(0.16), p84: px(0.84), p025: px(0.025), p975: px(0.975), n: r.length,
                hausse: +(r.filter(x => x > 0).length / r.length * 100).toFixed(1) };
    bandes.push(b);
    if (HORIZONS.includes(h)) tableau.push({ h, t: b.t, proba: b.hausse, haut: b.p84, base: b.p50, bas: b.p16, annees: r.length });
  }
  return { depuis: { t: der.t, c: der.c }, bandes, tableau, prix: serie.slice(-130).map(x => ({ t: x.t, c: +x.c.toFixed(5) })) };
}
// Tout d'un coup, depuis UNE série journalière : le mensuel en découle (dernière clôture de chaque mois).
function saisonnaliteComplete(ts, closes, maintenant) {
  const base = saisonnalite(ts, closes, maintenant);
  const serie = serieJournaliere(ts, closes);
  return Object.assign(base, { journalier: cheminsJournaliers(serie, maintenant), projection: projection(serie, maintenant) });
}
module.exports = { rendementsMensuels, tableSaisonniere, courbe, statMois, saisonnalite,
                   serieJournaliere, clotureAvant, cheminAnnee, cheminsJournaliers, projection, saisonnaliteComplete, HORIZONS };

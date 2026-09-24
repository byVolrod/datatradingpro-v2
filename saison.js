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
module.exports = { rendementsMensuels, tableSaisonniere, courbe, statMois, saisonnalite };

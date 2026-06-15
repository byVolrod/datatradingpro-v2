/**
 * lib/bias-calc.js — Calcul DÉTERMINISTE de l'Overall Conclusion du Smart Bias.
 * PUR (aucun effet de bord, aucune IA) → testable + zéro dérive. Voir test_bias_calc.js.
 *
 * Chaque indicateur est noté (Very Bullish=+2 … Very Bearish=−2). La conclusion = moyenne pondérée,
 * mappée sur des seuils fixes (bande Neutral ±0.25, puis Weak, puis full). La bande resserrée 0.4→0.25
 * (15/06/2026) fait ressortir les penchants NETS mais faibles (ex. COT very-short dilué) au lieu de les
 * aplatir en Neutral — Neutral réservé au vrai conflit/absence de signal. Demande : moins de Neutral.
 */
const SB_SCORE = {
  'Very Bullish': 2, 'Bullish': 1, 'Weak Bullish': 0.5, 'Uptrend': 1,
  'Neutral': 0, 'Range': 0,
  'Weak Bearish': -0.5, 'Bearish': -1, 'Downtrend': -1, 'Very Bearish': -2,
};

// values = tableau de libellés de biais (un par indicateur). weights = poids parallèle optionnel
// (par défaut 1 chacun → moyenne simple). Pondérer permet de faire primer NOTRE analyse (Weekly Recap,
// Fundamental) sur le positionnement spéculatif. Renvoie la conclusion globale.
function concludeBias(values, weights) {
  let s = 0, n = 0;
  const vals = values || [], ws = weights || [];
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    if (v != null && SB_SCORE[v] != null) { const w = (ws[i] != null ? ws[i] : 1); s += SB_SCORE[v] * w; n += w; }
  }
  const avg = n ? s / n : 0;
  return avg >= 1.0 ? 'Bullish'
       : avg >= 0.25 ? 'Weak Bullish'
       : avg <= -1.0 ? 'Bearish'
       : avg <= -0.25 ? 'Weak Bearish'
       : 'Neutral';
}

module.exports = { SB_SCORE, concludeBias };

/**
 * lib/bias-calc.js — Calcul DÉTERMINISTE de l'Overall Conclusion du Smart Bias.
 * PUR (aucun effet de bord, aucune IA) → testable + zéro dérive. Voir test_bias_calc.js.
 *
 * Chaque indicateur est noté (Very Bullish=+2 … Very Bearish=−2). La conclusion = moyenne pondérée,
 * mappée sur des seuils fixes (bande Neutral ±0.4, puis Weak, puis full). Aligné sur la spec PMT.
 */
const SB_SCORE = {
  'Very Bullish': 2, 'Bullish': 1, 'Weak Bullish': 0.5, 'Uptrend': 1,
  'Neutral': 0, 'Range': 0,
  'Weak Bearish': -0.5, 'Bearish': -1, 'Downtrend': -1, 'Very Bearish': -2,
};

// values = tableau de libellés de biais (un par indicateur). Renvoie la conclusion globale.
function concludeBias(values) {
  let s = 0, n = 0;
  for (const v of (values || [])) {
    if (v != null && SB_SCORE[v] != null) { s += SB_SCORE[v]; n++; }
  }
  const avg = n ? s / n : 0;
  return avg >= 1.0 ? 'Bullish'
       : avg >= 0.4 ? 'Weak Bullish'
       : avg <= -1.0 ? 'Bearish'
       : avg <= -0.4 ? 'Weak Bearish'
       : 'Neutral';
}

module.exports = { SB_SCORE, concludeBias };

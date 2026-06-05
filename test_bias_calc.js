/**
 * test_bias_calc.js — Test de NON-RÉGRESSION du calcul Overall Conclusion (Smart Bias).
 * Vanilla (aucun framework). Lancer : `node test_bias_calc.js` (exit 0 = OK, 1 = régression).
 * But : garantir qu'une modif future ne fait pas DÉRIVER le calcul des biais (anti hors-sujet).
 */
const { concludeBias } = require('./lib/bias-calc');

// [Fundamental, Bank, HedgeFund, Retail, Monetary, Seasonality, Trend] → conclusion attendue.
const CASES = [
  { name: 'Majorité franchement haussière',  values: ['Bullish', 'Bullish', 'Very Bullish', 'Bullish', 'Neutral', 'Bullish', 'Uptrend'],   expect: 'Bullish' },
  { name: 'Tout neutre',                     values: ['Neutral', 'Neutral', 'Neutral', 'Neutral', 'Neutral', 'Neutral', 'Range'],            expect: 'Neutral' },
  { name: 'Majorité franchement baissière',  values: ['Bearish', 'Very Bearish', 'Bearish', 'Neutral', 'Bearish', 'Bearish', 'Downtrend'],   expect: 'Bearish' },
  { name: 'Légèrement haussier',             values: ['Bullish', 'Bullish', 'Bullish', 'Neutral', 'Neutral', 'Neutral', 'Range'],            expect: 'Weak Bullish' },
  { name: 'Légèrement baissier',             values: ['Bearish', 'Bearish', 'Bearish', 'Neutral', 'Neutral', 'Neutral', 'Range'],            expect: 'Weak Bearish' },
  { name: 'Signaux qui s\'annulent',         values: ['Bullish', 'Bearish', 'Neutral', 'Neutral', 'Neutral', 'Neutral', 'Range'],            expect: 'Neutral' },
  { name: 'Valeurs manquantes ignorées',     values: ['Bullish', null, undefined, 'Bullish', 'Bullish', null, 'Uptrend'],                    expect: 'Bullish' },
];

let pass = 0, fail = 0;
console.log('── Test non-régression Overall Conclusion ──');
for (const t of CASES) {
  const got = concludeBias(t.values);
  const ok = got === t.expect;
  console.log(`${ok ? '✅' : '❌'} ${t.name} → ${got}${ok ? '' : `  (attendu: ${t.expect})`}`);
  ok ? pass++ : fail++;
}
console.log(`\n${pass}/${pass + fail} tests OK`);
if (fail) { console.error('⚠️ RÉGRESSION détectée dans le calcul des biais !'); process.exit(1); }
process.exit(0);

/* ═══════════════════════════════════════════════
   DataTradingPro : amCharts 5 Charts
   Stock · Strength · Risk · Meter · COT · DMX
═══════════════════════════════════════════════ */
'use strict';

// ── Thème clair/sombre des graphiques (mode clair "full white") : fond + texte selon le thème résolu ──
// LA source de vérité du thème est html[data-theme] (posé par dtpSetTheme/_dtpThemeApply et par le
// script anti-flash du <head>). L'ancienne lecture de body.theme-light visait une classe que plus
// personne ne pose : les graphiques restaient sombres sur desk clair (audit du 18/08). Les couleurs
// sont lues au BUILD du chart : un changement de thème à chaud s'applique au prochain rendu.
function _deskLight(){ try { return document.documentElement.getAttribute('data-theme') === 'light'; } catch(e){ return false; } }
function _deskChartBg(){ return _deskLight() ? 0xffffff : 0x0d0e11; }   /* sombre = #0d0e11 = fond panneau/cartes -> fonds graphiques homogenes */
function _deskChartTxt(){ return _deskLight() ? 0x334155 : 0xcbd5e1; }
function _deskChartGrid(){ return _deskLight() ? 0xd0d4da : 0x2b2e36; }
function _deskChartAxisTxt(){ return _deskLight() ? 0x596270 : 0x8a909a; }

// ── amCharts theme matching DataTradingPro ────────────────────────────────────
function applyTerminalTheme(root) {
  const theme = am5.Theme.new(root);

  theme.rule('ColorSet').setAll({
    colors: [
      am5.color(0xe3b23a), // orange
      am5.color(0x2ecc71), // green
      am5.color(0xe74c3c), // red
      am5.color(0x3498db), // blue
      am5.color(0x9b59b6), // purple
      am5.color(0x1abc9c), // teal
      am5.color(0xf1c40f), // yellow
      am5.color(0xe67e22), // dark orange
    ],
    reuse: true,
  });

  // Grille/axes : TRÈS discrets (rendu institutionnel propre, jamais de "trait plein"), theme-aware
  theme.rule('Grid').setAll({ stroke: am5.color(_deskChartGrid()), strokeOpacity: _deskLight() ? 0.6 : 0.3, strokeWidth: 1, strokeDasharray: [2, 4] });
  theme.rule('AxisRendererX').setAll({ stroke: am5.color(_deskChartGrid()), strokeOpacity: 0.2 });
  theme.rule('AxisRendererY').setAll({ stroke: am5.color(_deskChartGrid()), strokeOpacity: 0.2 });
  theme.rule('Label').setAll({ fill: am5.color(_deskChartAxisTxt()), fontSize: 10, fontFamily: '-apple-system, "Inter", "Segoe UI", sans-serif' });
  // Infobulles CARRÉES (cohérent avec l'identité desk) + contraste net
  theme.rule('Tooltip').setAll({
    background: am5.Rectangle.new(root, {
      fill: am5.color(0x12141a),
      stroke: am5.color(0x2b2e36),
      strokeWidth: 1,
      cornerRadiusTL: 0, cornerRadiusTR: 0, cornerRadiusBL: 0, cornerRadiusBR: 0,
    }),
    paddingTop: 7, paddingBottom: 7, paddingLeft: 11, paddingRight: 11,
  });
  theme.rule('Label', ['tooltip']).setAll({ fill: am5.color(0xe2e5ea), fontSize: 11, fontWeight: '500', fontFamily: '-apple-system, "Inter", "Segoe UI", sans-serif' });

  return theme;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function disposeRoot(id) {
  try {
    const existing = am5.registry.rootElements.find(r => r.dom && r.dom.id === id);
    if (existing) existing.dispose();
  } catch (_) {}
}
// (generateOHLC SUPPRIME le 15/08/2026 : il fabriquait des bougies par Math.random pour le widget
//  Graphique. Le widget lit desormais de vraies bougies via /api/bank-ohlc. La fonction n avait plus
//  aucun appelant ; on ne la garde pas « au cas ou » — un generateur de fausses cotations qui traine
//  dans un terminal de trading finit toujours par etre rebranche quelque part.)

// ── FX pairs config ──────────────────────────────────────────────────────────

const FX_PAIRS = [
  { name: 'EUR/USD', base: 1.0845, vol: 0.0006 },
  { name: 'GBP/USD', base: 1.2682, vol: 0.0008 },
  { name: 'USD/JPY', base: 157.42, vol: 0.015  },
  { name: 'USD/CHF', base: 0.9124, vol: 0.0006 },
  { name: 'AUD/USD', base: 0.6518, vol: 0.0007 },
  { name: 'NZD/USD', base: 0.6028, vol: 0.0007 },
  { name: 'USD/CAD', base: 1.3621, vol: 0.0007 },
  { name: 'EUR/GBP', base: 0.8557, vol: 0.0005 },
];

const INDICES = [
  { name: 'DAX',    base: 18420, vol: 0.008 },
  { name: 'S&P 500',base: 5290,  vol: 0.006 },
  { name: 'FTSE',   base: 8240,  vol: 0.006 },
  { name: 'CAC 40', base: 8080,  vol: 0.007 },
];

const COMMODITIES = [
  { name: 'Gold',   base: 2328, vol: 0.004 },
  { name: 'Oil WTI',base: 78.4, vol: 0.010 },
  { name: 'Silver', base: 29.2, vol: 0.008 },
];

// Live-ish ticker simulation
const priceState = {};
[...FX_PAIRS, ...INDICES, ...COMMODITIES].forEach(p => {
  // Le champ `data` portait 200 bougies ALEATOIRES par symbole, soit ~3000 fabriquees a chaque
  // chargement de page : il n'etait lu NULLE PART. `price` reste utile, non comme cotation (le tic
  // qui le faisait vivre est desactive plus bas) mais comme table de FORMATAGE : c'est son ordre de
  // grandeur qui decide du nombre de decimales de l'axe des prix.
  priceState[p.name] = { price: p.base, prev: p.base };
});

// ── LA DERNIERE MACHINERIE DE PRIX SIMULES A ETE SUPPRIMEE (15/08/2026) ──────────────────────
//  Cinq fonctions formaient un amas FERME, qui ne s appelait plus qu entre lui-meme :
//    buildBiasSidebar (point d entree, ZERO appelant) -> makeItem / updateSidebarPrices /
//    selectPair -> rebuildStockChart ; et tickPrices, deja neutralise par un `void`.
//  Elles alimentaient une ancienne colonne de prix : prix rafraichis toutes les 3 s par
//  Math.random, variation en % coloree, et reconstruction du graphique au clic.
//  PREUVE DE LEUR MORT, verifiee page par page : #bias-pairs, #bias-indices, #bias-commodities,
//  #bias-symbol-name, #chart-stock et .bias-tf-group n existent dans AUCUN des 4 fichiers HTML.
//  Le listener d unite de temps etait lui aussi branche sur .bias-tf-group : jamais declenche.
//  On ne garde pas ce code « au cas ou » : c est un generateur de fausses cotations, et le desk
//  vient tout juste de cesser d en afficher.
//  CE QUI SURVIT, et pourquoi : FX_PAIRS / INDICES / COMMODITIES (catalogue des instruments),
//  priceState (son champ `price` sert de table de FORMATAGE : l ordre de grandeur decide du
//  nombre de decimales de l axe), activeTimeframe et activePair (lus par buildStockChart).


// ═══════════════════════════════════════════════
//  BIAS SIDEBAR
// ═══════════════════════════════════════════════

let activePair = 'EUR/USD';
let activeTimeframe = 'H4';
let stockRoot = null;




// ═══════════════════════════════════════════════
//  STOCK CHART (BIAS view)
// ═══════════════════════════════════════════════

// `containerId` optionnel (widget « Mon Desk » — même patron que buildMeterChart) ; défaut = le
// graphique de l'onglet MARCHÉS. Sans ce paramètre, deux graphiques bougies ne pouvaient pas coexister :
// le second détruisait la racine amCharts du premier.
/* ── DE VRAIES BOUGIES, OU AUCUNE (15/08/2026) ────────────────────────────────────────────────
   Ce graphique dessinait une MARCHE ALEATOIRE (`generateOHLC`, Math.random) amorcee sur un prix
   ECRIT EN DUR et jamais rafraichi — l'or y partait de 2328 $ quand il en cotait 4362. Par-dessus
   ce bruit, le desk empilait deux moyennes mobiles, un RSI, un histogramme de volume, et une barre
   d'outils invitant a tracer des lignes de tendance. Un client pouvait y faire de l'analyse
   technique sur des chiffres qui n'ont jamais existe.
   La source reelle etait deja en production : /api/bank-ohlc sert les bougies Yahoo qui alimentent
   l'onglet BANQUES. On s'y branche.
   REGLE : si la source ne repond pas, on affiche « Graphique indisponible. » — jamais une courbe
   plausible. Un graphique faux est pire qu'un graphique absent. C'est le comportement que l'onglet
   BANQUES applique deja (app.js ~5503) : on l'aligne.
   Le VOLUME a disparu, et c'est voulu : le FX au comptant n'a pas de volume consolide, et la route
   n'en renvoie aucun. Mieux vaut une rubrique en moins qu'une rubrique inventee. */
const _TF_OHLC = { M1: 'M15', M5: 'M15', M15: 'M15', H1: 'H1', H4: 'H4', D1: 'D1', W1: 'W1' };
async function _ohlcReel(nom, tfKey) {
  // M1 et M5 n'existent pas cote source : on sert le M15, l'unite reelle la plus fine, plutot que
  // de fabriquer des bougies intermediaires. L'utilisateur voit alors de vraies M15.
  const tf = _TF_OHLC[tfKey] || 'H4';
  const fx = /^[A-Z]{3}\/[A-Z]{3}$/.test(nom);
  const q = fx ? 'pair=' + encodeURIComponent(nom) : 'sym=' + encodeURIComponent(nom);
  try {
    const r = await fetch('/api/bank-ohlc?' + q + '&tf=' + tf);
    const j = await r.json();
    const c = Array.isArray(j && j.candles) ? j.candles : [];
    return c.filter(x => x && x.o != null && x.h != null && x.l != null && x.c != null)
      .map(x => ({ Date: x.t, Open: x.o, High: x.h, Low: x.l, Close: x.c }));
  } catch (e) { return []; }
}
function _grapheVide(cid, msg) {
  const el = document.getElementById(cid);
  if (el) el.innerHTML = '<div class="wr-chart-loading" style="padding:24px;text-align:center;">' + (msg || 'Graphique indisponible.') + '</div>';
  return null;
}
async function buildStockChart(symbol, containerId, tfKey) {
  const _cid = containerId || 'chart-stock';
  disposeRoot(_cid);
  const all = [...FX_PAIRS, ...INDICES, ...COMMODITIES];
  const p = all.find(x => x.name === symbol) || FX_PAIRS[0];
  const tfMap = { M1: [1/60, 100], M5: [5/60, 100], M15: [0.25, 100], H1: [1, 150], H4: [4, 200], D1: [24, 365], W1: [168, 104] };
  // `tfKey` : unité de temps PROPRE à l'appelant (widget « Mon Desk »). Sans lui, on suit celle de
  // l'onglet MARCHÉS — un widget qui la lirait globalement changerait de période quand l'utilisateur
  // touche l'onglet, et inversement.
  const [tfH, periods] = tfMap[tfKey || activeTimeframe] || [4, 200];

  // Regenerate data for the selected pair + timeframe
  // On lit priceState par p.name (et non par `symbol`) : un widget dont la paire sauvegardée aurait
  // disparu du catalogue retombe sur EUR/USD au lieu de planter sur un état inexistant.
  const s = priceState[p.name];
  void periods; void tfH;              // bornes de l'ancienne simulation : la source decide desormais
  const ohlcData = await _ohlcReel(p.name, tfKey || activeTimeframe);
  if (!ohlcData.length) return _grapheVide(_cid);   // aucune donnee reelle -> on le DIT, on n'invente pas

  const root = _dtpAncreGraphe(am5.Root.new(_cid));
  if (!containerId) stockRoot = root;      // seul l'onglet MARCHÉS pilote la racine globale
  root._logo?.set('forceHidden', true);

  root.setThemes([
    am5themes_Animated.new(root),
    applyTerminalTheme(root),
  ]);

  root._logo?.dispose();

  // ── Stock chart ───────────────────────────────
  const stockChart = root.container.children.push(
    am5stock.StockChart.new(root, {
      paddingRight: 0,
      paddingBottom: 0,
    })
  );

  // ── Main panel (OHLC + EMA) ───────────────────
  const mainPanel = stockChart.panels.push(
    am5stock.StockPanel.new(root, {
      wheelY: 'zoomX',
      panX: true,
      panY: true,
      height: am5.percent(68),
    })
  );

  mainPanel.set('background', am5.Rectangle.new(root, { fill: am5.color(_deskChartBg()), fillOpacity: 1 }));

  const valueAxis = mainPanel.yAxes.push(
    am5xy.ValueAxis.new(root, {
      renderer: am5xy.AxisRendererY.new(root, {
        pan: 'zoom',
        opposite: true,
        inside: false,
      }),
      tooltip: am5.Tooltip.new(root, {}),
      numberFormat: `#,###.${'0'.repeat(p.base < 10 ? 5 : p.base < 1000 ? 2 : 0)}`,
    })
  );

  const dateAxis = mainPanel.xAxes.push(
    am5xy.GaplessDateAxis.new(root, {
      baseInterval: { timeUnit: tfH < 1 ? 'minute' : tfH < 24 ? 'hour' : 'day', count: tfH < 1 ? Math.round(tfH * 60) : tfH < 24 ? tfH : 1 },
      renderer: am5xy.AxisRendererX.new(root, { minorGridEnabled: true }),
      tooltip: am5.Tooltip.new(root, {}),
    })
  );

  // ── Candlestick series ────────────────────────
  const candleSeries = mainPanel.series.push(
    am5xy.CandlestickSeries.new(root, {
      name: symbol,
      clustered: false,
      valueXField: 'Date',
      valueYField: 'Close',
      highValueYField: 'High',
      lowValueYField: 'Low',
      openValueYField: 'Open',
      calculateAggregates: true,
      xAxis: dateAxis,
      yAxis: valueAxis,
      legendValueText: '[#666]O:[/] [bold]{openValueY}[/]  [#666]H:[/] [bold]{highValueY}[/]  [#666]L:[/] [bold]{lowValueY}[/]  [#666]C:[/] [bold]{valueY}[/]',
      tooltip: am5.Tooltip.new(root, {
        pointerOrientation: 'horizontal',
        labelText: '[bold]{name}[/]\nO: {openValueY}  H: {highValueY}\nL: {lowValueY}  C: {valueY}',
      }),
    })
  );

  /* BOUGIES FAÇON TERMINAL DE RÉFÉRENCE (11/08, demande user) — deux défauts corrigés :
     · `strokeOpacity: 0` éteignait le TRAIT de la bougie. Or dans amCharts, c'est ce trait qui dessine
       la MÈCHE (haut/bas) : elles ressortaient filiformes et grisâtres au lieu de porter la couleur du
       corps. Trait rétabli, épaisseur 1, et MÊME couleur que le corps via le même adaptateur ;
     · les teintes étaient les couleurs génériques d'un thème plat (#2ecc71 / #e74c3c). On passe au
       couple canonique des terminaux — vert-sarcelle #26a69a, rouge corail #ef5350 — qui tient sur fond
       sombre sans vibrer, contrairement à un vert pur.
     Corps à 72 % du pas (au lieu de 80) : les bougies respirent, on distingue chaque séance. */
  const _CDL_UP = am5.color(0x26a69a), _CDL_DOWN = am5.color(0xef5350);
  const _cdlCol = target => {
    const di = target.dataItem;
    if (!di) return am5.color(0xe3b23a);
    return di.get('valueY') >= di.get('openValueY') ? _CDL_UP : _CDL_DOWN;
  };
  candleSeries.columns.template.setAll({
    strokeOpacity: 1,
    strokeWidth: 1,
    cornerRadiusBR: 0,
    cornerRadiusTR: 0,
    width: am5.percent(72),
  });
  candleSeries.columns.template.adapters.add('fill', (_f, t) => _cdlCol(t));
  candleSeries.columns.template.adapters.add('stroke', (_s, t) => _cdlCol(t));

  // ── EMA 20 ───────────────────────────────────
  const ema20 = mainPanel.series.push(
    am5xy.LineSeries.new(root, {
      name: 'EMA 20',
      xAxis: dateAxis,
      yAxis: valueAxis,
      valueXField: 'Date',
      valueYField: 'Close',
      stroke: am5.color(0xe3b23a),
      tooltip: am5.Tooltip.new(root, { labelText: 'EMA 20: {valueY}' }),
    })
  );
  ema20.strokes.template.setAll({ strokeWidth: 1.5, strokeDasharray: [] });

  // ── EMA 50 ───────────────────────────────────
  const ema50 = mainPanel.series.push(
    am5xy.LineSeries.new(root, {
      name: 'EMA 50',
      xAxis: dateAxis,
      yAxis: valueAxis,
      valueXField: 'Date',
      valueYField: 'Close',
      stroke: am5.color(0x3498db),
      tooltip: am5.Tooltip.new(root, { labelText: 'EMA 50: {valueY}' }),
    })
  );
  ema50.strokes.template.setAll({ strokeWidth: 1.5, strokeOpacity: 0.8 });

  // ── Volume : RUBRIQUE RETIREE (15/08/2026) ────────────────────────────────────────────────
  // L histogramme de volume etait entierement invente (Math.round(800 + Math.random()*4200)).
  // Il n a pas ete remplace par une vraie serie parce qu il n en existe pas : le FX au comptant
  // n a pas de volume consolide, et /api/bank-ohlc n en renvoie aucun. Une rubrique en moins vaut
  // mieux qu une rubrique fabriquee.
  // ── RSI panel ────────────────────────────────
  const rsiPanel = stockChart.panels.push(
    am5stock.StockPanel.new(root, {
      wheelY: 'zoomX',
      panX: true,
      height: am5.percent(16),
    })
  );

  rsiPanel.set('background', am5.Rectangle.new(root, { fill: am5.color(_deskChartBg()), fillOpacity: 1 }));

  const rsiValueAxis = rsiPanel.yAxes.push(
    am5xy.ValueAxis.new(root, {
      min: 0, max: 100,
      strictMinMax: true,
      renderer: am5xy.AxisRendererY.new(root, { pan: 'zoom', opposite: true }),
    })
  );

  const rsiDateAxis = rsiPanel.xAxes.push(
    am5xy.GaplessDateAxis.new(root, {
      baseInterval: dateAxis.get('baseInterval'),
      renderer: am5xy.AxisRendererX.new(root, {}),
    })
  );

  // RSI overbought/oversold ranges
  [30, 70].forEach(level => {
    const range = rsiValueAxis.createAxisRange(rsiValueAxis.makeDataItem({ value: level }));
    range.get('grid').setAll({ stroke: am5.color(0x333333), strokeOpacity: 0.8, strokeWidth: 1, strokeDasharray: [4, 4] });
    range.get('label').setAll({ text: String(level), fill: am5.color(0x555555), inside: true });
  });

  const rsiSeries = rsiPanel.series.push(
    am5xy.LineSeries.new(root, {
      name: 'RSI(14)',
      xAxis: rsiDateAxis,
      yAxis: rsiValueAxis,
      valueXField: 'Date',
      valueYField: 'RSI',
      stroke: am5.color(0x9b59b6),
    })
  );
  rsiSeries.strokes.template.setAll({ strokeWidth: 1.5 });

  // ── Scrollbar ────────────────────────────────
  const scrollbar = mainPanel.set('scrollbarX',
    am5xy.XYChartScrollbar.new(root, {
      orientation: 'horizontal',
      height: 28,
    })
  );

  scrollbar.set('background', am5.Rectangle.new(root, { fill: am5.color(_deskChartBg()), fillOpacity: 1 }));

  const sbDateAxis = scrollbar.chart.xAxes.push(
    am5xy.GaplessDateAxis.new(root, {
      baseInterval: dateAxis.get('baseInterval'),
      renderer: am5xy.AxisRendererX.new(root, { minorGridEnabled: false }),
    })
  );

  const sbValueAxis = scrollbar.chart.yAxes.push(
    am5xy.ValueAxis.new(root, { renderer: am5xy.AxisRendererY.new(root, {}) })
  );

  const sbSeries = scrollbar.chart.series.push(
    am5xy.LineSeries.new(root, {
      valueXField: 'Date',
      valueYField: 'Close',
      xAxis: sbDateAxis,
      yAxis: sbValueAxis,
      stroke: am5.color(0xe3b23a),
      fill: am5.color(0xe3b23a),
    })
  );
  sbSeries.fills.template.setAll({ fillOpacity: 0.08, visible: true });

  /* ── Barre d'outils du graphe ────────────────────────────────────────────────────────────────
     ⚠️ Le conteneur était CODÉ EN DUR sur #chart-stock, l'élément de l'onglet MARCHÉS. Monté depuis
     le widget « Graphique » de Mon Desk, cet élément n'existe pas : StockToolbar recevait null et
     JETAIT — d'où le repli « Graphique indisponible » sur un widget par ailleurs bien construit.
     On prend le conteneur de CE graphe, et on n'ajoute la barre que s'il est présent. */
  const _hoteBarre = document.getElementById(_cid);
  const toolbar = _hoteBarre ? am5stock.StockToolbar.new(root, {
    container: _hoteBarre,
    stockChart,
    controls: [
      am5stock.IndicatorControl.new(root, { stockChart, legend: mainPanel.children.push(am5.Legend.new(root, { centerX: am5.percent(100), x: am5.percent(100) })) }),
      am5stock.DrawingControl.new(root, { stockChart }),
      am5stock.ResetControl.new(root, { stockChart }),
      am5stock.SettingsControl.new(root, { stockChart }),
    ],
  }) : null;

  // ── Compute EMA helper ────────────────────────
  function calcEMA(data, period) {
    const k = 2 / (period + 1);
    let ema = null;
    return data.map((d, i) => {
      if (i === 0) { ema = d.Close; return { ...d, EMA: ema }; }
      ema = d.Close * k + ema * (1 - k);
      return { ...d, EMA: ema };
    });
  }

  function calcRSI(data, period = 14) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
      if (i < period) { result.push({ ...data[i], RSI: 50 }); continue; }
      let gains = 0, losses = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const delta = data[j].Close - data[j - 1].Close;
        if (delta > 0) gains += delta; else losses -= delta;
      }
      const rs = losses === 0 ? 100 : gains / losses;
      result.push({ ...data[i], RSI: parseFloat((100 - 100 / (1 + rs)).toFixed(2)) });
    }
    return result;
  }

  // ── Compute & set data ─────────────────────────
  let d = calcEMA(ohlcData, 20);
  const ema20Data = d.map(x => ({ ...x, Close: x.EMA }));
  d = calcEMA(ohlcData, 50);
  const ema50Data = d.map(x => ({ ...x, Close: x.EMA }));
  const rsiData = calcRSI(ohlcData, 14);

  candleSeries.data.setAll(ohlcData);
  ema20.data.setAll(ema20Data);
  ema50.data.setAll(ema50Data);
  sbSeries.data.setAll(ohlcData);
  rsiSeries.data.setAll(rsiData);

  // ── Cursor ────────────────────────────────────
  const cursor = mainPanel.set('cursor',
    am5xy.XYCursor.new(root, {
      behavior: 'zoomXY',
      xAxis: dateAxis,
    })
  );
  cursor.lineY.set('visible', false);
  cursor.lineX.setAll({ stroke: am5.color(0x444444), strokeWidth: 1, strokeDasharray: [4, 4] });

  // Sync cursors across panels
  [rsiPanel].forEach(panel => {   // (le panneau volume a ete retire : aucune donnee reelle)
    panel.set('cursor', am5xy.XYCursor.new(root, { behavior: 'zoomX', xAxis: panel.xAxes.getIndex(0) }));
  });

  candleSeries.appear(800, 100);

  return root;
}


// ═══════════════════════════════════════════════
//  STRENGTH : Real Force des Devises (Single Chart + TF Selector)
// ═══════════════════════════════════════════════

// Palette SATURÉE : couleurs plus vives/denses pour RESSORTIR sur le fond noir #0d0d0d.
const CS_COLORS = {
  USD: 0xe8eaed,  // blanc (orange écarté ; blanc = distinct de CHF jaune-or, convention devise de base)
  EUR: 0xff3b30,  // rouge vif (était #dc2626, trop mat)
  JPY: 0x22d3ee,  // cyan clair vif
  GBP: 0x2bee6b,  // vert flashy dense
  AUD: 0x3b82f6,  // bleu roi + lumineux (était #2563eb, sombre sur fond noir)
  CHF: 0xffd60a,  // jaune doré vif
  CAD: 0xbe8bff,  // violet vif
  NZD: 0xff5cae,  // rose magenta vif
};
/* ⚠️ CE QUE CETTE PALETTE NE TIENT PAS, MESURÉ LE 04/09 — à savoir avant d'y toucher. Huit courbes
   sont à l'écran EN MÊME TEMPS : ce sont donc les 28 paires qu'il faut séparer, pas seulement les
   voisines d'une liste. Sur ce fond, la paire la plus fragile est JPY/GBP à ΔE 3,9 en vision
   tritanope, et GBP/CHF à 4,1 en protanope — sous le plancher de 6. Concrètement, deux des huit
   courbes se confondent pour une partie des lecteurs. Toutes les autres paires tiennent (≥ 6,8), et
   AUCUNE ne passe sous le plancher de vision normale (15,0 au pire, EUR/NZD).
   CE QUI REND LA CARTE LISIBLE MALGRÉ ÇA : la couleur n'est pas seule à désigner une devise — le
   code est écrit sur la pastille au bout de chaque courbe, et la légende porte le même code. C'est
   l'encodage secondaire qui rend une paire faible acceptable.
   ⚠️ CES TEINTES SONT DES CHOIX DE L'UTILISATEUR, itérés (« orange écarté », « était #dc2626, trop
   mat », « était #2563eb, sombre sur fond noir ») : on ne les remplace pas sans lui. La correction
   minimale, si elle est demandée un jour, est de déplacer LE VERT — une seule teinte suffit à
   remonter la pire paire de 3,9 à 6,8, et au-delà il faut en bouger deux. */
/* ══ LA MÊME PALETTE NE PEUT PAS SERVIR SUR BLANC (29/08) ═══════════════════════════════════════
   Ces huit teintes sont réglées pour ressortir sur le fond sombre du desk, et elles y ressortent :
   la plus faible tient 5,25 pour un seuil de 3. Sur le fond BLANC du thème clair, mesuré, SIX des
   huit passent sous 3 — et l'USD, qui est un blanc cassé, tombe à 1,21 : sa courbe est littéralement
   invisible. Le graphique promettait huit devises et en montrait deux ou trois.
   On garde l'IDENTITÉ de chaque devise — même famille de teinte, donc le lecteur qui passe d'un
   thème à l'autre reconnaît ses courbes — en descendant la luminosité de ce qu'il faut. Mesuré :
   les huit tiennent entre 4,87 et 15,52 sur blanc, et la paire la plus proche (AUD/CAD, distance
   Lab 34,4) est même MIEUX séparée que la paire la plus proche de la palette sombre (30,1). */
const CS_COLORS_CLAIR = {
  USD: 0x1f2430,  // ardoise très sombre : sur blanc, le « neutre » de la devise de base
  EUR: 0xd92318,  // rouge profond
  JPY: 0x0e7490,  // cyan foncé
  GBP: 0x15803d,  // vert foncé
  AUD: 0x2563eb,  // bleu roi
  CHF: 0x9a6700,  // or foncé
  CAD: 0x7c3aed,  // violet
  NZD: 0xc2185b,  // magenta foncé
};
// La couleur d'une devise POUR LE THÈME COURANT. Un seul point de décision : les pastilles, les
// courbes et les listes ne peuvent pas diverger.
function _csCouleur(ccy) {
  const t = _deskLight() ? CS_COLORS_CLAIR : CS_COLORS;
  return t[ccy] || CS_COLORS[ccy] || 0x888888;
}
/* ══ ET CE POINT DE DÉCISION UNIQUE DOIT VALOIR HORS DE CE FICHIER AUSSI (04/09) ═══════════════
   Le commentaire ci-dessus dit « un seul point de décision : les pastilles, les courbes et les
   listes ne peuvent pas diverger ». C'était vrai DANS charts.js, et faux dans le desk : le récap
   hebdomadaire (app.js) portait sa PROPRE table de huit couleurs de devises. Les huit divergeaient,
   et l'USD carrément de famille — or de marque d'un côté, blanc de l'autre — donc la même devise
   portait deux couleurs dans le même produit.
   ⚠️ ET LA COPIE N'AVAIT PAS DE VARIANTE CLAIRE. Mesuré sur fond blanc : QUATRE des huit codes
   passaient sous le contraste 3:1 exigé pour du gros texte — l'USD à 1,96, le CHF à 1,92. C'est
   exactement le défaut réparé ICI le 29/08, que la copie n'avait jamais reçu. Une seule table le
   reçoit une seule fois.
   Rendue en chaîne CSS : app.js peint du texte, charts.js des courbes amCharts (qui veut un
   nombre). La conversion vit ici, à la source. */
if (typeof window !== 'undefined') {
  window.DTPCsCouleur = function (ccy) {
    const n = _csCouleur(ccy);
    return '#' + Number(n).toString(16).padStart(6, '0');
  };
}

/* ══ RÉGLAGES D'AFFICHAGE MÉMORISÉS PAR COMPTE — MAGASIN GÉNÉRIQUE (12/08) ══════════════════════════
   Demande user : « chaque config ou affichage d'un widget que je configure doit être mémorisé pour
   chaque compte ». Le desk avait des réglages persistants (période Force, thème, zoom, saisonnalité)
   mais une quinzaine d'autres étaient PUREMENT VOLATILES : période Force en vue symbole, type COT,
   unité de temps et tri du DMX, filtre d'impact du calendrier, sous-onglet symbole, filtres du
   Journal, onglet des alertes… Chacun oubliait le choix au moindre rechargement.
   Ce module leur donne à TOUS la même mécanique que la période Force, dont l'architecture a été
   validée à l'usage — et ses trois garde-fous, chèrement acquis :
     · `keepalive` sur l'écriture (sinon la requête meurt quand on se déconnecte dans la foulée) ;
     · un drapeau « en attente » rejoué au départ de page ;
     · l'horodatage du dernier clic, pour qu'une réponse serveur partie AVANT un clic ne vienne
       jamais l'écraser (c'est exactement ce qui faisait « oublier » la période Force).
   localStorage n'est qu'un cache d'affichage instantané ; la SOURCE DE VÉRITÉ est le compte, donc le
   réglage suit l'utilisateur d'un appareil à l'autre. */
const DTPPref = (function () {
  var LS = 'dtp_uiprefs';
  var cache = null;          // valeurs connues (compte ou cache local)
  var sale = {};             // clés écrites mais pas encore confirmées par le compte
  var clicAt = 0;            // dernier choix HUMAIN — arbitre la course avec la réponse serveur
  var enVol = null, chargeA = 0, pret = false;
  /* ── TAMPON DE PROPRIÉTAIRE (12/08) : LES RÉGLAGES D'UN COMPTE NE DOIVENT JAMAIS ATTEINDRE UN AUTRE.
     Défaut trouvé par l'audit et vérifié dans le code : la clé `dtp_uiprefs` est GLOBALE au
     navigateur, et la branche de réparation de `charger()` pousse le cache local vers le compte
     quand celui-ci ne connaît encore aucun réglage. Sur un poste partagé — démo, formation,
     ordinateur familial — le compte A configurait son desk, B se connectait, et les réglages de A
     étaient ÉCRITS sur le compte de B. Pas un artefact d'affichage : une écriture serveur, qui
     suivait ensuite B sur son propre téléphone.
     ⚠️ On n'indexe PAS la clé par identifiant : `get()` est appelé de façon SYNCHRONE au premier
     rendu, alors que /api/auth/me est encore en vol — la clé serait coupée en deux et on perdrait la
     peinture instantanée, seule raison d'être de ce cache. On estampille donc le CONTENU, et
     `owner()` tranche dès que l'identité est connue. */
  var _uid = '';
  function local() {
    try {
      var j = JSON.parse(localStorage.getItem(LS) || 'null');
      if (!j || typeof j !== 'object') return {};
      var o = {}; for (var k in j) if (k !== '_u') o[k] = j[k];
      return o;
    } catch (e) { return {}; }
  }
  function tamponLocal() {                       // propriétaire inscrit dans le cache, '' si inconnu
    try { var j = JSON.parse(localStorage.getItem(LS) || 'null'); return (j && typeof j === 'object' && j._u) ? String(j._u) : ''; }
    catch (e) { return ''; }
  }
  function ecrisLocal() {
    try {
      var o = {}; for (var k in cache) o[k] = cache[k];
      if (_uid) o._u = _uid;                     // on n'estampille que si l'identité est connue
      localStorage.setItem(LS, JSON.stringify(o));
    } catch (e) {}
  }
  function pousse(obj) {
    try {
      fetch('/api/ui-prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(obj), keepalive: true })
        .then(function (r) { if (r.ok) Object.keys(obj).forEach(function (k) { delete sale[k]; }); })
        .catch(function () {});
    } catch (e) {}
  }
  (function () {
    var renvoi = function () {
      var k = Object.keys(sale); if (!k.length || !cache) return;
      var o = {}; k.forEach(function (x) { o[x] = cache[x]; });
      pousse(o);
    };
    window.addEventListener('pagehide', renvoi);
    document.addEventListener('visibilitychange', function () { if (document.hidden) renvoi(); });
  })();
  return {
    /* Déclare le compte connecté, dès que /api/auth/me a répondu. Si le cache local porte le tampon
       d'un AUTRE compte, il est jeté sur-le-champ — c'est ce qui referme la fuite, y compris quand
       l'utilisateur précédent n'a jamais cliqué sur « Déconnexion » (session expirée, onglet fermé).
       Un cache SANS tampon est de provenance inconnue : on le garde pour l'affichage mais on ne le
       poussera jamais vers un compte (cf. `charger`). */
    owner: function (id) {
      var v = String(id || ''); if (!v) return;
      var t = tamponLocal();
      if (t && t !== v) {
        try { localStorage.removeItem(LS); } catch (e) {}
        // Le cache des périodes Force n'est pas estampillé : il suivrait sinon le compte précédent.
        try { localStorage.removeItem('dtp_stf_tf'); } catch (e) {}
        cache = {}; sale = {}; pret = false; enVol = null;
      }
      _uid = v;
      if (cache) ecrisLocal();                   // (re)pose le tampon sur le cache conservé
    },
    // Valeur connue TOUT DE SUITE (cache local), sans attendre le compte : les vues se dessinent
    // au bon réglage dès la première frame, comme le fait déjà la barre de périodes Force.
    get: function (k, def) {
      if (!cache) cache = local();
      var v = cache[k];
      return (v === undefined || v === null || v === '') ? def : v;
    },
    set: function (k, v) {
      if (!cache) cache = local();
      if (cache[k] === v) return;
      cache[k] = String(v == null ? '' : v);
      clicAt = Date.now();
      sale[k] = 1;
      ecrisLocal();
      var o = {}; o[k] = cache[k];
      pousse(o);
    },
    // Charge les réglages du COMPTE. `onPret` reçoit l'objet complet une fois aligné — les vues déjà
    // dessinées peuvent s'y recaler. Un seul appel réseau, quel que soit le nombre d'appelants.
    charger: function (onPret) {
      if (pret) { if (onPret) onPret(cache || {}); return Promise.resolve(cache || {}); }
      if (!enVol) {
        chargeA = Date.now();
        enVol = fetch('/api/ui-prefs').then(function (r) { return r.json(); }).then(function (r) {
          if (!cache) cache = local();
          if (r && r.src === 'kv' && r.prefs) {
            // Le compte fait foi — SAUF pour les clés que l'utilisateur vient de changer pendant le
            // vol de la requête : son geste est plus récent que la réponse, il gagne.
            var frais = clicAt > chargeA;
            Object.keys(r.prefs).forEach(function (k) { if (!(frais && sale[k])) cache[k] = r.prefs[k]; });
            ecrisLocal();
          } else if (r && r.src === 'defaut') {
            // Le compte ne sait rien mais le navigateur se souvient : on répare le compte — MAIS
            // SEULEMENT si le cache local porte le tampon de CE compte. Sans cette garde, c'était le
            // chemin exact de la fuite : le compte neuf de B héritait, par écriture serveur, des
            // réglages laissés par A sur le même navigateur. Un cache sans tampon (antérieur au
            // correctif, ou d'origine inconnue) ne remonte JAMAIS : un compte neuf part sur ses
            // défauts, ce qui est le comportement correct — et il se re-remplira au premier clic.
            var loc = local();
            if (_uid && tamponLocal() === _uid && Object.keys(loc).length) {
              Object.keys(loc).forEach(function (k) { sale[k] = 1; }); pousse(loc);
            }
          }
          pret = true;
          return cache || {};
        }).catch(function () { enVol = null; return cache || local(); });   // échec réseau : on retentera
      }
      return enVol.then(function (c) { if (onPret) onPret(c); return c; });
    },
  };
})();
if (typeof window !== 'undefined') window.DTPPref = DTPPref;   // app.js consomme le même magasin

const STF_ORDER  = ['today', 'week', '8h', '1d', '7d', '1m'];   // 5D retiré
/* ══ PÉRIODE MÉMORISÉE PAR COMPTE (06/08) ═══════════════════════════════════════════════════════════
   Demande user : le choix de période doit survivre au changement d'onglet ET à la déconnexion.
   Source de vérité = le COMPTE (KV serveur, /api/strength-tf) → il suit aussi le changement
   d'appareil. localStorage n'est qu'un cache instantané, pour que la barre s'affiche déjà au bon
   endroit avant la réponse du serveur : sans lui, on verrait TD une fraction de seconde puis un saut.
   Même architecture que l'historique de recherche de symboles, validée par l'utilisateur. */
const STF_DEF = { L: 'today', R: 'week' };
let _stfPref = null;
let _stfSale = false;                     // vrai tant que le compte n a pas confirme l enregistrement
// FILET DE DEPART DE PAGE : si l ecriture n a pas abouti au moment ou l onglet se ferme ou navigue,
// on la rejoue en keepalive. C est le meme filet que _flush() pour les layouts, et il couvre le cas
// exact decrit par l utilisateur : changer de periode puis se deconnecter dans la foulee.
(function () {
  var renvoi = function () {
    if (!_stfSale || !_stfPref) return;
    try {
      fetch('/api/strength-tf', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(_stfPref), keepalive: true }).catch(function () {});
    } catch (e) {}
  };
  window.addEventListener('pagehide', renvoi);
  document.addEventListener('visibilitychange', function () { if (document.hidden) renvoi(); });
})();
/* SOURCE DE VÉRITÉ = LE MAGASIN GÉNÉRIQUE (bascule 12/08, après mesure sur les comptes réels).
   Constat en production : `uipref:<user>` contenait bien les réglages écrits par DTPPref, pendant que
   `stftf:<user>` restait figé sur les défauts — sur le MÊME compte, au même moment. Le mécanisme
   dédié à la période Force n'écrivait donc pas, là où le magasin générique écrivait. Plutôt que de
   continuer à chercher pourquoi une deuxième plomberie fuit, on lit la période dans celle qui tient.
   L'ancien endpoint reste écrit (compatibilité, et rien à perdre) mais il n'a plus le dernier mot. */
function _stfLocal() {
  try {
    if (window.DTPPref) {
      const L = DTPPref.get('stfl', ''), R = DTPPref.get('stfr', '');
      if (STF_ORDER.includes(L) && STF_ORDER.includes(R)) return { L, R };
    }
  } catch (e) {}
  try { const j = JSON.parse(localStorage.getItem('dtp_stf_tf') || 'null');
        if (j && STF_ORDER.includes(j.L) && STF_ORDER.includes(j.R)) return j; } catch (e) {}
  return null;
}
// Horodatage du DERNIER choix humain. Il arbitre la course décrite dans _stfCharger : une réponse
// serveur partie AVANT un clic ne doit jamais écraser ce clic.
let _stfClicAt = 0;
function _stfSet(side, per) {
  if (!STF_ORDER.includes(per)) return;
  _stfPref = Object.assign({}, _stfPref || _stfLocal() || STF_DEF);
  _stfPref[side] = per;
  _stfClicAt = Date.now();
  _stfSale = true;                        // en attente de confirmation du compte
  try { localStorage.setItem('dtp_stf_tf', JSON.stringify(_stfPref)); } catch (e) {}
  // ÉCRITURE PRINCIPALE : le magasin générique, celui qui écrit réellement sur les comptes (vérifié
  // en production). Il porte ses propres garde-fous — keepalive, rejeu au départ de page, arbitrage
  // du dernier clic — et c'est lui que _stfLocal() relit en priorité.
  try { if (window.DTPPref) { DTPPref.set('stfl', _stfPref.L); DTPPref.set('stfr', _stfPref.R); } } catch (e) {}
  // Écriture serveur au fil de l'eau : un clic = un enregistrement, pas de bouton à penser.
  try {
    // ⚠️ keepalive : SANS lui, la requête est ANNULÉE si la page part avant qu'elle n'aboutisse —
    // et c'est exactement le geste de l'utilisateur qui la déclenche : il change de période puis
    // quitte ou se déconnecte. Le choix semblait pris (l'affichage suivait, via le cache local) mais
    // n'atteignait jamais le compte. Le dépôt utilise déjà ce garde-fou pour l'écriture des layouts.
    // On note aussi l'échec : un refus silencieux est ce qui a rendu ce bug invisible.
    fetch('/api/strength-tf', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_stfPref), keepalive: true,
    }).then(function (r) {
      if (!r.ok) console.warn('[Force] période non enregistrée sur le compte : HTTP', r.status);
      else _stfSale = false;
    }).catch(function (e) { console.warn('[Force] période non enregistrée :', e && e.message); });
  } catch (e) {}
}
// ⚠️ REFONTE 10/08, après le test en échec de l'utilisateur. Le défaut structurel : le serveur
// renvoyait ses DÉFAUTS sous la même forme qu'un choix stocké, et ce code, croyant lire le compte,
// ÉCRASAIT le cache local correct puis re-basculait les panneaux. Tout échec de POST — quelle qu'en
// soit la cause — devenait une perte définitive ET la destruction de la preuve locale.
// Règles désormais :  src 'kv'    → le compte fait foi, on s'aligne et on met le cache à jour ;
//                     src 'defaut'→ le compte ne SAIT rien : on ne touche à rien, et si le cache
//                                   local porte un choix, on le POUSSE au serveur (auto-réparation —
//                                   même si tous les POST passés ont échoué, le prochain chargement
//                                   soigne le compte).
// L'échec réseau n'est plus mémorisé : le prochain appel retentera, au lieu de figer les défauts.
// ⚠️ CORRECTIF 12/08 (bug user : « j'ai mis TW, je me déconnecte/reconnecte, ça ne mémorise pas »).
// COURSE : la vue dessine ses panneaux tout de suite, puis interroge le compte. Tant que cette
// réponse est en vol, l'utilisateur PEUT déjà cliquer — c'est même le cas courant, l'onglet FORCE
// s'ouvre sur un graphe prêt. La réponse arrivait ensuite et, partie AVANT le clic, elle portait
// l'ancienne valeur : elle écrasait `_stfPref`, réécrivait le cache local par-dessus le choix frais,
// et rebasculait le panneau. Le clic semblait « ne pas tenir ». On horodate donc le dernier clic et
// on IGNORE toute réponse plus vieille que lui — c'est le choix humain qui gagne, et on le pousse
// au compte au lieu de le perdre.
let _stfEnVol = null;                     // une seule requête pour les deux panneaux
async function _stfCharger() {
  if (_stfPref) return _stfPref;
  if (_stfEnVol) return _stfEnVol;
  const local = _stfLocal();
  const _partiA = Date.now();
  _stfEnVol = (async function () {
    try {
      const r = await fetch('/api/strength-tf').then(function (x) { return x.json(); });
      if (_stfClicAt > _partiA && _stfPref) {
        // L'utilisateur a tranché pendant le vol : sa valeur fait foi, on (re)pousse au compte.
        try {
          fetch('/api/strength-tf', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(_stfPref), keepalive: true })
            .then(function (x) { if (x.ok) _stfSale = false; }).catch(function () {});
        } catch (e) {}
        return _stfPref;
      }
      // ⚠️ Le magasin générique PRIME sur l'ancien endpoint. Sans ce garde, la réponse de
      // /api/strength-tf — restée bloquée sur les défauts pour les comptes où son écriture ratait —
      // viendrait écraser le choix que DTPPref a, lui, correctement enregistré.
      const _dp = (function () {
        try {
          if (!window.DTPPref) return null;
          const L = DTPPref.get('stfl', ''), R = DTPPref.get('stfr', '');
          return (STF_ORDER.includes(L) && STF_ORDER.includes(R)) ? { L, R } : null;
        } catch (e) { return null; }
      })();
      if (_dp) { _stfPref = _dp; return _stfPref; }
      if (r && r.src === 'kv' && STF_ORDER.includes(r.L) && STF_ORDER.includes(r.R)) {
        _stfPref = { L: r.L, R: r.R };
        try { localStorage.setItem('dtp_stf_tf', JSON.stringify(_stfPref)); } catch (e) {}
        return _stfPref;
      }
      if (r && r.src === 'defaut' && local) {
        // Le compte est vide mais le navigateur se souvient : on répare le compte avec le local.
        _stfPref = local; _stfSale = true;
        try {
          fetch('/api/strength-tf', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(local), keepalive: true })
            .then(function (x) { if (x.ok) _stfSale = false; }).catch(function () {});
        } catch (e) {}
        return _stfPref;
      }
      if (r && r.src === 'defaut') { _stfPref = STF_DEF; return _stfPref; }
    } catch (e) {}
    _stfEnVol = null;                     // échec réseau : PAS de mémorisation, on retentera
    return local || STF_DEF;
  })();
  return _stfEnVol;
}
const STF_LABELS = { today: 'TD', week: 'TW', '8h': '8H', '1d': '1D', '7d': '7D', '1m': '1M' };

let _strengthRoot  = null;
let _strengthRelance = null;   // retour d'onglet FORCE : relance silencieuse des panneaux vivants (jamais de rideau)
let _strengthTimer = null;
let _meterTimer    = null;

// Smooth a series with a 3-point moving average.
// The last point is NOT smoothed so the current market value is shown as-is.
function _smoothCS(pts) {
  return pts.map((d, i) => {
    if (d.v == null) return d;
    if (i === pts.length - 1) return d; // keep last point raw : no look-behind pull
    const p = i > 0 && pts[i - 1].v != null ? pts[i - 1].v : d.v;
    const n = pts[i + 1]?.v != null ? pts[i + 1].v : d.v;
    return { ...d, v: +((p + d.v + n) / 3).toFixed(4) };
  });
}

/* ═══ ANCRAGE ÉCRAN DES GRAPHIQUES ═══════════════════════════════════════════════════════════════
   Le desk s'affiche via la propriété CSS `zoom` sur <html> (réglage Apparence › Zoom, 90 % par
   défaut). amCharts, lui, mesure son conteneur avec des coordonnées ÉCRAN mais dessine dans des
   coordonnées LOCALES. Sous zoom, les deux repères ne coïncident plus et TOUT est faussé du même
   facteur — mesuré au banc à 90 % : le canvas ne couvre que 0,9 × 0,9 du cadre (d'où la bande vide
   à droite et en bas) et le croisillon dérive jusqu'à 46 px du pointeur, l'écart grandissant avec
   la distance au bord.
   On annule donc le zoom sur le SEUL conteneur du graphique. Son repère local redevient celui de
   l'écran, et les deux défauts disparaissent ensemble (mesuré : remplissage 1 × 1, écart 0 px).
   Sa taille RENDUE ne bouge pas : une largeur en % se résout dans le repère local, que le zoom
   remultiplie ensuite — le graphique occupe exactement la place qu'on lui donne.
   À 100 % la règle vaut `zoom: 1`, donc elle ne fait rien. ═══════════════════════════════════ */
function _dtpAncreGraphe(root) {
  try { if (root && root.dom) root.dom.style.zoom = 'calc(1 / var(--dtp-zoom, 1))'; } catch (e) {}
  return root;
}

// Teinte CLAIRE d'une couleur (blend vers le blanc) → rectangle de droite du badge (valeur).
function _lighten(hexInt, amt) {
  const r = (hexInt >> 16) & 255, g = (hexInt >> 8) & 255, b = hexInt & 255;
  const lr = Math.round(r + (255 - r) * amt), lg = Math.round(g + (255 - g) * amt), lb = Math.round(b + (255 - b) * amt);
  return '#' + ((lr << 16) | (lg << 8) | lb).toString(16).padStart(6, '0');
}
// Badge du bout de courbe : CODE DEVISE sur la couleur pleine de la courbe.
// La VALEUR chiffrée n'y figure PAS par défaut (05/08 : « enlève les chiffres à côté du nom de la
// devise dans le label »). Elle reste disponible en option — réglage « Valeur sur les étiquettes » —
// et s'affiche alors dans un second pavé, sur la même teinte éclaircie. Deux pavés accolés plutôt
// qu'une pastille unie : c'est la lecture DTP, et le chiffre se détache du code sans séparateur.
// TRAIT DE RAPPEL (05/08, « relie la courbe au label ») : l'anti-collision ÉCARTE verticalement la
// pastille de son point d'ancrage — sans lien visuel on ne sait plus quelle pastille appartient à
// quelle courbe. On trace un filet de la couleur de la devise, de la pastille jusqu'à la hauteur
// réelle du bout de courbe. `dy` est le décalage appliqué : positif = pastille poussée vers le BAS,
// donc la courbe est au-dessus et le filet remonte.
/* `hors` : +1 si la courbe finit AU-DESSUS du cadre, -1 en dessous, 0 dans le cadre.
   La pastille est alors ramenee au bord (cf. `ancrerBadges`) et porte un chevron : sans lui, le
   lecteur croirait que la devise finit PILE au bord, ce qui serait un mensonge. Avec lui, il lit
   « cette devise est au-dela », et sa valeur exacte reste dans la pastille (option « valeur ») et
   dans l'infobulle. */
/* LA COULEUR DU TEXTE SE DÉDUIT DU FOND DE LA PASTILLE, ELLE NE SE DÉCRÈTE PAS PAR THÈME (29/08).
   La feuille de style imposait « texte clair en thème sombre, texte foncé en thème clair » — ce qui
   marchait tant que les huit fonds de pastille étaient clairs. Le thème clair a désormais sa palette
   FONCÉE (sans quoi les courbes sont invisibles sur blanc) : la règle par thème posait alors du
   texte foncé sur un fond foncé, et l'USD, le plus sombre des huit, devenait illisible.
   On calcule donc le contraste sur le fond RÉEL de chaque pastille. Une seule règle, valable dans
   les deux thèmes et pour n'importe quelle couleur future. */
function _csTexteSur(hex) {
  const l = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * l((hex >> 16) & 255) + 0.7152 * l((hex >> 8) & 255) + 0.0722 * l(hex & 255);
  return L > 0.42 ? '#0c0c0e' : '#ffffff';
}
/* ⚠️ LE FILET PORTE DÉSORMAIS UN POINT D'ARRIVÉE (01/09, demande utilisateur, capture à l'appui :
   « il faut aligner les courbes à leurs devises qu'on puisse bien comprendre… sans que ça désordonne
   quoi que ce soit », puis « essayer d'être un peu plus précis »).
   CE QUI EXISTAIT : quand l'anti-collision écarte une pastille du bout de sa courbe, un filet
   vertical dans la couleur de la devise relie les deux. Il part du MILIEU de la pastille et court
   sur |dy| pixels, à `left: 0`, c'est-à-dire pile sur l'axe — là où la courbe se termine.
   CE QUI MANQUAIT : rien ne marquait SON AUTRE BOUT. Un trait qui s'arrête dans le vide, au milieu
   de sept autres traits de la même largeur, ne désigne pas un point : l'œil ne sait pas où il
   atterrit, donc il ne relie pas la pastille à SA courbe. RENDU ET MESURÉ (le badge est du HTML/CSS
   pur, donc rendable sans amCharts) : les huit filets courant dans la même colonne se recouvraient
   en une bande opaque — le filet du CHF disparaissait derrière celui du NZD.
   D'où le partage : le trait devient FIN et DISCRET, et c'est un POINT de 5 px, dans la couleur de
   la devise et cerné d'un halo au fond du panneau, qui marque la fin RÉELLE de la courbe. Pastille,
   filet, point, courbe : le trajet se ferme, et deux devises qui finissent collées gardent chacune
   son point lisible.
   RIEN NE BOUGE, et c'est la contrainte : aucune pastille n'est déplacée, aucun écart n'est changé,
   aucune largeur de gouttière n'est touchée. On n'ajoute qu'une marque au bout d'un trait déjà
   tracé. Une pastille pile sur sa courbe (`d === 0`) n'a ni filet ni point : il n'y a rien à
   relier, et un point posé là ferait un artefact sur le tracé. */
function _csBadgeHtml(ccy, fullHex, valStr, dy, hors) {
  const d = Math.round(dy || 0);
  const filet = d
    ? `<i class="cs-link${d > 0 ? '' : ' cs-link--bas'}" style="height:${Math.abs(d)}px;background:${fullHex}"><b style="background:${fullHex}"></b></i>`
    : '';
  /* ⚠️ LA TEINTE ÉCLAIRCIE A DISPARU DE LA SIGNATURE (02/09), et ce n'est pas un nettoyage
     cosmétique : elle ne servait qu'au second pavé, celui de la valeur posée À CÔTÉ du code. Ce
     pavé n'existe plus. Garder le paramètre aurait laissé croire à un futur lecteur qu'une couleur
     secondaire joue encore un rôle ici — c'est exactement le genre de trace périmée qui fait
     prendre une mauvaise décision plus tard. */
  const _n = h => (typeof h === 'number') ? h : parseInt(String(h).replace('#', ''), 16);
  const txtPlein = _csTexteSur(_n(fullHex));
  const chev = hors ? `<i class="cs-badge-hors">${hors > 0 ? '\u25b2' : '\u25bc'}</i>` : '';
  /* ══ « VALEUR SUR LES ÉTIQUETTES » : LA VALEUR REMPLACE LE CODE, ELLE NE S'Y AJOUTE PAS ══════════
     (02/09, demande utilisateur, capture de référence à l'appui : « dans le réglage afficher valeur
     de l'étiquette, quand on coche, ça doit s'afficher comme ceci » — une pastille unique portant le
     seul nombre, dans la couleur pleine de la courbe.)
     ⚠️ C'EST CE QUE LE PRODUIT DISAIT DÉJÀ, ET QUE LE CODE NE FAISAIT PAS. Le réglage est décrit
     dans widgets.js comme « avec ou sans le code de la devise », la feuille de style porte depuis
     des semaines une classe `.cs-badge-val--seul` documentée « la valeur porte la couleur pleine de
     la courbe et redevient une pastille entière » — et cette classe n'était émise NULLE PART. On
     rendait code + valeur : deux pavés, une gouttière deux fois plus large, et de la largeur prise
     au tracé. Trois écrits d'accord entre eux, une implémentation qui faisait autre chose.
     CE QUI DÉSIGNE ALORS LA DEVISE : sa COULEUR, et la légende du haut qui en est la table de
     correspondance — elle liste les huit devises avec leur teinte, en permanence, au-dessus du
     tracé. L'identité n'est donc jamais portée par la couleur seule.
     Le chevron « au-delà du cadre » reste : il qualifie la pastille quelle que soit sa forme. */
  if (valStr != null && valStr !== '') {
    return `<div class="cs-badge${hors ? ' cs-badge--hors' : ''}">${filet}`
      + `<span class="cs-badge-val cs-badge-val--seul" style="background:${fullHex};color:${txtPlein}">${chev}${valStr}</span></div>`;
  }
  return `<div class="cs-badge${hors ? ' cs-badge--hors' : ''}">${filet}<span class="cs-badge-ccy" style="background:${fullHex};color:${txtPlein}">${chev}${ccy}</span></div>`;
}
/* ══ LES DEVISES DÉCOCHÉES SE MÉMORISENT (04/09, demande utilisateur) ═══════════════════════════
   « Quand l'utilisateur décoche certaines devises et qu'il change d'onglet puis revient, ça doit
   mémoriser, comme ça il reprend le travail où il en était. »
   Le clic de légende ne vivait que dans l'instance du graphique : changer de période, d'onglet ou
   recharger le remettait à huit courbes. Sur un panneau dont on se sert justement pour ISOLER deux
   ou trois devises, c'est un réglage à refaire à chaque aller-retour.
   Le magasin est `DTPPref` — le même que les autres réglages d'affichage : source de vérité sur le
   COMPTE, `localStorage` en simple cache instantané, donc le choix suit l'utilisateur d'un appareil
   à l'autre. On stocke les devises MASQUÉES et non les visibles : une devise ajoutée un jour à la
   liste des huit apparaîtra par défaut, ce qui est le comportement attendu.
   ⚠️ SEUL LE PANNEAU PRINCIPAL MÉMORISE. Un graphique isolé (rapport, courriel), un graphique en
   mode « focus » sur une devise et le mode « paire » (`onlyCurrencies`) posent eux-mêmes leur
   sélection : y appliquer une mémoire d'utilisateur produirait un rapport dont le contenu dépend de
   qui le lit. */
const _CS_MEMO_KEY = 'csoff';
function _csMemoLu() {
  try {
    const v = window.DTPPref ? DTPPref.get(_CS_MEMO_KEY, '') : '';
    return new Set(String(v || '').split(',').map(x => x.trim()).filter(Boolean));
  } catch (e) { return new Set(); }
}
function _csMemoEcris(set) {
  try { if (window.DTPPref) DTPPref.set(_CS_MEMO_KEY, Array.from(set).join(',')); } catch (e) {}
}
function buildStrengthChart(containerId, data, opts = {}) {
  /* ══ L'ÉTIQUETTE PORTE LA VALEUR PAR DÉFAUT (04/09, demande utilisateur, capture de référence à
     l'appui : « met comme la 2e image pour la colonne là où il y a les étiquettes, tu vois, le
     nombre »). Le terminal de référence range huit nombres au bout de ses huit courbes ; le desk
     rangeait huit codes de devise, l'information la moins utile des deux — le code est déjà dans
     la légende du haut, en permanence, avec sa teinte. La colonne de droite disait donc deux fois
     la même chose et jamais où en est la devise.
     Le réglage « Valeur sur les étiquettes » ne disparaît pas : il est simplement COCHÉ par défaut,
     et le décocher rend la pastille au code, à l'identique. `!== false` et non `!!` : un appelant
     qui ne dit rien reçoit la valeur, un appelant qui dit `false` reçoit le code. */
  const _avecValeur = opts.avecValeur !== false;
  const _focus = opts.focusCurrency || null;   // (optionnel) 1 devise mise en avant, les autres grisées
  const _iso   = !!opts.isolated;              // graphique autonome (rapport) → ne touche pas la réf. globale
  // (optionnel) n'afficher QUE ces devises (ex. les 2 de la paire EURAUD → EUR+AUD) : les autres
  // sont masquées d'emblée ET exclues de l'animation d'apparition (sinon `appear` les ré-affiche).
  const _only  = (Array.isArray(opts.onlyCurrencies) && opts.onlyCurrencies.length) ? new Set(opts.onlyCurrencies) : null;
  const _legendVal = !!opts.legendValues;      // (mail) affiche la valeur TD a DROITE de chaque devise dans la legende
  /* La mémoire des devises décochées : lue une fois au montage, et seulement pour le panneau
     principal (cf. la note de `_csMemoLu`). `_memoActif` reste faux pendant la construction — sans
     quoi les masquages QUE NOUS venons de rejouer se ré-écriraient comme s'ils venaient d'un clic. */
  const _memoOff = (!opts.isolated && !opts.focusCurrency && !(Array.isArray(opts.onlyCurrencies) && opts.onlyCurrencies.length)) ? _csMemoLu() : null;
  let _memoActif = false;
  /* ⚠️ UNE RECONSTRUCTION N'EST PAS UNE PREMIÈRE OUVERTURE (29/08, demande user : « il y a souvent
     des rafraîchissements/actualisations, cache-moi ça »). Le shimmer premium et l'animation
     d'apparition des huit courbes sont faits pour le PREMIER rendu ; rejoués à chaque
     reconstruction (auto-rétablissement, retour d'onglet, période recalée par le compte), ils
     transforment une simple remise à jour en rechargement SPECTACLE. `rebuild: true` peint
     directement, sans rideau ni entrée en scène. */
  const _rebuild = !!opts.rebuild;
  disposeRoot(containerId);
  const container = document.getElementById(containerId);
  if (container) container.innerHTML = '';
  const root = _dtpAncreGraphe(am5.Root.new(containerId));
  root.setThemes([applyTerminalTheme(root)]);
  root._logo?.set('forceHidden', true);
  if (!_iso) _strengthRoot = root;   // l'onglet STRENGTH garde sa réf. ; le graphique du rapport est autonome
  if (container && !_rebuild) { try { window._dtpChartPremium && window._dtpChartPremium(container, 760); } catch (e) {} }   // chargement premium : overlay shimmer pendant appear(500,i*20) -> reveal fondu (PREMIER rendu seulement)

  const chart = root.container.children.push(
    am5xy.XYChart.new(root, {
      paddingLeft: 0, paddingRight: 0, paddingTop: 4, paddingBottom: 3,   // marges horizontales SYMÉTRIQUES : le graphe était posé 2 px plus à droite qu'à gauche (décalage constant, invisible en petit, cumulé aux 26 px de la gouttière une fois agrandi). `paddingLeft: 0` conservé — tracé au ras du bord gauche, intention d'origine.
      layout: root.verticalLayout,
      // Façon la référence : on GLISSE le graphe (drag) pour remonter l'historique. wheelY 'none' →
      // la molette continue de scroller la page ; pinch zoom au doigt sur mobile.
      panX: true, panY: false, wheelX: 'panX', wheelY: 'none', pinchZoomX: true,
    })
  );
  chart.set('background', am5.Rectangle.new(root, { fill: am5.color(_deskChartBg()), fillOpacity: 1 }));  // anthracite doux (un peu moins noir)
  chart.zoomOutButton.set('forceHidden', true);
  // Clip : SEULES les courbes sont clippées (pas les axes ni les badges → l'axe X et les étiquettes droites restent visibles)
  chart.plotContainer.set('maskContent', true);
  try { chart.gridContainer.toBack(); } catch (e) {}   // grille STRICTEMENT derrière les courbes (1er plan = lignes)
  try { chart.seriesContainer.toFront(); } catch (e) {}   // double sécurité : courbes TOUJOURS au 1er plan (jamais coupées par la grille)

  const _firstSeries = Object.values(data.series).find(s => s.length >= 2) || [];
  const _dtMs = _firstSeries.length >= 2 ? _firstSeries[1].t - _firstSeries[0].t : 0;
  const baseInterval =
    _dtMs >= 12 * 3600000 ? { timeUnit: 'day',    count: 1 } :
    _dtMs >=      3600000 ? { timeUnit: 'hour',   count: 1 } :
                            { timeUnit: 'minute', count: 5 };

  const xAxis = chart.xAxes.push(
    am5xy.DateAxis.new(root, {
      baseInterval, extraMin: 0, extraMax: 0,
      maxDeviation: 0.05,   // léger élastique en bord de pan (rebond doux, jamais de vide infini)
      renderer: am5xy.AxisRendererX.new(root, { minGridDistance: 60 }),
    })
  );
  // Axe X : AUCUN tooltip de date : curseur « sans information » demandé
  // (uniquement le croisillon + le point d'ancrage coloré sur la courbe survolée).
  // LISIBILITÉ DE L'AXE DES HEURES (21/08, demande user), décidée par la MESURE : sur le fond du
  // graphique, l'ancien gris #6b7280 tombait à 3,96 de contraste, sous le seuil de 4,5. Une heure
  // qu'on doit deviner ne sert à rien — c'est elle qui permet de rattacher un mouvement à un
  // moment. Le nouveau gris atteint 7,5, et reste discret : il ne concurrence pas les courbes.
  // Chiffres à CHASSE FIXE : sans cela « 11:00 » et « 17:00 » n'ont pas la même largeur et l'axe
  // semble vibrer quand il défile.
  xAxis.get('renderer').labels.template.setAll({
    fill: am5.color(_deskLight() ? 0x4b5563 : 0x9aa3b2), fontSize: 11,
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    fontWeight: '500',
    /* Le premier libellé était coupé par le bord gauche — on lisait « 6:00 » pour « 16:00 ». Un
       libellé est centré sur sa graduation : il faut donc laisser passer SA DEMI-LARGEUR, pas un
       cheveu. 3,5 % de la largeur couvrent les 5 caractères de « 00:00 » jusqu'aux panneaux les plus
       étroits ; au-delà, amCharts écarte le libellé au lieu de le rogner. */
    minPosition: 0.035, maxPosition: 0.985,
  });
  /* ══ LA GRILLE DE FOND SE VOIT (31/08 : « ajoute aussi la même grille en fond des courbes ») ═════
     Elle existait, à 0,2 d'opacité : présente dans le code, invisible à l'écran. Sur huit courbes qui
     se croisent, une grille sert à SITUER — à quelle heure, à quel niveau — et une grille qu'on ne
     voit pas ne situe rien. Elle passe à 0,42 : lisible d'un coup d'œil, toujours derrière le tracé.
     ⚠️ ET LES DEUX AXES PARTAGENT ENFIN LE MÊME STYLE. La grille verticale était figée en gris
     sombre, la grille horizontale, elle, s'adaptait déjà au thème : sur le thème CLAIR, l'une
     s'effaçait et l'autre non — un quadrillage à moitié peint, ce qui est pire que pas de
     quadrillage. Une seule valeur pour les deux, calculée au même endroit. */
  const _csGrille = { stroke: am5.color(_deskLight() ? 0xd0d4da : 0x2b2b31), strokeOpacity: _deskLight() ? 0.5 : 0.42, strokeWidth: 1, strokeDasharray: [2, 4] };
  xAxis.get('renderer').grid.template.setAll(_csGrille);
  // Un filet sépare l'axe du tracé : sans lui les heures flottent sous les courbes et on ne sait
  // plus si un libellé appartient à l'axe ou au graphique.
  xAxis.get('renderer').setAll({ stroke: am5.color(_deskLight() ? 0xd8dce2 : 0x26262c), strokeOpacity: 1, strokeWidth: 1 });
  // Axe X façon DTP : la DATE pleine au changement de jour (ex. "05/06/2026" tout à gauche) + heures HH:mm ensuite.
  xAxis.set('dateFormats',             { minute: 'HH:mm', hour: 'HH:mm', day: 'dd/MM/yyyy', week: 'dd/MM', month: 'MMM yyyy' });
  xAxis.set('periodChangeDateFormats', { minute: 'HH:mm', hour: 'dd/MM/yyyy', day: 'dd/MM/yyyy', week: 'MMM', month: 'yyyy' });
  /* ⚠️ IL MANQUAIT LE PAS DE 2 HEURES (29/08). La suite sautait de 1 h à 3 h : sur un panneau étroit,
     le pas de 1 h ne tient plus et amCharts passe directement à 3 h — il ne reste alors que DEUX
     heures lisibles sur toute la largeur, et on ne sait plus rattacher un mouvement à un moment.
     Les pas de 2 h et 12 h comblent les deux trous de la suite. */
  xAxis.set('gridIntervals', [
    { timeUnit: 'minute', count: 30 }, { timeUnit: 'hour', count: 1 }, { timeUnit: 'hour', count: 2 }, { timeUnit: 'hour', count: 3 },
    { timeUnit: 'hour', count: 6 }, { timeUnit: 'hour', count: 12 }, { timeUnit: 'day', count: 1 }, { timeUnit: 'week', count: 1 }, { timeUnit: 'month', count: 1 },
  ]);

  // GOUTTIÈRE DROITE : graduations de l'axe Y ET étiquettes de devises, dans la MÊME colonne, toutes
  // deux ancrées à l'axe — c'est-à-dire au bout des courbes. L'étiquette étant opaque, elle masque la
  // graduation qui tombe à sa hauteur : à cet endroit précis, la devise est l'information utile.
  // (05/08 : j'avais d'abord retiré les graduations en lisant « enlève les chiffres » de travers —
  // c'était la VALEUR dans l'étiquette qui était visée. Les graduations sont rétablies.)
  /* Largeur : l'étiquette réduite au code (« NZD ») tient dans ~46 px, la graduation la plus longue
     (« -100,00 ») dans ~44 px.
     ⚠️ LA COLONNE « VALEUR » A RÉTRÉCI (02/09). Elle réservait 70 px (84 sur téléphone) parce que
     la pastille portait DEUX pavés, le code puis la valeur. La valeur remplace désormais le code :
     rendue et mesurée, la pastille fait 49,5 px, plus 2 px de calage — 51,5 px. On réserve 58 px,
     ce qui laisse la marge nécessaire aux graduations qui partagent la colonne (30,4 px pour
     « -110,00 ») et rend douze pixels au tracé. C'est ce que le libellé du réglage annonçait déjà :
     « la gouttière se resserre d'autant, ce qui rend de la largeur au tracé ». */
  const _csEtroit = (typeof window !== 'undefined' && window.matchMedia)
    ? window.matchMedia('(max-width: 560px)').matches : false;
  const yAxisRenderer = am5xy.AxisRendererY.new(root, { opposite: true, inside: false, minWidth: _avecValeur ? (_csEtroit ? 70 : 58) : (_csEtroit ? 56 : 50) });
  yAxisRenderer.labels.template.setAll({
    visible: true,
    fill: am5.color(0x94a3b8), fontSize: _csEtroit ? 11 : 9,   // plancher de 11 px sur téléphone
    fontFamily: '-apple-system, "Inter", "Segoe UI", sans-serif',
    minPosition: 0.02, maxPosition: 0.98,
    paddingLeft: 4,
  });
  // Échelle DTP : 2 décimales fixes + décimale FRANÇAISE (virgule) → « 4,00 / 0,00 / -16,00 ».
  yAxisRenderer.labels.template.adapters.add('text', t => (t == null ? t : String(t).replace('.', ',')));
  // Plus de grille horizontale (21/08, demande user : « enlève ces lignes pointillées »).
  // Ce que la lecture y perd : rien d'utile. Sur la Force des Devises, aucune valeur absolue ne
  // se lit sur une horizontale — ce qui compte est le CLASSEMENT des devises entre elles et leur
  // position par rapport au zéro. Or le zéro reste tracé, en blanc plein, juste en dessous : la
  // seule référence qui porte du sens est donc conservée, et les graduations chiffrées de la
  // gouttière droite restent là pour qui veut le niveau exact.
  /* ⚠️ GRILLE DE FOND HORIZONTALE REMISE (21/08, demande user : « ajoute la grille en fond qu il y
     a » sur la reference). Je l avais retiree plus tot ; la reference montre bien une grille de
     fond discrete. On la remet NEUTRE et tres legere, au MEME style que la grille verticale (X) :
     un quadrillage uniforme derriere les courbes. Ce ne sont PAS les lignes colorees par devise que
     vous aviez fait retirer, celles-la restent supprimees ; c est un simple fond gris pointille. */
  yAxisRenderer.grid.template.setAll(Object.assign({ visible: true }, _csGrille));   // MÊME style que la verticale : un quadrillage uniforme, pas deux demi-grilles

  const yAxis = chart.yAxes.push(
    /* ⚠️ UNE SEULE MARGE, ET C'EST LA NÔTRE (02/09). `extraMin/Max` ajoutait 7 % en haut et en bas
       — la même marge que `bornesPleines` et `bornesPaquet` calculent DÉJÀ dans les bornes qu'elles
       posent juste après. Deux marges empilées, c'est jusqu'à un quart de la hauteur rendu à du
       vide, et c'est de la hauteur prise aux courbes : elles se tassent, leurs fins se rapprochent,
       et l'anti-collision doit alors écarter les huit pastilles à l'espacement minimal — d'où des
       étiquettes régulièrement espacées qui ne pointent plus leur courbe (constat utilisateur :
       « des labels à droite bien alignés avec chaque courbe »).
       Les bornes viennent maintenant d'un seul endroit, celui qui les calcule. `maxDeviation: 0`
       reste : zoom Y rigide, glisser net. */
    am5xy.ValueAxis.new(root, { renderer: yAxisRenderer, numberFormat: '#0.00', maxDeviation: 0, extraMin: 0, extraMax: 0 })
  );

  // Zero reference line : gris clair UNI (c'est désormais la SEULE horizontale du graphique)
  const zeroRange = yAxis.createAxisRange(yAxis.makeDataItem({ value: 0 }));
  // ⚠️ `visible: true` EXPLICITE, et ce n'est pas une precaution decorative : la grille d'une plage
  // d'axe est fabriquee A PARTIR du gabarit `yAxisRenderer.grid.template`, que l'on vient de passer
  // en `visible: false` pour supprimer le quadrillage. Sans ce rappel, le zero heriterait de
  // l'invisibilite du gabarit et disparaitrait avec lui : on perdrait la seule reference qui porte
  // du sens sur ce graphique, en croyant n'avoir enleve qu'une grille.
  // ⚠️ COULEUR SELON LE THEME. Le zero etait blanc EN DUR. Or en theme clair le fond du graphique
  // est blanc pur (_deskChartBg) : la ligne etait donc blanche sur blanc, invisible. Tant qu'une
  // grille existait, on ne s'en apercevait pas ; maintenant que le zero est la seule horizontale,
  // le graphique clair se retrouverait sans aucune reference. Ardoise en clair, blanc en sombre.
  zeroRange.get('grid').setAll({
    visible: true, forceHidden: false,
    // POINTILLÉ LÉGER (23/08, demande user : « réduit la lisibilité de la droite horizontale 0,
    // met en pointillé légèrement ») : le trait plein blanc pesait plus que les courbes qu'il
    // sert de repère. Tirets 4/4 + opacité descendue : le zéro reste trouvable, il ne barre plus
    // le graphique. (L'historique du trait plein vs le pointillé [2,4] du thème global reste vrai :
    // on choisit ICI un pointillé PROPRE, distinct de l'ancien quadrillage.)
    strokeDasharray: [4, 4],
    stroke: am5.color(_deskLight() ? 0x334155 : 0xffffff), strokeWidth: 1, strokeOpacity: 0.22,
  });
  zeroRange.get('label').set('visible', false);

  const seriesArr = [];
  const seriesMap = {};
  const labelMap  = {};   // ccy → { range } pour mise à jour en place
  const _hiddenCcy = new Set();   // devises masquées via la légende → badge + ligne cachés, et le RESTENT (update/declutter ne les ré-affichent pas)

  // Échelle INSTITUTIONNELLE (façon DTP) : force ×100 → 0.11 devient 11,86. Compression UNIQUEMENT si extrême.
  function computeScale(d) {
    const BASE = 100;
    const abs = d.currencies
      .flatMap(c => (d.series[c] || []).map(x => x.v != null ? Math.abs(x.v) : null).filter(v => v != null))
      .sort((a, b) => a - b);
    const ref    = abs.length > 10 ? abs[Math.floor(abs.length * 0.99)] : (abs[abs.length - 1] || 0.01);
    const refMax = ref * BASE;
    const CAP    = 70;   // GBP atteint ~±48 → cap large : compression SEULEMENT sur extrêmes rares, amplitude réelle préservée (le cadrage pose lui-même sa marge de 7 %, cf. `bornesPleines`)
    return refMax > CAP ? (BASE * CAP / refMax) : BASE;
  }
  /* ══ CADRAGE VERTICAL SUR LE PAQUET (06/08) ══════════════════════════════════════════════════════
     L axe Y etait en auto-echelle PURE — seul graphe du fichier sans borne. La devise la plus extreme
     fixait donc l echelle des huit. Mesure sur les vraies donnees d une semaine : 47 % de la hauteur
     ne contenait QU UN SEUL trait, et les sept autres se partageaient 13 %. Le « vide » que voyait
     l utilisateur n etait pas vide : c etait une courbe solitaire.
     C est en partie STRUCTUREL — l indicateur est a somme quasi nulle, donc si une devise s echappe
     de +1,3 %, les sept autres se repartissent mecaniquement -1,3 % et se resserrent.

     CE QU ON FAIT, ET CE QU ON NE FAIT PAS. On borne le CADRE sur le 2e/98e centile de l ensemble des
     points. AUCUNE valeur n est modifiee ni ecretee : la courbe hors-cadre continue d etre tracee et
     SORT du cadre, exactement comme sur un graphe de prix zoome. L axe reste lineaire et gradue en
     vraies unites, l infobulle donne la valeur reelle, et le double-clic sur la gouttiere droite rend
     le cadrage plein.
     LES GARDE-FOUS, ET CE QU ILS GARANTISSENT VRAIMENT : on n active que si l extreme depasse
     largement l amplitude du paquet ; zero reste toujours dans le cadre ; et AUCUNE devise visible ne
     disparait du cadre — si le resserrement devait en rendre une muette, on y renonce (cf. la note
     « AUCUNE DEVISE NE DISPARAIT DU CADRE » plus bas).
     ⚠️ CE PARAGRAPHE A LONGTEMPS MENTI : il promettait que « les DERNIERES valeurs sont TOUJOURS
     visibles, quoi qu il arrive ». Ce n etait plus vrai depuis le 29/08, ou `fins` a ete restreint
     aux devises DU PAQUET — la fin d une fuyarde sort du cadre depuis. La promesse tenue aujourd hui
     n est pas celle-la : c est la PRESENCE de chaque courbe, ce qui est a la fois plus faible sur la
     derniere valeur et beaucoup plus fort sur le tracé.
     Ce qui a ete ecarte : ecreter la valeur (mensonge sur l amplitude) et l echelle non lineaire (sur
     un graphe de marche, les distances verticales ne voudraient plus rien dire). */
  // ⚠️ RAISONNER PAR DEVISE, PAS PAR POINT. Un premier essai bornait sur le 2e/98e centile de TOUS les
  // points confondus : sans effet ici, et pour une raison instructive — la devise qui s'échappe TIENT
  // son niveau pendant un tiers de la semaine. Ses valeurs ne sont donc pas des points « extrêmes »
  // au sens statistique : le 98e centile les contient déjà. Ce n'est pas un pic qu'il faut sortir du
  // cadre, c'est une COURBE ENTIÈRE qui vit ailleurs que les autres.
  // On mesure donc, pour CHAQUE devise, DE COMBIEN ELLE POUSSE LE CADRE — c'est-à-dire sa distance
  // au zéro, pas son amplitude : une devise qui reste plate à −18 pendant que les autres oscillent
  // autour de ±4 est parfaitement calme, et elle étire pourtant le cadre de tout le monde. On prend
  // la médiane de ces distances et on cadre sur celles qui restent dans une fourchette raisonnable
  // autour d'elle. Les fuyardes sortent du cadre — sans qu'aucune de leurs valeurs ne soit touchée,
  // et depuis le 29/08 sans perdre leur pastille : elle est ramenée au bord, chevron à l'appui.
  /* ══ QUEUE GELÉE : couper ce qui n'est pas de la donnée (06/08) ══════════════════════════════════
     Symptôme : les courbes filent en LIGNE DROITE jusqu'au bord droit, sur TOUTES les périodes.
     Ce n'est pas un défaut de rendu — les HUIT devises deviennent plates AU MÊME INSTANT, ce qu'aucune
     épaisseur ni décimation ne peut produire. C'est la source qui reporte sa dernière valeur sur les
     bins suivants quand elle n'a plus rien de neuf (hors séance, flux interrompu). Le graphe dessinait
     donc fidèlement une série qui ne bouge plus.
     RÈGLE, volontairement stricte : on ne retire un point de FIN que si TOUTES les devises visibles y
     valent EXACTEMENT leur valeur précédente. Un marché où les huit devises sont rigoureusement
     inchangées pendant des heures n'existe pas ; en revanche une seule qui ne bouge pas, ça arrive, et
     on n'y touche pas. On s'arrête au premier instant où quelque chose a bougé — jamais plus loin.
     On ne coupe QUE la queue : rien au milieu de la série, aucune valeur modifiée, et la garde à 60 %
     empêche de raboter une série entière si la source se figeait longtemps. */
  function _couperQueueGelee(d) {
    try {
      var ccys = (d.currencies || []).filter(function (c) { return (d.series[c] || []).length > 5; });
      if (ccys.length < 3) return d;
      var nMin = Math.min.apply(null, ccys.map(function (c) { return d.series[c].length; }));
      if (nMin < 30) return d;
      var k = nMin - 1;
      while (k > 0) {
        var gele = true;
        for (var i = 0; i < ccys.length; i++) {
          var se = d.series[ccys[i]];
          if (se[k].v !== se[k - 1].v) { gele = false; break; }
        }
        if (!gele) break;
        k--;
      }
      var coupes = nMin - 1 - k;
      if (coupes < 3) return d;                                   // rien de significatif : on ne touche à rien
      if (k < nMin * 0.4) return d;                               // garde-fou : on ne rabote jamais l'essentiel
      /* ⚠️ ON COUPE À UNE DATE, PAS À UN INDICE (29/08). Les huit séries n'ont pas toutes la même
         longueur — une devise dont la source a démarré plus tard en a moins. Trancher toutes les
         séries au même INDICE revenait alors à les couper à des INSTANTS différents : la devise la
         plus courte perdait la fin de sa journée pendant que les autres gardaient la leur, et le
         graphique superposait des courbes qui ne parlaient plus de la même fenêtre. L'indice `k` est
         relevé sur la série la plus courte ; c'est sa DATE qui fait la coupe pour tout le monde. */
      var ref = d.series[ccys.reduce(function (a, b) { return d.series[a].length <= d.series[b].length ? a : b; })];
      var tCoupe = ref[Math.min(k, ref.length - 1)].t;
      var out = { currencies: d.currencies, series: {} };
      Object.keys(d.series).forEach(function (c) { out.series[c] = (d.series[c] || []).filter(function (x) { return x.t <= tCoupe; }); });
      for (var p in d) if (!(p in out)) out[p] = d[p];
      return out;
    } catch (e) { return d; }
  }

  function bornesPaquet(d, facteur) {
    var vis = (d.currencies || []).filter(function (c) { return !_hiddenCcy.has(c) && (!_only || _only.has(c)); });
    // ⚠️ _hiddenCcy est TRANSITOIREMENT rempli pendant l'animation d'apparition d'amCharts — le
    // fichier le documente déjà plus haut (bug « on ne voit que USD »). S'y fier au premier rendu
    // faisait tomber sous le seuil de quatre courbes et renoncer au cadrage, silencieusement : tout
    // le calcul était juste, il n'était simplement jamais atteint.
    if (vis.length < 4) vis = (d.currencies || []).filter(function (c) { return !_only || _only.has(c); });
    if (vis.length < 4) return null;                                  // vraiment trop peu : rien à arbitrer
    var infos = [];
    vis.forEach(function (c) {
      var serie = (d.series[c] || []).filter(function (x) { return x.v != null; });
      if (serie.length < 20) return;
      var lo = Infinity, hi = -Infinity;
      serie.forEach(function (x) { var v = x.v * facteur; if (v < lo) lo = v; if (v > hi) hi = v; });
      infos.push({ c: c, lo: lo, hi: hi, ext: Math.max(Math.abs(lo), Math.abs(hi)), fin: serie[serie.length - 1].v * facteur });
    });
    if (infos.length < 4) return null;
    var exts = infos.map(function (i) { return i.ext; }).sort(function (a, b) { return a - b; });
    /* ⚠️ VRAIE MÉDIANE, PAS LE RANG DU MILIEU ARRONDI EN HAUT (29/08). Sur huit devises,
       `exts[Math.floor(8/2)]` rend le CINQUIÈME plus petit, pas la médiane. C'est sans conséquence
       quand le champ est homogène — un demi-rang d'écart — mais dès que la moitié du champ décroche,
       ce cinquième rang tombe DANS le groupe des fuyardes : la référence devient une fuyarde, le
       seuil part à trois fois une fuyarde, plus personne ne le franchit, et la fonction conclut que
       « personne ne s'échappe » au moment précis où quatre devises s'échappent. Le cadre restait
       alors plein et les autres courbes écrasées au fond — c'est le TW de la capture. */
    var med = exts.length % 2
      ? exts[(exts.length - 1) / 2]
      : (exts[exts.length / 2 - 1] + exts[exts.length / 2]) / 2;
    if (!(med > 0)) return null;
    /* SEUIL RELEVÉ À 3× (12/08, 2e signalement user « je ne vois pas bien la courbe JPY »).
       Mesuré sur la semaine réelle en production : médiane des amplitudes 0,4 ; le JPY à 0,9
       franchissait le seuil de 2,2× (= 0,88) **de deux centièmes**. Une devise 2,2 fois plus mobile
       que la médiane n'est pas une anomalie sur le change — c'est une semaine de yen ordinaire. On
       la faisait sortir du cadre, donc illisible, pour un resserrement de 36 % : l'échange n'en vaut
       pas la peine. À 3×, plus personne ne s'échappe sur cette semaine, et la compression reste
       disponible pour le cas qu'elle vise vraiment — une devise qui décroche franchement. */
    var SEUIL = med * 3;
    var dedans = infos.filter(function (i) { return i.ext <= SEUIL; });
    if (dedans.length === infos.length) return null;                  // personne ne s'échappe → on ne touche à rien
    if (dedans.length < Math.ceil(infos.length * 0.6)) return null;    // trop de fuyardes → l'idée ne tient plus
    var lo = 0, hi = 0;
    dedans.forEach(function (i) { if (i.lo < lo) lo = i.lo; if (i.hi > hi) hi = i.hi; });
    if (!(hi - lo > 0)) return null;
    // Le gain doit valoir le dérangement. Seuil porté de 35 % à 45 % de resserrement exigé (12/08) :
    // la semaine du signalement, le cadre se resserrait de 36 % — juste assez pour déclencher, pas
    // assez pour justifier qu'une devise devienne illisible. Rendre une courbe inutilisable est un
    // coût CERTAIN ; gagner un tiers de hauteur d'axe est un confort. On ne paie plus ce prix-là
    // pour si peu.
    var loT = 0, hiT = 0;
    infos.forEach(function (i) { if (i.lo < loT) loT = i.lo; if (i.hi > hiT) hiT = i.hi; });
    if ((hi - lo) > (hiT - loT) * 0.55) return null;
    // Les dernières valeurs de TOUTES les devises visibles restent dans le cadre — fuyardes comprises
    // (correctif 11/08, constat user : AUD/CHF/JPY coupées en bas du cadre, illisibles). La garantie
    // documentée plus haut (« les DERNIÈRES valeurs sont TOUJOURS visibles, quoi qu'il arrive ») ne
    // s'appliquait en réalité qu'au paquet. Conséquence assumée : quand une fuyarde TERMINE sur son
    // plateau extrême, le cadre s'étend jusqu'à elle et la compression disparaît — c'est précisément
    // le cas où l'utilisateur veut la LIRE. Quand elle est revenue vers le paquet en fin de période,
    // le cadrage compresse comme avant et seule son excursion médiane sort du cadre.
    /* ⚠️ REVIREMENT ASSUMÉ (29/08, demande user « le TW pas ajusté, corrige tout » — il tranche
       l'arbitrage qu'on lui a soumis). Le 11/08, `fins` couvrait TOUTES les devises pour que la
       fuyarde qui TERMINE à son extrême reste lisible : conséquence, le cadre s'étendait jusqu'à
       elle et la compression disparaissait — sur le TW réel, l'USD finissant à ~+35 rendait les
       SEPT autres courbes illisibles, tassées sur le fond du cadre. C'était le pari « l'utilisateur
       veut lire la fuyarde » ; la pratique a montré l'inverse : il veut lire le PAQUET.
       `fins` ne couvre donc plus que les devises DU PAQUET (`dedans`) — le constat du 11/08 reste
       honoré : les fins du paquet ne sont jamais coupées. La fuyarde, elle, SORT du cadre en fin de
       période comme elle en sortait déjà au milieu : son BADGE reste visible (declutter le borne au
       bord avec son filet de rappel), sa valeur exacte reste dans l'infobulle, et le double-clic
       sur la gouttière droite rend toujours le cadrage plein. */
    var fins = dedans.map(function (i) { return i.fin; });
    var marge = (hi - lo) * 0.06;
    var finLo = Math.min.apply(null, fins), finHi = Math.max.apply(null, fins);
    var cadre = { min: Math.min(lo - marge, finLo - marge * 0.5), max: Math.max(hi + marge, finHi + marge * 0.5) };
    /* ══ AUCUNE DEVISE NE DISPARAÎT DU CADRE (02/09, demande utilisateur capture à l'appui : « on ne
       voit pas la courbe NZD, il faut que toutes les courbes apparaissent visuellement ») ══════════
       C'EST LE TROISIÈME SIGNALEMENT DU MÊME MANQUE — JPY le 12/08, l'absence de pastille le 29/08,
       le NZD aujourd'hui. Les deux premières fois on a déplacé un seuil ; le tracé, lui, pouvait
       toujours quitter le cadre entièrement. Une courbe qu'on ne voit jamais n'est pas « hors
       cadre », elle est ABSENTE : le graphique annonce huit devises dans sa légende et en montre
       sept. On pose donc une condition de sortie, et non un seuil de plus.
       LA RÈGLE : le cadre ne se resserre sur le paquet QUE si chaque devise visible garde une
       présence réelle dedans. Sinon on renonce à compresser et on rend le cadre plein — tout est
       visible, quitte à ce que le paquet soit plus tassé. C'est l'arbitrage que l'utilisateur vient
       de trancher, et il l'emporte sur celui du 29/08 (« il veut lire le PAQUET »), qui n'avait
       jamais envisagé qu'une courbe puisse disparaître complètement.
       LE SEUIL SUIT UN PRINCIPE, IL N'EST PAS AJUSTÉ SUR DES ÉCHANTILLONS. La compression est
       légitime quand elle cache une EXCURSION ; elle ne l'est pas quand elle cache une COURBE. Une
       excursion, par définition, est minoritaire dans la fenêtre : une devise doit donc passer plus
       de la MOITIÉ du temps dans le cadre pour qu'on accepte de la voir en sortir le reste.
       J'avais d'abord posé 25 %, en le calant entre deux jeux d'essai (8 % d'un côté, 41 % de
       l'autre). C'était un nombre ajusté sur ce que j'avais sous la main, et il laissait passer un
       cas que l'utilisateur aurait signalé comme les autres : une devise visible 23 % du temps,
       c'est-à-dire absente des trois quarts du graphique. Un seuil qui se justifie par un principe
       vaut mieux qu'un seuil qui se justifie par deux mesures.
       CE QUE ÇA COÛTE, ASSUMÉ : quand une devise vit franchement ailleurs, le cadre redevient plein
       et le paquet est plus tassé — la situation que le 29/08 cherchait à éviter. C'est l'arbitrage
       que l'utilisateur vient de trancher, trois signalements de suite allant dans le même sens
       (JPY le 12/08, les pastilles le 29/08, le NZD aujourd'hui) contre un seul dans l'autre. Le
       double-clic sur la gouttière droite reste là pour basculer.
       ON NE MESURE PAS LA DERNIÈRE VALEUR, ON MESURE LA PRÉSENCE. Borner sur la fin de chaque
       courbe (la règle du 11/08) étirait le cadre jusqu'à la fuyarde et écrasait les sept autres —
       c'est très exactement ce que le 29/08 a corrigé. La présence, elle, distingue « cette courbe
       sort un moment » de « cette courbe n'est jamais là ». */
    var PRESENCE_MIN = 0.5;
    for (var vi = 0; vi < vis.length; vi++) {
      var sv = (d.series[vis[vi]] || []).filter(function (x) { return x.v != null; });
      if (sv.length < 20) continue;                                 // série trop courte pour conclure
      var dedansN = 0;
      for (var pi = 0; pi < sv.length; pi++) {
        var vv = sv[pi].v * facteur;
        if (vv >= cadre.min && vv <= cadre.max) dedansN++;
      }
      if (dedansN / sv.length < PRESENCE_MIN) return null;           // → cadre plein, toutes les courbes visibles
    }
    return cadre;
  }
  var _dernieresDonnees = data;                                     // pour recadrer sans attendre le prochain rafraichissement
  var _cadreLibre = false;                                            // double-clic : retour au cadrage plein
  /* ══ LE CADRE PLEIN EST UN CADRE, PAS UNE ABSENCE DE CADRE (29/08) ═══════════════════════════════
     Quand `bornesPaquet` renonce — et elle renonce souvent : quatre devises qui decrochent, ou un
     resserrement juge trop maigre — l'axe repassait en AUTO-ECHELLE PURE (`min: null, max: null`).
     Or amCharts arrondit alors les bornes a des nombres ronds. Mesure sur un jeu qui s'etend de
     -38 a +42 : le cadre sortait a [-100, +100]. Les huit courbes tenaient dans 40 % de la hauteur,
     et les 60 % restants etaient du vide — pas de la donnee, du vide. C'est la moitie de la plainte
     « je ne vois pas toutes les courbes », et elle ne coute RIEN a corriger : on pose nous-memes les
     bornes sur l'etendue REELLE des series visibles, avec la marge de 7 % deja voulue.
     Aucune valeur n'est touchee, aucune courbe ne sort du cadre : on retire seulement le vide. */
  function bornesPleines(d) {
    try {
      var vis = (d.currencies || []).filter(function (c) { return !_hiddenCcy.has(c) && (!_only || _only.has(c)); });
      if (!vis.length) vis = (d.currencies || []).filter(function (c) { return !_only || _only.has(c); });
      var lo = Infinity, hi = -Infinity;
      vis.forEach(function (c) {
        (d.series[c] || []).forEach(function (x) {
          if (x.v == null) return;
          var v = x.v * scaleFactor;
          if (v < lo) lo = v; if (v > hi) hi = v;
        });
      });
      if (!isFinite(lo) || !isFinite(hi)) return null;
      if (lo > 0) lo = 0; if (hi < 0) hi = 0;                         // le zero reste TOUJOURS dans le cadre
      var m = (hi - lo) * 0.07 || 1;                                  // la meme marge que l'ancien extraMin/Max
      return { min: lo - m, max: hi + m };
    } catch (e) { return null; }
  }
  /* ══ UN CADRE NE COUPE PLUS JAMAIS UNE COURBE (05/09, demande utilisateur, deux captures) ═══════
     « Je ne vois pas la courbe JPY, corrige ça afin qu'on ait une vue d'ensemble à chaque fois que
     le prix fait des hikes hyper hauts — car à chaque fois je dois te dire pour que tu corriges. »
     C'est une RÈGLE qu'il pose, pas un cas particulier, et elle tranche une tension que ce fichier
     portait depuis le 29/08.
     MESURÉ SUR SA CAPTURE : cadre à peu près [-48 ; +20], la courbe JPY sort par le haut vers le
     02/09 et n'y revient jamais, et SEPT pastilles sur huit à droite — celle du JPY manque. Le
     resserrement sur le paquet fait donc exactement ce pour quoi il a été écrit : il sacrifie la
     fuyarde pour que les sept autres se distinguent. C'était le bon arbitrage pour la plainte du
     29/08 (« je ne vois pas à vue d'œil toutes les courbes »), ce n'est plus celui que l'utilisateur
     veut aujourd'hui, et c'est lui qui décide.
     ⚠️ ON NE SUPPRIME PAS `bornesPaquet` POUR AUTANT, et c'est délibéré : le resserrement reste
     utile quand il ne coûte RIEN. On lui ajoute donc une condition — il ne s'applique que si AUCUN
     point d'AUCUNE série visible ne tombe hors du cadre qu'il propose. Dès qu'il couperait quoi que
     ce soit, on prend le cadre plein. En pratique, sur une fuyarde, il renonce ; sur un champ
     homogène, il resserre comme avant.
     ⚠️ ET LA VÉRIFICATION PORTE SUR TOUS LES POINTS, PAS SUR LES FINS. `bornesPaquet` raisonne sur
     les valeurs de FIN ; une courbe peut très bien finir dans le paquet après avoir culminé bien
     au-dessus. Ne contrôler que les fins laisserait passer précisément le « hike » dont il est
     question. */
  function paquetSansCouper(d, b) {
    if (!b) return null;
    try {
      var vis = (d.currencies || []).filter(function (c) { return !_hiddenCcy.has(c) && (!_only || _only.has(c)); });
      if (vis.length < 4) vis = (d.currencies || []).filter(function (c) { return !_only || _only.has(c); });
      for (var i = 0; i < vis.length; i++) {
        var serie = d.series[vis[i]] || [];
        for (var k = 0; k < serie.length; k++) {
          var v = serie[k].v; if (v == null) continue;
          v *= scaleFactor;
          if (v < b.min || v > b.max) return null;                    // il couperait : on renonce
        }
      }
      return b;
    } catch (e) { return null; }
  }
  function cadrerSurLePaquet(d) {
    try {
      var b = (_cadreLibre ? null : paquetSansCouper(d, bornesPaquet(d, scaleFactor))) || bornesPleines(d);
      if (b) yAxis.setAll({ min: b.min, max: b.max, strictMinMax: true });
      else   yAxis.setAll({ min: null, max: null, strictMinMax: false });
      ancrerBadges();
    } catch (e) {}
  }
  /* ══ AUCUNE DEVISE MUETTE (29/08, demande utilisateur capture a l'appui : « je ne vois pas a vu
     d'oeil toutes les courbes informations de force de devises ») ══════════════════════════════════
     Une pastille est le LABEL D'UNE PLAGE D'AXE, posee a la valeur de fin de courbe. Quand le cadre
     se resserre sur le paquet et laisse une devise dehors, cette valeur tombe hors des bornes — et
     amCharts ne rend tout simplement pas la plage. La devise perdait donc son NOM et sa VALEUR, pas
     seulement sa courbe. Mesure : sept pastilles sur huit, l'etiquette manquante ayant pourtant
     `visible: true`, `forceHidden: false` et son element HTML bien vivant.
     Le commentaire du revirement du 29/08 affirmait « son BADGE reste visible (declutter le borne au
     bord avec son filet de rappel) » : c'etait faux. `declutter` borne la POSITION EN PIXELS, ce qui
     ne sert a rien puisque la plage est ecartee bien avant, au niveau de l'axe.
     On pose donc la plage a une valeur BORNEE au cadre, en gardant la vraie valeur pour l'affichage,
     et la pastille porte un chevron qui dit que la courbe est au-dela. C'est la seule facon d'avoir
     les deux : un cadre serre sur le paquet, ET les huit devises nommees. */
  function ancrerBadges() {
    try {
      var min = yAxis.get('min'); if (min == null) min = yAxis.getPrivate('min');
      var max = yAxis.get('max'); if (max == null) max = yAxis.getPrivate('max');
      Object.keys(labelMap).forEach(function (ccy) {
        var o = labelMap[ccy];
        if (!o || o.value == null) return;
        var a = o.value, hors = 0;
        if (min != null && max != null && max > min) {
          /* ⚠️ LA MARGE SE COMPTE EN PIXELS DE PASTILLE, PAS EN POURCENTAGE D'AXE (02/09).
             Elle valait 1,2 % de l'amplitude — sur un tracé de 255 px, trois pixels. Une pastille
             en fait quinze : ramenée à trois pixels du bord, elle en dépasse sept vers le haut, et
             amCharts pose alors `display: none` sur le `<div>` qui la porte. Mesuré exactement
             ainsi : la plage d'axe était juste (valeur bornée à 8,16 pour un cadre [-13,9 ; 8,42]),
             son étiquette `visible: true`, son `forceHidden: false`, la pastille elle-même en
             `inline-flex` et pleinement opaque — et son conteneur en `display: none`, boîte 0×0.
             Sept pastilles sur huit à l'écran, la huitième vivante et invisible.
             Ce défaut ne se voyait QUE sous compression, sur la devise ramenée au bord : c'est le
             seul cas où une pastille est posée à un cheveu de la limite. Le régime « échappée
             tardive », écrit ce matin, est ce qui l'a fait sortir.
             On borne donc à une demi-pastille plus trois pixels de garde, convertis en unités
             d'axe. Le pourcentage reste comme plancher quand la hauteur du tracé est inconnue. */
          var marge = (max - min) * 0.012;                            // plancher : un cheveu a l'interieur
          try {
            var hPlot = chart.plotContainer.height();
            var hbPast = (_hbPlein > 4 ? _hbPlein : 17);
            if (hPlot > 40) marge = Math.max(marge, (max - min) * ((hbPast / 2 + 3) / hPlot));
          } catch (e) {}
          if (o.value > max) { a = max - marge; hors = 1; }
          else if (o.value < min) { a = min + marge; hors = -1; }
        }
        if (a === o.ancre && hors === o.hors) return;
        o.ancre = a; o.hors = hors;
        try { o.range.set('value', a); } catch (e) {}
        o.dy = null;                                                  // le chevron change -> le HTML sera refait par declutter
      });
    } catch (e) {}
  }

  // La coupe s'applique à TOUTES les périodes — elle ne regarde pas l'onglet, elle regarde la donnée.
  data = _couperQueueGelee(data);
  let scaleFactor = computeScale(data);

  /* ══ DENSITÉ DE TRACÉ CALÉE SUR LA RÉFÉRENCE (02/09, demande utilisateur, capture PMT à l'appui) ══
     « Les courbes sont très irrégulières, avec énormément de petites variations… sur PMT elles sont
     beaucoup plus fluides, propres et lisibles, tout en conservant les mouvements du marché. » Et,
     dans la même demande : « ne cherche pas simplement à lisser artificiellement les données ».
     CE QUI SÉPARE VRAIMENT LES DEUX RENDUS, mesuré sur la capture de référence elle-même : ce n'est
     pas le lissage, c'est la DENSITÉ AU PIXEL. La référence montre ~17 h de pas 1 min sur ~1 850 px
     de tracé, soit **0,55 point par pixel**. Notre desk sert la même minute dans un widget de ~880 px
     de tracé : 0,95 point par pixel en TD, et jusqu'à 1,7 en TW. À plus d'un point par colonne de
     pixels, chaque colonne reçoit deux valeurs et le trait ne dessine plus une courbe mais une bande
     de bruit. La même donnée, deux fois plus serrée, ne peut pas avoir l'air de la même courbe.
     CE QU'ON FAIT : on ramène la densité de TRACÉ à celle de la référence, en NE GARDANT QUE DES
     POINTS RÉELS. `_csLTTB` (Largest Triangle Three Buckets) choisit, dans chaque tranche, le point
     qui porte le plus de forme — c'est l'algorithme standard de réduction pour l'affichage, utilisé
     par les terminaux de marché. Aucune valeur n'est calculée, moyennée ni inventée : chaque point
     tracé est un point servi par la source, aux mêmes date et valeur. Les extrêmes sont conservés
     par construction (un sommet est toujours le point le plus « portant » de sa tranche), et le
     premier comme le dernier point sont gardés tels quels — la fin de courbe, celle que lit
     l'étiquette de droite, reste exacte à la valeur près.
     CE QU'ON NE FAIT PAS, et c'est la consigne : aucune moyenne mobile, aucune spline, aucune
     tension. Une moyenne mobile aurait rendu une courbe plus douce que le marché ; ici la courbe
     reste EXACTEMENT celle du marché, simplement dessinée à une densité que l'œil peut lire.
     ⚠️ CECI RENVERSE L'ARBITRAGE DU 21/08 (« le user trouve nos courbes trop lisses, on dessine donc
     plus de points »), pris devant une autre référence, très nerveuse. L'utilisateur tranche
     aujourd'hui dans l'autre sens, capture à l'appui. Les traces de l'ancienne règle sont réécrites
     dans le même commit ; `minDistance` d'amCharts n'a plus de rôle (il sautait des points au hasard
     du zoom, ce qui produisait le moiré qu'on cherchait à éviter) et repasse à 0 : on trace
     désormais TOUS les points qu'on a choisi de garder. */
  var CS_PT_PAR_PX = 0.55;                                   // densité mesurée sur la référence
  function _csLTTB(pts, cible) {
    var n = pts.length;
    if (!(cible > 2) || n <= cible) return pts;
    var out = [pts[0]];
    var pas = (n - 2) / (cible - 2);
    var aX = 0;                                              // indice du point déjà retenu
    for (var i = 0; i < cible - 2; i++) {
      // Barycentre de la tranche SUIVANTE : c'est lui qui donne au triangle son troisième sommet.
      var d0 = Math.floor((i + 1) * pas) + 1, d1 = Math.min(Math.floor((i + 2) * pas) + 1, n);
      var mx = 0, my = 0, mn = d1 - d0;
      if (mn <= 0) { d1 = Math.min(d0 + 1, n); mn = d1 - d0; }
      for (var j = d0; j < d1; j++) { mx += pts[j].t; my += pts[j].v; }
      mx /= mn; my /= mn;
      var r0 = Math.floor(i * pas) + 1, r1 = Math.floor((i + 1) * pas) + 1;
      var aXv = pts[aX].t, aYv = pts[aX].v, meilleur = -1, iMeilleur = r0;
      for (var k = r0; k < r1 && k < n; k++) {
        // Deux fois l'aire du triangle (point retenu, candidat, barycentre suivant) : le candidat
        // qui « porte » le plus de forme est celui qui s'écarte le plus de la corde.
        var aire = Math.abs((aXv - mx) * (pts[k].v - aYv) - (aXv - pts[k].t) * (my - aYv));
        if (aire > meilleur) { meilleur = aire; iMeilleur = k; }
      }
      out.push(pts[iMeilleur]); aX = iMeilleur;
    }
    out.push(pts[n - 1]);                                    // la DERNIÈRE valeur, jamais approchée
    return out;
  }

  // ÉPAISSEUR SELON LA DENSITÉ MESURÉE, jamais selon la période. 1,8 px pour un pas de 3 px (TD) est
  // juste ; le MÊME 1,8 px pour un pas de 0,65 px (TW) donne un trait trois fois plus large que le
  // pas — les segments se recouvrent et les huit courbes s'empâtent en une seule masse. On mesure le
  // rapport points/pixel sur la largeur RÉELLE du conteneur, on ne déduit rien de l'onglet choisi.
  const _gouttiere = _avecValeur ? (_csEtroit ? 70 : 58) : (_csEtroit ? 56 : 50);
  const _plotW = Math.max(200, ((container && container.clientWidth) || 900) - _gouttiere);
  const _nPts = Math.max.apply(null, (data.currencies || []).map(function (c) { return (data.series[c] || []).length; }).concat([0]));
  const _ptPx = _nPts / _plotW;
  /* La densité TRACÉE est désormais bornée à `CS_PT_PAR_PX` quelle que soit la période : l'ancien
     escalier d'épaisseurs (1,3 / 1,5 / 1,8 px selon les points par pixel) n'a plus d'objet, il
     compensait une densité qui variait du simple au triple. Un trait unique, FIN, comme sur la
     référence : c'est lui qui donne la sensation de propreté, un trait large sur une courbe dense
     empâtant les huit devises en une seule masse. 1,4 px sur un écran ordinaire ; 1,6 px sur
     téléphone, où le trait doit rester visible à bout de bras. */
  const _sw = _csEtroit ? 1.6 : 1.4;
  const _cible = Math.max(60, Math.round(_plotW * CS_PT_PAR_PX));   // points à tracer, densité de la référence

  for (const ccy of data.currencies) {
    const dim      = _focus && ccy !== _focus;            // courbe à estomper (devise non sélectionnée)
    const hexColor = dim ? 0x5b6471 : _csCouleur(ccy);
    const hexStr   = '#' + hexColor.toString(16).padStart(6, '0');
    const color    = am5.color(hexColor);
    const pts      = _csLTTB((data.series[ccy] || [])
      .filter(d => d.v != null && d.t != null)
      .map(d => ({ ...d, v: d.v * scaleFactor })), _cible);

    const series = chart.series.push(
      am5xy.LineSeries.new(root, {
        name: ccy, xAxis, yAxis,
        valueXField: 't', valueYField: 'v',
        stroke: color, connect: true,
        /* ⚠️ LA DÉCIMATION D'amCHARTS EST RETIRÉE (02/09), ET VOICI CE QU'ELLE A APPRIS.
           Elle a été posée le 06/08 contre le moiré du TW (1 416 points pour ~848 px de tracé,
           1,7 point par pixel : chaque colonne en recevait deux, ce qui dessine une bande de bruit
           et non une courbe), puis assouplie le 21/08 pour rendre les courbes plus nerveuses. Elle
           n'a jamais bien marché, pour une raison de principe : `minDistance` saute les points trop
           rapprochés AU ZOOM COURANT. Le choix dépend donc du cadrage et non de la forme de la
           courbe, et rien n'empêche qu'un sommet tombe précisément dans ce qui est sauté. Elle
           produisait ainsi le moiré qu'elle devait supprimer, et un artefact bien visible en TD :
           sur une fin de série sans nouveaux points, un long segment droit filant jusqu'au bord.
           La densité est désormais choisie EN AMONT et sur la FORME (cf. `_csLTTB`), donc ce
           réglage repasse à 0 : on trace tous les points qu'on a retenus, et rien d'autre. */
        minDistance: 0,                                   // on trace TOUS les points retenus (cf. `_csLTTB`)
        tooltip: am5.Tooltip.new(root, {
          labelText: `[bold ${hexStr}]${ccy}[/]: {valueY.formatNumber("+#.##;-#.##;0.00")}`,
          getFillFromSprite: false,
          background: am5.Rectangle.new(root, {
            fill: am5.color(0x141414), stroke: am5.color(0x252525), strokeWidth: 1,
          }),
        }),
      })
    );
    series.strokes.template.setAll({ strokeWidth: _sw, strokeOpacity: dim ? 0 : 1 });
    /* TOUJOURS AUCUN LISSAGE, et c'est la consigne : aucune moyenne mobile, aucune spline, aucune
       tension. `LineSeries` relie les points par des segments DROITS, et chaque point tracé est un
       point servi par la source, à sa date et à sa valeur. Ce qui a changé le 02/09 n'est pas la
       nature du tracé mais son NOMBRE DE POINTS PAR PIXEL, ramené à celui de la référence : la
       courbe reste exactement celle du marché, dessinée à une densité que l'œil peut lire. */
    const cleanPts = pts;
    series.data.setAll(cleanPts);

    // Étiquette flottante sur l'axe Y à la dernière valeur
    const lastPt = cleanPts[cleanPts.length - 1];
    const lastV  = (lastPt && lastPt.v != null) ? lastPt.v : 0;
    const rangeItem = yAxis.makeDataItem({ value: lastV });
    const range     = yAxis.createAxisRange(rangeItem);
    const valStr    = lastV.toFixed(2).replace('.', ',');   // valeur SANS "+", décimale FR (façon DTP)
    range.get('label').setAll({
      html: _csBadgeHtml(ccy, hexStr, _avecValeur ? valStr : '', 0),
      centerY: am5.percent(50),
      centerX: am5.percent(0),   // ancré à l'axe → colonne droite parfaitement alignée (aucun décalage horizontal)
      // ⚠️ PIÈGE MESURÉ : une étiquette de PLAGE est créée à partir du gabarit `renderer.labels.template`,
      // celui des chiffres de l'axe. Le `paddingLeft` qui repousse les chiffres vers l'extérieur
      // s'appliquait donc AUSSI aux pastilles, qui restaient à 44 px de leur courbe. On le remet à
      // zéro ici : la pastille touche l'axe, c'est-à-dire le bout exact de sa courbe.
      paddingLeft: 0,
    });
    range.get('tick').set('visible', false);
    // Même demande du 21/08 : la pastille de chaque devise ne tire plus son horizontale pointillée
    // en travers du graphique. À huit devises, cela faisait huit lignes de couleurs différentes
    // superposées aux courbes, pour une information que la pastille donne déjà à son extrémité.
    // ⚠️ `visible` et NON `forceHidden` : plus bas, l'affichage/masquage d'une courbe remet
    // `forceHidden` à false sur cette grille — la ligne serait revenue au premier clic de légende.
    range.get('grid').setAll({ visible: false });
    if (dim) range.get('label').set('visible', false);   // mode isolé : badge de la devise estompée

    seriesArr.push(series);
    seriesMap[ccy] = series;
    // `value` = la VRAIE fin de courbe (c'est elle qu'on affiche) ; `ancre` = la valeur a laquelle la
    // plage est reellement posee, bornee au cadre (cf. `ancrerBadges`) ; `hors` = de quel cote elle
    // deborde. dy = decalage impose par l'anti-collision, et longueur du filet de rappel.
    labelMap[ccy]  = { range, value: lastV, ancre: lastV, hors: 0, hexStr, hexColor, dy: 0 };
    // (mail) valeur TD figee du jour A DROITE de la devise, directement dans le LABEL de legende (le nom) :
    // fiable sans curseur (contrairement a legendValueText). Le tooltip/badge continuent d'utiliser `ccy`.
    if (_legendVal) series.set('name', ccy + '   ' + lastV.toFixed(1).replace('.', ','));

    // Légende cliquable : masquer une courbe masque AUSSI son badge flottant (et le rétablit).
    // DOUBLE écoute (événements + propriété `visible`) : si un événement rate (update pendant
    // l'animation de masquage), l'état est de toute façon ré-imposé par declutter()/update()
    // qui lisent la visibilité RÉELLE de la série (cf. plus bas).
    series.events.on('hidden', () => { _hiddenCcy.add(ccy); if (_memoOff && _memoActif) _csMemoEcris(_hiddenCcy); setTimeout(() => { cadrerSurLePaquet(_dernieresDonnees); scheduleDeclutter(0); }, 0); try { range.get('label')?.setAll({ forceHidden: true, visible: false });  range.get('grid')?.set('forceHidden', true);  } catch {} });
    series.events.on('shown',  () => { _hiddenCcy.delete(ccy); if (_memoOff && _memoActif) _csMemoEcris(_hiddenCcy); setTimeout(() => { cadrerSurLePaquet(_dernieresDonnees); scheduleDeclutter(0); }, 0); try { range.get('label')?.setAll({ forceHidden: false, visible: true }); range.get('grid')?.set('forceHidden', false); } catch {} });
    series.on('visible', (vis) => {
      if (vis) _hiddenCcy.delete(ccy); else _hiddenCcy.add(ccy);
      try { range.get('label')?.set('forceHidden', !vis); range.get('grid')?.set('forceHidden', !vis); } catch {}
    });

    // Mode « paire » : on masque d'emblée les devises hors-paire (courbe + badge). La légende les
    // conserve (grisées, re-cliquables), exactement la référence pro.
    if (_only && !_only.has(ccy)) { try { series.hide(0); } catch {} }
    // …et la MÉMOIRE de l'utilisateur, rejouée à l'identique : la devise qu'il avait décochée
    // repart décochée, courbe et pastille comprises (le gestionnaire `hidden` ci-dessus s'en charge).
    if (_memoOff && _memoOff.has(ccy)) { try { series.hide(0); } catch {} }
  }

  // ── Légende cliquable (en haut) : clic sur une devise = masquer / réafficher sa courbe ──
  if (!_focus) {
    const legend = chart.children.unshift(am5.Legend.new(root, {
      centerX: am5.percent(0), x: am5.percent(0),
      marginTop: 0, marginBottom: 6, paddingLeft: 0, paddingTop: 0,
    }));
    /* ══ LA LEGENDE TIENT SUR UNE LIGNE (29/08) ══════════════════════════════════════════════════
       Mesure sur une fenetre etroite (400 px, le cas de la capture) : la legende passait a DEUX
       lignes — six devises, puis les deux dernieres seules en dessous. Elle prenait alors 28 px au
       lieu de 14 sur un widget de 300, soit 7 % du trace, pour une information que les pastilles
       portent deja au bout de chaque courbe.
       On ne touche PAS a la taille du texte : 11 px est le plancher de lisibilite du desk, et une
       legende cliquable est une CIBLE, pas une decoration. On reprend la place la ou elle ne coute
       rien — le marqueur et les marges de chaque entree : 11 px de pastille et 4+4 de marge par
       entree, huit fois, font 88 px de largeur pour zero information.
       MESURE : 54,5 px par entree avant, 42,8 apres. La legende tient sur une ligne des 400 px de
       large — la fenetre de la capture — au lieu de 440. Sous 380 px elle repasse a deux lignes et
       c'est assume : en dessous, la seule facon de gagner serait de rogner le texte a 11 px, qui est
       le plancher de lisibilite du desk, ou de supprimer une cible cliquable. */
    legend.labels.template.setAll({ fill: am5.color(_deskChartTxt()), fontSize: 11, fontFamily: '-apple-system, "Inter", "Segoe UI", sans-serif', paddingLeft: 1, paddingRight: 0 });
    legend.valueLabels.template.set('forceHidden', true);                       // valeur non fiable sans curseur -> cote mail on la met dans le LABEL (nom, cf. loop)
    legend.markers.template.setAll({ width: 7, height: 7 });
    legend.markerRectangles.template.setAll({ cornerRadiusTL: 2, cornerRadiusTR: 2, cornerRadiusBL: 2, cornerRadiusBR: 2 });
    legend.itemContainers.template.setAll({ paddingTop: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1 });
    legend.data.setAll(chart.series.values);
  }

  /* ══ LE SURVOL NE MET PLUS AUCUNE COURBE EN AVANT (30/08) ══════════════════════════════════════
     Ajouté la veille : survoler une devise (légende ou tracé) la gardait pleine et estompait les
     sept autres à 14 % d'opacité. L'intention était de démêler huit courbes qui se croisent — le
     résultat, capture à l'appui : « quand je glisse mon curseur sur une courbe ça cache les autres,
     enlève ça ». Et c'est juste : dans ce panneau, on ne suit pas UNE devise, on compare les huit ;
     le curseur se promène en permanence sur le tracé, donc l'effacement se déclenchait tout le
     temps, sans être demandé. Une mise en avant permanente n'est plus une mise en avant, c'est un
     graphique qui clignote.
     Le mode « focus » (une seule devise, les autres grisées) reste : lui, on le DEMANDE. Le
     croisillon et son point d'ancrage coloré restent aussi — ils désignent sans rien effacer.
     ⚠️ Ne pas le remettre « en plus discret » : le contrôle de force-verif éprouve maintenant
     l'INVERSE — les huit courbes gardent leur opacité pleine, souris posée sur la légende comme
     sur le tracé. */

  // Croisillon : ligne verticale pointillés gris clair, suit la souris + dots magnétiques
  // snapToSeriesBy 'y!' → le tooltip suit la courbe la PLUS PROCHE du curseur (celle réellement
  // survolée) et n'affiche QUE celle-ci → on lit le bon nom (USD sur USD, GBP sur GBP…).
  const cursor = chart.set('cursor', am5xy.XYCursor.new(root, {
    behavior: 'none', snapToSeries: seriesArr, snapToSeriesBy: 'y!',
  }));
  cursor.lineX.setAll({ stroke: am5.color(0x475569), strokeWidth: 1, strokeDasharray: [3, 3], strokeOpacity: 0.9 });
  // Croisillon complet (vertical + horizontal), pointillés gris : comme l'image demandée.
  cursor.lineY.setAll({ visible: true, stroke: am5.color(0x475569), strokeWidth: 1, strokeDasharray: [3, 3], strokeOpacity: 0.9 });
  // Point d'ancrage coloré sur la courbe survolée, MAIS bulle d'info masquée (« sans information ») :
  // on garde le tooltip ACTIF (c'est lui qui dessine le point) en rendant son fond transparent + son texte invisible.
  seriesArr.forEach(s => {
    s.bullets.clear();
    s.set('snapTooltip', true);
    const tt = s.get('tooltip');
    if (tt) {
      tt.label.set('forceHidden', true);
      const bg = tt.get('background'); if (bg) bg.setAll({ fillOpacity: 0, strokeOpacity: 0 });
      tt.setAll({ paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 });
    }
  });

  // ── Fenêtre initiale sur la FIN de série → on glisse vers la gauche pour remonter le temps.
  // Curseur NORMAL (défaut) et non « main/grab » (demande utilisateur) ; le pan au glisser reste actif.
  chart.plotContainer.set('cursorOverStyle', 'default');
  if (seriesArr[0]) seriesArr[0].events.once('datavalidated', () => { try { xAxis.zoom(0.08, 1); } catch (e) {} });   // on montre ~92 % de la session (vs 65 %) → bien plus de points/pixel = texture dense visible d'emblée (pan toujours dispo, donnée inchangée)

  // Apparition animée : SAUF les devises masquées du mode « paire » (sinon `appear` les ré-afficherait).
  if (!_rebuild) chart.series.values.forEach((s, i) => {
    if (_only && !_only.has(s.get('name'))) return;
    if (_memoOff && _memoOff.has(s.get('name'))) return;   // même raison que le mode « paire » : `appear` la ré-afficherait
    s.appear(500, i * 20);
  });
  /* À partir d'ici, tout masquage vient d'un CLIC : la mémoire peut écrire. Armé après la boucle
     d'apparition, sinon nos propres `hide(0)` de restauration se réécriraient eux-mêmes. */
  _memoActif = true;

  // ── Anti-collision des badges : écarte verticalement ceux trop proches ───────
  let _dcRedo = 0, _dcApres = 0, _hbPlein = 0;        // garde-fous de boucle + hauteur nominale de pastille (hors mode compact)
  const _gradCachees = new Set();                     // graduations masquées PAR NOUS (les seules qu'on rétablira)
  function declutter() {
    try {
      // ⚠️ CAUSE RACINE du bug « on ne voit qu'une étiquette » : l'axe est en AUTO-ÉCHELLE (min/max non
      // configurés) → yAxis.get('min')/get('max') renvoient NULL (la config, pas l'étendue calculée) et
      // declutter bailait TOUJOURS → aucun `dy` posé → les badges de devises aux valeurs PROCHES (ex. aujourd'hui
      // USD/GBP et NZD/CHF) se superposaient et se cachaient. L'étendue RÉELLE = getPrivate('min'/'max').
      // Les bornes ont pu changer depuis le dernier cadrage (auto-echelle qui se stabilise, glisser
      // du zoom Y) : on re-ancre AVANT de placer, sinon on placerait d'apres un cadre perime.
      ancrerBadges();
      const min = yAxis.getPrivate('min') != null ? yAxis.getPrivate('min') : yAxis.get('min');
      const max = yAxis.getPrivate('max') != null ? yAxis.getPrivate('max') : yAxis.get('max');
      const h = chart.plotContainer.height();
      if (min == null || max == null || !h || max === min) return;
      // ÉCART MINIMAL, PAS CONFORTABLE (demande user 05/08 « aligne comme ceci ») : une étiquette
      // n'a de sens qu'au bout de sa courbe, donc on ne l'en écarte QUE de ce qu'il faut pour ne pas
      // recouvrir sa voisine. La pastille mesure 15 px de haut sur les deux tailles (11 px de texte
      // + 4 px de marge sur téléphone, 9 px + 6 px sur bureau) → 17 px laissent 2 px de garde.
      // Mesuré sur une séance serrée : l'écart maximal tombe de 29 px à 18 px, sans un seul
      // chevauchement. À 24 px, les huit pastilles finissaient en colonne loin de leurs courbes.
      const GAP_BASE = 17;
      // (le plancher réel est recalculé plus bas sur la hauteur MESURÉE de la pastille)
      // Position pixel réelle de fin de chaque courbe (0 = haut), triée de haut en bas.
      // Masquage = UNIQUEMENT _hiddenCcy (devises explicitement masquées via la légende, maintenu par les
      // événements hidden/shown/visible de la série). On N'utilise PLUS s.isHidden()/get('visible') ici : ces
      // états sont TRANSITOIRES pendant l'animation d'apparition et les courses de layout (build en conteneur
      // 0×0) → ils force-cachaient des badges VISIBLES qui ne revenaient jamais (bug « on ne voit que USD » :
      // 2 devises aux valeurs proches se retrouvaient force-hidden pendant le build et restaient invisibles).
      const arr = Object.entries(labelMap).filter(([ccy, o]) => {
        const hid = _hiddenCcy.has(ccy);
        try { o.range.get('label')?.set('forceHidden', !!hid); o.range.get('grid')?.set('forceHidden', !!hid); } catch {}
        return !hid;
      }).map(([ccy, o]) => {
        // ⚠️ L'ANCRE, PAS LA VALEUR. `dy` est un decalage RELATIF au point ou amCharts a pose la
        // plage ; depuis `ancrerBadges`, ce point est la valeur BORNEE au cadre. Calculer le
        // decalage depuis la vraie valeur d'une devise hors cadre donnerait un `dy` de plusieurs
        // centaines de pixels — la pastille repartirait exactement d'ou on vient de la ramener.
        const v = o.ancre != null ? o.ancre : (o.value != null ? o.value : 0);
        // Bornage AVANT espacement (04/08, mobile) : une valeur pile au bord donnait un centre de
        // badge à 0 ou h → moitié coupée. On garde chaque point d'ancrage dans le cadre.
        const px = Math.max(8, Math.min(h - 8, (max - v) / (max - min) * h));
        // basePx BORNÉ lui aussi : avec un axe cadré (cf. cadrerSurLePaquet), une courbe qui sort du
        // cadre donnait un point d'ancrage à plusieurs centaines de pixels, donc un filet de rappel
        // traversant la légende. Les étiquettes ne sont pas clippées, il faut le faire ici.
        const brut = (max - v) / (max - min) * h;
        return { ccy, o, basePx: Math.max(-6, Math.min(h + 6, brut)), brut, px };
      }).filter(x => isFinite(x.basePx)).sort((a, b) => a.px - b.px);
      // ÉCART COMPRESSÉ À LA HAUTEUR RÉELLE (04/08, constat user mobile : pastilles coupées en
      // haut) : sur un petit graphe, 8 badges × 20 px dépassent le tracé — la remontée en bloc
      // poussait alors la pile HORS CADRE par le haut. L'écart s'adapte : jamais plus de 20 px,
      // jamais moins de 12 px (léger recouvrement contrôlé plutôt qu'une pastille invisible).
      // ⚠️ L'ancienne ligne était MORTE : Math.min(17, Math.max(16, …)) ne pouvait renvoyer que 16
      // ou 17, quelle que soit la hauteur — le commentaire ci-dessus décrivait une plage 20/12 px
      // qui n'existait plus. Le plancher est rétabli à 12 px : sous 128 px de tracé (petit widget
      // Mon Desk, mobile en paysage), huit pastilles de 15 px ne tiennent PAS, et mieux vaut un
      // léger recouvrement qu'une colonne qui sort du cadre.
      /* ══ LE PLANCHER DE L'ÉCART EST LA HAUTEUR RÉELLE DE LA PASTILLE (29/08) ═══════════════════
         Il était codé en dur à 12 px pour une pastille qui en mesure 15 : sous ~170 px de tracé, les
         huit pastilles se recouvraient TOUTES et la dernière sortait du widget (mesuré : 7
         recouvrements et un écart de −3 px à 360×150). Un plancher inférieur à la hauteur de l'objet
         qu'il espace ne peut pas espacer : il autorise le recouvrement par construction.
         On mesure donc la pastille au lieu de la supposer — elle change de taille avec le réglage
         « valeur », le thème et le mode compact ci-dessous. */
      /* ⚠️ ON MESURE LA PASTILLE, PAS LA BOÎTE QU'AMCHARTS LUI FABRIQUE : le conteneur de l'étiquette
         rend 19 px là où la pastille en fait 17 — deux pixels de trop, huit fois, et la colonne
         déborde du tracé.
         ⚠️ ET ON MESURE LES HUIT, PAS LA PREMIÈRE. `declutter` reconstruit le HTML des étiquettes
         qu'il déplace ; mesurer une seule pastille tombe parfois sur une reconstruction en cours et
         rend 0. Le pas se calait alors sur une hauteur trop petite et deux pastilles se recouvraient
         — un défaut INTERMITTENT, celui qu'on ne reproduit qu'une fois sur deux. On prend la plus
         haute des mesures valides, et à défaut la valeur nominale. */
      let HB = 0;
      try {
        arr.forEach(x => {
          const e = x.o.range.get('label')?.getPrivate('htmlElement');
          const b = e && (e.classList.contains('cs-badge') ? e : e.querySelector('.cs-badge'));
          const hh = b && b.offsetHeight;
          if (hh > HB) HB = hh;
        });
      } catch (e) {}
      if (!(HB > 4)) HB = 17;
      /* ══ MODE COMPACT : QUAND HUIT PASTILLES NE TIENNENT PAS, ON LES RÉDUIT ═════════════════════
         Sur une carte de 150 px, le tracé fait 105 px : huit pastilles de 15 px espacées de 17 en
         demandent 134. Aucun placement ne peut les y loger — il faut réduire l'objet, pas le pousser.
         La classe est posée sur le CONTENEUR d'après sa hauteur MESURÉE, jamais d'après la largeur de
         la fenêtre : un panneau étroit sur grand écran a exactement le même problème qu'un téléphone,
         et une `@media` de viewport ne le voit pas. */
      try {
        if (container) {
          const estDense = container.classList.contains('cs-dense');
          /* ⚠️ LA DÉCISION SE PREND SUR LA TAILLE NOMINALE, JAMAIS SUR LA TAILLE COURANTE. Sinon elle
             se juge sur son propre effet et OSCILLE : à taille pleine « ça ne tient pas » → on passe
             compact ; à taille compacte « ça tient » → on repasse plein ; etc. Le garde-fou de
             boucle arrêtait le va-et-vient sur un état arbitraire — d'où un recouvrement une fois
             sur deux, et un défaut qu'on ne reproduisait pas à volonté.
             On mémorise donc la hauteur mesurée HORS mode compact et on ne juge plus que sur elle. */
          if (!estDense && HB > 4) _hbPlein = HB;
          const hbRef = _hbPlein || 17;
          const dense = (arr.length - 1) * (hbRef + 2) + hbRef > h;
          if (estDense !== dense) {
            container.classList.toggle('cs-dense', dense);
            if (_dcRedo < 3) { _dcRedo++; setTimeout(declutter, 30); return; }   // la pastille a changé de taille : on remesure
          }
        }
      } catch (e) {}
      _dcRedo = 0;
      /* ⚠️ LE PAS NE PEUT PAS DÉPASSER LA PLACE. Un plancher pris comme un `Math.max` — c'était le
         cas ici avec un 12 codé en dur, et ça l'est resté un instant avec `HB + 2` — impose un pas
         que le tracé ne peut pas contenir : huit pastilles à 21 px dans 105 px de haut débordent de
         47 px, et deux d'entre elles sortent du widget. Le pas est donc borné des DEUX côtés : ce
         qu'il faut pour ne pas se recouvrir, et jamais plus que ce qui tient. */
      const pasMin  = HB + 2;                                            // juste de quoi ne pas se recouvrir
      const pasDispo = arr.length > 1 ? (h - HB) / (arr.length - 1) : pasMin;
      const GMAX = pasDispo;
      /* ⚠️ L'ÉCART EST LE MINIMUM, ET RIEN DE PLUS (02/09, demande utilisateur, référence à l'appui :
         « c'est pas aligné, ça fait pas pro du tout, regarde la 2ème image comme c'est bien aligné »).
         CE QUI SE PASSAIT. Un « écart de confort » (HB + 8) s'ajoutait dès qu'un paquet dépassait
         deux étiquettes, au motif que huit pastilles collées se liraient comme un seul pavé. Sur le
         cas réel — les huit devises qui finissent dans un mouchoir — ça faisait 25 px de pas là où
         19 suffisent : SIX pixels d'écartement artificiel par étiquette, sept fois, soit plus de
         quarante pixels de dérive cumulée entre la première pastille et la dernière. Chacune
         s'éloignait donc de sa courbe pour une raison qui n'était pas la donnée, et la colonne
         régulière qui en résultait ne montrait plus rien : c'est exactement ce que l'utilisateur
         voit, et il a raison.
         CE QUE MONTRE LA RÉFÉRENCE : chaque étiquette est posée à la hauteur EXACTE de la fin de sa
         courbe, sans le moindre écartement de confort — la position de l'étiquette EST la donnée.
         C'est la seule façon d'être « bien aligné ».
         On garde donc l'anti-collision, mais réduite à ce qu'elle doit être : on ne s'écarte QUE
         pour ne pas se recouvrir, jamais pour respirer. La lisibilité d'un paquet serré est prise en
         charge autrement depuis le 01/09 — chaque pastille porte un filet fin jusqu'au POINT posé à
         la fin réelle de sa courbe : c'est ce point qui désigne, plus l'écartement. */
      const gapFor = () => Math.min(GMAX, pasMin);
      // ── PLACEMENT PAR PAQUETS CENTRÉS (05/08, demande user : « les étiquettes doivent être bien
      //    alignées avec les courbes ») ────────────────────────────────────────────────────────
      // L'ancienne méthode poussait TOUJOURS vers le bas depuis la première étiquette, puis
      // remontait la pile entière si elle débordait. Conséquence : deux devises serrées au milieu
      // du tracé décalaient toute la suite, et la remontée en bloc déplaçait même celles qui
      // avaient toute la place — elles se retrouvaient loin de leur courbe.
      // Ici on regroupe les étiquettes qui DOIVENT être écartées, et on centre CHAQUE paquet sur la
      // moyenne de leurs positions naturelles. Une étiquette isolée ne bouge plus du tout ; celles
      // d'un paquet s'écartent autour de leur centre de gravité, donc au plus près de leur courbe.
      const paquets = arr.map(x => ({ n: 1, somme: x.px }));
      const centre = g => g.somme / g.n;
      const haut   = g => centre(g) - (g.n - 1) * gapFor(g.n) / 2;
      const bas    = g => centre(g) + (g.n - 1) * gapFor(g.n) / 2;
      for (let k = 0; k < paquets.length - 1;) {
        // On teste avec l'écart qu'aurait le paquet APRÈS fusion : sinon un paquet de huit se
        // formerait avec l'écart d'un paquet de deux et se retrouverait trop serré une fois constitué.
        const GAP = gapFor(paquets[k].n + paquets[k + 1].n);
        if (bas(paquets[k]) + GAP > haut(paquets[k + 1]) + 0.01) {
          paquets[k].n += paquets[k + 1].n;
          paquets[k].somme += paquets[k + 1].somme;
          paquets.splice(k + 1, 1);
          if (k > 0) k--;                     // la fusion peut heurter le paquet précédent
        } else k++;
      }
      let idx = 0;
      paquets.forEach(g => {
        // Bornage du PAQUET dans le cadre : aucune étiquette coupée en haut ni en bas.
        const GAP = gapFor(g.n);
        const d = Math.max(HB / 2, Math.min(h - HB / 2 - (g.n - 1) * GAP, haut(g)));
        for (let j = 0; j < g.n; j++) arr[idx++].px = d + j * GAP;
      });
      /* ⚠️ BALAYAGE FINAL, ET IL N'EST PAS DÉCORATIF. Le bornage ci-dessus s'applique à CHAQUE paquet
         indépendamment, APRÈS la boucle de fusion : un paquet remonté ou descendu pour tenir dans le
         cadre peut donc entrer dans son voisin, et plus rien ne les refusionne. Mesuré à 1400×200 :
         un recouvrement EUR/JPY de 12 px sur une pastille de 15 — l'EUR devenait illisible.
         On repasse donc de proche en proche : descente qui écarte, puis remontée d'ensemble si la
         pile déborde par le bas. Sur les cas où rien ne se heurte, ce balayage ne déplace RIEN. */
      const GS = Math.min(GMAX, pasMin);
      for (let k = 1; k < arr.length; k++) if (arr[k].px < arr[k - 1].px + GS) arr[k].px = arr[k - 1].px + GS;
      const debord = arr.length ? (arr[arr.length - 1].px + HB / 2) - h : 0;
      if (debord > 0) for (let k = arr.length - 1; k >= 0; k--) {
        arr[k].px -= debord;
        if (k > 0 && arr[k].px < arr[k - 1].px + GS) continue;     // on continue de remonter la pile
        break;
      }
      if (arr.length && arr[0].px < HB / 2) { const d0 = HB / 2 - arr[0].px; arr.forEach(x => { x.px += d0; }); }
      for (let k = 1; k < arr.length; k++) if (arr[k].px < arr[k - 1].px + GS) arr[k].px = arr[k - 1].px + GS;
      /* ══ UNE PASTILLE MASQUE SA GRADUATION, ELLE NE LA TRANCHE PAS (29/08) ═══════════════════════
         Pastilles et graduations chiffrées occupent la MÊME colonne, toutes deux ancrées à l'axe.
         L'intention était que la pastille couvre la graduation qui tombe à sa hauteur — à cet
         endroit, la devise est l'information utile. Mais elle ne la couvre qu'en PARTIE : mesuré,
         80 à 93 % de la largeur du chiffre, et 1 à 15 px sur les 17 de sa hauteur. Résultat à
         l'écran : un bandeau de chiffre qui dépasse par-dessous, qu'on ne lit pas et qui se lit
         comme un défaut de rendu — c'est ce qu'on voit sur la capture de l'utilisateur, avec
         « 20,00 » et « 0,00 » à moitié sortis de derrière les pastilles.
         On masque donc franchement la graduation qu'une pastille recouvre. On ne touche QU'À CELLES
         QU'ON A MASQUÉES : rétablir aveuglément `forceHidden` à false ferait réapparaître celles
         qu'amCharts écarte pour ses propres raisons (bords de l'axe). */
      try {
        const bandes = arr.map(x => [x.px - HB / 2 - 1, x.px + HB / 2 + 1]);
        yAxis.get('renderer').labels.each(l => {
          if (!l || l.get('html')) return;                       // une pastille, pas une graduation
          const y0 = l.y(), hh = l.height() || 0;
          if (!isFinite(y0) || hh <= 0 || y0 < -500) return;
          /* On prend la bande LA PLUS LARGE des deux conventions possibles (libellé posé par son
             haut, ou centré sur sa valeur) : se tromper en masquant coûte une graduation dans une
             colonne que les pastilles occupent déjà presque entièrement ; se tromper en gardant
             laisse un chiffre coupé en deux, c'est-à-dire le défaut qu'on corrige. */
          const couverte = bandes.some(b => y0 + hh > b[0] && y0 - hh / 2 < b[1]);
          if (couverte) { _gradCachees.add(l); l.set('forceHidden', true); }
          else if (_gradCachees.has(l)) { _gradCachees.delete(l); l.set('forceHidden', false); }
        });
      } catch (e) {}

      let refait = false;
      arr.forEach(x => {
        const lbl = x.o.range?.get('label');
        const d = Math.round(x.px - x.basePx);
        if (!lbl) return;
        try {
          lbl.set('dy', d);
          // Le filet de rappel est dessiné DANS le badge : il faut donc reconstruire son HTML quand
          // le décalage change. On ne le fait que dans ce cas — declutter est rappelé à chaque
          // redimensionnement, et reconstruire huit étiquettes à chaque fois ferait clignoter.
          // `dy` est mis a null par `ancrerBadges` quand le chevron change : la comparaison echoue
          // alors forcement, et le HTML est refait. Sans cela, une devise qui vient de sortir du
          // cadre garderait une pastille sans chevron, donc un mensonge.
          if (x.o.dy !== d) {
            x.o.dy = d;
            // ⚠️ La valeur DOIT être repassée : reconstruire le badge sans elle l'effacerait jusqu'à
            // la prochaine mise à jour des données, soit jusqu'à 20 s d'étiquettes muettes. Et c'est
            // la VRAIE valeur, jamais l'ancre : l'ancre sert a placer, pas a informer.
            const v = (x.o.value != null ? x.o.value : 0).toFixed(2).replace('.', ',');
            lbl.set('html', _csBadgeHtml(x.ccy, x.o.hexStr, _avecValeur ? v : '', d, x.o.hors));
            refait = true;
          }
        } catch {}
      });
      /* Une étiquette dont le HTML vient d'être refait n'a pas encore sa taille définitive : on
         repasse une fois pour vérifier le placement sur les vraies boîtes. Borné à deux reprises —
         au-delà, c'est que la taille oscille, et boucler ne la stabiliserait pas. */
      if (refait && _dcApres < 2) { _dcApres++; setTimeout(declutter, 40); } else if (!refait) _dcApres = 0;

      /* ══ L'INVARIANT, EN DERNIER RECOURS : UNE COURBE VISIBLE A UNE PASTILLE VISIBLE (10/09) ═══
         L'utilisateur signale une pastille manquante en vue de PAIRE — la courbe est là, son
         étiquette non. CINQ pistes ont été éliminées à la mesure, et aucune ne reproduit : 210
         configurations de géométrie, la forme de la donnée servie par le serveur, le rognage par le
         vrai panneau, la course 0×0 à la construction, et 25 scénarios de rafraîchissement. Le
         défaut existe pourtant : il a été vu.
         ⚠️ ON NE DEVINE DONC PAS LA CAUSE — ON REND L'INVARIANT VRAI. Quel que soit le chemin qui
         désynchronise l'état d'une étiquette de celui de sa série (course d'animation, événement
         'shown' qui ne part pas parce que la propriété n'a pas changé, passe de mise à jour
         entrelacée), cette dernière ligne relit la visibilité RÉELLE de la série — la seule source
         de vérité qui ne se décale pas — et rétablit l'étiquette qui la contredit.
         ⚠️ POURQUOI ICI ET PAS DANS `update()` : à cet endroit, l'anti-collision a fini son travail
         et les boîtes sont stables. Plus haut, on lisait des états transitoires — c'est la raison
         pour laquelle `update()` s'appuie sur `_hiddenCcy` et NON sur `isHidden()`, et cette
         décision-là n'est pas touchée. On n'ajoute qu'un filet, après coup, jamais une seconde
         source de vérité concurrente.
         ⚠️ ET IL NE FORCE RIEN DANS L'AUTRE SENS : une devise réellement masquée (légende décochée,
         hors paire) garde son étiquette masquée. Le filet ne fait que RÉVÉLER ce qui devrait
         l'être — le défaut inverse, une étiquette de courbe absente, serait pire. */
      try {
        Object.keys(labelMap).forEach(function (c) {
          var s2 = seriesMap[c], l2 = labelMap[c];
          if (!s2 || !l2 || !l2.range) return;
          var cachee = _hiddenCcy.has(c) || (_only && !_only.has(c));
          if (cachee) return;                                  // masquée pour de bon : on n'y touche pas
          var et = l2.range.get('label'); if (!et) return;
          if (et.get('forceHidden') === true || et.get('visible') === false) {
            et.setAll({ forceHidden: false, visible: true });
          }
        });
      } catch {}
    } catch {}
  }
  // declutter RÉSILIENT (corrige « on ne voit que l'étiquette USD ») : au build, le conteneur peut être à 0
  // hauteur (course de layout — la raison même de _selfHeal). declutter() bail alors (h=0) et n'était RELANCÉ
  // par rien → les badges restaient EMPILÉS à leur valeur brute et se CACHAIENT l'un l'autre (les valeurs du
  // jour sont proches → chevauchement, seule la devise isolée reste lisible). On reprogramme tant que la hauteur
  // n'est pas réelle, puis on ré-espace à CHAQUE redimensionnement du conteneur (révélation d'onglet, drag du splitter).
  function scheduleDeclutter(tries) {
    tries = tries || 0;
    let h = 0; try { h = chart.plotContainer.height(); } catch (e) {}
    if (!h || h < 24) { if (tries < 25) setTimeout(() => scheduleDeclutter(tries + 1), 200); return; }
    declutter();
    setTimeout(declutter, 300);    // 2e passe une fois le layout stabilisé
    /* 3e passe. L'axe Y REFABRIQUE ses graduations quand ses bornes changent — et elles changent
       après coup : masquage de devises en mode « paire », recadrage sur le paquet, animation
       d'apparition. Les graduations neuves ne connaissent pas le masquage posé sur les anciennes, et
       un chiffre ressortait alors de derrière une pastille, une fois sur deux. */
    setTimeout(declutter, 1200);
  }
  // ⚠️ Le cadrage est posé PLUS BAS, APRÈS le branchement du zoom au glisser — celui-ci réinitialise
  // l'axe au moment où il s'attache. Posé ici, il était calculé correctement puis EFFACÉ dans la
  // foulée : l'axe repassait en min/max null et le graphe ne bougeait pas d'un pixel alors que tout
  // le calcul était juste. Symptôme trompeur s'il en est.
  scheduleDeclutter(0);
  // Ré-espacement à CHAQUE recalcul des bornes du plot (révélation d'onglet, resize, drag du splitter, zoom Y) :
  // on écoute l'événement NATIF amCharts 'boundschanged', émis APRÈS que la mise en page est recalculée → declutter
  // lit une hauteur RÉELLE. (Un ResizeObserver DOM, lui, précède ce recalcul → declutter lisait une hauteur périmée
  // et laissait les badges empilés.) Débounce en requestAnimationFrame (boundschanged peut se répéter en rafale).
  try {
    let _dcRaf = 0;
    const _relance = () => {
      if (_dcRaf) return;
      _dcRaf = requestAnimationFrame(() => { _dcRaf = 0; declutter(); _ajusterGrip(); });
    };
    chart.plotContainer.events.on('boundschanged', _relance);
    /* ⚠️ ET QUAND L'AXE REFABRIQUE SES GRADUATIONS. Elles sont recréées dès que ses bornes changent —
       recadrage sur le paquet, masquage d'une devise à la légende, mode « paire », fin d'animation.
       Les graduations neuves ignorent le masquage posé sur les anciennes : un chiffre ressortait
       alors de derrière une pastille, et pas toujours — ce qui est le pire des deux, un défaut qu'on
       ne reproduit qu'une fois sur deux. `datavalidated` est émis exactement à ce moment-là. */
    yAxis.events.on('datavalidated', _relance);
  } catch (e) {}
  /* LA BANDE DE PRÉHENSION ÉPOUSE LA GOUTTIÈRE RÉELLE (29/08). Sa largeur était SUPPOSÉE — 50, 56,
     70 ou 84 px selon le réglage et la largeur d'écran — alors que la gouttière mesure en vrai de 37
     à 77 px selon le contenu des pastilles, le chevron et le thème. Trop large, la bande `ns-resize`
     recouvre le tracé et mange le survol, le croisillon et le glisser ; trop étroite, le bord droit
     ne répond plus au double-clic qui rend le cadrage plein. On la mesure. */
  function _ajusterGrip() {
    try {
      const g = container && container.querySelector('.cs-yzoom-grip');
      const w = Math.round(yAxis.width());
      if (g && w > 10 && Math.abs(parseInt(g.style.width, 10) - w) > 1) g.style.width = w + 'px';
    } catch (e) {}
  }

  // ── Mise à jour EN PLACE (pas de reconstruction → aucun clignotement) ────────
  function update(newData) {
    if (!newData || !newData.currencies) return;
    newData = _couperQueueGelee(newData);
    scaleFactor = computeScale(newData);
    _dernieresDonnees = newData;
    // ⚠️ Avec min/max + strictMinMax, l axe ne se recale PLUS tout seul : sans ce rappel a chaque
    // rafraichissement, le cadre serait fige sur des donnees perimees et pourrait masquer plus qu au
    // premier rendu.
    cadrerSurLePaquet(newData);
    for (const ccy of newData.currencies) {
      const s = seriesMap[ccy];
      if (!s) continue;
      /* ⚠️ LA MÊME DENSITÉ QU'À LA CONSTRUCTION, sans quoi la première actualisation ramènerait la
         courbe à sa densité brute et le rendu changerait sous les yeux de l'utilisateur au bout de
         trente secondes. La largeur du tracé est relue au moment du rafraîchissement : une carte
         redimensionnée entre-temps reçoit le nombre de points qui lui revient. */
      const _cibleMaj = Math.max(60, Math.round(
        Math.max(200, ((container && container.clientWidth) || 900) - _gouttiere) * CS_PT_PAR_PX));
      const pts = _csLTTB((newData.series[ccy] || [])
        .filter(d => d.v != null && d.t != null)
        .map(d => ({ ...d, v: d.v * scaleFactor })), _cibleMaj);
      /* PAS de moyenne mobile ici non plus : la mise à jour live RÉÉCRIVAIT autrefois les points
         avec une moyenne 3 points, et la courbe du premier rendu devenait molle en quelques
         secondes. Ce qui est appliqué ci-dessus n'est pas un lissage mais un CHOIX de points réels. */
      const cleanPts = pts;
      s.data.setAll(cleanPts);                      // animation fluide intégrée amCharts
      // Repositionner + retexter le badge flottant
      const lp = cleanPts[cleanPts.length - 1];
      const lv = (lp && lp.v != null) ? lp.v : 0;
      const lbl = labelMap[ccy];
      if (lbl && lbl.range) {
        lbl.value = lv;
        // ⚠️ ON NE POSE PLUS LA PLAGE SUR LA VALEUR BRUTE. `ancrerBadges` la borne au cadre juste
        // apres ; poser d'abord la valeur brute ferait disparaitre la pastille d'une devise sortie
        // du cadre, le temps d'une trame — un clignotement a chaque rafraichissement.
        lbl.ancre = null;                                             // force `ancrerBadges` a reposer la plage
        // On repasse le dy courant : sans lui la mise a jour effacerait le filet de rappel jusqu au prochain declutter.
        try { lbl.range.get('label')?.set('html', _csBadgeHtml(ccy, lbl.hexStr, _avecValeur ? lv.toFixed(2).replace('.', ',') : '', lbl.dy, lbl.hors)); } catch {}
        // le re-set du html ré-affichait le badge même masqué → on ré-applique l'état caché à chaque update,
        // d'après _hiddenCcy UNIQUEMENT (source de vérité des devises masquées via la légende). On n'utilise plus
        // s.isHidden()/get('visible') : transitoires (animation/course de layout) → ils force-cachaient à tort.
        if (_hiddenCcy.has(ccy)) { try { lbl.range.get('label')?.setAll({ forceHidden: true, visible: false }); lbl.range.get('grid')?.set('forceHidden', true); } catch {} }
        else { try { lbl.range.get('label')?.setAll({ forceHidden: false, visible: true }); } catch {} }
      }
    }
    ancrerBadges();              // les fins ont bouge : on reborne les plages sur le cadre courant
    setTimeout(declutter, 60);   // recalibrer l'anti-collision après mise à jour
  }

  // Étirement vertical de l'axe Y au glisser (façon TradingView/la référence) sur la gouttière droite
  // 4e argument : la bascule de cadrage. Le double-clic sur la gouttière alterne « serré sur le
  // paquet » et « cadre plein » — la devise partie loin redevient visible en un geste.
  // La bande de préhension épouse la gouttière RÉELLE (`_gouttiere`, calculé l. 923 dans cette même
  // fonction selon le réglage « valeur sur les étiquettes » et la largeur d'écran) au lieu d'un 70 px
  // codé en dur. Mesuré sur le code réel : yAxis.width() = 43,7 px, plotContainer.width() = 493,3 px,
  // grip.offsetWidth = 70 px → 26 px du TRACÉ étaient recouverts par une zone `ns-resize` qui mangeait
  // le survol, le croisillon et le pan, et faisait paraître le graphe décalé une fois agrandi (le bord
  // gauche colle au cadre, le droit non).
  _attachYAxisDragZoom(container, yAxis, _gouttiere, function () {
    _cadreLibre = !_cadreLibre;
    cadrerSurLePaquet(_dernieresDonnees);
    scheduleDeclutter(0);
  });
  // ICI, et pas plus haut : l'attachement ci-dessus réinitialise l'axe. Le cadrage doit avoir le
  // dernier mot, sinon il est calculé pour rien.
  // REPOSÉ après stabilisation : au premier rendu, amCharts anime l'apparition des séries et remet
  // l'axe à zéro en cours de route. Même cause et même remède que la 2e passe de declutter à 300 ms.
  cadrerSurLePaquet(data);
  setTimeout(function () { cadrerSurLePaquet(_dernieresDonnees); scheduleDeclutter(0); }, 700);
  setTimeout(function () { cadrerSurLePaquet(_dernieresDonnees); scheduleDeclutter(0); }, 1900);
  scheduleDeclutter(0);

  // ── LE TRACÉ SUIT SON CADRE ──────────────────────────────────────────────────────────────────
  // amCharts recalcule sa taille sur un changement de FENÊTRE, pas sur un changement de son
  // CONTENEUR. Or le cadre bouge sans que la fenêtre bouge : dézoom de la page, ouverture d'un
  // volet latéral, glisser du splitter, passage d'un widget en plein écran, révélation d'un onglet.
  // Le tracé restait alors à son ancienne largeur et laissait une bande vide à droite (capture user
  // 05/08). On observe donc la boîte elle-même. Débounce en requestAnimationFrame : l'observateur
  // se déclenche en rafale pendant un glisser.
  if (container && window.ResizeObserver) {
    let _roRaf = 0;
    let _lastCalW = _plotW;   // largeur de tracé à la dernière calibration densité/épaisseur
    const ro = new ResizeObserver(() => {
      // Auto-nettoyage : le graphique peut être détruit alors que l'observateur vit encore.
      try { if (root.isDisposed && root.isDisposed()) { ro.disconnect(); return; } } catch (e) { ro.disconnect(); return; }
      if (_roRaf) return;
      _roRaf = requestAnimationFrame(() => {
        _roRaf = 0;
        try { root.resize(); } catch (e) {}
        declutter();   // la hauteur du tracé a changé → l'anti-collision doit se recalibrer
        // Recalibrage densité/épaisseur (10/08) : _sw et minDistance sont calculés à la CONSTRUCTION
        // pour la largeur d'alors. Un vrai changement de cadre (splitter, plein écran d'un widget,
        // volet latéral) change le rapport points/pixel → un TW passé en plein écran gardait sa
        // décimation 2 px devenue inutile, un graphe rétréci s'empâtait sans elle. On recalcule les
        // DEUX leviers sur la largeur réelle, SANS reconstruire (la donnée n'est jamais retouchée).
        // Seuil 15 % : les micro-variations de layout ne déclenchent rien.
        try {
          const wNow = Math.max(200, ((container && container.clientWidth) || 0) - _gouttiere);
          if (wNow > 200 - 1 && _lastCalW > 0 && Math.abs(wNow - _lastCalW) / _lastCalW > 0.15) {
            _lastCalW = wNow;
            const dd = _dernieresDonnees || {};
            const nPts = Math.max.apply(null, ((dd.currencies) || []).map(function (c) { return ((dd.series || {})[c] || []).length; }).concat([0]));
            /* ⚠️ ON RE-CHOISIT LES POINTS, ON NE RETOUCHE PLUS UN SEUIL DE DÉCIMATION. Élargir la
               carte (splitter, plein écran) donne droit à plus de points, la rétrécir en demande
               moins : c'est la même règle qu'à la construction, appliquée à la largeur du moment.
               L'épaisseur, elle, ne dépend plus de la densité — celle-ci est constante par
               construction — donc il n'y a plus rien à y recalculer. */
            const cible = Math.max(60, Math.round(wNow * CS_PT_PAR_PX));
            const fact = scaleFactor;
            chart.series.each(function (s) {
              try {
                var c = s.get('name');
                var src = ((dd.series || {})[c] || []).filter(function (d2) { return d2.v != null && d2.t != null; })
                  .map(function (d2) { return { t: d2.t, v: d2.v * fact }; });
                if (src.length) s.data.setAll(_csLTTB(src, cible));
              } catch (e) {}
            });
          }
        } catch (e) {}
      });
    });
    try { ro.observe(container); } catch (e) {}
  }

  return { root, seriesMap, update };
}

// ── Étirement vertical de l'axe Y au DRAG (façon TradingView / la référence) ───────────
// On superpose une fine bande transparente sur la gouttière de l'axe Y (à DROITE,
// car renderer opposite:true). Un glisser vertical y zoome l'axe des valeurs :
//   HAUT  → on étire (zoom in) → les courbes montent/descendent davantage,
//   BAS   → on revient vers l'ajustement auto,  DOUBLE-CLIC → réinitialise.
// Capture de pointeur → aucun listener résiduel (le grip meurt avec le conteneur au rebuild).
// État volatil : remis à plat à chaque reconstruction (innerHTML vidé) : conforme DTP.
function _attachYAxisDragZoom(container, yAxis, gutterW, onFitToggle) {
  if (!container || !yAxis || typeof window.PointerEvent === 'undefined') return;
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  const grip = document.createElement('div');
  grip.className = 'cs-yzoom-grip';
  grip.style.cssText = 'position:absolute;top:0;bottom:0;right:0;width:' + (gutterW || 70) + 'px;z-index:6;cursor:ns-resize;touch-action:none;';
  container.appendChild(grip);

  const MINS = 0.12, MAXS = 3, K = 0.0065;   // scale : <1 = étiré (zoom in, ~8× max) · 1 = plein · >1 = COMPRESSÉ (désélargi, ~3×)
  let scale = 1, dragging = false, startY = 0, startScale = 1, raf = 0;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function apply() {
    try {
      if (scale <= 1) {                                                  // ÉTIRER : on zoome sur une sous-fenêtre centrée
        yAxis.set('extraMin', 0); yAxis.set('extraMax', 0);
        const h = scale / 2; yAxis.zoom(0.5 - h, 0.5 + h);
      } else {                                                           // COMPRESSER (désélargir) : marge haut/bas → courbes aplaties
        yAxis.zoom(0, 1);
        const pad = (scale - 1) / 2; yAxis.set('extraMin', pad); yAxis.set('extraMax', pad);
      }
    } catch (e) {}
  }
  function schedule() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; apply(); }); }
  grip.addEventListener('pointerdown', (e) => {
    dragging = true; startY = e.clientY; startScale = scale;
    try { grip.setPointerCapture(e.pointerId); } catch (_) {}
    grip.classList.add('is-grabbing'); e.preventDefault(); e.stopPropagation();
  });
  grip.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    scale = clamp(startScale * Math.exp((e.clientY - startY) * K), MINS, MAXS);   // dy<0 (haut) → exp<1 → scale↓ → zoom in
    schedule(); e.preventDefault(); e.stopPropagation();
  });
  function end(e) { if (!dragging) return; dragging = false; grip.classList.remove('is-grabbing'); try { grip.releasePointerCapture(e.pointerId); } catch (_) {} }
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
  grip.addEventListener('lostpointercapture', () => { dragging = false; grip.classList.remove('is-grabbing'); });
  // Double-clic sur la gouttière = BASCULE du cadrage (06/08) : on alterne entre le cadre serré sur
  // le paquet et le cadre PLEIN, qui remontre la devise partie loin. C'est la porte de sortie du
  // cadrage automatique : rien n'est caché définitivement, tout est à un geste.
  grip.addEventListener('dblclick', (e) => {
    scale = 1; apply();
    try { if (typeof onFitToggle === 'function') onFitToggle(); } catch (err) {}
    e.preventDefault(); e.stopPropagation();
  });
}

// Graphique de force ISOLÉ (réutilisé par le Weekly Recap) :
// la devise `focusCurrency` garde sa couleur à 100 %, les 7 autres passent en gris à 10 %.
async function buildIsolatedStrength(containerId, focusCurrency, period = 'week', reglages) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = (window.dtpLoader ? window.dtpLoader('Chargement de la force des devises…') : 'Chargement…');
  try {
    const data = await (window.dtpFetchBorne ? window.dtpFetchBorne(`/api/currency-strength?period=${period}`) : fetch(`/api/currency-strength?period=${period}`)).then(r => r.json());
    if (!data || !data.currencies) { el.innerHTML = '<div class="wr-chart-loading">Force des devises indisponible.</div>'; return; }
    // GARDE 0×0 (03/08, « force des devises il bug ») : même course que la carte des sessions et le
    // baromètre — amCharts mesure un cadre PAS ENCORE POSÉ (accueil monté en différé, onglet caché,
    // rangée de grille qui se stabilise) → graphe BLANC définitif. On attend une vraie taille
    // (jusqu'à ~8 s) avant de construire ; cadre disparu entre-temps → abandon propre.
    for (let i = 0; i < 12 && (el.offsetWidth < 80 || el.offsetHeight < 60); i++) {
      await new Promise(r => setTimeout(r, 650));
      if (!document.getElementById(containerId)) return;
    }
    if (!document.getElementById(containerId)) return;
    el.innerHTML = '';
    return buildStrengthChart(containerId, data, Object.assign({ focusCurrency, isolated: true }, reglages || {}));
  } catch {
    el.innerHTML = '<div class="wr-chart-loading">Force des devises indisponible.</div>';
  }
}
window.buildIsolatedStrength = buildIsolatedStrength;

// Ranked snapshot view : horizontal bars sorted strongest → weakest
function buildStrengthSnapshot(containerId, data) {
  const el = document.getElementById(containerId);
  if (!el) return;

  // Extract latest non-null value per currency
  const scores = data.currencies.map(ccy => {
    const pts = (data.series[ccy] || []).filter(d => d.v != null);
    const v   = pts.length > 0 ? pts[pts.length - 1].v : 0;
    return { ccy, v };
  }).sort((a, b) => b.v - a.v);

  const maxAbs = Math.max(...scores.map(s => Math.abs(s.v)), 0.01);

  el.innerHTML = `<div class="cs-rank-list">${
    scores.map((s, i) => {
      const hex    = '#' + _csCouleur(s.ccy).toString(16).padStart(6, '0');
      const barPct = (Math.abs(s.v) / maxAbs * 100).toFixed(1);
      const dir    = s.v >= 0 ? 'pos' : 'neg';
      const valStr = (s.v >= 0 ? '+' : '') + s.v.toFixed(2);
      return `
        <div class="cs-rank-item">
          <span class="cs-rank-num">${i + 1}</span>
          <span class="cs-rank-ccy" style="color:${hex}">${s.ccy}</span>
          <div class="cs-rank-bar-wrap">
            <div class="cs-rank-bar" style="width:${barPct}%;background:${hex}33;border-right:2px solid ${hex}"></div>
          </div>
          <span class="cs-rank-val cs-rank-val--${dir}">${valStr}</span>
        </div>`;
    }).join('')
  }</div>`;
}

// Vue double "Force de la devise" : panneau gauche (TD) + panneau droit (TW), 50/50
let _strengthTimers = [];

// Fetch JSON RÉSILIENT (anticipation) : tolère les hoquets transitoires : 502/HTML pendant un redéploiement,
// coupure réseau, réponse non-JSON. Réessaie sur 5xx / non-JSON / erreur réseau. Renvoie le JSON, ou lève
// après N essais. Évite définitivement le « Unexpected token '<' » (parse d'une page d'erreur HTML).
async function _dtpJSON(url, opts = {}) {
  const tries = opts.tries || 3, delay = opts.delay || 1200;
  // Borne par tentative (11/09, même défaut que Force des Devises et le détail calendrier) : sans
  // elle, un serveur qui ne répond ni n'échoue jamais bloque la 1ʳᵉ tentative pour toujours — les
  // `tries` de retry prévus ne servent à rien si on ne sort jamais de la première boucle.
  const delaiMs = opts.delaiMs || 12000;
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, delaiMs);
    try {
      const r = await fetch(url, Object.assign({}, opts.init || {}, { signal: ctrl.signal }));
      const ct = r.headers.get('content-type') || '';
      if (r.ok && /json/i.test(ct)) return await r.json();
      if (r.status === 401 || r.status === 403) return await r.json().catch(() => ({ error: 'unauthorized' }));   // vraie réponse d'auth → pas un hoquet
      lastErr = new Error('HTTP ' + r.status + (/html|<!/i.test(ct) ? ' (HTML)' : ''));
    } catch (e) { lastErr = e; }
    finally { clearTimeout(t); }
    if (i < tries - 1) await new Promise(s => setTimeout(s, delay));
  }
  throw lastErr || new Error('fetch failed');
}
if (typeof window !== 'undefined') window._dtpJSON = _dtpJSON;

async function buildStrengthCharts() {
  const wrap = document.getElementById('strength-charts-row');
  if (!wrap) return;

  /* RETOUR SUR L'ONGLET SANS SPECTACLE (30/08, demande user « les forces des devises se rechargent
     et on ne voit plus les courbes — faut pas que ça se voit que ça s'actualise ») : chaque retour
     sur FORCE reconstruisait TOUT (dispose + loader + refetch) alors que les deux graphes étaient
     encore VIVANTS — les courbes disparaissaient le temps du rechargement. Si chaque panneau porte
     un canvas rendu, on ne détruit rien : on ré-arme seulement le rafraîchissement silencieux (les
     minuteurs se coupent d'eux-mêmes quand l'onglet se ferme) et on met à jour EN PLACE. */
  if (_strengthRelance && wrap.querySelector('.strength-pane')
      && ['L', 'R'].every(s => { const cv = wrap.querySelector('#chart-strength-' + s + ' canvas'); return cv && cv.clientHeight > 40; })) {
    _strengthRelance();
    return;
  }
  _strengthRelance = null;

  // Nettoyage
  if (_strengthRoot) { try { _strengthRoot.dispose(); } catch {} _strengthRoot = null; }
  _strengthTimers.forEach(t => clearInterval(t)); _strengthTimers = [];
  ['chart-strength-L', 'chart-strength-R'].forEach(id => { try { disposeRoot(id); } catch {} });

  // Libellé « Force des Devises » RESTAURÉ (demande user 27/07 « gère pour ces widgets aussi ») dans le
  // MÊME style canonique que tous les autres titres de vues (.strength-chart-label = Inter Tight MAJUSCULES) :
  // remplit la barre (titre à gauche, sélecteurs de période à droite) au lieu de la laisser à moitié vide.
  const paneHtml = (side, defPeriod) => `
    <div class="strength-pane" data-side="${side}">
      <div class="strength-tf-bar chart-header">
        <span class="strength-chart-label chart-header-title">Force des Devises</span>
        <span style="flex:1"></span>
        ${STF_ORDER.map(p =>
          `<button class="stf-btn stf-tf-btn${p === defPeriod ? ' stf-btn--active' : ''}" data-period="${p}">${STF_LABELS[p]}</button>`
        ).join('')}
      </div>
      <div class="strength-main-chart" id="chart-strength-${side}"></div>
    </div>`;

  /* ⚠️ ORDRE D'INITIALISATION : LE COMPTE D'ABORD (correctif 12/08, bug user « je mets TD en haut et
     TW en bas, je me déconnecte/reconnecte, tout revient à TD »).
     Vérifié de bout en bout en production : après déco/reco, /api/strength-tf renvoie bien le choix
     stocké. Le serveur est donc hors de cause — c'est l'amorçage client qui perdait la valeur.
     Le défaut : on peignait les panneaux depuis le CACHE LOCAL, puis on « corrigeait » après coup si
     le compte disait autre chose. Ça fait dépendre l'affichage d'un cache par navigateur, avec une
     correction qui ne s'applique QUE si elle diffère de la période déjà chargée — assez de conditions
     pour qu'une seule d'entre elles rate et fige les deux panneaux sur le défaut.
     Désormais : si le compte a déjà répondu une fois dans la vie de la page (`_stfPref`), c'est LUI
     qui peint, immédiatement et sans correction ultérieure. Sinon on peint depuis le cache local (pas
     d'attente perceptible) et la réponse du compte recale les panneaux — chemin inchangé. */
  const _pref0 = _stfPref || _stfLocal() || STF_DEF;
  wrap.innerHTML = paneHtml('L', _pref0.L) + paneHtml('R', _pref0.R);

  // Contrôleur d'un panneau (chargement + rendu + auto-refresh indépendants)
  function makePane(side, initialPeriod) {
    const pane        = wrap.querySelector(`.strength-pane[data-side="${side}"]`);
    const containerId = `chart-strength-${side}`;
    let activePeriod  = initialPeriod;
    let chartCtl      = null;   // { root, seriesMap, update }
    let _dejaPeint    = false;  // premier rendu accompli → les reconstructions se font sans spectacle

    // silent=true → mise à jour en place (pas de reconstruction, pas de spinner)
    async function load(period, { force = false, silent = false } = {}) {
      const periodChanged = period !== activePeriod;
      activePeriod = period;
      const el = document.getElementById(containerId);
      if (!silent || periodChanged || !chartCtl) {
        if (el && !chartCtl) el.innerHTML = (window.dtpLoader ? window.dtpLoader('Chargement de la force des devises…') : 'Chargement…');
      }
      try {
        const url  = `/api/currency-strength?period=${period}${force ? '&force=1' : ''}`;
        const data = await _dtpJSON(url);
        if (!data.currencies) throw new Error(data.error || 'No data');
        if (chartCtl && chartCtl.update && !periodChanged) {
          chartCtl.update(data);            // ← prolonge la courbe sans clignoter
        } else {
          try { disposeRoot(containerId); } catch {}
          // Reconstruction silencieuse dès qu'un premier rendu a eu lieu : changer de période ou
          // se rétablir d'un blanc ne doit pas rejouer le rideau d'ouverture.
          chartCtl = buildStrengthChart(containerId, data, { rebuild: _dejaPeint });
          _dejaPeint = true;
        }
      } catch (e) {
        console.error('[Strength]', side, e.message);
        if (!chartCtl) {
          // JAMAIS d'erreur brute (« Unexpected token '<' ») : on montre « Chargement… » et on RÉESSAIE tant
          // qu'on est sur l'onglet STRENGTH → la carte se rétablit toute seule après un hoquet serveur (déploiement).
          const el2 = document.getElementById(containerId);
          if (el2) el2.innerHTML = (window.dtpLoader ? window.dtpLoader('Chargement de la force des devises…') : 'Chargement…');
          const tab = document.getElementById('rtab-strength');
          if (tab && tab.classList.contains('active')) setTimeout(() => { try { load(activePeriod, { silent: true }); } catch (e2) {} }, 4000);
        }
      }
    }

    pane.querySelectorAll('.stf-tf-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        pane.querySelectorAll('.stf-tf-btn').forEach(b => b.classList.remove('stf-btn--active'));
        btn.classList.add('stf-btn--active');
        chartCtl = null;                    // changement de période → reconstruction
        _stfSet(side, btn.dataset.period);  // mémorisé pour ce compte, dès le clic
        load(btn.dataset.period, { force: false });
      });
    });

    load(initialPeriod, { force: true });
    // La valeur du COMPTE a le dernier mot : si l'utilisateur a changé de période sur un autre
    // appareil (ou vidé son cache local), on s'aligne dès que le serveur a répondu.
    const _monteA = Date.now();
    _stfCharger().then(function (pref) {
      // Même arbitrage qu'au-dessus, côté panneau : si l'utilisateur a cliqué depuis le montage,
      // on ne rebascule PAS son graphe sous ses yeux.
      if (_stfClicAt > _monteA) return;
      const voulu = pref && pref[side];
      if (!voulu || voulu === activePeriod) return;
      pane.querySelectorAll('.stf-tf-btn').forEach(function (b) {
        b.classList.toggle('stf-btn--active', b.dataset.period === voulu);
      });
      chartCtl = null;
      load(voulu, { force: false });
    }).catch(function () {});
    // AUTO-RÉTABLISSEMENT (« Force des Devises ne s'affiche pas ») : si le conteneur était à 0 hauteur au montage
    // (course de layout / restauration de l'onglet à l'ouverture de la vue Analyste), amCharts sort en 0×0 et
    // reste BLANC même une fois la place disponible → on détecte (conteneur dimensionné mais sans canvas rendu)
    // et on RECONSTRUIT. Retry tant que le conteneur n'a pas de taille (jusqu'à ~3 s).
    const _selfHeal = (tries) => {
      const panel = document.getElementById('rtab-strength');
      const el = document.getElementById(containerId);
      if (!el || !panel || !panel.classList.contains('active')) return;
      const cv = el.querySelector('canvas');
      if (el.clientHeight > 40) { if (!cv || cv.clientHeight < 40) { chartCtl = null; load(activePeriod, { force: false }); } }
      else if (tries < 9) setTimeout(() => _selfHeal(tries + 1), 340);
    };
    setTimeout(() => _selfHeal(0), 340);
    // Rafraîchissement rapide et fluide (20s) : uniquement quand l'onglet STRENGTH est visible.
    // Extrait en arm() (30/08) : le minuteur se coupe tout seul à la fermeture de l'onglet — le
    // RETOUR doit pouvoir le re-poser sans reconstruire le panneau (relance silencieuse).
    let _tic = null;
    const arm = () => {
      if (_tic) { clearInterval(_tic); _strengthTimers = _strengthTimers.filter(t => t !== _tic); }
      _tic = setInterval(() => {
        const panel = document.getElementById('rtab-strength');
        if (!panel || !panel.classList.contains('active')) { _strengthTimers.forEach(t => clearInterval(t)); _strengthTimers = []; _tic = null; return; }
        const el = document.getElementById(containerId), cv = el && el.querySelector('canvas');
        if (el && el.clientHeight > 40 && (!cv || cv.clientHeight < 40)) chartCtl = null;   // blanc détecté → forcer une reconstruction
        load(activePeriod, { silent: true });
      }, 20_000);
      _strengthTimers.push(_tic);
    };
    arm();
    return { arm, load: (o) => load(activePeriod, o) };
  }

  // Défauts d'origine (gauche = TD intraday, droite = TW hebdomadaire) UNIQUEMENT si le compte n'a
  // rien mémorisé : dès qu'un choix a été fait, c'est lui qui s'applique — au retour sur l'onglet,
  // après reconnexion, et depuis un autre appareil.
  const _pL = makePane('L', _pref0.L);
  const _pR = makePane('R', _pref0.R);
  // Poignée du retour d'onglet : ré-arme les minuteurs et met à jour EN PLACE (silent) — un graphe
  // vivant ne se reconstruit jamais, donc les courbes ne disparaissent plus à la ré-ouverture.
  _strengthRelance = () => { [_pL, _pR].forEach(p => { p.arm(); p.load({ silent: true }); }); };
}

// ═══════════════════════════════════════════════
//  RISK : Real Risk Sentiment Widget
// ═══════════════════════════════════════════════

let _riskRefreshTimer = null;
let _riskGaugeOnUpdate = null;   // listener du snapshot risque partagé (source unique)
let _riskGaugeRoot    = null;
let _riskHandDI       = null;
let _riskHand         = null;   // sprite ClockHand (pour recolorer l'aiguille selon l'état au refresh)
let _riskScoreLabel   = null;
let _riskBadgeLabel   = null;

// Bande sentiment (● LABEL: phrase EN) : partagée build + mise à jour du widget risque
const _RISK_BAND_EN = {
  'STRONG RISK-ON':  'Fort appétit pour le risque. Les capitaux affluent vers les actions et les actifs à fort bêta. Les valeurs refuges sont vendues.',
  'RISK-ON':         'L’appétit pour le risque domine. Actions et actifs risqués recherchés ; actifs défensifs en retrait.',
  'WEAK RISK-ON':    'Appétit pour le risque modéré. Ton constructif mais conviction limitée.',
  'NEUTRAL':         'Sentiment équilibré. Signaux mitigés sur les actifs risqués, pas de direction claire.',
  'WEAK RISK-OFF':   'La prudence domine. Flux mitigés. Valeurs refuges soutenues. Volatilité élevée.',
  'RISK-OFF':        'Aversion au risque à l’œuvre. Fuite vers la sécurité : obligations, or, JPY et CHF recherchés.',
  'STRONG RISK-OFF': 'Forte aversion au risque. Fuite marquée vers les valeurs refuges. Volatilité forte.',
};
// Libellé FR du badge/bande de risque : affichage UNIQUEMENT (la valeur logique data.label reste EN :
// dérivation de classe `cls`, comparaisons /risk-on/i, couleurs). Couvre les 7 variantes.
const GAUGE_LABEL_FR = {
  'STRONG RISK-ON':  'FORT APPÉTIT',
  'RISK-ON':         'APPÉTIT',
  'WEAK RISK-ON':    'FAIBLE APPÉTIT',
  'NEUTRAL':         'NEUTRE',
  'WEAK RISK-OFF':   'LÉGÈRE AVERSION',
  'RISK-OFF':        'AVERSION',
  'STRONG RISK-OFF': 'FORTE AVERSION',
};
function _riskBandInner(data) {
  // Phrase façon DTP, construite à partir des VRAIES données (assets réels) → plus jamais
  // d'affirmation figée qui contredit le marché (ex. « VIX trending lower » alors qu'il monte).
  const A = {};
  (data.assets || []).forEach(a => { A[a.label] = a.chg; });
  const eq    = ((A['S&P 500'] || 0) + (A['Nasdaq (Tech/Risk)'] || 0)) / 2;
  const haven = ((A['Or (Sécurité)'] || 0) + (A['Obligations US'] || 0)) / 2;
  const vix   = A['VIX (Volatilité)'] || 0;
  const LEAD = {
    'STRONG RISK-ON':  'Fort appétit pour le risque.',
    'RISK-ON':         'Appétit pour le risque bien présent.',
    'WEAK RISK-ON':    'Appétit pour le risque en amélioration progressive.',
    'NEUTRAL':         'Appétit pour le risque équilibré. Marchés en consolidation.',
    'WEAK RISK-OFF':   'La prudence s’installe.',
    'RISK-OFF':        'Aversion au risque à l’œuvre.',
    'STRONG RISK-OFF': 'Forte aversion au risque.',
  };
  const vixTxt   = `VIX ${vix >= 0 ? '+' : ''}${vix.toFixed(1)}%`;
  // Bande COURTE (demande user) : la conclusion + le VIX seulement (fini « actions…, valeurs refuges… »).
  const phrase = (data.assets && data.assets.length)
    ? `${LEAD[data.label] || ''} ${vixTxt}.`
    : (_RISK_BAND_EN[data.label] || data.description || '');
  void eq; void haven;   // (calcules mais plus affiches dans la bande courte)
  return `<span class="risk-ticker-dot"></span><span class="risk-ticker-txt"><strong>${GAUGE_LABEL_FR[data.label] || data.label}:</strong> ${phrase}</span>`;
}

// Couleur du dégradé d'arc à une position v∈[-100,100] (interp linéaire des 7 stops de l'arc).
// → le marqueur triangle prend la teinte de l'arc sous lui (olive en weak-on, vert vif en strong-on,
// rouge en risk-off…), pour une jauge épurée.
function _riskArcColor(v) {
  const stops = [0xc63430, 0xdb5a2c, 0xe88a28, 0xddb23a, 0xa9c64a, 0x5cb060, 0x2a9e60];
  const t = Math.max(0, Math.min(1, (v + 100) / 200));
  const x = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i, a = stops[i], b = stops[i + 1];
  const ch = (sh) => Math.round(((a >> sh) & 0xff) + (((b >> sh) & 0xff) - ((a >> sh) & 0xff)) * f);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

function buildRiskGauge() {
  const wrap = document.getElementById('risk-widget');
  if (!wrap) return;

  clearInterval(_riskRefreshTimer);
  if (_riskGaugeRoot) { _riskGaugeRoot.dispose(); _riskGaugeRoot = null; }
  _riskHandDI = _riskHand = _riskScoreLabel = _riskBadgeLabel = null;

  wrap.innerHTML = (window.dtpLoader ? window.dtpLoader('Chargement de la jauge de risque…') : 'Chargement…');

  let isBuilt = false;

  async function loadAndRender(dataArg) {
    try {
      // Source unique : on réutilise le snapshot partagé (fetché par app.js) si dispo,
      // sinon on fetch une fois et on alimente le snapshot. → jamais de divergence.
      const data = dataArg || window._dtpRisk || await (window.dtpFetchBorne ? window.dtpFetchBorne('/api/risk-sentiment') : fetch('/api/risk-sentiment')).then(r => r.json());
      if (data.error) throw new Error(data.error);
      window._dtpRisk = data;

      const frLabel = GAUGE_LABEL_FR[data.label] || data.label;
      const isOn  = /risk-on/i.test(data.label);
      const isOff = /risk-off/i.test(data.label);
      const cls   = isOn ? 'risk-on' : isOff ? 'risk-off' : 'neutral';
      const sentColor = isOn ? 0x2dc653 : isOff ? 0xd62828 : 0xfcbf49;
      const gaugeVal  = Math.max(-100, Math.min(100, +((typeof data.pct === 'number' ? data.pct : data.score * 50)).toFixed(1)));   // pct canonique serveur
      const display   = `${gaugeVal > 0 ? '+' : ''}${gaugeVal.toFixed(1)}%`;

      // Sync topbar sentiment button
      if (typeof _applyRiskTopbar === 'function') _applyRiskTopbar(data);

      if (!isBuilt) {
        isBuilt = true;
        wrap.innerHTML = `
          <div id="risk-ticker" class="risk-ticker ${cls}">${_riskBandInner(data)}</div>
          <div class="risk-gauge-stage">
            <div id="risk-gauge-div"></div>
            <div class="risk-readout">
              <div class="risk-readout-badge ${cls}" id="risk-badge-val">${frLabel}</div>
            </div>
          </div>`;

        const root = _dtpAncreGraphe(am5.Root.new('risk-gauge-div'));
        root.setThemes([am5themes_Animated.new(root), applyTerminalTheme(root)]);   /* thème terminal (était am5themes_Dark générique) */
        root._logo?.set('forceHidden', true);
        _riskGaugeRoot = root;
        { const _gd = document.getElementById('risk-gauge-div'); const _gs = _gd && _gd.closest('.risk-gauge-stage'); try { window._dtpChartPremium && window._dtpChartPremium(_gs || _gd, 560); } catch (e) {} }   // chargement premium : overlay sur la scene (couvre jauge + readout) -> reveal fondu (build-once)

        const chart = root.container.children.push(
          am5radar.RadarChart.new(root, {
            panX: false, panY: false,
            startAngle: -180, endAngle: 0,
            radius: am5.percent(86),
            innerRadius: am5.percent(78),               // arc plus FIN (épuré)
            paddingTop: 12, paddingBottom: 26,           // jauge AGRANDIE (plus grande que la bande historique)
            paddingLeft: 28, paddingRight: 28,
          })
        );

        const axisRenderer = am5radar.AxisRendererCircular.new(root, { strokeOpacity: 0 });
        axisRenderer.labels.template.setAll({ visible: false });
        axisRenderer.ticks.template.setAll({ visible: false });
        axisRenderer.grid.template.setAll({ visible: false });

        const axis = chart.xAxes.push(
          am5xy.ValueAxis.new(root, {
            min: -100, max: 100, strictMinMax: true,
            renderer: axisRenderer,
          })
        );

        /* ══ COURSE DE L'AIGUILLE — EXPANSION DU CENTRE (09/09) ═══════════════════════════════════════
   Retour utilisateur : « on est toujours au milieu, genre l'aiguille ». C'est vrai, et ce n'était
   pas une illusion : l'axe va de −100 à +100 alors que le score de risque, en régime ordinaire,
   vit entre −30 et +30. Les trois quarts de l'arc ne servaient donc jamais, et deux séances aux
   humeurs très différentes plaçaient l'aiguille à quelques degrés l'une de l'autre.
   On applique une expansion en PUISSANCE : angle ∝ signe(x) · |x/100|^0,55. Elle est STRICTEMENT
   MONOTONE — l'ordre de deux valeurs n'est jamais inversé, ce qui est la seule chose qu'une jauge
   doit garantir — et elle FIXE les extrêmes : −100 reste à gauche, 0 reste au centre, +100 reste à
   droite. Un score de 10 occupe désormais un quart de la demi-course au lieu d'un dixième.
   ⚠️ C'EST UNE ÉCHELLE D'AFFICHAGE, PAS UN CHIFFRE RETOUCHÉ. Le pourcentage écrit sous la jauge et
   le badge de régime restent la valeur EXACTE du serveur : on ne change pas ce qui est dit, on
   change la place dont on dispose pour le montrer. Même esprit qu'une échelle logarithmique.
   ⚠️ ET LA COULEUR DU TRIANGLE SUIT LA VALEUR VRAIE (`_riskArcColor(gaugeVal)`), pas sa position
   sur l'arc : c'est elle qui porte le sens, le dégradé derrière n'est qu'un fond d'ambiance. */
const _RISK_EXPANSION = 0.55;
function _riskAngleVal(pct) {
  const x = Math.max(-100, Math.min(100, Number(pct) || 0));
  return Math.sign(x) * Math.pow(Math.abs(x) / 100, _RISK_EXPANSION) * 100;
}

// Arc LISSE & PRO : un SEUL remplissage avec un dégradé linéaire continu (horizontal :
        // rouge à gauche → ambre au centre → émeraude à droite). Aucune bande, aucun liseré.
        const _arc = axis.createAxisRange(axis.makeDataItem({ value: -100, endValue: 100 }));
        _arc.get('axisFill').setAll({
          visible: true,
          fillOpacity: 1,
          strokeOpacity: 0,
          fill: am5.color(0xddb23a),   // base de secours si le dégradé ne s'applique pas
          fillGradient: am5.LinearGradient.new(root, {
            rotation: 0,   // 0° = horizontal (gauche → droite), aligné sur le demi-cercle
            stops: [
              { color: am5.color(0xc63430) },   // rouge (extrême gauche)
              { color: am5.color(0xdb5a2c) },
              { color: am5.color(0xe88a28) },    // orange
              { color: am5.color(0xddb23a) },    // ambre (centre / neutre)
              { color: am5.color(0xa9c64a) },    // jaune-vert
              { color: am5.color(0x5cb060) },
              { color: am5.color(0x2a9e60) },    // émeraude (extrême droite)
            ],
          }),
        });
        _arc.get('grid')?.setAll({ visible: false });
        _arc.get('tick')?.setAll({ visible: false });
        _arc.get('label')?.setAll({ visible: false });

        // Jauge ÉPURÉE : PAS de labels autour de l'arc.

        // Marqueur TRIANGLE : petit triangle DÉTACHÉ du centre (ni aiguille depuis le
        // centre, ni moyeu), teinté par la couleur de l'arc sous lui (olive en weak-on, vert vif
        // en strong-on, rouge en risk-off).
        _riskHandDI = axis.makeDataItem({ value: 0 });
        const hand = am5radar.ClockHand.new(root, {
          pinRadius: 0,                              // pas de moyeu central
          radius: am5.percent(64),
          innerRadius: am5.percent(43),              // détaché du centre → petit triangle "flottant"
          bottomWidth: 26,                           // base large (côté centre) → pointe vers l'arc
          topWidth: 0,
        });
        hand.pin.setAll({ forceHidden: true });
        hand.hand.setAll({ fill: am5.color(_riskArcColor(gaugeVal)), fillOpacity: 0.95, strokeOpacity: 0 });
        _riskHand = hand;

        _riskHandDI.set('bullet', am5xy.AxisBullet.new(root, { sprite: hand }));
        axis.createAxisRange(_riskHandDI);
        _riskHandDI.get('grid')?.setAll({ visible: false });

        // Score label
        // Score + badge sont rendus en HTML CENTRÉ (overlay .risk-readout) → centrage garanti
        // sous la jauge, design net et facile à styliser. (Plus de labels amCharts ici.)

        // Animate needle to initial value
        _riskHandDI.animate({
          key: 'value', to: _riskAngleVal(gaugeVal),
          duration: 1000, easing: am5.ease.out(am5.ease.cubic),
        });

      } else {
        // Refresh: animate needle + recolore l'aiguille selon l'état + update labels
        if (_riskHandDI) {
          _riskHandDI.animate({
            key: 'value', to: _riskAngleVal(gaugeVal),
            duration: 800, easing: am5.ease.out(am5.ease.cubic),
          });
        }
        if (_riskHand) {
          _riskHand.hand.set('fill', am5.color(_riskArcColor(gaugeVal)));   // triangle = couleur de l'arc sous lui
        }
        const badgeEl = document.getElementById('risk-badge-val');
        if (badgeEl) {
          const _chg = badgeEl.textContent && badgeEl.textContent !== frLabel;   // garde : flash SEULEMENT si le régime bascule vraiment
          badgeEl.textContent = frLabel; badgeEl.className = `risk-readout-badge ${cls}`;
          if (_chg && window._dtpFlash) window._dtpFlash(badgeEl);   // posé APRÈS la réécriture de className (sinon la classe de flash serait écrasée)
        }
        const ticker = document.getElementById('risk-ticker');
        if (ticker) {
          ticker.className = `risk-ticker ${cls}`;
          ticker.innerHTML = _riskBandInner(data);
        }
      }

      // Couleur d'arc COURANTE (sous le marqueur) → teinte le badge ET la ligne d'état (ticker),
      // en SYNCHRO avec la jauge (même _riskArcColor que l'aiguille). Recalculé à CHAQUE refresh =
      // la ligne d'état change de couleur en temps réel, simultanément avec la jauge.
      // ÉTAT et non dégradé (20/08, demande user « fais bien ressortir risk-on / risk-off /
      // neutre ») : le dégradé de l'arc donnait un badge AMBRE pour une LÉGÈRE AVERSION, alors
      // que la charte tranche : aversion = rouge, appétit = vert, neutre = ambre. Le label EN
      // (data.label, valeur logique) est la SOURCE UNIQUE : aucun seuil recalculé ici.
      const _clair = _deskLight();
      // Zone du cadran, pas seulement le signe : WEAK et NEUTRAL = zone ambre (la ou pointe
      // l aiguille pour ces etats), RISK-ON/OFF francs = vert/rouge francs.
      const _lab = String(data.label || '');
      const _etatHex = /weak|neutral/i.test(_lab) ? (_clair ? '#8a6100' : '#ffb300')
        : /risk-off/i.test(_lab) ? (_clair ? '#c73000' : '#ef4444')
        : /risk-on/i.test(_lab) ? (_clair ? '#00783d' : '#22c55e')
        : (_clair ? '#8a6100' : '#ffb300');
      const _arcHex = _etatHex;
      const _badgeTint = document.getElementById('risk-badge-val');
      if (_badgeTint) { _badgeTint.style.color = _arcHex; _badgeTint.style.borderColor = _arcHex; }
      const _tickerEl = document.getElementById('risk-ticker');
      if (_tickerEl) {
        // Bases THEME-AWARE (20/08) : les littéraux sombres (#c7cacc sur #0c0e13) peignaient une
        // bande noire au milieu du thème clair.
        _tickerEl.style.color = `color-mix(in oklab, ${_arcHex} 52%, ${_clair ? '#3a3f46' : '#c7cacc'})`;
        _tickerEl.style.background = `color-mix(in oklab, ${_arcHex} ${_clair ? '9%' : '13%'}, ${_clair ? '#faf8f4' : '#0c0e13'})`;
        _tickerEl.style.borderColor = `color-mix(in oklab, ${_arcHex} 30%, transparent)`;
        const _d = _tickerEl.querySelector('.risk-ticker-dot'); if (_d) _d.style.background = _arcHex;   // le point
        const _s = _tickerEl.querySelector('strong');           if (_s) _s.style.color = _arcHex;        // le label "WEAK RISK-OFF"
      }

      const updEl = document.getElementById('risk-updated');
      if (updEl && data.updatedAt) {
        const d = new Date(data.updatedAt);
        const _t = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        if (updEl.textContent && updEl.textContent !== _t && window._dtpFlash) window._dtpFlash(updEl);   // flash discret : heure de MAJ change vraiment
        updEl.textContent = _t;
      }

    } catch (e) {
      if (!isBuilt) wrap.innerHTML = `<div style="padding:16px;color:var(--red);font-size:11px">Erreur : ${e.message}</div>`;
    }
  }

  loadAndRender();
  // Pas de poller indépendant : on suit le snapshot partagé diffusé par app.js
  // (_loadRiskSentiment). → topbar, popup et jauge METER affichent TOUJOURS la même valeur.
  if (_riskGaugeOnUpdate) window.removeEventListener('dtp-risk', _riskGaugeOnUpdate);
  _riskGaugeOnUpdate = e => loadAndRender(e.detail);
  window.addEventListener('dtp-risk', _riskGaugeOnUpdate);
}

// ═══════════════════════════════════════════════
//  RISK SENTIMENT HISTORY : barres quotidiennes risk-on/off (amCharts)
//  Source UNIQUE : /api/risk-history (échantillonné depuis fetchRiskSentiment serveur). On ne recalcule rien.
// ═══════════════════════════════════════════════
let _riskHistCtl = null;
// ── Bascule de thème : le FOND du graphe d'historique est évalué au build (_deskChartBg) : après
//    un changement de thème il restait à l'ancien (constaté user 20/08 : bande blanche en sombre).
//    On RECONSTRUIT avec les données déjà en mémoire (aucun fetch), et on rejoue le dernier snapshot
//    de risque pour que badge et bande d'état reprennent aussi les encres du nouveau thème. ──
window.addEventListener('dtp-theme', () => {
  try {
    const host = document.getElementById('risk-history-chart');
    if (host && window._dtpRiskHistory) {
      try { disposeRoot('risk-history-chart'); } catch (e) {}
      host.innerHTML = '';
      _riskHistCtl = buildRiskHistoryChart('risk-history-chart', window._dtpRiskHistory);
    }
    if (window._dtpRisk) window.dispatchEvent(new CustomEvent('dtp-risk', { detail: window._dtpRisk }));
  } catch (e) {}
});

const RH_GREEN = 0x22c55e;   // pct ≥ 0 → risk-on (vert de marque DTP)
const RH_RED   = 0xef4444;   // pct < 0 → risk-off (rouge de marque DTP)
const RH_ZERO  = 0x6b7280;   // ligne zéro = gris neutre

function buildRiskHistoryChart(containerId, data) {
  const el = document.getElementById(containerId);
  if (!el) return null;
  try { disposeRoot(containerId); } catch {}
  /* ⚠️ AUDIT 22/08 : _dtpAncreGraphe pose `zoom:calc(1/var(--dtp-zoom))` en inline sur root.dom.
     Monté DIRECTEMENT sur #risk-history-chart, ce zoom rescalait aussi les longueurs de layout
     de .rsh-chart : la bande se rendait 11% plus grande que sa cote CSS (210px écran au lieu de
     189). On monte donc le root sur un div INTERNE 100%/100% — exactement le patron déjà utilisé
     par la carte Mon Desk (widgets.js) : l'ancre anti-flou reste sur le canevas, le conteneur
     garde ses cotes. Le div est recréé à chaque build (dispose + innerHTML='' en amont). */
  let _mnt = el.querySelector(':scope > .rsh-mount');
  if (!_mnt) {
    _mnt = document.createElement('div');
    _mnt.className = 'rsh-mount';
    _mnt.style.cssText = 'width:100%;height:100%';
    el.innerHTML = ''; el.appendChild(_mnt);
  }
  const root = _dtpAncreGraphe(am5.Root.new(_mnt));
  root._logo?.set('forceHidden', true);
  root.setThemes([am5themes_Animated.new(root), applyTerminalTheme(root)]);
  { try { window._dtpChartPremium && window._dtpChartPremium(el, 620); } catch (e) {} }   // chargement premium : overlay shimmer pendant appear(500) -> reveal fondu (build-once ; update()=data.setAll)

  const chart = root.container.children.push(am5xy.XYChart.new(root, {
    panX: false, panY: false, wheelX: 'none', wheelY: 'none',
    paddingLeft: 4, paddingRight: 6, paddingTop: 6, paddingBottom: 2,
    layout: root.verticalLayout,
  }));
  // Fond THEME-AWARE (20/08, mode clair : la bande restait noire sur panneau blanc). En sombre,
  // _deskChartBg rend 0x0d0e11 : exactement l'homogénéité panneau que visait l'ancien littéral.
  chart.set('background', am5.Rectangle.new(root, { fill: am5.color(_deskChartBg()), fillOpacity: 1 }));
  chart.zoomOutButton.set('forceHidden', true);

  // Axe X : DateAxis quotidien
  /* LISIBILITÉ DES DATES (24/08, demande user « améliore la lisibilité et visibilité »). Ces libellés
     étaient en 9 px gris #6b7280, soit un contraste de 3,99 pour 1 sur le fond du desk : EN DESSOUS
     même du minimum de 4,5 pour du petit texte, et un cran plus faible que le reste du terminal (le
     thème pose déjà 10 px sur _deskChartAxisTxt, à 6,01). On applique la recette déjà validée le
     26/07 sur le profil de risque hebdo : plus clair, un cran plus grand, gras léger.
     Mesuré après correctif : 9,11 pour 1 en sombre, 7,56 en clair, les deux au-dessus du seuil de 7.
     Le ton est théma-conscient : #aab3bf s'effacerait sur le panneau blanc du thème clair. */
  const xRenderer = am5xy.AxisRendererX.new(root, { minGridDistance: 58 });   // 50 -> 58 : des libellés plus grands ont besoin de respirer, sinon amCharts en escamote un sur deux
  xRenderer.labels.template.setAll({ fill: am5.color(_deskLight() ? 0x4b5563 : 0xaab3bf), fontSize: 11, fontWeight: '600' });
  xRenderer.grid.template.setAll({ stroke: am5.color(_deskChartGrid()), strokeOpacity: 0.26, strokeDasharray: [2, 4] });   // repères verticaux un peu moins fantomatiques, sans devenir du bruit
  const xAxis = chart.xAxes.push(am5xy.DateAxis.new(root, {
    baseInterval: { timeUnit: 'day', count: 1 }, extraMin: 0.01, extraMax: 0.01, maxDeviation: 0.05, renderer: xRenderer,
  }));
  xAxis.set('dateFormats', { day: 'MM-dd', week: 'MM-dd', month: 'MMM' });                  // format court : 06-19
  xAxis.set('periodChangeDateFormats', { day: 'MM-dd', week: 'MM-dd', month: 'MM-dd' });

  // Axe Y : Sentiment (%) de -100 à +100
  const yRenderer = am5xy.AxisRendererY.new(root, { opposite: false, inside: false, minWidth: 22 });   // axe Y (Sentiment %) à GAUCHE
  /* ⚠️ CHIFFRES DE L'AXE Y RETIRÉS (22/08, demande user : « le 100 est sur une ligne, garde le côté
     minimaliste »). Sur cette bande de FOND, courte par nature, l'axe ne pouvait souvent afficher
     qu'un seul label — « 100% » — posé tout seul sur la ligne du haut, ce qui faisait bâclé. La
     bande n'a pas besoin de son échelle chiffrée : le titre « Sentiment (%) », la ligne de zéro et
     la couleur des barres (vert au-dessus, rouge en dessous) disent déjà tout. On retire donc les
     nombres et on garde l'essentiel. minWidth réduit à 22 px : la place gagnée revient au tracé. */
  yRenderer.labels.template.setAll({ visible: false, forceHidden: true });
  yRenderer.grid.template.setAll({ stroke: am5.color(0x2b2b31), strokeOpacity: 0.2, strokeWidth: 1, strokeDasharray: [] });   // grille continue TRÈS discrète (le « 0% » = l'axe orange fin ci-dessous)
  const yAxis = chart.yAxes.push(am5xy.ValueAxis.new(root, {
    min: -100, max: 100, strictMinMax: true, numberFormat: "#'%'", renderer: yRenderer,
  }));
  yAxis.children.unshift(am5.Label.new(root, {
    text: 'Sentiment (%)', rotation: -90, y: am5.p50, centerX: am5.p50, fill: am5.color(0x9ca3af), fontSize: 10, fontWeight: '600',
  }));

  // Ligne ZÉRO orange (signature DTP)
  const zero = yAxis.createAxisRange(yAxis.makeDataItem({ value: 0 }));
  zero.get('grid').setAll({ stroke: am5.color(RH_ZERO), strokeWidth: 1, strokeOpacity: 0.8 });   // « 0% » : trait fin (affiné)
  zero.get('label')?.set('visible', false);

  // Barres : 1/jour, vert (≥0 = risk-on) / rouge (<0 = risk-off)
  const series = chart.series.push(am5xy.ColumnSeries.new(root, {
    name: 'Risk', clustered: false, xAxis, yAxis, valueXField: 'ts', valueYField: 'pct',
    tooltip: am5.Tooltip.new(root, { labelText: '{valueY.formatNumber("#0.0")}% : {label}', pointerOrientation: 'vertical' }),
  }));
  series.columns.template.setAll({ width: am5.percent(72), strokeOpacity: 0, cornerRadiusTL: 1, cornerRadiusTR: 1 });
  series.columns.template.adapters.add('fill', (_f, t) => {
    const di = t.dataItem; if (!di) return am5.color(0x444444);
    // TROIS COULEURS D'ÉTAT (20/08, charte : risk-on vert, risk-off rouge, neutre ambre), pilotées
    // par le LABEL serveur de CHAQUE jour (source unique). Le dégradé continu rendait l'aversion
    // orange boueux et l'appétit olive : rien ne tranchait. Repli signe si label absent (vieux points).
    const lab = String((di.dataContext || {}).label || '');
    // Zone du cadran (2e passe user) : un jour FAIBLE ou NEUTRE est ambre, comme l aiguille l etait
    // ce jour-la ; seuls les jours francs prennent le vert/rouge franc. Repli sans label : la borne
    // ±30 approxime la zone ambre du degrade (7 crans sur -100..100).
    if (/weak|neutral/i.test(lab)) return am5.color(0xffb300);
    if (/risk-off/i.test(lab)) return am5.color(0xef4444);
    if (/risk-on/i.test(lab)) return am5.color(0x22c55e);
    const v = di.get('valueY') || 0;
    if (Math.abs(v) < 30) return am5.color(0xffb300);
    return am5.color(v < 0 ? 0xef4444 : 0x22c55e);
  });

  const cursor = chart.set('cursor', am5xy.XYCursor.new(root, { behavior: 'none', snapToSeries: [series] }));
  cursor.lineY.set('visible', false);
  cursor.lineX.setAll({ stroke: am5.color(0x475569), strokeWidth: 1, strokeDasharray: [3, 3], strokeOpacity: 0.8 });

  function setData(arr) {
    const rows = (Array.isArray(arr) ? arr : []).map(e => ({ ts: new Date(e.date + 'T00:00:00Z').getTime(), pct: e.pct, label: e.label || '' }));
    series.data.setAll(rows);
  }
  setData((data && data.series) || data || []);
  series.appear(500, 0); chart.appear(400, 0);
  return { root, series, update(d) { setData((d && d.series) || d || []); } };
}

// Bandeau d'état (label FR + pastille + description) : depuis la SOURCE UNIQUE (jamais recalculé).
function _renderRiskHistStatus(cur) {
  const box = document.getElementById('risk-history-status'); if (!box || !cur) return;
  const isOn = /risk-on/i.test(cur.label || ''), isOff = /risk-off/i.test(cur.label || '');
  box.className = 'rsh-status ' + (isOn ? 'risk-on' : isOff ? 'risk-off' : 'neutral');
  const lbl = box.querySelector('.rsh-label'), desc = box.querySelector('.rsh-desc');
  if (lbl) lbl.textContent = cur.label || '-';
  if (desc) desc.textContent = cur.description || '';
}

async function loadRiskHistory(opts) {
  const silent = opts && opts.silent;
  const host = document.getElementById('risk-history-chart');
  if (!host) return;
  if (!silent && !_riskHistCtl) host.innerHTML = (window.dtpLoader ? window.dtpLoader('Chargement de l\'historique…') : 'Chargement…');
  try {
    const data = (typeof _dtpJSON === 'function')
      ? await _dtpJSON('/api/risk-history?days=60', { tries: 3, delay: 1200 })
      : await fetch('/api/risk-history?days=60').then(r => r.json());
    window._dtpRiskHistory = data;
    if (_riskHistCtl && _riskHistCtl.update) _riskHistCtl.update(data);
    else { try { disposeRoot('risk-history-chart'); } catch {} host.innerHTML = ''; _riskHistCtl = buildRiskHistoryChart('risk-history-chart', data); }
    _renderRiskHistStatus((data && data.current) || window._dtpRisk);
  } catch (e) {
    if (!_riskHistCtl) host.innerHTML = `<div style="padding:14px;color:var(--red);font-size:11px">Erreur : ${e.message}</div>`;
  }
}

// Live sync (source unique) : l'event 'dtp-risk' (diffusé par app.js toutes les 3 min) met à jour le bandeau
// SANS re-fetch, et rafraîchit la barre du jour seulement si l'onglet RISK est visible.
window.addEventListener('dtp-risk', e => {
  try { _renderRiskHistStatus(e.detail); } catch {}
  const panel = document.getElementById('rtab-risk');
  if (panel && panel.classList.contains('active')) loadRiskHistory({ silent: true });
});

// ═══════════════════════════════════════════════
//  METER : Sentiment Gauge
// ═══════════════════════════════════════════════

// Métadonnées devises (code pays ISO pour flagcdn + nom complet)
const METER_META = {
  USD: { iso: 'us', name: 'Dollar américain' },
  EUR: { iso: 'eu', name: 'Euro' },
  JPY: { iso: 'jp', name: 'Yen japonais' },
  GBP: { iso: 'gb', name: 'Livre sterling' },
  AUD: { iso: 'au', name: 'Dollar australien' },
  CHF: { iso: 'ch', name: 'Franc suisse' },
  CAD: { iso: 'ca', name: 'Dollar canadien' },
  NZD: { iso: 'nz', name: 'Dollar néo-zélandais' },
};
// Drapeau image (flagcdn) : fonctionne sur tous les OS (contrairement aux emojis)
function _flagImg(iso, size = 16) {
  return `<img class="meter-flag-img" src="https://flagcdn.com/w20/${iso}.png" `
       + `srcset="https://flagcdn.com/w40/${iso}.png 2x" width="${size}" alt="" loading="lazy">`;
}
const METER_ORDER  = ['USD', 'EUR', 'JPY', 'GBP', 'AUD', 'CHF', 'CAD', 'NZD'];
const METER_BRICKS = 10;   // briques par moitié (10 haut + 10 bas)

function buildMeterChart(containerId) {   // containerId optionnel (widget « Mon Desk ») ; défaut = onglet METER du desk (rétrocompatible)
  clearInterval(_meterTimer);
  const container = document.getElementById(containerId || 'chart-meter');
  if (!container) return;

  // Tooltip flottant unique
  let tip = document.getElementById('meter-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'meter-tooltip';
    tip.className = 'meter-tooltip';
    document.body.appendChild(tip);
  }

  // Construit la structure (colonnes + briques) une seule fois
  function buildSkeleton() {
    container.className = 'meter-grid';
    container.innerHTML = METER_ORDER.map(ccy => {
      const m = METER_META[ccy] || { flag: '', name: ccy };
      const topBricks = Array.from({ length: METER_BRICKS }, (_, i) =>
        `<div class="meter-brick" data-half="pos" data-idx="${METER_BRICKS - 1 - i}"></div>`).join('');
      const botBricks = Array.from({ length: METER_BRICKS }, (_, i) =>
        `<div class="meter-brick" data-half="neg" data-idx="${i}"></div>`).join('');
      return `
        <div class="meter-col" data-ccy="${ccy}">
          <div class="meter-col-head">${_flagImg(m.iso)}<span class="meter-ticker">${ccy}</span></div>
          <div class="meter-stack">
            <div class="meter-half meter-half-top">${topBricks}</div>
            <div class="meter-zero"></div>
            <div class="meter-half meter-half-bot">${botBricks}</div>
          </div>
          <div class="meter-col-val" data-ccy-val="${ccy}"></div>
        </div>`;
    }).join('');

    // Hover tooltip par colonne
    container.querySelectorAll('.meter-col').forEach(col => {
      col.addEventListener('mousemove', e => {
        const ccy = col.dataset.ccy;
        const v   = _meterValues[ccy];
        if (v == null) return;
        const m = METER_META[ccy] || { iso: '', name: ccy };
        const col2 = v >= 0 ? '#00e676' : '#ff3b3b';   // couleurs Meter DTP
        tip.innerHTML = `<div class="meter-tip-name">${_flagImg(m.iso, 14)} ${m.name}</div>`
          + `<div class="meter-tip-val" style="color:${col2}">${(v >= 0 ? '+' : '') + v.toFixed(2)}</div>`;
        tip.style.display = 'block';
        tip.style.left = (e.clientX + 14) + 'px';
        tip.style.top  = (e.clientY + 14) + 'px';
      });
      col.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    });
  }

  let _meterValues = {};

  function applyValues(values) {
    _meterValues = values;
    // Échelle RELATIVE : la devise la plus forte remplit le meter, les autres proportionnellement.
    // Plancher bas (0.25) au lieu de 1 → un marché peu volatil (moves < 1%) reste lisible
    // (avant, tout était écrasé contre 1 → quasi aucune brique, USD/EUR paraissaient vides).
    const maxAbs = Math.max(...Object.values(values).map(v => Math.abs(v)), 0.25);
    METER_ORDER.forEach(ccy => {
      const v   = values[ccy] || 0;
      const col = container.querySelector(`.meter-col[data-ccy="${ccy}"]`);
      if (!col) return;
      // ≥1 brique dès que la valeur est non nulle → USD/EUR (souvent faibles) jamais "vides"
      const lit = v === 0 ? 0 : Math.max(1, Math.round(Math.abs(v) / maxAbs * METER_BRICKS));  // 1..10
      col.querySelectorAll('.meter-brick').forEach(b => {
        const half = b.dataset.half;
        const idx  = +b.dataset.idx;          // 0 = près du zéro
        const on   = (half === 'pos' && v > 0 && idx < lit)
                  || (half === 'neg' && v < 0 && idx < lit);
        b.classList.toggle('meter-brick--pos', on && half === 'pos');
        b.classList.toggle('meter-brick--neg', on && half === 'neg');
        b.classList.toggle('meter-brick--off', !on);
        // Degrade pro : vif pres de l'axe zero, fondu vers la pointe de la barre
        b.style.opacity = on ? (1 - 0.42 * (idx / Math.max(lit - 1, 1))).toFixed(3) : '';
      });
      // Valeur chiffrée sous la colonne (précision)
      const valEl = col.querySelector('.meter-col-val');
      if (valEl) {
        // Valeur en ETIQUETTE semantique (fond colore + texte blanc, facon cellules Radar de Biais)
        valEl.innerHTML = '<span class="v">' + (v >= 0 ? '+' : '') + v.toFixed(2) + '</span>';
        valEl.className = 'meter-col-val ' + (v > 0 ? 'meter-col-val--pos' : v < 0 ? 'meter-col-val--neg' : 'meter-col-val--neut');
        valEl.style.color = '';
      }
    });
  }

  buildSkeleton();
  container.querySelectorAll('.meter-brick').forEach(b => b.classList.add('meter-brick--off'));

  async function loadAndRender() {
    // 'today' (force intraday du jour) d'abord ; repli 'week' si indispo → le baromètre n'est JAMAIS vide.
    // (l'ancien param '1d' renvoyait "Data unavailable" → 8 colonnes vides, façon bug.)
    for (const period of ['today', 'week']) {
      try {
        const resp = await fetch('/api/currency-strength?period=' + period);
        const data = await resp.json();
        if (!data.currencies || !data.series) throw new Error(data.error || 'No data');
        const values = {};
        data.currencies.forEach(ccy => {
          const pts = (data.series[ccy] || []).filter(d => d.v != null);
          values[ccy] = pts.length ? +pts[pts.length - 1].v.toFixed(2) : 0;
        });
        applyValues(values);
        return;
      } catch (e) {
        console.error('[Meter]', period, e.message);
      }
    }
  }

  loadAndRender();
  /* ⚠️ LA GARDE DE VISIBILITÉ DÉPEND DE L'ENDROIT OÙ LE GRAPHIQUE VIT (21/08).
     Elle ne testait que l'onglet BAROMÈTRE du desk. Or cette fonction sert AUSSI la carte « Mon
     Desk », où cet onglet n'est évidemment pas actif : le minuteur se supprimait donc lui-même AU
     PREMIER TOUR, quinze secondes après l'affichage. La carte paraissait vivante et ne bougeait
     plus jamais. C'est pire qu'une carte sans mise à jour, parce que rien ne le signale.
     On teste désormais la visibilité de CE conteneur-ci : l'onglet du desk quand c'est lui, la
     carte quand c'est elle. Même intention, appliquée au bon élément. */
  const _surDesk = !containerId || containerId === 'chart-meter';
  _meterTimer = setInterval(() => {
    if (_surDesk) {
      const panel = document.getElementById('rtab-meter');
      if (!panel || !panel.classList.contains('active')) { clearInterval(_meterTimer); _meterTimer = null; return; }
    } else {
      // Carte Mon Desk : on s'arrête si elle a quitté le document, et on saute le tour si elle est
      // masquée ou hors écran. Dépenser du réseau pour ce que personne ne regarde a déjà coûté cher.
      const el = document.getElementById(containerId);
      if (!el || !el.isConnected) { clearInterval(_meterTimer); _meterTimer = null; return; }
      if (document.hidden) return;
      const b = el.getBoundingClientRect();
      if (b.width < 2 || b.bottom < -200 || b.top > (window.innerHeight || 0) + 200) return;
    }
    loadAndRender();
  }, 15 * 1000);   // temps réel : MAJ toutes les 15 s
}

// ═══════════════════════════════════════════════
//  COT : Commitment of Traders
// ═══════════════════════════════════════════════

// RÉTROCOMPATIBLE (widgets Mon Desk 23/07) : gridId/typeArg optionnels — le desk appelle sans argument
// (grille #cot-grid + bouton actif de SON onglet #rtab-cot) ; un widget passe SA grille + SON type.
// Pave les N cartes en RECTANGLE PLEIN (jamais d'orpheline seule sur la derniere rangee) dont les
// cellules approchent le ratio cible : le bloc widget est rempli, sans zone morte a droite.
// 8 devises => colonnes possibles 1 / 2 / 4 / 8. Si aucune combinaison ne tient a taille lisible,
// on repasse en mode defilement (rangees a hauteur plancher).
// Planchers de CELLULE. La hauteur (252) n'est pas décorative : en dessous, l'en-tête + la légende +
// les 3 stats mangent tout et le donut tombe à ~36 px (mesuré) — illisible. Sous ce seuil on préfère
// défiler avec des cartes lisibles plutôt que pavér le bloc avec des donuts minuscules.
const _COT_FIT_W = 132, _COT_FIT_H = 252;
function _cotFit(grid) {
  if (!grid || !grid.classList.contains('cot-grid--fit')) return;
  const n = grid.children.length;
  const W = grid.clientWidth, H = grid.clientHeight;
  if (!n || !W || !H) return;
  let best = null, large = 1;
  for (let c = 1; c <= n; c++) {
    if (n % c) continue;                                  // rangees TOUTES pleines
    const cw = W / c, ch = H / (n / c);
    if (cw >= _COT_FIT_W) large = c;                      // repli defilement : le + de colonnes lisibles
    if (cw < _COT_FIT_W || ch < _COT_FIT_H) continue;
    const score = Math.abs(Math.log((cw / ch) / 1.05));   // cellule presque carree = donut bien proportionne
    if (!best || score < best.score) best = { c, r: n / c, score };
  }
  grid.style.gridTemplateColumns = 'repeat(' + (best ? best.c : large) + ', minmax(0, 1fr))';
  grid.style.gridTemplateRows = best ? 'repeat(' + best.r + ', minmax(0, 1fr))' : '';
  grid.style.gridAutoRows = best ? '' : 'minmax(' + _COT_FIT_H + 'px, 1fr)';
  grid.classList.toggle('cot-grid--scroll', !best);
}

// DONUT DE RÉPARTITION (rétabli 04/08, demande user « remets les donuts c'était bien »). Il reprend
// la place de la barre empilée — pas en plus d'elle : les deux disaient exactement la même chose.
// Taille MODÉRÉE et pilotée par le CSS : la version qui remplissait la carte avait été rejetée.
// Le centre porte le pourcentage DOMINANT, dans la couleur du camp qui domine — on lit le rapport
// de force sans avoir à comparer deux arcs.
/* ÉPURE 11/08 (demande user « fais un truc + clean, toujours en donut ») — ce qui a changé et pourquoi :
   · le % au centre ne disait pas de QUOI il était le pourcentage → il porte désormais son camp
     dessous, en petit (« vendeurs » / « acheteurs ») : la carte se lit sans légende ;
   · l'anneau était épais et les deux arcs également saturés, ce qui faisait deux blocs de couleur
     qui se disputaient l'œil → anneau plus fin, le camp MINORITAIRE en retrait (il reste lisible,
     il ne crie plus), le camp dominant seul en pleine couleur ;
   · un mince espace sépare les deux arcs, comme sur les donuts de terminal — la frontière se voit
     sans qu'on ait besoin d'un liseré. */
function _cotRing(ok, sPct, lPct, mod) {
  const r = 30, C = 2 * Math.PI * r;
  const GAP = 1.6;                                        // respiration entre les deux arcs (en unités de tracé)
  const arc = p => Math.max(0, (p / 100) * C - GAP).toFixed(2) + ' ' + C.toFixed(2);
  const dom = sPct >= lPct ? sPct : lPct;
  const cls = !ok ? 'na' : (sPct === lPct ? 'flat' : (sPct > lPct ? 'bear' : 'bull'));
  // Légende sous le % RETIRÉE (demande user 11/08) : le camp qui domine est déjà dit deux fois — par
  // le badge de l'en-tête (ACHETEUR / VENDEUR) et par la couleur de l'arc dominant. Le centre du donut
  // ne porte plus que le chiffre.
  return '<svg class="cot-ring cot-ring--' + cls + '" viewBox="0 0 80 80" role="img"'
    + ' aria-label="Répartition : ' + sPct + '% de positions courtes, ' + lPct + '% de positions longues">'
    + '<circle class="cot-ring-bg" cx="40" cy="40" r="' + r + '" fill="none"/>'
    + '<g transform="rotate(-90 40 40)">'
    +   '<circle class="cot-ring-s" cx="40" cy="40" r="' + r + '" fill="none" stroke-dasharray="' + arc(sPct) + '"/>'
    +   '<circle class="cot-ring-l" cx="40" cy="40" r="' + r + '" fill="none" stroke-dasharray="' + arc(lPct) + '"'
    +     ' stroke-dashoffset="' + (-(sPct / 100) * C).toFixed(2) + '"/>'
    + '</g>'
    + '<text class="cot-ring-v" x="40" y="45.5" text-anchor="middle">' + (ok ? dom + '%' : '-') + '</text>'
    + '</svg>';
}

function buildCOTChart(gridId, typeArg) {
  const grid = document.getElementById(gridId || 'cot-grid');
  if (!grid) return;
  grid.innerHTML = (window.dtpLoader ? window.dtpLoader('Chargement des données COT…') : 'Chargement des données COT…');

  const activeTypeBtn = document.querySelector('#rtab-cot .cot-type-btn--active');
  const cotType = typeArg || (activeTypeBtn ? activeTypeBtn.dataset.cotType : 'lev_money');

  (window.dtpFetchBorne ? window.dtpFetchBorne(`/api/cot?type=${cotType}`) : fetch(`/api/cot?type=${cotType}`))
    .then(r => r.json())
    .then(data => {
      if (!data.currencies || data.currencies.length === 0) {
        grid.innerHTML = '<div style="padding:20px;color:#666;font-size:11px;">Données COT indisponibles</div>';
        return;
      }
      grid.innerHTML = '';

      const TYPE_LABELS = {
        noncomm: 'Non-commercial', dealer: 'Courtier intermédiaire',
        asset_mgr: 'Gestionnaire d’actifs', lev_money: 'Fonds à effet de levier',
        other_rept: 'Autres reportables',
      };
      const typeLabel = TYPE_LABELS[cotType] || 'COT';
      const COT_ISO = { USD:'us', EUR:'eu', JPY:'jp', GBP:'gb', AUD:'au', CHF:'ch', CAD:'ca', NZD:'nz' };
      // Format FR : le desk affichait « 157.9K » avec un point décimal anglo-saxon.
      const fmtK = v => Math.abs(v) >= 1000
        ? `${(v / 1000).toFixed(1).replace('.', ',')}K`
        : String(Math.round(v));

      for (const cur of data.currencies) {
        // ÉTAT À 4 VALEURS, pas 2. Le binaire `longPos >= shortPos` affichait « acheteur » à une
        // devise parfaitement à l'équilibre, et « NaNK » à une devise sans rapport COT publié.
        // « Manquant » n'est pas « neutre » — doctrine .fxl-badge--na du desk.
        const ok    = Number.isFinite(cur.shortPos) && Number.isFinite(cur.longPos)
                      && (cur.shortPos + cur.longPos) > 0;
        const ecart = ok ? Math.abs((cur.shortPct || 0) - (cur.longPct || 0)) : 0;
        const mod   = !ok ? 'na' : ecart < 4 ? 'flat' : (cur.longPos > cur.shortPos ? 'bull' : 'bear');
        const VERDICT = { bull: 'Acheteur', bear: 'Vendeur', flat: 'Neutre', na: 'N.D.' };
        const TIRET = '-';
        const net   = ok ? fmtK(Math.abs(cur.longPos - cur.shortPos)) : TIRET;
        const sPct  = ok ? (cur.shortPct || 0) : 50;
        const lPct  = ok ? (cur.longPct  || 0) : 50;
        const flag  = _flagImg(COT_ISO[cur.key] || 'us', 14);

        const cell = document.createElement('article');
        cell.className = 'cot-cell cot-cell--' + mod;
        // ÉPURE 11/08 : la carte disait quatre fois la même chose (badge, position nette encadrée,
        // donut, puis deux lignes boîtées à liseré). Elle tient maintenant en trois temps —
        // l'en-tête (qui domine), le donut (de combien), le pied (les volumes bruts + le net) —
        // sans filet interne ni ligne encadrée.
        cell.innerHTML = `
          <header class="cot-head">
            ${flag}<span class="cot-ccy">${cur.key}${cur.derived ? '<i class="cot-drv" title="Série dérivée">*</i>' : ''}</span>
            <span class="cot-badge">${VERDICT[mod]}</span>
          </header>
          <div class="cot-split">${_cotRing(ok, sPct, lPct, mod)}</div>
          <div class="cot-foot2">
            <div class="cot-sides">
              <span class="cot-side cot-side--l">Longs<b>${ok ? fmtK(cur.longPos) : TIRET}</b></span>
              <span class="cot-side cot-side--n">Net<b>${net}</b></span>
              <span class="cot-side cot-side--s">Courts<b>${ok ? fmtK(cur.shortPos) : TIRET}</b></span>
            </div>
          </div>`;
        grid.appendChild(cell);
      }
      // (Pied de catégorie RETIRÉ 04/08, demande user : il occupait une ligne pour une information
      //  que la barre d'onglets porte déjà. On nettoie aussi ceux qu'un rendu précédent a laissés.)
      if (grid.parentNode) grid.parentNode.querySelectorAll(':scope > .cot-foot').forEach(el => el.remove());
      try { _cotFit(grid); } catch (e) {}
    })
    .catch(() => {
      grid.innerHTML = '<div style="padding:20px;color:#666;font-size:11px;">Échec du chargement des données COT</div>';
    });
}

// ═══════════════════════════════════════════════
//  DMX : Myfxbook Community Outlook
// ═══════════════════════════════════════════════

// Forex + metals only filter for DMX
const _DMX_MAJORS = new Set(['EUR','GBP','USD','JPY','CAD','AUD','CHF','NZD']);
const _DMX_METALS = new Set(['XAU','XAG','XPT','XPD']);
function _dmxAllowed(symbol) {
  if (!symbol || symbol.length < 5) return false;
  const base = symbol.slice(0, 3), quote = symbol.slice(3, 6);
  if (_DMX_METALS.has(base)) return _DMX_MAJORS.has(quote);
  return _DMX_MAJORS.has(base) && _DMX_MAJORS.has(quote);
}

let _dmxLastUpdate = 0;
let _dmxTimer = null;
let _dmxServerTs = 0;   // timestamp serveur du dernier snapshot retail (pour l'âge affiché)
// Libellé de fraîcheur (le sentiment retail Myfxbook = 1 snapshot live, MAJ ~15 min)
function _dmxAgo(ts) {
  if (!ts) return 'Direct';
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  return m < 1 ? 'Direct · à l\'instant' : `Direct · MAJ il y a ${m} min`;
}

// RÉTROCOMPATIBLE (widgets Mon Desk 23/07) : opts {wrapId, period, sort} optionnel — le desk appelle
// sans opts (état de SON onglet #rtab-dmx : boutons TF, select tri, label période, timer partagé) ;
// un widget passe SON conteneur + SON état, et gère lui-même son rafraîchissement (pas de _dmxTimer).
function buildDMXChart(forceRefresh = false, opts) {
  const wrap = document.getElementById((opts && opts.wrapId) || 'dmx-table-wrap');
  if (!wrap) return;

  const activeTfBtn = document.querySelector('#rtab-dmx .dmx-tf-btn--active');
  const period = (opts && opts.period) || (activeTfBtn ? activeTfBtn.dataset.tf : 'H1');

  // En-tête : fraîcheur réelle du snapshot (Myfxbook = 1 jeu de données live partagé par les TF)
  const periodLbl = opts ? null : document.getElementById('dmx-period-label');
  if (periodLbl && !periodLbl.textContent) periodLbl.textContent = 'Direct';

  // On NE force PLUS automatiquement : le serveur sert son cache INSTANTANÉMENT et le tient
  // à jour en arrière-plan (refresh 5 min). On ne force (refresh fond) que via le bouton Retry.
  const url = `/api/community-outlook?period=${period}${forceRefresh ? '&force=1' : ''}`;

  // On n'affiche "Chargement…" que si l'onglet est vide (sinon on garde l'ancien rendu → pas de flash)
  if (!wrap.querySelector('.dmx2-row')) wrap.innerHTML = (window.dtpLoader ? window.dtpLoader('Chargement des données DMX…') : 'Chargement…');

  /* ⚠️ GARDE-TEMPS CÔTÉ DESK (09/09, capture utilisateur : « pourquoi ça charge à l'infini ? »).
     Un `fetch` sans délai attend AUSSI LONGTEMPS que le serveur tient la connexion — et la route
     de positionnement pilotait un navigateur au premier chargement d'un conteneur neuf, donc après
     chaque déploiement, avec des délais internes de 30 puis 45 secondes. Le serveur borne désormais
     son attente ; ce garde-ci reste nécessaire quand même : il couvre ce que le serveur ne peut pas
     couvrir — un réseau qui ne répond plus, un relais qui garde la connexion ouverte, un ordinateur
     qui sort de veille. Une animation de chargement qui tourne sans fin n'est pas une attente,
     c'est une panne muette. */
  var _abandon = (typeof AbortController === 'function') ? new AbortController() : null;
  var _minuteur = setTimeout(function () { try { _abandon && _abandon.abort(); } catch (e) {} }, 15000);

  fetch(url, _abandon ? { signal: _abandon.signal } : undefined)
    .then(r => r.json())
    .then(data => {
      clearTimeout(_minuteur);
      if (data.error) throw new Error(data.error);
      /* LE SERVEUR SAIT DIRE « JE CHERCHE ENCORE » (`pending`), et c'est une réponse, pas un échec :
         la récupération continue de son côté. On le dit en clair et on redemande tout seul — un
         message figé qui n'essaierait plus jamais serait la même impasse sous un autre habillage. */
      /* ⚠️ QUAND LE SERVEUR SAIT POURQUOI, ON L'AFFICHE (09/09, « le DMX ne fonctionne pas »).
         Un widget qui répète « en attente » sans fin ne laisse rien faire à personne — alors que la
         cause la plus fréquente, des identifiants absents du serveur, se corrige en une ligne. La
         phrase vient du serveur, qui seul sait ce qui a échoué ; le desk ne la devine pas. */
      var _raison = data.raison && data.raison.texte ? String(data.raison.texte) : '';
      var _dit = function (txt, sousTitre, relance) {
        wrap.innerHTML = '<div class="dmx-loading">' + txt
          + (sousTitre ? '<br><span style="opacity:.7;font-size:10px">' + sousTitre + '</span>' : '') + '</div>';
        if (relance) setTimeout(function () { buildDMXChart(false, opts); }, relance);
      };
      if (data.pending) {
        _dit('Positionnement en cours de récupération…',
          _raison || 'Première synchronisation avec la source, quelques instants.', 10000);
        return;
      }
      let symbols = (data.symbols || []).filter(row => _dmxAllowed(row.symbol));
      if (!symbols.length) {
        /* Répondu, mais VIDE : ce n'est ni une attente ni une erreur. On le distingue des deux, et
           on redemande plus lentement — la source peut être en maintenance. Si le serveur a nommé
           la cause, c'est ELLE qu'on affiche : elle est plus utile que notre phrase générique. */
        _dit(_raison || 'Aucun positionnement publié par la source pour le moment.', '', 60000);
        return;
      }

      _dmxLastUpdate = Date.now();
      if (periodLbl) periodLbl.textContent = _dmxAgo(data.updatedTs);

      // SEPT ordres (demande user) : l'ordre d'origine + les deux sens sur la paire et sur chacun
      // des deux pourcentages. « src » = la liste telle que la source la renvoie — c'est le défaut,
      // et il exige de NE PAS trier : l'ancien code retombait sur A-Z pour toute valeur inconnue,
      // ce qui rendait l'ordre source inatteignable.
      // 'src' (ordre source) a ete retire du menu : une valeur enregistree avant ce retrait retombe
      // sur le tri par paire au lieu de laisser la liste non triee sans que rien ne l'indique.
      var sortVal = opts ? (opts.sort || 'az') : (document.getElementById('dmx-sort-select')?.value || 'az');
      if (sortVal === 'src') sortVal = 'az';
      const _num = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
      if (sortVal === 'long')           symbols.sort((a, b) => _num(b.longPct)  - _num(a.longPct));
      else if (sortVal === 'long_asc')  symbols.sort((a, b) => _num(a.longPct)  - _num(b.longPct));
      else if (sortVal === 'short')     symbols.sort((a, b) => _num(b.shortPct) - _num(a.shortPct));
      else if (sortVal === 'short_asc') symbols.sort((a, b) => _num(a.shortPct) - _num(b.shortPct));
      else if (sortVal === 'az')        symbols.sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)));
      else if (sortVal === 'za')        symbols.sort((a, b) => String(b.symbol).localeCompare(String(a.symbol)));


      const rows = symbols.map(row => {
        const lf  = +row.longPct;
        const sf  = +row.shortPct;
        // Always ensure they sum to 100 (handle rounding)
        const total = lf + sf;
        const lw = total > 0 ? (lf / total * 100).toFixed(2) : '50';
        const sw = total > 0 ? (sf / total * 100).toFixed(2) : '50';
        const lTxt = lf >= 6 ? `${Math.round(lf)}%` : '';
        const sTxt = sf >= 6 ? `${Math.round(sf)}%` : '';
        const sym = row.symbol.length === 6
          ? `${row.symbol.slice(0, 3)}/${row.symbol.slice(3)}`
          : row.symbol;
        // Determine dominant side for label styling
        const lDom = lf >= sf;
        return `<div class="dmx2-row">
          <span class="dmx2-sym">${sym}</span>
          <div class="dmx2-bar">
            <div class="dmx2-bar-long" style="width:${lw}%"><span class="dmx2-pct">${lTxt}</span></div>
            <div class="dmx2-bar-short" style="width:${sw}%"><span class="dmx2-pct">${sTxt}</span></div>
          </div>
        </div>`;
      }).join('');

      wrap.innerHTML = `<div class="dmx2-list">${rows}</div>`;
      if (window._dtpDataIn) window._dtpDataIn(wrap, 'dmx');   // fondu d'arrivee (1re fois : chargement -> lignes, jamais aux refresh 60 s)

      // Auto-refresh tant que l'onglet DMX est visible (sert le cache serveur, MAJ 15 min)
      // — DESK uniquement : un widget Mon Desk gère son propre intervalle (cleanup au démontage).
      if (!opts && !_dmxTimer) {
        _dmxTimer = setInterval(() => {
          const panel = document.getElementById('rtab-dmx');
          if (!panel || !panel.classList.contains('active')) { clearInterval(_dmxTimer); _dmxTimer = null; return; }
          if (periodLbl) periodLbl.textContent = _dmxAgo(_dmxServerTs);   // rafraîchit l'âge affiché
          buildDMXChart(false);
        }, 60 * 1000);
      }
      _dmxServerTs = data.updatedTs || _dmxServerTs;
    })
    .catch(() => {
      // En mode widget (opts) : pas de bouton inline (il rappellerait le DESK) — le retry auto suffit,
      // et buildDMXChart s'arrête tout seul si le conteneur du widget a été démonté (getElementById null).
      clearTimeout(_minuteur);
      wrap.innerHTML = `<div class="dmx-loading">
        Erreur de connexion : nouvelle tentative…${opts ? '' : `<br>
        <button onclick="buildDMXChart(true)" style="margin-top:10px;background:var(--bg3);border:1px solid var(--border2);color:var(--text2);padding:3px 10px;font-size:10px;cursor:pointer;border-radius:2px;font-family:var(--font-mono);">Réessayer</button>`}
      </div>`;
      setTimeout(() => buildDMXChart(true, opts), 15000);
    });
}

// ═══════════════════ SEASONALITY : table de performance mensuelle (façon pro) ═══════════════════
// 28 paires FX (mêmes que Force des Devises). Défaut EUR/USD, sinon la dernière paire consultée (persistée
// PAR COMPTE via /api/season-pair). Données = /api/seasonality (Yahoo : rendement mensuel × 5 ans + moyenne).
const _SEASON_PAIRS = ['EURUSD','GBPUSD','USDJPY','USDCHF','AUDUSD','NZDUSD','USDCAD','EURGBP','EURJPY','EURCHF','EURAUD','EURCAD','EURNZD','GBPJPY','GBPCHF','GBPAUD','GBPCAD','GBPNZD','AUDJPY','NZDJPY','CADJPY','CHFJPY','AUDNZD','AUDCAD','AUDCHF','NZDCAD','NZDCHF','CADCHF'];
let _seasonPair = null;   // paire courante (chargée 1×/session depuis le compte)
function _seasonFmtPair(c){ return (c && c.length === 6) ? c.slice(0,3) + '/' + c.slice(3) : c; }
// Heatmap, intensité ∝ |valeur| (plafonnée ~4 %).
// 04/08 — deux corrections de charte :
//  (1) les teintes étaient rgba(0,200,120) et rgba(255,60,70), soit un vert et un rouge génériques.
//      La charte DTP impose vert #00e676 (0,230,118) et rouge #ff3d00 (255,61,0).
//  (2) le plafond d'opacité à 0,92 produisait des aplats saturés façon tableur : les cellules
//      hurlaient et les CHIFFRES — la vraie information — passaient au second plan. Plafond à 0,58 :
//      la teinte situe, le nombre informe.
function _seasonCellBg(v){
  if (v == null) return 'transparent';
  const a = Math.max(0.09, Math.min(0.58, Math.abs(v) / 4 * 0.58));
  return v >= 0 ? `rgba(0,230,118,${a.toFixed(3)})` : `rgba(255,61,0,${a.toFixed(3)})`;
}
function _seasonCell(v, isAvg){
  const ac = isAvg ? ' season-td--avg' : '';
  if (v == null) return `<td class="season-td${ac} season-td--na"></td>`;
  const sens = v >= 0 ? ' season-td--up' : ' season-td--dn';
  return `<td class="season-td${ac}${sens}" style="background:${_seasonCellBg(v)}"><span class="season-arrow">${v >= 0 ? '↗' : '↘'}</span>${v >= 0 ? '+' : ''}${v.toFixed(2)}%</td>`;
}
function _seasonPick(code){
  if (!code || code === _seasonPair) return;
  _seasonPair = code;
  try { fetch('/api/season-pair', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pair: code }) }); } catch {}
  buildSeasonalityChart();
}
function buildSeasonalityChart(){
  const wrap = document.getElementById('seasonality-table-wrap');
  if (!wrap) return;
  _seasonLoadCatalog();   // libellés multi-classes (Forex/Stocks/Commodities/Indices) pour le badge + la fenêtre Settings
  const sel = document.getElementById('season-pair-select');
  if (sel && !sel.options.length) sel.innerHTML = _SEASON_PAIRS.slice().sort((a, b) => _seasonFmtPair(a).localeCompare(_seasonFmtPair(b), 'fr', { numeric: true, sensitivity: 'base' })).map(p => `<option value="${p}">${_seasonFmtPair(p)}</option>`).join('');   // tri ALPHABÉTIQUE des paires (numérique + insensible à la casse)
  // 1re activation : récupère la dernière paire du compte (défaut EUR/USD), puis rend.
  if (_seasonPair == null){
    _seasonPair = 'EURUSD';
    fetch('/api/season-pair').then(r=>r.json()).then(d=>{ if (d && d.pair) _seasonPair = d.pair; }).catch(()=>{}).finally(buildSeasonalityChart);
    return;
  }
  if (sel) sel.value = _seasonPair;
  const titleEl = document.getElementById('season-pair-title');
  if (titleEl) titleEl.textContent = '[' + _seasonLabel(_seasonPair) + ']';
  if (!wrap.querySelector('.season-table')) wrap.innerHTML = (window.dtpLoader ? window.dtpLoader('Chargement de la saisonnalité…') : 'Chargement…');
  const want = _seasonPair;
  (window._dtpJSON ? window._dtpJSON('/api/seasonality?symbol=' + want) : fetch('/api/seasonality?symbol=' + want).then(r=>r.json()))
    .then(data => {
      if (want !== _seasonPair) return;   // réponse périmée (l'utilisateur a changé de paire) → ignorer
      if (!data || !Array.isArray(data.rows)) { wrap.innerHTML = '<div class="dmx-loading">Aucune donnée</div>'; return; }
      if (titleEl && data.symbol) titleEl.textContent = '[' + data.symbol + ']';   // libellé exact (ex. « Gold », « S&P 500 »)
      const yrs = data.years || [];
      const head = `<tr><th class="season-th season-th--m"></th>${yrs.map(y => `<th class="season-th">'${String(y).slice(2)}</th>`).join('')}<th class="season-th season-th--avg">Moy.</th></tr>`;
      const body = data.rows.map(row =>
        `<tr><td class="season-month">${row.month}</td>${(row.vals||[]).map(v => _seasonCell(v,false)).join('')}${_seasonCell(row.avg,true)}</tr>`
      ).join('');
      wrap.innerHTML = `<table class="season-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
    })
    .catch(() => { if (want === _seasonPair) wrap.innerHTML = '<div class="dmx-loading">Erreur de chargement<br><button onclick="buildSeasonalityChart()" style="margin-top:8px;background:#1c1c1f;border:1px solid #2a2f3a;color:#e3b23a;padding:4px 12px;border-radius:6px;cursor:pointer">Réessayer</button></div>'; });
}

// ═══ Seasonality Performance Table Settings : fenêtre multi-classes (façon pro) ═══
// Engrenage (tooltip « Settings ») → fenêtre : Asset Class (Forex/Stocks/Commodities/Indices) + grille
// de symboles cliquable (drapeaux pour le forex). Le choix appelle _seasonPick (persiste par compte).
let _seasonCatalog = null, _seasonLabelById = {}, _seasonCfgClass = 'forex';
function _seasonLabel(id){ return _seasonLabelById[id] || _seasonFmtPair(id); }
function _seasonCcyIso(ccy){ const m = (typeof METER_META !== 'undefined') ? METER_META[ccy] : null; return (m && m.iso) ? m.iso : null; }
function _seasonFlags(it){
  if (it.b && it.q){ const a = _seasonCcyIso(it.b), b = _seasonCcyIso(it.q);
    if (a && b) return `<img class="sea-flag" src="https://flagcdn.com/w20/${a}.png" alt=""><img class="sea-flag sea-flag--2" src="https://flagcdn.com/w20/${b}.png" alt="">`; }
  return '';
}
async function _seasonLoadCatalog(){
  if (_seasonCatalog) return _seasonCatalog;
  try { const d = await (await fetch('/api/season-catalog')).json(); _seasonCatalog = d.catalog || {}; }
  catch { _seasonCatalog = {}; }
  _seasonLabelById = {};
  for (const arr of Object.values(_seasonCatalog)) for (const it of (arr || [])) _seasonLabelById[it.id] = it.label;
  return _seasonCatalog;
}
function _seasonClassOf(id){ for (const [cls, arr] of Object.entries(_seasonCatalog || {})) if ((arr || []).some(it => it.id === id)) return cls; return 'forex'; }
const _SEA_CLASSES = [['forex','Forex'],['stocks','Stocks'],['commodities','Commodities'],['indices','Indices']];
async function _seasonOpenSettings(){
  await _seasonLoadCatalog();
  let ov = document.getElementById('season-cfg-overlay');
  if (!ov){ ov = document.createElement('div'); ov.id = 'season-cfg-overlay'; ov.className = 'sea-cfg-overlay'; document.body.appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    document.addEventListener('keydown', function esc(e){ if (e.key === 'Escape'){ const o = document.getElementById('season-cfg-overlay'); if (o) o.remove(); document.removeEventListener('keydown', esc); } }); }
  _seasonCfgClass = _seasonClassOf(_seasonPair);
  _seasonRenderCfg(ov);
}
function _seasonRenderCfg(ov){
  const cls = (_seasonCatalog[_seasonCfgClass] || []).length ? _seasonCfgClass : 'forex';
  // Tri ALPHABÉTIQUE (par libellé) pour retrouver un symbole facilement, en 2 colonnes.
  const items = (_seasonCatalog[cls] || []).slice().sort((a, b) => String(a.label || a.id).localeCompare(String(b.label || b.id), 'fr', { numeric: true, sensitivity: 'base' }));
  const tabs = _SEA_CLASSES.filter(([k]) => (_seasonCatalog[k] || []).length)
    .map(([k, lbl]) => `<button class="sea-cfg-tab${k === cls ? ' sea-cfg-tab--on' : ''}" data-cls="${k}">${lbl}</button>`).join('');
  const grid = items.map(it => {
    const on = it.id === _seasonPair;
    return `<button class="sea-cfg-sym${on ? ' sea-cfg-sym--on' : ''}" data-id="${it.id}">`
      + (cls === 'forex' ? _seasonFlags(it) : '')
      + `<span class="sea-cfg-sym-lbl">${it.label}</span>${on ? '<span class="sea-cfg-chk">✓</span>' : ''}</button>`;
  }).join('');
  ov.innerHTML = `<div class="sea-cfg-modal" role="dialog" aria-label="Paramètres du tableau de saisonnalité">
    <div class="sea-cfg-head">
      <span class="sea-cfg-ttl"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e3b23a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg> Paramètres du tableau de saisonnalité</span>
      <button class="sea-cfg-x" data-x="1" aria-label="Fermer">✕</button>
    </div>
    <div class="sea-cfg-body">
      <div class="sea-cfg-lbl">Classe d’actifs</div>
      <div class="sea-cfg-tabs">${tabs}</div>
      <div class="sea-cfg-lbl">Symbole</div>
      <div class="sea-cfg-grid">${grid}</div>
    </div>
    <div class="sea-cfg-foot"><button class="sea-cfg-cancel" data-x="1">Annuler</button></div>
  </div>`;
  ov.querySelectorAll('[data-x]').forEach(b => b.onclick = () => ov.remove());
  ov.querySelectorAll('.sea-cfg-tab').forEach(b => b.onclick = () => { _seasonCfgClass = b.dataset.cls; _seasonRenderCfg(ov); });
  ov.querySelectorAll('.sea-cfg-sym').forEach(b => b.onclick = () => { _seasonPick(b.dataset.id); ov.remove(); });
}

function initCOTTabs() {
  // Scopé à l'onglet desk #rtab-cot : les boutons COT d'un widget Mon Desk (mêmes classes) ont leurs
  // propres handlers — sans ce scope, un clic desk éteignait le bouton actif du widget (et vice-versa).
  // Type de positionnement : MÉMORISÉ PAR COMPTE (12/08). On restaure d'abord le choix connu, puis on
  // câble les clics — l'état de ce contrôle vit dans le DOM (classe --active), il n'y a pas de
  // variable à réhydrater : c'est donc le bouton lui-même qu'on réactive.
  const _cotVoulu = (function () { try { return DTPPref.get('cottype', ''); } catch (e) { return ''; } })();
  const _cotBtns = document.querySelectorAll('#rtab-cot .cot-type-btn');
  if (_cotVoulu) {
    const cible = [..._cotBtns].find(b => b.dataset.cotType === _cotVoulu);
    if (cible) { _cotBtns.forEach(b => b.classList.remove('cot-type-btn--active')); cible.classList.add('cot-type-btn--active'); }
  }
  _cotBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      _cotBtns.forEach(b => b.classList.remove('cot-type-btn--active'));
      btn.classList.add('cot-type-btn--active');
      try { DTPPref.set('cottype', btn.dataset.cotType || ''); } catch (e) {}
      buildCOTChart();
    });
  });
}

const _DMX_TF_LABELS = { H1: 'Chaque heure', H4: 'Toutes les 4 heures', D1: 'Chaque jour' };

function initDMXTabs() {
  // Scopé à l'onglet desk #rtab-dmx (mêmes classes réutilisées par les widgets Mon Desk — cf. initCOTTabs).
  const _btns = document.querySelectorAll('#rtab-dmx .dmx-tf-btn');
  const _majLbl = tf => { const lbl = document.getElementById('dmx-period-label'); if (lbl) lbl.textContent = _DMX_TF_LABELS[tf] || tf; };
  // Unité de temps MÉMORISÉE PAR COMPTE (12/08) : elle repartait sur le défaut du HTML à chaque
  // rechargement. Comme pour le COT, l'état vit dans le DOM → on réactive le bon bouton.
  const _voulu = (function () { try { return DTPPref.get('dmxtf', ''); } catch (e) { return ''; } })();
  if (_voulu) {
    const cible = [..._btns].find(b => b.dataset.tf === _voulu);
    if (cible) { _btns.forEach(b => b.classList.remove('dmx-tf-btn--active')); cible.classList.add('dmx-tf-btn--active'); _majLbl(_voulu); }
  }
  _btns.forEach(btn => {
    btn.addEventListener('click', () => {
      _btns.forEach(b => b.classList.remove('dmx-tf-btn--active'));
      btn.classList.add('dmx-tf-btn--active');
      _majLbl(btn.dataset.tf);
      try { DTPPref.set('dmxtf', btn.dataset.tf); } catch (e) {}
      buildDMXChart(true);
    });
  });
  // Tri du tableau (select) : même traitement — il est câblé en `onchange` inline dans index.html,
  // on complète ici sans y toucher.
  const _sel = document.getElementById('dmx-sort-select');
  if (_sel && !_sel.dataset.prefWired) {
    _sel.dataset.prefWired = '1';
    const _tri = (function () { try { return DTPPref.get('dmxsort', ''); } catch (e) { return ''; } })();
    if (_tri && [..._sel.options].some(o => o.value === _tri)) _sel.value = _tri;
    _sel.addEventListener('change', () => { try { DTPPref.set('dmxsort', _sel.value); } catch (e) {} });
  }
}

// ═══════════════════════════════════════════════
//  SESSION MAP : amCharts 5 MapChart
// ═══════════════════════════════════════════════

const MAP_CITIES = [
  { id: 'london',   name: 'London',   tz: 'Europe/London',    lon: -0.12,  lat: 51.5,  open: 8,  close: 17, ldx: -68, ldy:  0  },
  { id: 'newyork',  name: 'New York', tz: 'America/New_York', lon: -74.0,  lat: 40.7,  open: 9,  close: 17, ldx: -68, ldy:  0  },
  { id: 'tokyo',    name: 'Tokyo',    tz: 'Asia/Tokyo',       lon: 139.7,  lat: 35.7,  open: 9,  close: 15, ldx:  12, ldy: -2  },
  { id: 'sydney',   name: 'Sydney',   tz: 'Australia/Sydney', lon: 151.2,  lat: -33.9, open: 9,  close: 17, ldx:  12, ldy: -2  },
  { id: 'dubai',    name: 'Dubai',    tz: 'Asia/Dubai',       lon: 55.3,   lat: 25.2,  open: 8,  close: 14, ldx:  12, ldy: -2  },
  { id: 'hongkong', name: 'HK',       tz: 'Asia/Hong_Kong',   lon: 114.2,  lat: 22.3,  open: 9,  close: 16, ldx: -56, ldy:  0  },
];

// Session blocks for 24-h timeline (UTC hours)
const SESSION_BLOCKS = [
  { name: 'Sydney',   utcOpen: 22, utcClose: 6,  color: '#0a1228', colorActive: '#102058', city: 'sydney'   },
  { name: 'Tokyo',    utcOpen: 0,  utcClose: 9,  color: '#0d1540', colorActive: '#1838b0', city: 'tokyo'    },
  { name: 'London',   utcOpen: 8,  utcClose: 16, color: '#281a04', colorActive: '#b8800a', city: 'london'   },
  { name: 'New York', utcOpen: 13, utcClose: 21, color: '#140a28', colorActive: '#302890', city: 'newyork'  },
];

let mapRoot = null;
let mapCityPointSeries = null;
let mapTimelineTimer = null;
let mapClockTimer = null;
let mapNightTimer = null;   // redraw du terminateur jour/nuit
let mapNightRO = null;      // ResizeObserver de l'overlay nuit

function isCityOpen(city, now) {
  const local = new Date(now.toLocaleString('en-US', { timeZone: city.tz }));
  const h = local.getHours() + local.getMinutes() / 60;
  const dow = local.getDay();
  if (dow === 0 || dow === 6) return false;
  return h >= city.open && h < city.close;
}

function isSessionActive(block, utcH) {
  if (block.utcOpen < block.utcClose) return utcH >= block.utcOpen && utcH < block.utcClose;
  return utcH >= block.utcOpen || utcH < block.utcClose; // wraps midnight
}

// ── Filet de sécurité CARTE DES SESSIONS ──────────────────────────────────────────────────────────
// Si l'onglet MONDE est visible mais la carte VIDE (script CDN arrivé tard/raté, init manquée, root
// disposée), on répare tout seul : ré-injection UNIQUE des scripts amCharts map si absents après ~24 s,
// puis reconstruction automatique dès que les libs sont là. Plus jamais de panneau vide silencieux.
let _mapScriptsReinjected = false;
setInterval(() => {
  try {
    const el = document.getElementById('am5-map');
    if (!el || el.offsetParent === null) return;               // onglet non visible → rien à faire
    // Santé (même critère que initRightTab) : continents SVG Leaflet (>5 <path>) OU canvas amCharts réel OU
    // tuiles. L'ancien test « canvas présent ? » ignorait le SVG Leaflet → il RECONSTRUISAIT la carte toutes
    // les 12 s pendant que MONDE était ouvert (saccades signalées « pas fluide »).
    const _c = el.querySelector('canvas');
    // Une carte LEAFLET vivante (_loaded) = saine, on ne la reconstruit JAMAIS (un rebuild = re-cadrage visible =
    // le « dézoom puis zoom » signalé). Sinon, critères SVG/canvas/tuiles comme avant.
    if ((window._dtpLfMap && window._dtpLfMap._loaded) || (el.querySelectorAll('path').length > 5) || (_c && _c.width > 60 && _c.height > 60) || el.querySelector('img.leaflet-tile')) return;
    if (typeof am5map === 'undefined' || typeof am5geodata_worldLow === 'undefined') {
      if (!_mapScriptsReinjected && performance.now() > 24000) {
        _mapScriptsReinjected = true;
        ['https://cdn.amcharts.com/lib/5/map.js', 'https://cdn.amcharts.com/lib/5/geodata/worldLow.js'].forEach(src => {
          if (document.querySelector('script[data-mapretry="' + src + '"]')) return;
          const sc = document.createElement('script'); sc.src = src; sc.async = true; sc.dataset.mapretry = src;
          document.head.appendChild(sc);
        });
      }
      return;                                                   // buildSessionMap réessaiera quand les libs seront là
    }
    buildSessionMap();                                          // libs OK mais carte vide → reconstruction
  } catch (e) {}
}, 12000);

function buildSessionMap() {
  if (typeof am5map === 'undefined' || typeof am5geodata_worldLow === 'undefined') {
    setTimeout(buildSessionMap, 800);
    return;
  }
  disposeRoot('am5-map');
  if (mapTimelineTimer) { clearInterval(mapTimelineTimer); mapTimelineTimer = null; }
  if (mapClockTimer)    { clearInterval(mapClockTimer);    mapClockTimer = null; }
  if (mapNightTimer)    { clearInterval(mapNightTimer);    mapNightTimer = null; }
  if (mapNightRO)       { try { mapNightRO.disconnect(); } catch (e) {} mapNightRO = null; }
  document.getElementById('map-night-canvas')?.remove();

  const root = _dtpAncreGraphe(am5.Root.new('am5-map'));
  mapRoot = root;
  root.setThemes([applyTerminalTheme(root)]);
  root._logo?.set('forceHidden', true);
  root._logo?.dispose();

  const chart = root.container.children.push(
    am5map.MapChart.new(root, {
      projection:   am5map.geoMercator(),
      panX:         'rotateX',       // rotation horizontale → la carte REMPLIT la hauteur (bords E/O calés, fini les bandes noires) ; re-cadrée à chaque frame
      panY:         'none',
      wheelY:       'none',
      wheelX:       'none',
      minZoomLevel: 1, maxZoomLevel: 6,                // autorise le zoom de COUVERTURE (one-shot, validé sans blocage)
      paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0,
    })
  );
  chart.set('background', am5.Rectangle.new(root, { fill: am5.color(_deskChartBg()), fillOpacity: 1 }));  // fond charcoal desk

  // Rendu ÉPURÉ : pas de grille (graticule) → carte propre comme la référence.

  // Country polygons : vert plus clair sur océan noir (valeurs DTP)
  const polygonSeries = chart.series.push(
    am5map.MapPolygonSeries.new(root, { geoJSON: am5geodata_worldLow, exclude: ['AQ'] })
  );
  polygonSeries.mapPolygons.template.setAll({
    fill: am5.color(0x262a34), stroke: am5.color(0x3a3f4b),
    strokeWidth: 0.4, fillOpacity: 1, interactive: true, tooltipText: '{name}',
  });
  polygonSeries.mapPolygons.template.states.create('hover', { fill: am5.color(0x33373f) });

  // ── Terminateur JOUR/NUIT : overlay CANVAS hors-amCharts ──────────────────────────────────────
  // On dessine le VRAI terminateur solaire (point subsolaire + déclinaison, calculés depuis l'UTC) sur
  // un canvas posé PAR-DESSUS la carte. Hors amCharts → ne touche JAMAIS aux bornes/au cadrage (l'ancien
  // polygone plein-globe cassait d3-geo). Aligné via la projection RÉELLE d'amCharts (chart.convert →
  // calibration mercator), dégradé crépusculaire continu (smoothstep sur l'altitude solaire jusqu'à −18°),
  // recalé à chaque tick → suit l'heure/la saison/le DST automatiquement.
  const _mapDiv = document.getElementById('am5-map');
  let _nightCanvas = document.getElementById('map-night-canvas');
  if (_nightCanvas) _nightCanvas.remove();
  _nightCanvas = document.createElement('canvas');
  _nightCanvas.id = 'map-night-canvas';
  _nightCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4;';
  if (_mapDiv) { _mapDiv.style.position = 'relative'; _mapDiv.appendChild(_nightCanvas); }
  const _nightOff = document.createElement('canvas');   // grille basse résolution → lissée au scale (dégradé doux + perf)

  function _subsolar(date) {
    const rad = Math.PI / 180, n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
    let L = (280.460 + 0.9856474 * n) % 360; if (L < 0) L += 360;
    const g = ((357.528 + 0.9856003 * n) % 360) * rad;
    const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;
    const eps = 23.439 * rad;
    const decl = Math.asin(Math.sin(eps) * Math.sin(lam));               // déclinaison solaire (saison)
    const ra   = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
    let gmst = (280.46061837 + 360.98564736629 * n) % 360; if (gmst < 0) gmst += 360;
    let lon = ra / rad - gmst; lon = ((lon + 180) % 360 + 360) % 360 - 180;   // longitude subsolaire (équation du temps incluse)
    return { decl, subLon: lon * rad };
  }

  function refreshNight() {
    try {
      if (!_nightCanvas || !_mapDiv) return;
      const W = _mapDiv.clientWidth, H = _mapDiv.clientHeight;
      if (!W || !H) return;
      if (_nightCanvas.width  !== W) _nightCanvas.width  = W;
      if (_nightCanvas.height !== H) _nightCanvas.height = H;
      // Calibration mercator via la VRAIE projection amCharts (3 points) → robuste au resize/offset.
      const c00 = chart.convert({ longitude: 0,  latitude: 0  });
      const cLo = chart.convert({ longitude: 90, latitude: 0  });
      const cLa = chart.convert({ longitude: 0,  latitude: 60 });
      if (!c00 || !cLo || !cLa || !isFinite(c00.x) || !isFinite(cLo.x) || !isFinite(cLa.y)) return;
      const mY = lat => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
      const dXdLon = (cLo.x - c00.x) / 90;
      const dYdMY  = (cLa.y - c00.y) / (mY(60) - mY(0));
      if (!dXdLon || !dYdMY) return;
      const lonAt = x => (x - c00.x) / dXdLon;
      const latAt = y => (2 * Math.atan(Math.exp((y - c00.y) / dYdMY + mY(0))) - Math.PI / 2) * 180 / Math.PI;

      const COLS = Math.max(80, Math.min(240, Math.round(W / 4)));
      const ROWS = Math.max(60, Math.min(170, Math.round(H / 4)));
      const ss = _subsolar(new Date());
      const sinD = Math.sin(ss.decl), cosD = Math.cos(ss.decl), rad = Math.PI / 180;
      const cosH = new Float64Array(COLS);
      for (let i = 0; i < COLS; i++) cosH[i] = Math.cos(lonAt((i + 0.5) * W / COLS) * rad - ss.subLon);
      const sinLat = new Float64Array(ROWS), cosLat = new Float64Array(ROWS);
      for (let j = 0; j < ROWS; j++) {
        const phi = Math.max(-89, Math.min(89, latAt((j + 0.5) * H / ROWS))) * rad;
        sinLat[j] = Math.sin(phi); cosLat[j] = Math.cos(phi);
      }
      _nightOff.width = COLS; _nightOff.height = ROWS;
      const octx = _nightOff.getContext('2d');
      const img = octx.createImageData(COLS, ROWS), d = img.data;
      const SIN18 = Math.sin(18 * rad), MAXA = 150;   // alpha max ~0.59 (nuit profonde)
      for (let j = 0; j < ROWS; j++) {
        const a1 = sinLat[j] * sinD, b1 = cosLat[j] * cosD, row = j * COLS;
        for (let i = 0; i < COLS; i++) {
          const sinAlt = a1 + b1 * cosH[i];           // sin(altitude solaire)
          let a = 0;
          if (sinAlt < 0) { const t = Math.min(1, -sinAlt / SIN18); a = (t * t * (3 - 2 * t)) * MAXA; }   // smoothstep → crépuscule doux
          const k = (row + i) * 4;
          d[k] = 3; d[k + 1] = 6; d[k + 2] = 22; d[k + 3] = a;
        }
      }
      octx.putImageData(img, 0, 0);
      const mctx = _nightCanvas.getContext('2d');
      mctx.clearRect(0, 0, W, H);
      mctx.imageSmoothingEnabled = true;
      mctx.drawImage(_nightOff, 0, 0, COLS, ROWS, 0, 0, W, H);   // upscale lissé → dégradé continu sans coupure
    } catch (e) { /* overlay best-effort : ne casse jamais la carte */ }
  }

  // ── Orange UTC vertical line ──────────────────
  const utcLineSeries = chart.series.push(am5map.MapLineSeries.new(root, {}));
  utcLineSeries.mapLines.template.setAll({
    stroke: am5.color(0xe3b23a), strokeWidth: 1.4, strokeOpacity: 0.7,   // trait fin (DTP)
  });

  const utcLabelSeries = chart.series.push(am5map.MapPointSeries.new(root, {}));
  let _utcLabel = null;
  utcLabelSeries.bullets.push((r) => {
    const cont = am5.Container.new(r, {});
    cont.children.push(am5.RoundedRectangle.new(r, {
      width: 46, height: 19,
      fill: am5.color(0xe3b23a), fillOpacity: 1,
      cornerRadiusTL: 4, cornerRadiusTR: 4, cornerRadiusBL: 4, cornerRadiusBR: 4,
      centerX: am5.percent(50), centerY: am5.percent(50),
    }));
    _utcLabel = cont.children.push(am5.Label.new(r, {
      text: '--:--',
      fill: am5.color(0x000000),
      fontSize: 10, fontFamily: '-apple-system, "Inter", "Segoe UI", sans-serif', fontWeight: '700',
      centerX: am5.percent(50), centerY: am5.percent(50),
      oversizedBehavior: 'none',
    }));
    // Petite flèche orange sous l'étiquette, pointant vers le bas (vers le trait) : façon pro.
    // Caractère « ▼ » (Label) plutôt qu'am5.Triangle (qui faisait planter le rendu).
    cont.children.push(am5.Label.new(r, {
      text: '▼', fill: am5.color(0xe3b23a),
      fontSize: 9, fontWeight: '700',
      centerX: am5.percent(50), centerY: am5.percent(0), y: 11,
    }));
    return am5.Bullet.new(r, { sprite: cont });
  });

  let _lastUTCLineLon = null;
  function refreshUTCLine(now) {
    const h = now.getUTCHours() + now.getUTCMinutes() / 60;
    const lon = (h - 12) * 15;
    // Étiquette du trait « now » = HEURE LOCALE courante HH:MM (comme la référence : « 22:14 »), pas un countdown.
    const cd = now.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' });
    if (_utcLabel) _utcLabel.set('text', cd);
    if (_lastUTCLineLon === null || Math.abs(lon - _lastUTCLineLon) >= 0.25) {
      _lastUTCLineLon = lon;
      utcLineSeries.data.setAll([{ geometry: { type: 'LineString', coordinates: [[lon, 84], [lon, -58]] } }]);   // dans l'étendue des terres → n'élargit PAS les bornes (le trait fin est OK, contrairement au voile de nuit)
      utcLabelSeries.data.setAll([{ geometry: { type: 'Point', coordinates: [lon, 80] } }]);   // badge heure calé tout en HAUT du trait (façon pro)
    }
  }

  // ── 4 key trading cities ──────────────────────
  const SESSION_CITIES = [   // couleurs + côté du badge calqués sur l'image de référence (NY violet/droite ; Londres jaune ; Tokyo/Sydney bleu/gauche pour ne pas sortir du cadre est)
    { id: 'london',  name: 'London',   tz: 'Europe/London',    lon: -0.12,  lat: 51.5,  open: 8, close: 17, labelLeft: true,  color: 0xe3b23a },
    { id: 'newyork', name: 'New York', tz: 'America/New_York', lon: -74.0,  lat: 40.7,  open: 9, close: 17, labelLeft: false, color: 0xe3b23a },
    { id: 'tokyo',   name: 'Tokyo',    tz: 'Asia/Tokyo',       lon: 139.7,  lat: 35.7,  open: 9, close: 15, labelLeft: true,  color: 0xe3b23a },
    { id: 'sydney',  name: 'Sydney',   tz: 'Australia/Sydney', lon: 151.2,  lat: -33.9, open: 9, close: 17, labelLeft: true,  color: 0xe3b23a },
  ];

  // Statut dynamique (DST géré par Intl/timeZone) : 'open' | 'closing' (<30 min) | 'opening' (<30 min) | 'closed'.
  function cityStatus4(city, now) {
    const local = new Date(now.toLocaleString('en-US', { timeZone: city.tz }));
    const dow = local.getDay();
    if (dow === 0 || dow === 6) return 'closed';            // week-end : FX fermé
    const h = local.getHours() + local.getMinutes() / 60;
    if (h >= city.open && h < city.close) return (city.close - h <= 0.5) ? 'closing' : 'open';   // clôture imminente
    if (city.open - h > 0 && city.open - h <= 0.5) return 'opening';                              // ouverture imminente
    return 'closed';
  }

  const pointSeries = chart.series.push(am5map.MapPointSeries.new(root, {}));
  mapCityPointSeries = pointSeries;

  function buildCityData4(now) {
    return SESSION_CITIES.map(c => {
      const status = cityStatus4(c, now);
      return {
        geometry:  { type: 'Point', coordinates: [c.lon, c.lat] },
        id:        c.id,
        name:      c.name,
        status,
        isOpen:    status === 'open' || status === 'closing',
        labelLeft: c.labelLeft,
        color:     c.color,
      };
    });
  }

  pointSeries.data.setAll(buildCityData4(new Date()));

  const _cityTimeLabelRefs = {};

  pointSeries.bullets.clear();
  pointSeries.bullets.push((root, series, dataItem) => {
    const data     = dataItem.dataContext;
    const status   = data.status || (data.isOpen ? 'open' : 'closed');
    const isOpen   = status === 'open' || status === 'closing';
    const imminent = status === 'opening' || status === 'closing';   // ouverture/clôture < 30 min
    const lit      = isOpen || imminent;
    const accent   = data.color || 0xe3b23a;        // couleur propre à la session (London=jaune, NY=violet…)
    const AMBER    = 0xfbbf24;                       // cue « imminent »
    const ringCol  = (status === 'open') ? accent : AMBER;
    const cont     = am5.Container.new(root, {});

    // Badge COMPACT sur UNE SEULE LIGNE : « 15:02:50  New York » : heure colorée + ville blanche, côte à côte,
    // fond sombre + fine bordure de la couleur de la ville, collé à côté du point (gauche/droite selon le bord).
    const box = cont.children.push(am5.Container.new(root, {
      paddingTop: 3, paddingBottom: 3, paddingLeft: 7, paddingRight: 7,
      layout: root.horizontalLayout,
      centerY: am5.percent(50), y: -11,
      x: data.labelLeft ? -12 : 12,
      centerX: data.labelLeft ? am5.percent(100) : am5.percent(0),
    }));

    box.set('background', am5.RoundedRectangle.new(root, {
      fill:          am5.color(0x0b1020),
      fillOpacity:   0.9,
      stroke:        am5.color(lit ? (status === 'open' ? accent : AMBER) : accent),
      strokeOpacity: lit ? 0.95 : 0.5,
      strokeWidth:   1.2,
      cornerRadiusTL: 5, cornerRadiusTR: 5, cornerRadiusBL: 5, cornerRadiusBR: 5,
    }));

    const timeLabel = box.children.push(am5.Label.new(root, {
      text:       '--:--:--',
      fill:       am5.color(accent),
      fontSize:   11, fontWeight: '700',
      fontFamily: '-apple-system, "Inter", "Segoe UI", sans-serif',
      centerY:    am5.percent(50), paddingRight: 5,
    }));

    box.children.push(am5.Label.new(root, {
      text:       data.name,
      fill:       am5.color(0xf4f6f9),
      fontSize:   11, fontWeight: '600',
      fontFamily: '-apple-system, "Inter", "Segoe UI", sans-serif',
      centerY:    am5.percent(50),
    }));

    _cityTimeLabelRefs[data.id] = timeLabel;

    // Halo pulsant : sessions OUVERTES (couleur session) + ouverture/clôture IMMINENTE (ambre).
    if (lit) {
      const startOp = isOpen ? 0.75 : 0.5;
      const ring = cont.children.push(
        am5.Circle.new(root, { radius: 7, fillOpacity: 0, stroke: am5.color(ringCol), strokeOpacity: startOp, strokeWidth: 1.5 })
      );
      ring.animate({ key: 'radius',        from: 5,       to: 22, duration: 2000, loops: Infinity, easing: am5.ease.out(am5.ease.cubic) });
      ring.animate({ key: 'strokeOpacity', from: startOp, to: 0,  duration: 2000, loops: Infinity, easing: am5.ease.out(am5.ease.cubic) });
    }

    // Point ville : vif si ouverte, ambre si imminente, discret si fermée.
    cont.children.push(am5.Circle.new(root, {
      radius:      isOpen ? 5 : (imminent ? 4 : 3),
      fill:        isOpen ? am5.color(accent) : (imminent ? am5.color(AMBER) : am5.color(0x555570)),
      stroke:      lit ? am5.color(0xffffff) : am5.color(0x333350),
      strokeWidth: lit ? 1.4 : 0.8,
    }));

    return am5.Bullet.new(root, { sprite: cont });
  });

  function updateCityTimes(now) {
    SESSION_CITIES.forEach(c => {
      const label = _cityTimeLabelRefs[c.id];
      if (!label) return;
      const local = new Date(now.toLocaleString('en-US', { timeZone: c.tz }));
      label.set('text', local.toLocaleTimeString('en-GB', {
        hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
      }));
    });
  }

  function updateHeader(now) {
    // DTP affiche simplement "Live" (vert) à côté du point : pas la liste des sessions
    const labEl = document.getElementById('active-sessions-label');
    if (labEl) { labEl.textContent = 'Direct'; labEl.style.color = '#22c55e'; }
  }

  let _statusTick = 0;
  mapClockTimer = setInterval(() => {
    const now = new Date();
    updateHeader(now);
    refreshUTCLine(now);
    updateCityTimes(now);
    if (++_statusTick % 60 === 0) pointSeries.data.setAll(buildCityData4(now));   // ré-évalue ouvert/fermé/imminent chaque minute
  }, 1000);

  updateHeader(new Date());
  refreshUTCLine(new Date());
  setTimeout(() => updateCityTimes(new Date()), 200);

  // Terminateur jour/nuit : 1er rendu après le layout, puis redraw périodique (l'ombre avance ~0,25°/min) + au resize.
  setTimeout(refreshNight, 700);
  mapNightTimer = setInterval(refreshNight, 15000);
  if (window.ResizeObserver && _mapDiv) { mapNightRO = new ResizeObserver(() => refreshNight()); mapNightRO.observe(_mapDiv); }

  // PLUS DE ZOOM DE COUVERTURE : sans le voile de nuit, la carte épouse l'étendue des TERRES (ratio large
  // ~1.65) et REMPLIT la largeur en montrant le monde ENTIER (haut + bas), bien centré, dès le zoom 1 →
  // rien à forcer, et c'est responsive nativement (amCharts ajuste les bornes à la taille du panneau).

  return root;
}


// ═══════════════════════════════════════════════
//  RIGHT PANEL TAB SWITCHING
// ═══════════════════════════════════════════════

const chartInited = { world: false, risk: false, strength: false, meter: false, cot: false };

function initRightTab(tab) {
  // Onglets à polling : on (re)construit à CHAQUE activation → seul l'onglet visible poll
  // (le timer se relance ici et s'auto-coupe quand l'onglet n'est plus actif). Évite le
  // gaspillage réseau/serveur des onglets en arrière-plan.
  if (tab === 'dmx')      { buildDMXChart();      return; }
  if (tab === 'cot')      { buildCOTChart();      return; }
  if (tab === 'seasonality') { buildSeasonalityChart(); return; }
  if (tab === 'meter')    { buildMeterChart();    return; }   // rebuild léger (briques HTML)
  if (tab === 'strength') { buildStrengthCharts(); return; }  // dispose + rebuild amCharts
  // RISK : jauge construite UNE fois (idempotente), mais l'HISTORIQUE se rafraîchit à chaque activation
  // (barre du jour à jour) : uniquement quand l'onglet est visible (anti-egress).
  if (tab === 'risk') { if (!chartInited.risk) { chartInited.risk = true; buildRiskGauge(); } loadRiskHistory(); return; }
  // CARTE DES SESSIONS : à CHAQUE activation on vérifie qu'elle est SAINE, sinon on RECONSTRUIT (visible).
  // La carte réelle est LEAFLET (sessionmap.js redéfinit window.buildSessionMap ; continents = GeoJSON SVG).
  // Construite CACHÉE (0×0) au chargement, son retry geodata (~6 s) peut expirer → couche continents jamais
  // ajoutée → panneau « Monde » sombre avec juste les badges villes (bug signalé). Santé = continents SVG
  // présents (>5 <path> : 4 halos + terminateur seuls = 5) OU canvas amCharts réel OU tuiles chargées.
  if (tab === 'world') {
    const _mEl = document.getElementById('am5-map');
    const _cv  = _mEl && _mEl.querySelector('canvas');
    const _drawn = _mEl && ((_mEl.querySelectorAll('path').length > 5)
      || (_cv && _cv.width > 60 && _cv.height > 60)
      || _mEl.querySelector('img.leaflet-tile'));
    if (!chartInited.world || !_drawn) { chartInited.world = true; buildSessionMap(); }
    // Revisite d'une carte SAINE : recadrage LÉGER qui RESTAURE la vue figée sans refit → plus de « dézoom puis
    // zoom » (l'ancien fitBounds recalculait un zoom fractionnaire légèrement différent → flottement signalé).
    else if (window._dtpLfRefit) { window._dtpLfRefit(); }
    else if (window._dtpLfMap) { try { window._dtpLfMap.invalidateSize(); } catch (e) {} }
    else if (mapRoot) { try { mapRoot.resize(); } catch (e) {} }   // variante amCharts (si sessionmap.js retiré)
    return;
  }
  // Autres onglets statiques éventuels : construits une seule fois
  if (chartInited[tab]) return;
  chartInited[tab] = true;
}

document.addEventListener('DOMContentLoaded', () => {
  // Réglages du COMPTE : on les demande dès le départ. Les vues se dessinent d'abord avec le cache
  // local (aucune attente perceptible), puis se recalent si le compte dit autre chose.
  try { DTPPref.charger(); } catch (e) {}
  // Idem pour les périodes du Force des Devises, et pour la MÊME raison : en la demandant au
  // chargement de la page — et non à l'ouverture de l'onglet FORCE —, `_stfPref` est déjà renseignée
  // quand l'onglet s'ouvre. Les panneaux naissent alors DIRECTEMENT sur le choix du compte, au lieu
  // de naître sur le cache du navigateur puis d'être corrigés. C'est ce décalage qui faisait
  // « oublier » TD/TW à la reconnexion, en particulier sur un appareil au cache vide.
  try { _stfCharger(); } catch (e) {}

  // Tab switching
  document.getElementById('right-panel-tabs')?.addEventListener('click', e => {
    const tab = e.target.closest('[data-rtab]')?.dataset?.rtab;
    if (!tab) return;
    document.querySelectorAll('[data-rtab]').forEach(t => t.classList.toggle('right-tab--active', t.dataset.rtab === tab));
    document.querySelectorAll('.right-tab-panel').forEach(p => p.classList.toggle('active', p.id === `rtab-${tab}`));
    initRightTab(tab);
    try { localStorage.setItem('dtp_active_rtab', tab); } catch {}   // cache instantané
    try { DTPPref.set('rtab', tab); } catch (e) {}                   // + mémorisé sur le COMPTE (suit l'appareil)
  });

  // ── View switching (main nav) ──────────────────────────────────────────────
  // Liste des onglets valides (pour valider une valeur mémorisée)
  // 'widgets' = MON DESK (grille composable). L'onglet n'est CRÉÉ que pour l'admin (widgets.js) ;
  // la vue reste donc inatteignable pour un client, mais doit être valide ici sinon activateView
  // retomberait sur 'news' à chaque ouverture (et au rechargement avec la vue mémorisée).
  const VALID_VIEWS = ['news', 'calendar', 'bias', 'fxlist', 'institution', 'analyst', 'weekahead', 'bank', 'taux', 'symbol', 'journal', 'calculator', 'widgets'];
  // Titre d'onglet élégant : "DTP | <PAGE>" (NEWS par défaut = espace de travail "JOT")
  // Titre FIXE de l'onglet : "DataTradingPro - <nom utilisateur>" (ne dépend plus de la vue active).
  // Le nom est exposé par index.html après /api/auth/me (window._dtpUser).
  function _setDocTitle(_view) {
    try { document.title = 'DTP' + (window._dtpUser ? ' | ' + window._dtpUser : ''); } catch {}
  }

  let _tauxPoll = null, _tauxSig = '';   // rafraîchissement TEMPS RÉEL de l'onglet TAUX
  function _tauxTick() {
    const v = document.getElementById('view-taux');
    if (!v || v.classList.contains('hidden') || document.hidden) return;   // uniquement si l'onglet est visible et l'app au premier plan
    loadTauxView();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) _tauxTick(); });   // retour sur l'app → maj immédiate

  async function loadTauxView() {
    const host = document.getElementById('taux-grid');
    if (!host) return;
    const hasCards = () => host.children.length && !host.querySelector('.taux-loading') && !host.querySelector('.taux-empty') && !host.querySelector('.rtc-skel');
    // Skeleton shimmer (8 cartes) AVANT le 1er fetch -> perception de vitesse ; auto-efface au render.
    if (!hasCards() && !host.querySelector('.rtc-skel')) {
      host.innerHTML = Array.from({ length: 8 }).map(() =>
        '<div class="rtc rtc-skel" aria-hidden="true">' +
          '<div class="rtc-head"><span class="dtp-skel" style="width:16px;height:16px;border-radius:50%"></span><span class="dtp-skel" style="width:58%"></span></div>' +
          '<div class="rtc-metrics">' + Array.from({ length: 5 }).map(() => '<div class="rtc-m"><span class="dtp-skel" style="width:72%"></span><span class="dtp-skel" style="width:52%;height:12px;margin-top:4px"></span></div>').join('') + '</div>' +
          '<div class="rtc-dist">' + Array.from({ length: 3 }).map(() => '<div class="rtc-bar"><span class="dtp-skel" style="width:100%;height:14px"></span></div>').join('') + '</div>' +
        '</div>'
      ).join('');
    }
    try {
      const d = window._dtpJSON ? await window._dtpJSON('/api/rates') : await (await fetch('/api/rates')).json();   // fetch RÉSILIENT (retry sur 502/non-JSON transitoire)
      const banks = (d && d.banks) || [];
      if (!banks.length) { if (!hasCards()) host.innerHTML = '<div class="taux-empty">Aucune donnée.</div>'; return; }
      const sig = (d.rpAt || 0) + '|' + (d.updatedAt || 0) + '|' + banks.length;
      if (sig === _tauxSig && hasCards()) return;   // données inchangées → pas de re-rendu (évite tout clignotement)
      _tauxSig = sig;
      host.innerHTML = banks.map(_rtcCard).join('');
      if (window._dtpDataIn) window._dtpDataIn(host, 'taux');   // fondu d'arrivee (1re fois : skeleton -> cartes)
      // Mention « ● Cotations à jour · HH:MM » RETIRÉE (demande user 27/07) — même esprit que le badge
      // « Direct » du Radar de Biais : le rafraîchissement continu reste actif, seul l'indicateur disparaît.
      // On vide le conteneur pour purger un libellé rendu par une version précédente.
      const upd = document.getElementById('taux-update');
      if (upd) upd.innerHTML = '';
    } catch (e) {
      // Échec TRANSITOIRE (502 pendant un redéploiement…) : si pas encore de cartes → on GARDE le chargement
      // et on retente vite (jamais bloqué sur le spinner) ; sinon on garde l'affichage existant (zéro clignotement).
      if (!hasCards()) {
        if (!host.querySelector('.taux-loading')) host.innerHTML = '<div class="taux-loading"><div class="dtp-loader"><div class="dtp-loader__spin"></div><div class="dtp-loader__label">Chargement des probabilités de taux…</div></div></div>';
        setTimeout(loadTauxView, 4000);
      }
    }
  }

  // ── Carte « Interest Rate Probability » : clone fidèle, partagée entre l'onglet TAUX et la vue paire ──
  // Terminologie financière EN d'origine (Next Move/Probability/Expected Δ/Current Rate/Meeting Date,
  // Scenario Distribution, Cut/Hold/Hike, Implied Δ (BPS), Base Case). Sparklines data-driven en fond.
  const _RTC_EN = { USD: 'Réserve fédérale (OIS)', EUR: 'Banque centrale européenne', GBP: 'Banque d’Angleterre', JPY: 'Banque du Japon', CHF: 'Banque nationale suisse', CAD: 'Banque du Canada', AUD: 'Banque de réserve d’Australie', NZD: 'Banque de réserve de Nouvelle-Zélande' };
/* LA MESURE EXACTE QUE PORTE CHAQUE CARTE. Vide = « Taux actuel » suffit (une seule mesure
   publiée). Renseignée là où la banque en publie PLUSIEURS, donc là où le doute est possible. */
const _RTC_MESURE = {
  ECB: 'Taux de dépôt',        // et non le refi, supérieur de 15 pb depuis septembre 2024
  FED: 'Fed funds (haut)',     // la Fed annonce une FOURCHETTE : on affiche le haut
};
/* ⚠️ ET L'AUTRE CHIFFRE, AU SURVOL. Nommer la mesure ferme la moitié du doute ; l'autre moitié
   vient de ce qu'on lit AILLEURS. Les sites grand public (TradingEconomics par exemple) titrent le
   taux de la zone euro sur le REFINANCEMENT PRINCIPAL, pas sur le dépôt : quelqu'un qui compare
   voit deux chiffres différents et conclut à une erreur. Le survol dit donc lequel est lequel, et
   pourquoi celui-ci est affiché. Écrit une fois, ça évite la question à chaque fois. */
const _RTC_MESURE_AIDE = {
  ECB: 'La BCE publie DEUX taux : la facilité de dépôt (affichée ici) et le refinancement principal, '
     + 'supérieur de 15 points de base depuis la réforme du corridor de septembre 2024. '
     + 'Le dépôt est le taux directeur effectif que le marché price : c’est lui qui commande les probabilités ci-dessous. '
     + 'Les sites grand public titrent souvent le refinancement : d’où l’écart si vous comparez.',
  FED: 'La Fed annonce une FOURCHETTE (par exemple 3,50-3,75%). La carte affiche sa borne HAUTE, '
     + 'la convention des tables de taux et des contrats à terme.',
};
  function _rtcCard(b) {
    const MVC = { HOLD: { txt: 'Maintien', cls: 'w' }, HIKE: { txt: 'Hausse', cls: 'g' }, CUT: { txt: 'Baisse', cls: 'r' } };
    const fr  = s => { try { const p = String(s).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; } catch (e) { return s; } };
    const num = (v, dec) => Number(v).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const pct = v => num(v, 2) + '%';
    const bps = v => (v > 0 ? '+' : '') + num(v, 2) + ' bps';
    // Mini-courbes décoratives la référence, une PAR cellule, calées bas-droite derrière le texte.
    // Tracés en COURBES DE BÉZIER lissées (fini les dents de scie anguleuses) + dégradé sous la
    // ligne qui s'estompe vers le bas : ondulée grise (neutre/Hold), montante verte (Hike/Δ+),
    // descendante rouge (Cut/Δ−).
    const SPK_PATH = {
      wavy: 'M0 17 C5 11, 9 11, 13 15 C17 19, 21 19, 25 14 C29 9, 33 9, 37 14 C41 19, 45 19, 49 14 C53 9, 57 10, 62 13',
      up:   'M0 26 C5 24, 7 25, 10 23 C14 20, 16 23, 20 21 C25 18, 27 21, 31 17 C35 13, 37 16, 41 12 C45 8, 47 11, 51 7 C55 3, 58 4, 62 2',
      down: 'M0 2 C5 4, 7 3, 10 5 C14 8, 16 5, 20 7 C25 10, 27 7, 31 11 C35 15, 37 12, 41 16 C45 20, 47 17, 51 21 C55 25, 58 24, 62 26',
    };
    const SPK_COL = { wavy: '#7c879b', up: '#00e676', down: '#ff3d00' };
    const mspk = kind => {
      const p = SPK_PATH[kind], c = SPK_COL[kind], gid = 'rtcg-' + kind;
      return '<svg class="rtc-msp" viewBox="0 0 64 28" fill="none" preserveAspectRatio="none">'
        + '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">'
        + '<stop stop-color="' + c + '" stop-opacity="0.42"/><stop offset="1" stop-color="' + c + '" stop-opacity="0"/></linearGradient></defs>'
        + '<path d="' + p + ' L62 28 L0 28 Z" fill="url(#' + gid + ')"/>'
        + '<path d="' + p + '" stroke="' + c + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';   // trait 1,5→2 + dégradé 0,30→0,42 (23/08 : le viewBox écrasé rendait ~0,8px, quasi invisible)
    };
    // Header directionnel = PROCHAIN MOUVEMENT (champ `stance` = FedWatch/biais maison curé) → COHÉRENT avec le
    // « Prochain mouvement » du Radar de Biais (demande user « aligner TAUX sur la stance »). Repli sur `move` (ancien).
    let _mvd = b.stance || b.move;
    const sc = b.scenario || { hold: 0, hike: 0, cut: 0 };
    /* ⚠️ LA PROBABILITÉ AFFICHÉE EST CELLE DU MOUVEMENT AFFICHÉ (29/08, incident client MaTToKs).
       Avant : l'étiquette venait de la stance (Radar de Biais) et « Probabilité » du scénario
       DOMINANT de la prochaine réunion — deux moteurs différents sur la même ligne. Sur la RBNZ,
       ça donnait « Hausse · 50,00% » où 50 % était la probabilité du MAINTIEN : la carte se
       contredisait elle-même, et sa propre colonne « Scénario central » disait HOLD deux
       centimètres plus bas. Désormais le couple est UNE grandeur : la probabilité que le
       mouvement affiché se produise À LA PROCHAINE RÉUNION. Si ce mouvement n'y est pas pricé du
       tout (0 %), l'en-tête bascule sur le scénario central de la réunion — un couple cohérent
       plutôt qu'un « Hausse · 0,00% » qui se lirait comme une panne. */
    let _prob = _mvd === 'HIKE' ? sc.hike : _mvd === 'CUT' ? sc.cut : sc.hold;
    if (!(_prob > 0) && _mvd !== 'HOLD' && b.meetings && b.meetings[0]) {
      _mvd = b.meetings[0].baseCase || 'HOLD';
      _prob = _mvd === 'HIKE' ? sc.hike : _mvd === 'CUT' ? sc.cut : sc.hold;
    }
    const mv = MVC[_mvd] || MVC.HOLD;
    const mvSpk  = _mvd === 'HIKE' ? 'up' : (_mvd === 'CUT' ? 'down' : 'wavy');
    const expSpk = b.expBps > 0 ? 'up' : (b.expBps < 0 ? 'down' : 'wavy');
    const expCls = b.expBps > 0 ? 'g' : (b.expBps < 0 ? 'r' : 'n');
    // Scenario Distribution : uniquement les scénarios > 0, triés décroissant (la référence n'affiche pas les lignes vides)
    const scen = [['Maintien', sc.hold, 'n'], ['Hausse', sc.hike, 'g'], ['Baisse', sc.cut, 'r']].filter(s => s[1] > 0).sort((a, z) => z[1] - a[1]);
    const scRows = (scen.length ? scen : [['Maintien', 0, 'n']]).map(s =>
      '<div class="rtc-bar"><span class="rtc-bl">' + s[0] + '</span><span class="rtc-track"><i class="' + s[2] + '" style="width:' + Math.max(0.6, s[1]) + '%"></i></span><span class="rtc-bp">' + pct(s[1]) + '</span></div>').join('');
    const rows = (b.meetings || []).map(m => {
      const ib = m.impliedBps > 0 ? 'g' : (m.impliedBps < 0 ? 'r' : 'n');
      const bc = m.baseCase === 'HIKE' ? 'g' : (m.baseCase === 'CUT' ? 'r' : 'n');
      return '<tr><td>' + fr(m.date) + '</td><td class="rtc-day">' + m.days + 'd</td>'
        + '<td>' + pct(m.cut) + '</td><td>' + pct(m.hold) + '</td><td>' + pct(m.hike) + '</td>'
        + '<td><span class="rtc-pill ' + ib + '">' + bps(m.impliedBps) + '</span></td>'
        + '<td><span class="rtc-base ' + bc + '">' + m.baseCase + '</span></td></tr>';
    }).join('');
    /* ⚠️ LE PIED DE CARTE A ÉTÉ RETIRÉ LE 02/09 (demande utilisateur, la phrase citée mot pour mot :
       « Taux directeur 2,50 % — décision du 08/07/2026 (RBNZ Interest Rate Decision, calendrier
       ForexFactory) · Pricing : modèle DTP (pas de pricing de marché chez notre fournisseur :
       abonnement Pro requis chez le fournisseur (HTTP 401)) »).
       Posé la veille pour citer les sources, il s'était mis à déverser du diagnostic interne sur la
       carte d'un client payant — un code HTTP et le nom d'un paywall fournisseur n'ont rien à faire
       dans un produit. Et sur deux lignes de 9,5 px, il pesait plus lourd que les chiffres.
       ⚠️ CE QUI RESTE, ET POURQUOI CE N'EST PAS NÉGOCIABLE : le badge « pricing modélisé » en tête
       de carte. C'est LUI le garde-fou né de l'incident du 29/08 (un client a comparé notre modèle à
       un pricing OIS réel en croyant comparer deux pricings) ; le pied n'en était que la version
       longue. Retirer le pied ne fait donc perdre aucune garantie : une carte sans pricing de marché
       continue de le dire, en trois mots au lieu de deux lignes.
       La provenance elle-même n'est pas perdue non plus : `rateSrc` reste calculé et servi dans
       /api/rates (server.js, `_origineTaux`) — c'est la donnée qui a permis de répondre « d'où vient
       ce taux ». Seul son AFFICHAGE sur la carte disparaît. */
    // data-bank : identifiant stable de la carte (FED/ECB/…) — le widget « Onglet Taux » filtre dessus
    // (réglage « Banque » : une seule banque ou toutes). Sans effet sur l'onglet du desk.
    return '<div class="rtc" data-bank="' + (b.code || '') + '">'
      + '<div class="rtc-head"><img class="rtc-flag" src="https://flagcdn.com/32x24/' + b.cc + '.png" alt="" loading="lazy">'
      + '<span class="rtc-bank">' + (_RTC_EN[b.code] || b.bank) + '</span>'
      /* La SOURCE, écrite sur la carte (29/08, incident client) : deux banques sur huit sortent du
         modèle DTP faute de flux de marché, et RIEN ne le disait — un client a comparé notre
         estimation à un pricing OIS réel en croyant comparer deux pricings. Le badge tranche. */
      /* Le survol du badge dit maintenant le POURQUOI (panne exacte côté fournisseur, ex. « abonnement
         Pro requis ») ou le QUAND (heure de la dernière donnée de marché reçue) — audit du 30/08 :
         « regarde les sources des autres taux ». Le taux affiché, lui, est recalé en continu sur la
         dernière décision réelle du calendrier économique, IA ou pas. */
      /* « ESTIMATION DTP » A ÉTÉ RETIRÉ LE 01/09 (demande user : « enlève estimation DTP, faut les
         vraies taux pour toutes les banques… et donne des sources qu'on a »). Le badge ne qualifiait
         QUE le pricing, mais placé seul en tête de carte il se lisait comme un verdict sur tout ce
         qu'elle affiche, TAUX DIRECTEUR COMPRIS — or ce chiffre-là n'est pas une estimation. Il dit
         maintenant ce qu'il qualifie (« pricing modélisé »), et la provenance du taux est écrite en
         toutes lettres en pied de carte, avec sa date. Ce qui ne change pas, parce que c'est la
         raison d'être de ce badge depuis l'incident du 29/08 : une carte sans pricing de marché ne
         doit JAMAIS pouvoir se lire comme un pricing de marché. */
      + (b.source && b.source !== 'market'
          ? '<span class="rtc-src rtc-src--est" title="Pricing de marché indisponible pour cette banque chez notre fournisseur' + (b.panne ? ' (' + b.panne + ')' : '') + ' : les probabilités de réunion viennent du modèle du desk. Le taux directeur, lui, est celui de la dernière décision publiée — sa source est écrite en pied de carte.">pricing modélisé</span>'
          : '<span class="rtc-src" title="Probabilités implicites de marché (OIS/futures), fournisseur rateprobability' + (b.srcAt ? ', dernière donnée reçue à ' + new Date(b.srcAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '') + '.">pricing marché</span>')
      + '</div>'
      + '<div class="rtc-metrics">'
      + '<div class="rtc-m"><span class="rtc-k">Prochain mouvement</span><span class="rtc-v ' + mv.cls + '">' + mv.txt + '</span>' + mspk(mvSpk) + '</div>'
      + '<div class="rtc-m"><span class="rtc-k">Probabilité</span><span class="rtc-v rtc-prob">' + pct(_prob) + '</span>' + mspk('wavy') + '</div>'
      + '<div class="rtc-m"><span class="rtc-k">Δ attendu</span><span class="rtc-v ' + expCls + '">' + bps(b.expBps) + '</span>' + mspk(expSpk) + '</div>'
      /* ⚠️ « TAUX ACTUEL » NE DIT PAS DE QUEL TAUX IL S'AGIT — ET POUR LA BCE, IL Y EN A DEUX (10/09).
         La BCE publie le MÊME JOUR la facilité de dépôt et le taux de refinancement principal,
         séparés de 15 points de base depuis la réforme du corridor de septembre 2024. La carte
         affiche DÉLIBÉRÉMENT la facilité de dépôt (décision du 01/09, cf. _calendrierEcritTaux) :
         c'est le taux directeur effectif que le marché price depuis 2014. Mais un intitulé nu
         (« Taux actuel : 2,5000% ») laisse le lecteur qui a en tête le refi (2,65 %) croire à une
         erreur — c'est arrivé, et c'est ce qui a motivé cette ligne. Nommer la MESURE coûte trois
         mots et ferme le doute pour de bon.
         ⚠️ Table par banque, PAS un cas particulier BCE : la Fed publie une fourchette, la BoJ un
         taux directeur au jour le jour. Une table se complète ; un `if (code === 'ECB')` se serait
         retrouvé seul face à la prochaine question du même genre. */
      + '<div class="rtc-m"><span class="rtc-k"'
      + (_RTC_MESURE_AIDE[b.code] ? ' title="' + _RTC_MESURE_AIDE[b.code].replace(/"/g, '&quot;') + '"' : '')
      + '>' + (_RTC_MESURE[b.code] || 'Taux actuel') + '</span><span class="rtc-v w">' + num(b.rate, 4) + '%</span></div>'
      /* ⚠️ « DATE DE RÉUNION » NE DISAIT PAS LAQUELLE (11/09, demande user : « on a les dates réu
         futures, ajoute aussi la dernière qui est passée, pour toutes les banques »). La carte ne
         montrait que la PROCHAINE : on savait quand la question serait reposée, jamais quand elle
         avait été tranchée. Or le taux juste au-dessus SORT de cette réunion passée : sans sa date,
         impossible de savoir s'il date d'une semaine ou de quatre mois, donc à quel point la
         prochaine décision est chargée. Les deux dates se lisent ensemble ou ne se lisent pas.
         L'intitulé devient explicite des deux côtés : « Prochaine réunion » / « Dernière réunion ».
         ⚠️ ON DIT QUAND, PAS CE QUI A ÉTÉ DÉCIDÉ. La provenance du taux est déjà écrite en pied de
         carte (`rateSrc`) ; accoler un verdict à cette date reviendrait à affirmer qu'on a lu le
         communiqué de cette réunion précise, ce qui n'est pas garanti pour les huit banques.
         ⚠️ ET L'ANCIENNETÉ EST DANS L'INFOBULLE, PAS SUR LA LIGNE : la carte est dense, et « il y a
         83 jours » est un complément, pas la donnée. */
      + '<div class="rtc-m"><span class="rtc-k">Prochaine réunion</span><span class="rtc-v w">' + (b.next ? fr(b.next) : '&mdash;') + '</span></div>'
      + '<div class="rtc-m"><span class="rtc-k" title="La réunion d\'où sort le taux directeur affiché ci-dessus. Sa provenance exacte est indiquée en pied de carte.">Dernière réunion</span><span class="rtc-v w"'
      + (b.lastDays != null ? ' title="il y a ' + b.lastDays + ' jour' + (b.lastDays > 1 ? 's' : '') + '"' : '')
      + '>' + (b.last ? fr(b.last) : '&mdash;') + '</span></div>'
      + '</div>'
      + '<div class="rtc-dist"><div class="rtc-dist-h">Distribution des scénarios</div>' + scRows
      + '<div class="rtc-axis"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div></div>'
      // Tableau dans une zone SCROLLABLE (en-tête collant) → lisible ET complet. Il occupe TOUTE la
      // hauteur restante depuis le retrait de la trajectoire implicite (04/08, jugée inutile) : ses
      // lignes se répartissent l'espace au lieu de laisser un vide en bas — même parti que la table
      // de saisonnalité, qui remplit son panneau de la même façon.
      + '<div class="rtc-tblwrap custom-scrollbar"><table class="rtc-tbl"><thead><tr><th>Date de réunion</th><th>Jours</th><th>Baisse (%)</th><th>Maintien (%)</th><th>Hausse (%)</th><th>Δ implicite (BPS)</th><th>Scénario central</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '</div>';
  }

  

  function activateView(view, { persist = true } = {}) {
    if (_tauxPoll) { clearInterval(_tauxPoll); _tauxPoll = null; }   // stoppe le rafraîchissement TAUX dès qu'on quitte l'onglet
    // MON DESK : démonter les widgets (roots amCharts + timers) à CHAQUE sortie, AVANT tout return
    // anticipé — sinon la branche 'markets' (mobile) les laisserait montés et fuir (revue adversariale).
    if (window.DTPWidgets) window.DTPWidgets.close();
    // MARCHÉS (mobile uniquement) : on bascule sur la colonne de droite (horloges, RISK, STRENGTH, COT…)
    if (view === 'markets') {
      document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('nav-item--active', x.dataset.view === 'markets'));
      // Retirer les etats plein-largeur herites d'un onglet precedent (TAUX/BANQUES/SEMAINE/journal...)
      // sinon .hide-right-panel/#panel-right (display:none !important) annule le reveal -> ecran VIDE.
      const _ml = document.getElementById('main-layout');
      _ml?.classList.remove('hide-right-panel', 'is-fxlist');
      _ml?.classList.add('show-right-mobile');
      _setDocTitle('markets');
      // Les graphiques (amCharts) ont pu être initialisés masqués → on force un recalcul à l'affichage
      setTimeout(() => { try { window.dispatchEvent(new Event('resize')); } catch {} }, 120);
      if (persist) { try { localStorage.setItem('dtp_active_view', 'markets'); } catch {} }
      return;   // on ne touche pas aux view-panel
    }
    if (!VALID_VIEWS.includes(view)) view = 'news';
    // MON DESK est réservé à l'ADMIN. Garde de routage (pas seulement l'onglet) : bloque toute
    // activation pour un non-admin — restauration d'un dtp_active_view='widgets' laissé par une
    // session admin sur le même navigateur, OU appel programmatique. Sinon le client verrait le
    // panneau bêta + perdrait sa colonne droite (revue adversariale, défaut majeur confirmé).
    if (view === 'widgets' && !window._pdMonDesk) view = 'news';   // _pdMonDesk = admin OU drapeau leve
    // SEMAINE À VENIR : désormais PUBLIC (plus de redirection des clients vers 'news').
    _setDocTitle(view);
    document.getElementById('main-layout')?.classList.remove('show-right-mobile');   // revient au flux

    document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('nav-item--active', x.dataset.view === view));
    document.querySelectorAll('.view-panel').forEach(p => p.classList.toggle('hidden', p.id !== `view-${view}`));

    // BANK : pleine largeur → on masque la colonne de droite (table seule).
    // FX LIST : côte à côte avec le panneau droit (World Clock/Mètre) comme DataTradingPro SUR GRAND
    //   ÉCRAN ; en dessous (~1600px) le CSS `.is-fxlist` repasse la table en pleine largeur (lisible).
    const _ml = document.getElementById('main-layout');
    _ml?.classList.toggle('hide-right-panel', view === 'bank' || view === 'weekahead' || view === 'taux' || view === 'symbol' || view === 'journal' || view === 'calculator' || view === 'widgets');   // pleine largeur
    document.getElementById('journal-btn')?.classList.toggle('topbar-icon--active', view === 'journal');   // état actif du bouton topbar Journal
    // ICÔNE MON DESK : état actif RÉTABLI (demande user 04/08). La consigne précédente — « qu'elle
    // reste comme les 2 autres » — partait d'une prémisse fausse : Journal et Calculatrice
    // s'allument bel et bien (lignes voisines). Les trois se comportent donc pareil.
    document.getElementById('widgets-btn')?.classList.toggle('topbar-icon--active', view === 'widgets');
    document.getElementById('calc-btn')?.classList.toggle('topbar-icon--active', view === 'calculator');   // état actif du bouton topbar Calculatrice
    _ml?.classList.toggle('is-fxlist', view === 'fxlist');
    /* ══ UN OUTIL PLEIN ÉCRAN NE GARDE PAS LA BARRE D'ONGLETS DU DESK (04/09, demande utilisateur,
       deux captures : le Journal, puis la Calculatrice) ══════════════════════════════════════════
       « Quand je suis dans le journal, le panneau à onglets n'est pas le mien, c'est celui du layout
        par défaut alors que j'utilise le template JOT. Corrige ça, ou sinon carrément masquer le
        panneau à onglets et afficher en grand le journal de trading. » Puis : « pareil pour la
        calculatrice ».
       CE QUE MONTRAIT LA CAPTURE, ET POURQUOI CE N'ÉTAIT PAS UNE ERREUR DE MODÈLE. La rangée
       « ACTUS · CALENDRIER · LISTE FX … » n'est PAS la barre des modèles de Mon Desk : c'est
       `#topbar-nav`, la navigation du desk classique, masquée en mode Mon Desk et rétablie dès
       qu'on en sort. Elle ne pouvait donc jamais porter les onglets du modèle JOT — elle appartient
       à un autre écran. C'est bien ce que l'utilisateur lisait : une barre qui n'est pas la sienne.
       ON RETIENT DONC SA SECONDE PROPOSITION, qui est aussi la plus juste : le Journal et la
       Calculatrice sont des OUTILS, pas des vues du desk. Ils prennent toute la hauteur, sans une
       rangée d'onglets qui ne mène qu'ailleurs — les trois icônes de la barre du haut restent le
       chemin de retour, et elles ne bougent pas. */
    document.body.classList.toggle('dtp-outil-plein', view === 'journal' || view === 'calculator');
    if (view === 'bias') {
      const strengthTab = document.querySelector('.right-tab[data-rtab="strength"]');
      if (strengthTab && !strengthTab.classList.contains('right-tab--active')) strengthTab.click();
    }

    if (view === 'bias' && typeof loadBiasView === 'function') {
      loadBiasView();
    }
    if (view === 'bank' && typeof loadBankView === 'function') {
      loadBankView();
    }
    if (view === 'calendar') buildCalendar();
    if (view === 'fxlist' && typeof loadFxListView === 'function') {
      if (!window._fxlistTabInited) { window._fxlistTabInited = true; initFxListTab(); }
      loadFxListView();
    }
    if (view === 'institution' && typeof loadInstitutionView === 'function') {
      if (!window._institutionTabInited) { window._institutionTabInited = true; loadInstitutionView(); }
      else renderBrList();
    }
    if (view === 'analyst' && typeof loadAnalystView === 'function') {
      if (!window._analystTabInited) { window._analystTabInited = true; initAnalystTab(); }
      loadAnalystView();
    }
    if (view === 'weekahead' && typeof loadWeekAheadView === 'function') {
      loadWeekAheadView();
      // La vue vient d'être RÉVÉLÉE : on rejauge les cartes qui ont pu être rendues à l'aveugle
      // (re-poll à 12 s pendant que l'utilisateur était ailleurs). Même raison que le montage
      // amCharts après le toggle .hidden : dans un conteneur caché, tout se mesure à zéro.
      if (window._waJauger) requestAnimationFrame(window._waJauger);
    }
    if (view === 'taux') { loadTauxView(); _tauxPoll = setInterval(_tauxTick, 30000); }   // TAUX : rafraîchi en TEMPS RÉEL (~30 s) tant que l'onglet est ouvert (re-render uniquement si les cotations ont changé)
    if (view === 'journal' && typeof window.loadJournalView === 'function') window.loadJournalView();
    if (view === 'calculator' && typeof window.loadCalculatorView === 'function') window.loadCalculatorView();
    if (view === 'symbol' && window.loadSymbolView) window.loadSymbolView();
    // MON DESK : monter APRÈS le toggle .hidden (amCharts mesure 0×0 dans un conteneur caché).
    // Le DÉMONTAGE est fait en TÊTE de fonction (couvre aussi le return anticipé 'markets').
    if (view === 'widgets' && window.DTPWidgets) window.DTPWidgets.open();

    // Mémoriser l'onglet actif pour le rouvrir au prochain retour.
    // 'symbol' = vue paire TRANSITOIRE (la paire est volatile) → jamais persistée, sinon au reload on
    // restaure une vue symbole sans paire = 4 panneaux vides. On garde donc la dernière vraie vue.
    if (persist && view !== 'symbol') {
      try { localStorage.setItem('dtp_active_view', view); } catch {}
      // + sur le COMPTE : la vue de travail suit l'utilisateur d'un appareil à l'autre. 'widgets'
      // est EXCLU — Mon Desk ne doit jamais se rouvrir tout seul (cf. verrou de restauration).
      try { if (view !== 'widgets') DTPPref.set('view', view); } catch (e) {}
    }
  }
  // Exposé globalement au cas où d'autres modules veulent changer de vue
  window.activateView = activateView;
  // VUES ADOPTABLES par Mon Desk (widgets « vue du desk », demande user 03/08 : les onglets de la nav
  // dans la Vue générale). Les chargeurs sont LOCAUX à cette IIFE : sans cet export, widgets.js ne
  // peut pas les appeler. Chaque entrée reproduit EXACTEMENT ce que fait activateView pour sa vue
  // (init one-shot + chargement) ; 'taux' rend une fonction d'arrêt (son poll 30 s meurt avec la carte).
  window._dtpVueLoaders = {
    fxlist: function () {
      if (typeof loadFxListView !== 'function') return;
      if (!window._fxlistTabInited && typeof initFxListTab === 'function') { window._fxlistTabInited = true; initFxListTab(); }
      loadFxListView();
    },
    institution: function () {
      if (typeof loadInstitutionView !== 'function') return;
      if (!window._institutionTabInited) { window._institutionTabInited = true; loadInstitutionView(); }
      else if (typeof renderBrList === 'function') renderBrList();
    },
    analyst: function () {
      if (typeof loadAnalystView !== 'function') return;
      if (!window._analystTabInited && typeof initAnalystTab === 'function') { window._analystTabInited = true; initAnalystTab(); }
      loadAnalystView();
    },
    weekahead: function () {
      if (typeof loadWeekAheadView !== 'function') return;
      loadWeekAheadView();
      // Carte à onglets de Mon Desk : un onglet inactif est en display:none, donc tout s'y mesure
      // à zéro. On rejauge au moment où la carte devient visible.
      if (window._waJauger) requestAnimationFrame(window._waJauger);
    },
    taux: function () {
      loadTauxView();
      var iv = setInterval(function () { try { loadTauxView(); } catch (e) {} }, 30000);
      return function () { clearInterval(iv); };
    },
    bias: function () { if (typeof loadBiasView === 'function') loadBiasView(); },
    bank: function () { if (typeof loadBankView === 'function') loadBankView(); },
  };

  document.getElementById('topbar-nav')?.addEventListener('click', e => {
    const a = e.target.closest('[data-view]');
    if (!a) return;
    e.preventDefault();
    activateView(a.dataset.view);
  });

  // ── Réorganiser les onglets : appui maintenu 1,5 s puis glisser pour déplacer. Tap court = navigation normale. ──
  (function initNavReorder() {
    const nav = document.getElementById('topbar-nav');
    if (!nav) return;
    const LS = 'dtp_nav_order', HOLD = 1500;
    const tabsArr = () => [...nav.querySelectorAll('.nav-item[data-view]')].filter(t => !t.classList.contains('nav-item--mobile-only'));
    const mobileTab = () => nav.querySelector('.nav-item--mobile-only');
    try {
      // Ordre des onglets : cache local d'abord (instantané), COMPTE en relais quand le navigateur
      // ne sait rien — la barre réordonnée suit l'utilisateur d'un appareil à l'autre (12/08).
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) {}
      if (!Array.isArray(saved) || !saved.length) {
        const brut = DTPPref.get('navorder', '');
        if (brut) saved = String(brut).split(',').filter(Boolean);
      }
      if (Array.isArray(saved) && saved.length) {
        const mob = mobileTab();
        saved.forEach(v => { const el = nav.querySelector('.nav-item[data-view="' + v + '"]'); if (el) { mob ? nav.insertBefore(el, mob) : nav.appendChild(el); } });
      }
    } catch {}
    const saveOrder = () => {
      const ordre = tabsArr().map(t => t.dataset.view);
      try { localStorage.setItem(LS, JSON.stringify(ordre)); } catch (e) {}
      // Stocké en liste séparée par des virgules : le magasin de préférences ne prend que des
      // chaînes courtes, et cette forme reste lisible côté serveur.
      try { DTPPref.set('navorder', ordre.join(',')); } catch (e) {}
    };
    let timer = null, dragging = null, active = false, sx = 0, sy = 0;
    const cancelArm = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const afterEl = x => {
      let best = null, bestOff = -Infinity;
      tabsArr().filter(t => t !== dragging).forEach(t => {
        const b = t.getBoundingClientRect(); const off = x - b.left - b.width / 2;
        if (off < 0 && off > bestOff) { bestOff = off; best = t; }
      });
      return best;
    };
    nav.addEventListener('pointerdown', e => {
      if (e.button) return;                                       // clic principal uniquement
      const item = e.target.closest('.nav-item[data-view]');
      if (!item || item.classList.contains('nav-item--mobile-only')) return;
      sx = e.clientX; sy = e.clientY;
      cancelArm();
      timer = setTimeout(() => {                                  // 1,5 s d'appui → on « prend » l'onglet
        active = true; dragging = item;
        item.classList.add('nav-item--dragging'); nav.classList.add('nav-reordering');
        try { item.setPointerCapture(e.pointerId); } catch {}
      }, HOLD);
    });
    nav.addEventListener('pointermove', e => {
      if (!active) { if (timer && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) cancelArm(); return; }   // bougé avant 1,5 s → simple clic/scroll
      e.preventDefault();
      const after = afterEl(e.clientX), mob = mobileTab();
      if (after) nav.insertBefore(dragging, after);
      else if (mob) nav.insertBefore(dragging, mob);
      else nav.appendChild(dragging);
    });
    const end = () => {
      cancelArm();
      if (active && dragging) { saveOrder(); window._navDragEndedAt = Date.now(); }
      if (dragging) dragging.classList.remove('nav-item--dragging');
      nav.classList.remove('nav-reordering');
      dragging = null; active = false;
    };
    nav.addEventListener('pointerup', end);
    nav.addEventListener('pointercancel', end);
    /* ⚠️ AU DOIGT, `preventDefault()` SUR `pointermove` NE SUFFIT PAS (29/08, mesuré). L'appui long
       arme bien l'onglet — la classe `nav-item--dragging` est posée — puis le navigateur reprend le
       geste au premier glissement et l'onglet ne bouge plus : les événements de pointeur issus du
       tactile sont émis APRÈS que le geste a été attribué au défilement, et les annuler là n'annule
       rien. Seul un `touchmove` NON PASSIF peut encore le refuser.
       Et on ne le refuse QUE pendant un déplacement armé : `touch-action: none` sur les onglets
       marcherait aussi, mais il empêcherait la barre de défiler horizontalement — or elle en a
       besoin, elle porte neuf onglets sur un écran de téléphone. */
    nav.addEventListener('touchmove', e => { if (active) e.preventDefault(); }, { passive: false });
    // Le clic qui suit immédiatement un déplacement ne doit PAS changer d'onglet.
    nav.addEventListener('click', e => { if (window._navDragEndedAt && Date.now() - window._navDragEndedAt < 300) { e.stopPropagation(); e.preventDefault(); window._navDragEndedAt = 0; } }, true);
  })();

  // ── Restaurer le dernier onglet visité (vue + sous-onglet du panneau droit) ──
  // Le cache local sert de source immédiate ; le COMPTE prend le relais quand le navigateur ne sait
  // rien (nouvel appareil, cache vidé). Toutes les sécurités ci-dessous s'appliquent aux DEUX
  // sources — en particulier le verrou 'widgets', qui ne doit jamais s'ouvrir tout seul.
  let _savedView = 'news';
  try { _savedView = localStorage.getItem('dtp_active_view') || DTPPref.get('view', '') || 'news'; } catch {}
  // 'markets' n'a de sens que sur mobile (sinon retour au flux)
  if (_savedView === 'markets' && window.innerWidth > 768) _savedView = 'news';
  if (_savedView === 'symbol') _savedView = 'news';   // sécurité : ancienne valeur 'symbol' en cache → pas de paire au reload
  // MON DESK ne s'AUTO-RESTAURE JAMAIS ici : localStorage est par-navigateur (pas par-compte) et
  // _pdIsAdmin n'est pas encore résolu à ce stade. Un dtp_active_view='widgets' laissé par une session
  // admin exposerait sinon le panneau bêta à un client sur le même navigateur (revue adversariale).
  // Pour un VRAI admin, c'est widgets.js boot() (qui attend _pdIsAdmin) qui rouvre Mon Desk au reload.
  if (_savedView === 'widgets') _savedView = 'news';
  if (_savedView !== 'news') {
    activateView(_savedView, { persist: false });   // 'news' est déjà actif par défaut dans le HTML
  }
  // Restaurer le sous-onglet du panneau droit (WORLD/RISK/STRENGTH/METER/COT/DMX)
  try {
    const _rtab = localStorage.getItem('dtp_active_rtab') || DTPPref.get('rtab', '');
    if (_rtab && _rtab !== 'world' && _savedView !== 'bias') {
      document.querySelector(`.right-tab[data-rtab="${_rtab}"]`)?.click();
    }
  } catch {}

  // (Listener d unite de temps SUPPRIME le 15/08/2026 avec la sidebar de prix simulés : il etait
  //  branche sur .bias-tf-group, absent de toutes les pages, et appelait rebuildStockChart, elle
  //  aussi supprimee. Le laisser aurait mis un appel vers une fonction inexistante dans le code.
  //  Les unites de temps du widget Graphique passent par son propre reglage, pas par ce chemin.)

  // Wire up COT type buttons and DMX timeframe buttons
  initCOTTabs();
  initDMXTabs();

  // MONDE : ne construire la carte QUE si son panneau est réellement actif au chargement. Avant, on la
  // construisait TOUJOURS ici — donc CACHÉE (0×0) quand le sous-onglet mémorisé était un autre (Force,
  // Risque…) → cadrage cassé → panneau « Monde » vide au clic. Désormais : init immédiate si visible,
  // sinon LAZY (le clic sur MONDE la construit visible, via initRightTab). Bonus : chargement plus léger.
  if (document.getElementById('rtab-world')?.classList.contains('active')) initRightTab('world');
});

// ─── FX LIST : Overview table ─────────────────────────────────────────────────
const FXL_COLS = [
  { key: 'symbol',    label: 'Symbole',    sortable: true,  align: 'left',   type: 'sym'     },
  { key: 'sparkLast', label: 'Dernier prix', sortable: false, align: 'center', type: 'price'   },
  { key: 'changePct', label: 'Var. %',     sortable: true,  align: 'right',  type: 'change'  },
  { key: 'seasonal',  label: 'Saisonnalité', sortable: false, align: 'center', type: 'season'  },
  { key: 'dmx',       label: 'DMX',        sortable: true,  align: 'center', type: 'donut'   },
  { key: 'fund',      label: 'Fund.',      sortable: true,  align: 'center', type: 'badge'   },
  { key: 'research',  label: 'Recherche',  sortable: true,  align: 'center', type: 'badge'   },
  { key: 'bias',      label: 'Biais',      sortable: true,  align: 'center', type: 'badge'   },
  { key: 'ret1M',     label: '1M %',       sortable: true,  align: 'right',  type: 'pct', heat: true },
  { key: 'ret3M',     label: '3M %',       sortable: true,  align: 'right',  type: 'pct', heat: true },
  { key: 'ret12M',    label: '12M %',      sortable: true,  align: 'right',  type: 'pct', heat: true },
  { key: 'trend',     label: 'Tendance',   sortable: false, align: 'center', type: 'trend'   },
  { key: 'strength',  label: 'Force',      sortable: true,  align: 'center', type: 'str'     },
];
const _SIG_RANK = { Bullish: 1, Neutral: 0, Bearish: -1 };
let _fxlData = null;
let _fxlSort = { key: 'symbol', dir: 1 };
let _fxlLoading = false;

// Points (x,y) d'une série dans une boîte w×h (marge verticale 1px) : base commune des sparklines
function _fxlSparkPts(vals, w, h) {
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1, pad = 1, ih = h - 2 * pad, stepX = w / (vals.length - 1);
  return vals.map((v, i) => [ +(i * stepX).toFixed(1), +(pad + ih - ((v - min) / range) * ih).toFixed(1) ]);
}

// LAST PRICE : ligne blanche, dernier segment coloré selon le sens du dernier tick (vert/rouge fluo)
function _fxlPriceSpark(arr, w = 78, h = 14) {
  const vals = (arr || []).filter(v => v != null);
  if (vals.length < 2) return '';
  const pts = _fxlSparkPts(vals, w, h);
  const a = vals[vals.length - 2], b = vals[vals.length - 1];
  const tick = b > a ? '#00e676' : b < a ? '#ff3d00' : '#e8eaed';
  return `<svg class="fxl-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">`
    + `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="#cfd3da" stroke-width="1"/>`
    + `<polyline points="${pts.slice(-2).map(p => p.join(',')).join(' ')}" fill="none" stroke="${tick}" stroke-width="1.4"/></svg>`;
}

// SEASONAL : sparkline ondulé multi-segments : chaque segment coloré selon sa pente (turquoise / rouge)
function _fxlSeasonSpark(arr, w = 78, h = 14) {
  const vals = (arr || []).filter(v => v != null);
  if (vals.length < 2) return '';
  const pts = _fxlSparkPts(vals, w, h);
  let segs = '';
  for (let i = 1; i < pts.length; i++) {
    const up = vals[i] >= vals[i - 1];
    segs += `<line x1="${pts[i-1][0]}" y1="${pts[i-1][1]}" x2="${pts[i][0]}" y2="${pts[i][1]}" stroke="${up ? '#00cc99' : '#ff3d00'}" stroke-width="1"/>`;
  }
  return `<svg class="fxl-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${segs}</svg>`;
}

// TREND : micro-ligne fine mono, couleur selon la direction macro
function _fxlTrendSpark(arr, w = 78, h = 14) {
  const vals = (arr || []).filter(v => v != null);
  if (vals.length < 2) return '';
  const pts = _fxlSparkPts(vals, w, h);
  const up = vals[vals.length - 1] >= vals[0];
  return `<svg class="fxl-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${up ? '#00cc99' : '#ff3d00'}" stroke-width="1"/></svg>`;
}

// PATTERN : micro-matrice de 5 carrés : allumés (blanc) selon les hausses récentes, sinon éteints
function _fxlPattern(arr) {
  const vals = (arr || []).filter(v => v != null);
  if (vals.length < 2) return '<span class="fxl-pat"></span>';
  const n = 5, step = (vals.length - 1) / n, s = [];
  for (let i = 0; i <= n; i++) s.push(vals[Math.round(i * step)]);
  let sq = '';
  for (let i = 1; i <= n; i++) sq += `<i class="fxl-pat-sq${s[i] > s[i-1] ? ' on' : ''}"></i>`;
  return `<span class="fxl-pat">${sq}</span>`;
}

// CHANGE % : texte simple (N/A gris foncé si absent, sinon coloré sans fond)
function _fxlChangeCell(v) {
  if (v == null) return '<span class="fxl-na">N/A</span>';
  return `<span class="fxl-chg fxl-chg--${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : ''}${v.toFixed(2)}%</span>`;
}

// Heatmap Cell (1M/3M/12M) : fond plein vert/rouge à OPACITÉ ∝ |%|, texte turquoise/rouge
function _fxlPctCell(v) {
  if (v == null) return '<span class="fxl-pct fxl-na">N/A</span>';
  const cls = v >= 0 ? 'pos' : 'neg';
  const rgb = v >= 0 ? '0,230,118' : '255,61,0';
  const a = Math.max(0.12, Math.min(0.52, Math.abs(v) / 12 * 0.5 + 0.12));
  return `<span class="fxl-pct fxl-pct--${cls}" style="background:rgba(${rgb},${a.toFixed(3)})">${v >= 0 ? '+' : ''}${v.toFixed(2)}%</span>`;
}

// STRENGTH : vumètre horizontal ultra-fin (2px), remplissage vers la droite, turquoise/fuchsia
function _fxlStrengthCell(v, maxAbs) {
  const mag = maxAbs > 0 ? Math.min(100, Math.abs(v) / maxAbs * 100) : 0;
  const cls = v >= 0 ? 'pos' : 'neg';
  return `<div class="fxl-str" title="${v >= 0 ? '+' : ''}${v.toFixed(2)}"><div class="fxl-str-track"><div class="fxl-str-bar fxl-str-bar--${cls}" style="width:${mag.toFixed(0)}%"></div></div></div>`;
}

function _fxlFlag(ccy) {
  const iso = (typeof _CURR_ISO !== 'undefined') ? _CURR_ISO[ccy] : null;
  if (!iso) return '<span class="fxl-flag fxl-flag--ph"></span>';
  return `<img src="https://flagcdn.com/w40/${iso}.png" alt="${ccy}" class="fxl-flag" loading="lazy">`;
}

// DMX : donut radial bicolore segmenté : part verte = flux haussiers, reste rouge (couleurs la référence exactes)
function _fxlDonut(pct) {
  const v = Math.max(0, Math.min(100, pct ?? 50));
  const r = 7, c = 2 * Math.PI * r, bull = (c * v / 100).toFixed(2);
  return `<svg class="fxl-dmx" width="20" height="20" viewBox="0 0 20 20">`
    + `<circle cx="10" cy="10" r="${r}" fill="none" stroke="rgb(255, 61, 0)" stroke-width="4"/>`
    + `<circle cx="10" cy="10" r="${r}" fill="none" stroke="rgb(0, 230, 118)" stroke-width="4" stroke-dasharray="${bull} ${c.toFixed(2)}" transform="rotate(-90 10 10)"/>`
    + `</svg>`;
}

// Libellés FR du badge FX (affichage UNIQUEMENT : la comparaison `=== 'Bullish'` et la classe restent EN).
const FXL_BADGE_FR = { Bullish: 'Haussier', Bearish: 'Baissier', Neutral: 'Neutre' };
function _fxlBadge(label) {
  // Donnée MANQUANTE ≠ « Neutre » : un champ absent/null s'affiche « — » (audit 16/07 — le défaut
  // silencieux « Neutre » rendait un payload incomplet indétectable, d'où le « tout Neutre »).
  if (label == null || label === '') return '<span class="fxl-badge fxl-badge--na">-</span>';
  const cls = label === 'Bullish' ? 'bull' : label === 'Bearish' ? 'bear' : 'neut';
  return `<span class="fxl-badge fxl-badge--${cls}">${FXL_BADGE_FR[label] || label}</span>`;
}

function _fxlCell(col, p, maxAbsStr) {
  switch (col.type) {
    case 'sym':     return `<div class="fxl-sym">${_fxlFlag(p.base)}<span class="fxl-sym-txt">${p.symbol}</span></div>`;
    case 'price':   return `<div class="fxl-last">${_fxlPriceSpark(p.sparkLast)}</div>`;
    case 'season':  return _fxlSeasonSpark(p.seasonal);
    case 'trend':   return _fxlTrendSpark(p.trend);
    case 'pattern': return _fxlPattern(p.pattern);
    case 'donut':   return _fxlDonut(p.dmx);
    case 'badge':   return _fxlBadge(p[col.key]);
    case 'change':  return _fxlChangeCell(p.changePct);
    case 'pct':     return _fxlPctCell(p[col.key]);
    case 'str':     return _fxlStrengthCell(p[col.key], maxAbsStr);
    default:        return '';
  }
}

/* ── LISTE FX : COLONNES MASQUABLES (01/09/2026, demande user) ────────────────────────────────
   « ajoute un icone reglages pour pouvoir masquer une colonne ou l afficher comme on le souhaite ».
   Treize colonnes tiennent dans ce tableau ; personne ne les lit toutes. Le reglage recopie mot pour
   mot celui du calendrier (DTPPref, donc par COMPTE et retrouve sur un autre appareil) plutot que
   d inventer une seconde grammaire — meme icone, meme volet, memes interrupteurs.
   ⚠️ TROIS PIEGES, tous vus au banc :
   1. « Symbole » N EST PAS masquable. Sans elle, on lit treize chiffres sans savoir de quelle paire
      il s agit — et surtout le tableau ne peut plus jamais devenir vide, ce qui evite tout garde-fou
      « au moins une colonne » et l etat impossible qui va avec.
   2. Le tri peut porter sur une colonne qu on vient de masquer : la table se reordonnerait selon une
      donnee INVISIBLE. On retombe alors sur « Symbole », qui est toujours la.
   3. renderFxList dessine les colonnes a TROIS endroits (en-tete, squelette de chargement, corps).
      En filtrer deux sur trois decale les cellules d une colonne — c est exactement ce que le banc
      verifie, en comptant les <th> et les <td> d une meme ligne. */
function _fxlColVisible(k) {
  if (k === 'symbol') return true;                                   // piege 1 : jamais masquable
  try { return window.DTPPref ? DTPPref.get('fxlcol' + k, '1') !== '0' : true; } catch (e) { return true; }
}
function _fxlColsVisibles() { return FXL_COLS.filter(c => _fxlColVisible(c.key)); }
function _fxlColSet(k, on) {
  if (k === 'symbol') return;
  try { if (window.DTPPref) DTPPref.set('fxlcol' + k, on ? '1' : '0'); } catch (e) {}
  // Piege 2 : on triait sur cette colonne, elle disparait → retour au tri par symbole.
  if (!on && _fxlSort.key === k) {
    _fxlSort = { key: 'symbol', dir: 1 };
    try { if (window.DTPPref) DTPPref.set('fxlsort', 'symbol:1'); } catch (e) {}
  }
  try { renderFxList(); } catch (e) {}
  try { _fxlMajReglages(); } catch (e) {}
}
window._fxlColSet = _fxlColSet;
function _fxlMajReglages() {
  const b = document.getElementById('fxl-set-pop');
  if (!b) return;
  const l = (c) => {
    const on = _fxlColVisible(c.key);
    return '<label class="cal-set-row"><span>' + c.label + '</span>'
      + '<button class="cal-set-sw' + (on ? ' on' : '') + '" role="switch" aria-checked="' + on + '"'
      + ' onclick="_fxlColSet(\'' + c.key + '\', ' + (!on) + ')"><i></i></button></label>';
  };
  b.innerHTML = '<div class="cal-set-t">Colonnes affichées</div>'
    + FXL_COLS.filter(c => c.key !== 'symbol').map(l).join('');
}
window._fxlToggleReglages = function () {
  const b = document.getElementById('fxl-set-pop');
  if (!b) return;
  if (!b.hasAttribute('hidden')) { b.setAttribute('hidden', ''); return; }
  _fxlMajReglages(); b.removeAttribute('hidden');
};

function renderFxList() {
  const head = document.getElementById('fxl-head');
  const body = document.getElementById('fxl-body');
  if (!head || !body) return;

  const _cols = _fxlColsVisibles();
  head.innerHTML = _cols.map(c => {
    const active = _fxlSort.key === c.key;
    // Flèche de tri : UNIQUEMENT sur la colonne triée (▲/▼). Le chevron double de repos (U+21C5, le
    // glyphe n'est pas réécrit ici : le banc colonnes-verif refuse sa présence dans cette fonction,
    // commentaires compris) se posait sur SYMBOLE et FORCE (02/09, « cache cette icône ») : deux gris
    // permanents dans un bandeau déjà dense, qui ne disaient rien de l'état du tableau — le tri
    // actif, lui, se lit d'un coup d'œil. Les colonnes restent TOUTES triables au clic
    // (`fxl-th--sortable` + `data-sort` inchangés) ; elles trient simplement en silence.
    const arrow = active ? `<span class="fxl-sort active">${_fxlSort.dir > 0 ? '▲' : '▼'}</span>` : '';
    return `<th class="fxl-th fxl-th--${c.align} ${c.sortable ? 'fxl-th--sortable' : ''}" ${c.sortable ? `data-sort="${c.key}"` : ''}>${c.label}${arrow}</th>`;
  }).join('');

  const _loader = document.getElementById('fxl-loader');
  if (!_fxlData) {
    if (_fxlLoading) {
      // Squelette shimmer qui epouse les 14 colonnes -> perception de vitesse (remplace le spinner centre).
      // Auto-efface : le rendu des donnees plus bas reecrit body.innerHTML ; echec -> branche "Aucune donnee".
      if (_loader) _loader.style.display = 'none';
      body.innerHTML = Array.from({ length: 12 }).map(() =>
        '<tr class="fxl-row fxl-skel-row" aria-hidden="true">' +
        _cols.map(c => `<td class="fxl-td fxl-td--${c.align}"><span class="dtp-skel"></span></td>`).join('') +
        '</tr>'
      ).join('');
    } else {
      body.innerHTML = '';
      if (_loader) { _loader.innerHTML = '<div class="fxl-msg">Aucune donnée</div>'; _loader.style.display = 'flex'; }
    }
    return;
  }
  /* PAYLOAD SANS `pairs` : LA PANNE MUETTE (01/09). `_fxlData` peut être un objet VALIDE sans
     tableau `pairs` — une réponse d'erreur applicative, un payload tronqué. `_fxlData.pairs.slice()`
     levait alors une TypeError APRÈS l'écriture de l'en-tête : la barre de colonnes se redessinait,
     le corps restait figé sur le squelette de chargement, et l'utilisateur voyait un tableau en
     attente éternelle. Rien en console de son côté, rien dans les bancs de syntaxe — c'est la forme
     exacte de l'incident du 25/08 (fil vide, aucune erreur visible). On retombe désormais sur le
     message « Aucune donnée », qui est la vérité. */
  if (!_fxlData || !Array.isArray(_fxlData.pairs)) {
    body.innerHTML = '';
    if (_loader) { _loader.innerHTML = '<div class="fxl-msg">Aucune donnée</div>'; _loader.style.display = 'flex'; }
    return;
  }
  if (_loader) _loader.style.display = 'none';

  const pairs = _fxlData.pairs.slice();
  const { key, dir } = _fxlSort;
  pairs.sort((a, b) => {
    if (key === 'symbol') return a.symbol.localeCompare(b.symbol) * dir;
    if (['fund', 'research', 'bias'].includes(key)) {
      return ((_SIG_RANK[a[key]] ?? 0) - (_SIG_RANK[b[key]] ?? 0)) * dir;
    }
    const av = a[key] == null ? -Infinity : a[key];
    const bv = b[key] == null ? -Infinity : b[key];
    return (av - bv) * dir;
  });

  const maxAbsStr = Math.max(...pairs.map(p => Math.abs(p.strength || 0)), 0.0001);

  body.innerHTML = pairs.map(p =>
    `<tr class="fxl-row">` +
    _cols.map(c => `<td class="fxl-td fxl-td--${c.align}${c.heat ? ' fxl-td--heat' : ''}">${_fxlCell(c, p, maxAbsStr)}</td>`).join('') +
    `</tr>`
  ).join('');
  if (window._dtpDataIn) window._dtpDataIn(body, 'fxl');   // fondu d'arrivee (1re fois seulement, jamais aux refresh silencieux)

  _fxlEtatFraicheur();
}

/* ══ LE TABLEAU NE PARLE DE SA FRAÎCHEUR QUE QUAND ELLE POSE PROBLÈME (04/09) ═══════════════════
   CE QU'ON A TROUVÉ EN AUDITANT « fiabilité des données et temps réel ». Le bloc qui écrivait
   « MAJ HH:MM » était MORT depuis le 04/08 : l'élément `#fxl-updated` a été retiré de la page ce
   jour-là, à la demande de l'utilisateur (« l'heure occupait le coin droit sans être consultée »),
   et le code s'est neutralisé tout seul sur son `if (upd && …)`. Le tableau ne dit donc PLUS RIEN
   de son âge — et il a des raisons d'être vieux :
     · le WEEK-END, le serveur sert délibérément la photo de vendredi et coupe le rafraîchissement
       des cotations (marché fermé). Un dimanche à 15 h, on lit des prix de vendredi 22 h sans que
       rien ne le dise ;
     · un rafraîchissement en échec laisse le tableau précédent en place, sans un mot ;
     · un conteneur réveillé sert son dernier instantané persisté, qui peut dater.
   Des prix faux ne sont pas le problème : ce sont les VRAIS prix d'un autre moment, affichés comme
   s'ils étaient d'maintenant.

   ⚠️ ON NE REMET PAS L'HORODATAGE PERMANENT : sa suppression était une bonne décision, et pour la
   bonne raison — un indicateur qu'on lit tous les jours sans jamais rien y voir cesse d'être lu,
   c'est la leçon du keep-alive vert qui ne pinguait rien. La règle retenue est donc celle que ce
   desk applique DÉJÀ au graphique de réaction : le cas ordinaire n'écrit rien, le cas anormal garde
   sa phrase. Rien à l'écran quand la donnée est fraîche ; une ligne quand elle ne l'est pas.
   ⚠️ ET C'EST LE SERVEUR QUI DIT SI LE MARCHÉ EST FERMÉ (`marcheFerme`), pas une seconde règle de
   week-end recopiée ici : deux sources de vérité divergent le jour où l'une des deux change. */
const _FXL_FRAIS_MS = 10 * 60 * 1000;   // le serveur rafraîchit les cotations toutes les 150 s et la vue interroge toutes les 90 s : au-delà de dix minutes, quelque chose ne tourne plus
function _fxlEtatFraicheur() {
  const barre = document.querySelector('.fxl-toolbar');
  if (!barre) return;
  let el = document.getElementById('fxl-etat');
  const d = _fxlData && _fxlData.updatedAt ? new Date(_fxlData.updatedAt) : null;
  const age = (d && !isNaN(d)) ? (Date.now() - d.getTime()) : null;
  const ferme = !!(_fxlData && _fxlData.marcheFerme);
  /* LE CAS ORDINAIRE : on se tait, et on retire ce qu'on avait pu dire. Sans ce retrait, la ligne
     survivrait au retour à la normale et deviendrait le mensonge inverse. */
  if (age == null || (!ferme && age < _FXL_FRAIS_MS)) { if (el) el.remove(); return; }
  const h = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  let txt;
  if (ferme) {
    /* On NOMME le jour : « 22:58 » lu un dimanche se comprend comme « ce soir ». Au-delà de trois
       jours, le nom du jour redevient ambigu (quel vendredi ?) et la date s'ajoute. */
    const j = d.toLocaleDateString('fr-FR', { weekday: 'long' });
    const loin = age > 3 * 24 * 3600e3;
    txt = 'Marché fermé · clôture de ' + j + (loin ? ' ' + d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '') + ' à ' + h;
  } else {
    const min = Math.round(age / 60000);
    const depuis = min < 90 ? min + ' min' : Math.round(min / 60) + ' h';
    txt = 'Cotations de ' + h + ', il y a ' + depuis;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = 'fxl-etat';
    el.className = 'fxl-etat';
    barre.appendChild(el);
  }
  el.classList.toggle('fxl-etat--ferme', ferme);
  if (el.textContent !== txt) el.textContent = txt;
}

async function loadFxListView(force = false, silent = false) {
  /* ON NE REMPLACE PAS DES DONNÉES PAR UN SQUELETTE — mais ce n'est PAS ce qui corrige l'attente
     signalée le 02/09, et il faut le dire ici plutôt que de laisser croire l'inverse.
     Le contrôle négatif l'a établi : en retirant `!_fxlData` de cette ligne, le banc reste VERT,
     parce que `renderFxList` garde déjà son squelette derrière un `if (!_fxlData)`. Le vrai
     correctif est le PRÉCHAUFFAGE posé dans app.js : la donnée est là avant le clic, donc plus
     personne ne voit d'écran d'attente.
     Cette garde reste parce qu'elle évite un rendu complet pour rien à chaque ouverture d'onglet
     (on a déjà le tableau, on le garde tel quel jusqu'à la réponse). C'est une économie, pas la
     réparation — un commentaire périmé mentirait avec l'autorité du code. */
  if (!silent && !_fxlData) { _fxlLoading = true; renderFxList(); }
  try {
    const r = await fetch('/api/fxlist' + (force ? '?force=1' : ''));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    _fxlData = await r.json();
  } catch (e) {
    console.warn('[fxlist] load failed', e);
  } finally {
    _fxlLoading = false;
    renderFxList();
  }
}

let _fxlAutoTimer = null;
function initFxListTab() {
  // TRI MÉMORISÉ PAR COMPTE (12/08). ⚠️ On valide contre FXL_COLS, PAS contre les [data-sort] du
  // DOM : #fxl-head est encore VIDE à cet instant (c'est renderFxList qui le remplit, plus tard), et
  // le verrou d'initialisation interdit un second essai — valider sur le DOM rejetterait la clé à
  // tous les coups, en silence.
  try {
    const _fs = window.DTPPref ? DTPPref.get('fxlsort', '') : '';
    if (_fs) {
      const [k, d] = String(_fs).split(':');
      if (FXL_COLS.some(c => c.key === k)) _fxlSort = { key: k, dir: d === '-1' ? -1 : 1 };
    }
  } catch (e) {}
  document.getElementById('fxl-head')?.addEventListener('click', e => {
    const th = e.target.closest('[data-sort]');
    if (!th) return;
    const key = th.dataset.sort;
    if (_fxlSort.key === key) _fxlSort.dir *= -1;
    else _fxlSort = { key, dir: key === 'symbol' ? 1 : -1 };
    try { if (window.DTPPref) DTPPref.set('fxlsort', _fxlSort.key + ':' + _fxlSort.dir); } catch (e2) {}
    renderFxList();
  });
  // Auto-actualisation 90 s (le serveur rafraîchit les PRIX toutes les 150 s via son tick léger) :
  // UNIQUEMENT quand l'onglet FX List est visible, sans vider la table (mise à jour silencieuse).
  // Si le 1er chargement a ÉCHOUÉ (_fxlData null), on RÉESSAIE en mode normal (audit 16/07 : l'ancienne
  // condition `&& _fxlData` figait l'onglet sur « Aucune donnée » jusqu'à un changement d'onglet).
  if (_fxlAutoTimer) clearInterval(_fxlAutoTimer);
  _fxlAutoTimer = setInterval(() => {
    const panel = document.getElementById('view-fxlist');
    if (panel && !panel.classList.contains('hidden')) loadFxListView(false, !!_fxlData);
  }, 90 * 1000);
}

// ─── Economic Calendar ────────────────────────────────────────────────────────

// ISO country codes for flag images (flagcdn.com)
const _CURR_ISO = {
  USD:'us', EUR:'eu', GBP:'gb', JPY:'jp', CAD:'ca',
  AUD:'au', CHF:'ch', NZD:'nz', CNY:'cn', CNH:'cn',
  SGD:'sg', HKD:'hk', SEK:'se', NOK:'no', MXN:'mx',
  BRL:'br', INR:'in', KRW:'kr', ZAR:'za', TRY:'tr',
  PLN:'pl', HUF:'hu', CZK:'cz', DKK:'dk', RUB:'ru',
};
function CAL_FLAG(currency) {
  const iso = _CURR_ISO[currency];
  if (!iso) return '';
  return `<span class="cal-flag-wrap"><img src="https://flagcdn.com/w40/${iso}.png" alt="${currency}" class="cal-flag-img" loading="lazy"></span>`;
}

let _calEvents       = [];
let _calCurFilter    = 'ALL';
let _calImpFilter    = 'ALL';
let _calSearch       = '';
let _calNeedsScroll  = false; // true once per calendar tab open → auto-scroll to next event
let _calBackMonths   = 0;     // 0 = live ; 1-3 = mois d'historique remontés via les flèches ‹ ›
function _calFetchUrl() { return _calBackMonths > 0 ? ('/api/calendar-events?back=' + _calBackMonths) : '/api/calendar-events'; }

function calImpDots(impact) {
  const l = (impact || '').toLowerCase();
  if (l === 'high')   return '<span class="ci-high">●●●</span>';
  if (l === 'medium') return '<span class="ci-med">●●<span class="ci-dot-off">●</span></span>';
  return '<span class="ci-low">●<span class="ci-dot-off">●●</span></span>';
}

// ─── Deviation Signaling : utilitaire SÉMANTIQUE UNIFIÉ ───────────────────────
// Compare une donnée chiffrée (actual) à sa référence (forecast) et renvoie la classe
// de la charte : 'cv-pos' (supérieur/favorable → vert), 'cv-neg' (inférieur → rouge),
// '' (égal ou non comparable → blanc). Fidèle DataTradingPro : SANS référence valable
// → neutre, on ne déduit JAMAIS un signal du previous. Réutilisable par tout composant
// data-driven affichant un résultat chiffré (calendrier, scanner, métriques…).
// POLARITÉ INTELLIGENTE (demande user) : pour certains indicateurs, un chiffre PLUS BAS que prévu est
// FAVORABLE (taux de chômage, inscriptions au chômage, licenciements…) → la couleur s'INVERSE. Partout
// ailleurs : plus haut que prévu = favorable (convention des calendriers pro, y compris l'inflation :
// surprise haussière = banque centrale plus hawkish = devise soutenue).
const CAL_INVERTED_RX = /unemployment|jobless|claimant|ch[oô]mage|layoff|job cuts|foreclosure|bankruptc|delinquen/i;
function deviationClass(actual, ref, title) {
  if (actual == null || actual === '' || ref == null || ref === '') return '';
  const a = parseFloat(String(actual).replace(',', '.'));
  const r = parseFloat(String(ref).replace(',', '.'));
  if (isNaN(a) || isNaN(r)) return '';
  // TROIS ÉTATS, PAS DEUX (12/08, demande user « mets une couleur si c'est positif, négatif ou
  // neutre »). Un chiffre SORTI PILE AU CONSENSUS est une information — le marché n'a pas été
  // surpris — et il s'affichait exactement comme un chiffre qu'on ne PEUT PAS juger faute de
  // prévision. Deux situations très différentes rendues à l'identique. Le cas « conforme » prend
  // donc le jaune-orangé NEUTRE de la charte ; l'absence de référence reste sans couleur.
  if (a === r) return 'cv-neu';
  const good = CAL_INVERTED_RX.test(String(title || '')) ? a < r : a > r;
  return good ? 'cv-pos' : 'cv-neg';
}
window.deviationClass = deviationClass;

// Cellule ACTUAL du calendrier : déviation vs FORECAST seul (blanc si forecast absent).
// ÉCLAIR ⚡ (demande user) : le chiffre est sorti SOUS l'estimation BASSE (colonne LOW) →
// éclair À GAUCHE du réel, DANS le span coloré → il prend la COULEUR DU RÉSULTAT
// (vert cv-pos / rouge cv-neg / blanc) via currentColor. Même parsing que deviationClass.
function calActualCell(actual, forecast, low, title) {
  if (actual == null || actual === '') return '<span class="cv-empty">-</span>';
  let bolt = '';
  if (low != null && low !== '') {
    const a = parseFloat(String(actual).replace(',', '.'));
    const l = parseFloat(String(low).replace(',', '.'));
    if (!isNaN(a) && !isNaN(l) && a < l) {
      // `data-aide` double le `title` : au doigt, aucune infobulle native ne s'affiche (cf. _aideAuTap).
      bolt = '<span class="cv-bolt" title="Sorti sous l\'estimation basse (LOW)" data-aide="Sorti sous l\'estimation basse (LOW)"><svg width="9" height="13" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true"><path d="M6.2 0 0 8.2h3.5L3.2 14l6.8-8.4H6.4L6.2 0z"/></svg></span>';
    }
  }
  return `<span class="cv-actual ${deviationClass(actual, forecast, title)}">${bolt}${actual}</span>`;
}

function calFormatTime(ts) {
  if (!ts) return '-';
  // PAS de timeZone fixe → heure LOCALE du navigateur de l'utilisateur (sa vraie heure locale).
  return new Date(ts).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

/* ── COLONNES HAUT / BAS MASQUABLES DANS L'ONGLET (15/08/2026) ────────────────────────────────
   Elles ne l'etaient que sur la carte « Calendrier » de Mon Desk : un utilisateur qui les masquait
   la-bas les retrouvait ici. ⚠️ Meme INTENTION mais DEUX reglages distincts : ici DTPPref
   (calcolhigh/calcollow, par compte), cote widget une option DE CARTE (col_high/col_low) ; ils ne
   sont PAS synchronises entre eux. Ne pas ecrire « meme reglage » : c'est faux, et cette phrase a
   deja masque le decouplage reel (verifie au banc le 17/08).
   Ce sont les bornes de la fourchette de consensus : utiles a qui les lit, du bruit pour qui suit
   seulement Reel / Prevision / Precedent. AFFICHEES par defaut : un reglage neuf ne doit jamais
   changer ce que l'utilisateur voyait la veille.
   Stockage par COMPTE via DTPPref (magasin /api/ui-prefs), donc retrouve sur un autre appareil. */
function _calColVisible(k) {
  try { return window.DTPPref ? DTPPref.get('cal' + k, '1') !== '0' : true; } catch (e) { return true; }
}
function _calColSet(k, on) {
  try { if (window.DTPPref) DTPPref.set('cal' + k, on ? '1' : '0'); } catch (e) {}
  try { renderCalTable(); } catch (e) {}
  try { _calMajReglages(); } catch (e) {}
}
window._calColSet = _calColSet;
// Panneau de reglages de l'onglet : l'icone existait depuis toujours dans le HTML mais n'etait
// reliee a rien (aucun gestionnaire dans le depot). Elle ouvre desormais ce petit volet.
function _calMajReglages() {
  const b = document.getElementById('cal-set-pop');
  if (!b) return;
  const l = (k, lbl) => '<label class="cal-set-row"><span>' + lbl + '</span>'
    + '<button class="cal-set-sw' + (_calColVisible(k) ? ' on' : '') + '" role="switch" aria-checked="' + _calColVisible(k) + '"'
    + ' onclick="_calColSet(\'' + k + '\', ' + (!_calColVisible(k)) + ')"><i></i></button></label>';
  b.innerHTML = '<div class="cal-set-t">Colonnes affichees</div>' + l('colhigh', 'Haut') + l('collow', 'Bas');
}
window._calToggleReglages = function () {
  const b = document.getElementById('cal-set-pop');
  if (!b) return;
  const ouvert = !b.hasAttribute('hidden');
  if (ouvert) { b.setAttribute('hidden', ''); return; }
  _calMajReglages(); b.removeAttribute('hidden');
};
// Fermeture au clic AILLEURS et à Échap : sans ça, le volet reste ouvert par-dessus le tableau et
// il faut retrouver l'icône pour s'en débarrasser. Écouteurs uniques, posés une seule fois, et
// PARTAGÉS par tous les volets de réglages d'onglet (calendrier, Liste FX). Un second volet avait
// tout pour se voir recopier ces douze lignes en changeant un id ; deux copies dérivent toujours —
// celle qu'on corrige et l'autre. Ajouter un volet = ajouter son id à cette liste, rien d'autre.
const _POPS_REGLAGES = ['cal-set-pop', 'fxl-set-pop'];
document.addEventListener('click', e => {
  for (const id of _POPS_REGLAGES) {
    const b = document.getElementById(id);
    if (!b || b.hasAttribute('hidden')) continue;
    if (b.contains(e.target)) continue;                                // clic DANS le volet : on garde
    if (e.target.closest && e.target.closest('.cal-title-icon')) continue;   // l'icône gère son propre bascule
    b.setAttribute('hidden', '');
  }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  for (const id of _POPS_REGLAGES) {
    const b = document.getElementById(id);
    if (b && !b.hasAttribute('hidden')) b.setAttribute('hidden', '');
  }
});
function renderCalTable() {
  const _vHigh = _calColVisible('colhigh');
  const _vLow = _calColVisible('collow');
  const wrap = document.getElementById('cal-table-wrap');
  if (!wrap) return;

  const q      = _calSearch.toLowerCase().trim();
  const nowMs  = Date.now();

  const evs = _calEvents.filter(ev => {
    if (_calCurFilter !== 'ALL' && ev.currency !== _calCurFilter) return false;
    if (_calImpFilter !== 'ALL' && (ev.impact || '').toLowerCase() !== _calImpFilter.toLowerCase()) return false;
    if (q && !(ev.title || '').toLowerCase().includes(q) && !(ev.currency || '').toLowerCase().includes(q)) return false;
    return true;
  });

  if (evs.length === 0) {
    wrap.innerHTML = '<div class="cal-empty">Aucun événement ne correspond au filtre.</div>';
    return;
  }

  // Find the next upcoming event
  let nextIdx = -1;
  for (let i = 0; i < evs.length; i++) {
    if ((evs[i].timestamp || 0) >= nowMs) { nextIdx = i; break; }
  }

  let tbody = '';
  let lastDayKey = '';

  evs.forEach((ev, i) => {
    // ── Day separator row ──
    // Regroupement par JOUR LOCAL du navigateur (cohérent avec l'heure locale affichée → un événement
    // tardif tombe sous le bon en-tête de jour pour l'utilisateur, pas sous le jour UTC).
    const dayKey = ev.timestamp
      ? new Date(ev.timestamp).toLocaleDateString('en-GB')
      : (ev.time || '').substring(0, 10);
    if (dayKey && dayKey !== lastDayKey) {
      const d       = ev.timestamp ? new Date(ev.timestamp) : new Date(dayKey);
      const weekday = d.toLocaleDateString('fr-FR', { weekday: 'long' });
      const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
      // colspan DYNAMIQUE : fige a 10, la ligne de separation debordait des qu une colonne partait.
      tbody += `<tr class="cal-day-sep"><td colspan="${8 + (_vHigh ? 1 : 0) + (_vLow ? 1 : 0)}">${weekday}, ${dateStr}</td></tr>`;
      lastDayKey = dayKey;
    }

    const imp      = (ev.impact || '').toLowerCase();
    const isNext   = i === nextIdx;
    const isPast   = (ev.timestamp || 0) < nowMs;
    const dispTime = calFormatTime(ev.timestamp) || ev.time || '-';

    // ── Row classes ──
    let rowCls = 'cal-row';
    if (isNext)                rowCls += ' cal-row--next';
    if (isPast)                rowCls += ' cal-row--past';
    if (imp === 'high')        rowCls += ' cal-row--high';
    else if (imp === 'medium') rowCls += ' cal-row--med';

    const fcast = ev.forecast && ev.forecast !== ''
      ? `<span class="cv-forecast">${ev.forecast}</span>`
      : '<span class="cv-empty">-</span>';
    const prev = ev.previous && ev.previous !== ''
      ? `<span class="cv-prev">${ev.previous}</span>`
      : '<span class="cv-empty">-</span>';
    // HIGH / LOW : not in ForexFactory XML, show dash when absent
    const hi  = ev.high  && ev.high  !== '' ? `<span class="cv-forecast">${ev.high}</span>`  : '<span class="cv-empty">-</span>';
    const lo  = ev.low   && ev.low   !== '' ? `<span class="cv-prev">${ev.low}</span>`        : '<span class="cv-empty">-</span>';

    // Chevron SANS espace apres le span : le chevron est desormais positionne en absolu (CSS) dans
    // la gouttiere gauche ; un espace residuel decalerait les chiffres de ~3,5 px et casserait
    // l'alignement en-tete « Heure » / heures, mesure au banc.
    const timeCell = `<td class="cth-time"><span class="cal-chv">›</span>${dispTime}</td>`;

    // Day-separator colspan includes all 9 columns (no chv column)
    const _evUrl = ev.url ? ` data-url="${encodeURIComponent(ev.url)}"` : '';
    // Chip « Clé » (23/07) : discours de TÊTE de banque centrale / audition / minutes / conf. de presse
    // — les prises de parole qui bougent vraiment le marché, repérables d'un coup d'œil dans la liste.
    const _keyChip = (_CAL_CB_RX.test(ev.title || '') && _CAL_CB_KEY_RX.test(ev.title || '')) ? ' <span class="cal-key-chip">Clé</span>' : '';
    tbody += `<tr class="${rowCls} cal-row--click" data-idx="${i}"${_evUrl}>
      ${timeCell}
      <td class="cth-flag">${CAL_FLAG(ev.currency)}</td>
      <td class="cth-curr">${ev.currency || ''}</td>
      <td class="cth-imp">${calImpDots(ev.impact)}</td>
      <td class="cth-event">${ev.title || ''}${_keyChip}</td>
      <td class="cth-val cth-val--reel" data-lbl="Réel">${calActualCell(ev.actual, ev.forecast, ev.low, ev.title)}</td>
      ${_vHigh ? `<td class="cth-val cth-val--haut" data-lbl="Haut">${hi}</td>` : ''}
      <td class="cth-val cth-val--prev" data-lbl="Prév.">${fcast}</td>
      ${_vLow ? `<td class="cth-val cth-val--bas" data-lbl="Bas">${lo}</td>` : ''}
      <td class="cth-val cth-val--prec" data-lbl="Préc.">${prev}</td>
    </tr>`;
  });

  // Classes cth-val--* SUR CHAQUE colonne de valeurs (th ET td) : le CSS responsive masquait par
  // nth-child, donc par POSITION : une colonne retiree du DOM (reglage Haut/Bas) decalait tout et
  // la colonne Bas s'affichait sous l'en-tete « PRÉV » (mesure au banc, 17/08). Cibler la classe
  // rend le masquage et les intitules abreges solidaires de la DONNEE, plus jamais de la position.
  wrap.innerHTML = `<table class="cal-table">
    <thead>
      <tr>
        <th class="cth-time">Heure</th>
        <th class="cth-flag">Pays</th>
        <th class="cth-curr">Dev.</th>
        <th class="cth-imp">IMPACT</th>
        <th class="cth-event">ÉVÉNEMENT</th>
        <th class="cth-val cth-val--reel">RÉEL</th>
        ${_vHigh ? `<th class="cth-val cth-val--haut">HAUT</th>` : ""}
        <th class="cth-val cth-val--prev">PRÉVISION</th>
        ${_vLow ? `<th class="cth-val cth-val--bas">BAS</th>` : ""}
        <th class="cth-val cth-val--prec">PRÉCÉDENT</th>
      </tr>
    </thead>
    <tbody>${tbody}</tbody>
  </table>`;
  if (window._dtpDataIn) window._dtpDataIn(wrap, 'cal');   // fondu d'arrivee (1re fois : skeleton -> donnees)

  // Clic sur une ligne → DÉROULÉ INLINE (Specs + History) sous la ligne : PAS de fenêtre modale
  wrap.querySelectorAll('tr.cal-row--click').forEach(tr => {
    tr.addEventListener('click', () => {
      const idx = parseInt(tr.dataset.idx, 10);
      const ev  = evs[idx];
      if (ev) toggleCalDetailRow(tr, ev);
    });
  });

  // Auto-scroll to the next upcoming event (only on first render per tab open)
  if (_calNeedsScroll) {
    _calNeedsScroll = false;
    requestAnimationFrame(() => {
      // Défiler UNIQUEMENT le conteneur du calendrier (#cal-table-wrap) — scrollIntoView défilait AUSSI
      // les ancêtres (body compris, malgré overflow:hidden) → sur mobile la topbar/l'app entière était
      // poussée hors écran. Calcul manuel du scrollTop → aucun effet de bord sur la page.
      const row = wrap.querySelector('.cal-row--next') || [...wrap.querySelectorAll('.cal-row--past')].pop();
      if (row) {
        const wr = wrap.getBoundingClientRect(), rr = row.getBoundingClientRect();
        wrap.scrollTo({ top: wrap.scrollTop + (rr.top - wr.top) - wrap.clientHeight / 2 + rr.height / 2, behavior: 'smooth' });
      }
    });
  }
}

// ─── Panneau détail d'un événement calendrier (Specs + History) ───────────────
const _calDetailCache = {};   // url → { specs, history } (cache navigateur : pas de re-fetch)
function _calEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function _calColorCell(actual, forecast, title) {
  if (!actual) return '<span class="cv-empty">-</span>';
  // Même Deviation Signaling unifié que la table — TITRE COMPRIS. Sans lui, l'inversion des
  // indicateurs où « plus haut » est MAUVAIS (chômage, inscriptions) ne s'appliquait pas : la
  // fiche affichait en VERT ce que la ligne du calendrier affichait en ROUGE, pour la même donnée.
  return `<span class="cv-actual ${deviationClass(actual, forecast, title)}">${_calEsc(actual)}</span>`;
}
// En-tête de valeurs (Actual / Forecast / Previous) d'un événement
function _calDetailHeadVals(ev) {
  return `
    <div class="cal-detail-vals">
      <div class="cdv"><span class="cdv-lbl">Réel</span>${_calColorCell(ev.actual, ev.forecast, ev.title)}</div>
      <div class="cdv"><span class="cdv-lbl">Prévision</span><span class="cv-forecast">${ev.forecast ? _calEsc(ev.forecast) : '-'}</span></div>
      <div class="cdv"><span class="cdv-lbl">Précédent</span><span class="cv-prev">${ev.previous ? _calEsc(ev.previous) : '-'}</span></div>
    </div>`;
}
// HTML Specs + History à partir des données détail (réutilisé par le déroulé inline)
// `titre` sert à colorer la colonne Réel : sans lui, un historique de chômage ressortait en vert.
function _calDetailBodyHtml(d, titre) {
  const specsHtml = (d && d.specs && d.specs.length)
    ? `<div class="cal-detail-section">Détails</div>
       <table class="cal-specs-table">${d.specs.map(s => `<tr><td class="cal-spec-lbl">${_calEsc(s.label)}</td><td class="cal-spec-val">${_calEsc(s.value)}</td></tr>`).join('')}</table>`
    : '';
  const histHtml = (d && d.history && d.history.length)
    ? `<div class="cal-detail-section">Historique</div>
       <table class="cal-hist-table">
         <thead><tr><th>Date</th><th>Réel</th><th>Prévision</th><th>Précédent</th></tr></thead>
         <tbody>${d.history.map(h => `<tr>
           <td>${_calEsc(h.date || '')}</td>
           <td>${_calColorCell(h.actual, h.forecast, titre)}</td>
           <td><span class="cv-forecast">${h.forecast ? _calEsc(h.forecast) : '-'}</span></td>
           <td><span class="cv-prev">${h.previous ? _calEsc(h.previous) : '-'}</span></td>
         </tr>`).join('')}</tbody>
       </table>`
    : '';
  return (specsHtml + histHtml);
}

// ═══ DÉCRYPTAGE DTP du déroulé calendrier (demande user 16/07 — « à la place de Aucun détail ») ═══
// Deux enrichissements, 100 % informatifs et déterministes (zéro IA, zéro quota) :
//  1) DONNÉES ÉCO : base de connaissance pédagogique (source : fiche « Learning Economics News » du user)
//     → catégorie, ce que ça mesure (vulgarisé), lecture factuelle du chiffre vs prévision, réaction
//     classique EN CONDITIONNEL pédagogique (jamais un conseil), ce que ça aide à anticiper + la
//     PROCHAINE ÉCHÉANCE LIÉE réellement présente dans le calendrier chargé.
//  2) BANQUE CENTRALE (discours/minutes/conférences/décisions) : ton récent du discours (mots-clés
//     hawkish/dovish/neutre sur les titres du fil), derniers propos — TRADUITS EN FRANÇAIS depuis
//     la demande du 17/07 (ce commentaire portait encore « VO, jamais traduits — veto » le 27/08,
//     ce qui était faux depuis trois mois et a failli faire refuser une demande légitime : un
//     commentaire périmé ment avec l'autorité du code),
//     taux actuel + prochaine réunion + probabilités (payload /api/rates du desk).
const CAL_KB = [
  { rx: /core\s+cpi|core\s+consumer\s+price|cpi\s+core/i, name: 'Core CPI', cat: 'Inflation', what: "Le prix des courses hors énergie et nourriture (l'inflation « de fond »).", anticipates: 'PCE, décisions de la banque centrale', nextRx: /\bpce\b|rate decision|fomc/i, hiUp: true },
  { rx: /core\s+pce/i, name: 'Core PCE', cat: 'Inflation', what: "La mesure d'inflation préférée de la Fed.", anticipates: 'Orientation future de la Fed', nextRx: /rate decision|fomc/i, hiUp: true },
  { rx: /\bpce\b|personal\s+consumption/i, name: 'PCE', cat: 'Inflation', what: 'Le prix réellement payé par les ménages.', anticipates: 'Futures décisions de taux', nextRx: /rate decision|fomc/i, hiUp: true },
  { rx: /\bppi\b|producer\s+price/i, name: 'PPI', cat: 'Inflation', what: 'Le coût de production des usines : en amont des prix consommateur.', anticipates: 'CPI futur (pression sur les prix)', nextRx: /\bcpi\b|consumer price|inflation rate/i, hiUp: true },
  { rx: /\bcpi\b|consumer\s+price|inflation\s+rate/i, name: 'CPI', cat: 'Inflation', what: 'Le prix du panier de la ménagère : LA mesure d\'inflation de référence.', anticipates: 'Politique monétaire, taux, devise', nextRx: /rate decision|fomc|\bpce\b/i, hiUp: true },
  { rx: /non-?farm|payrolls|\bnfp\b/i, name: 'NFP', cat: 'Emploi', what: 'Le score des nouveaux emplois créés dans le mois (hors agriculture).', anticipates: 'Chômage, salaires, banque centrale', nextRx: /unemployment|rate decision|fomc/i, hiUp: true },
  { rx: /unemployment\s+rate|jobless\s+rate/i, name: 'Taux de chômage', cat: 'Emploi', what: 'Le pourcentage de personnes sans travail.', anticipates: 'Consommation, croissance', nextRx: /retail sales|\bgdp\b/i, hiUp: false },
  { rx: /jobless\s+claims|initial\s+claims|continuing\s+claims/i, name: 'Inscriptions au chômage', cat: 'Emploi', what: 'Le thermomètre HEBDO du marché du travail (nouvelles demandes d\'allocations).', anticipates: 'NFP, santé de l\'emploi', nextRx: /non-?farm|payrolls/i, hiUp: false },
  { rx: /average\s+hourly\s+earnings|hourly\s+earnings|wage\s+growth|\bwages\b/i, name: 'Salaires horaires', cat: 'Emploi', what: 'La vitesse de hausse des salaires.', anticipates: 'Inflation future (CPI/PCE)', nextRx: /\bcpi\b|\bpce\b/i, hiUp: true },
  { rx: /\badp\b/i, name: 'ADP', cat: 'Emploi', what: 'Le « test » privé avant le vrai chiffre NFP.', anticipates: 'NFP (imparfaitement)', nextRx: /non-?farm|payrolls/i, hiUp: true },
  { rx: /jolts|job\s+openings/i, name: 'JOLTS', cat: 'Emploi', what: 'Le nombre de postes à pourvoir : la « demande » de travailleurs.', anticipates: 'NFP, salaires, inflation', nextRx: /non-?farm|payrolls/i, hiUp: true },
  { rx: /\bgdp\b|gross\s+domestic/i, name: 'PIB', cat: 'Croissance', what: 'La richesse totale produite par le pays.', anticipates: 'Politique monétaire, bénéfices des entreprises', nextRx: /rate decision|fomc/i, hiUp: true },
  { rx: /retail\s+sales/i, name: 'Ventes au détail', cat: 'Croissance', what: 'L\'argent réellement dépensé par les consommateurs.', anticipates: 'PIB, croissance future', nextRx: /\bgdp\b/i, hiUp: true },
  { rx: /(?:ism\s+)?manufacturing\s+pmi|pmi\s+manufacturing|ism\s+manufacturing/i, name: 'PMI Manufacturier', cat: 'Croissance', what: 'La santé des usines (au-dessus de 50 = expansion, en dessous = contraction).', anticipates: 'PIB, emploi industriel', nextRx: /\bgdp\b/i, hiUp: true },
  { rx: /(?:ism\s+)?services\s+pmi|pmi\s+services|ism\s+services|non-?manufacturing/i, name: 'PMI Services', cat: 'Croissance', what: 'La santé des entreprises de services (au-dessus de 50 = expansion).', anticipates: 'PIB, emploi', nextRx: /\bgdp\b/i, hiUp: true },
  { rx: /trade\s+balance|balance\s+of\s+trade/i, name: 'Balance commerciale', cat: 'Croissance', what: 'La différence entre ce que le pays exporte et importe.', anticipates: 'Devise, PIB', nextRx: /\bgdp\b/i, hiUp: true },
  { rx: /consumer\s+confidence|consumer\s+sentiment|michigan/i, name: 'Confiance des consommateurs', cat: 'Croissance', what: 'Le moral des ménages : leur envie de dépenser.', anticipates: 'Consommation, ventes au détail', nextRx: /retail\s+sales/i, hiUp: true },
  { rx: /building\s+permits|housing\s+starts|home\s+sales|new\s+home/i, name: 'Immobilier', cat: 'Croissance', what: 'La santé du secteur immobilier (permis, mises en chantier, ventes).', anticipates: 'Croissance, emploi BTP', nextRx: /\bgdp\b/i, hiUp: true },
  { rx: /industrial\s+production/i, name: 'Production industrielle', cat: 'Croissance', what: 'Ce que produisent les usines, mines et services publics.', anticipates: 'PIB, PMI manufacturier', nextRx: /\bgdp\b|pmi/i, hiUp: true },
  { rx: /durable\s+goods/i, name: 'Commandes de biens durables', cat: 'Croissance', what: 'Les commandes de biens qui durent (machines, avions, autos).', anticipates: 'Investissement des entreprises, PIB', nextRx: /\bgdp\b/i, hiUp: true },
  // Familles COMPLÉMENTAIRES (demande user 23/07 « décryptage pour chaque événement ») — noConcl : pas de
  // conclusion directionnelle automatique quand la polarité devise n'est pas univoque (taux crédit, stocks…).
  { rx: /mortgage/i, name: 'Crédit immobilier', cat: 'Taux', what: 'Le taux (ou la demande) des crédits immobiliers : la santé du financement du logement.', anticipates: 'Immobilier, consommation', nextRx: /housing|home|building/i, hiUp: true, noConcl: true },
  { rx: /crude|gasoline|distillate|natural gas storage|oil stock/i, name: "Stocks d'énergie", cat: 'Énergie', what: "Les réserves hebdo américaines (brut, essence, gaz) : l'équilibre offre/demande d'énergie.", anticipates: 'Prix du pétrole et du gaz, CAD', nextRx: /crude|oil/i, hiUp: false, noConcl: true },
  { rx: /auction/i, name: 'Adjudication obligataire', cat: 'Taux', what: "Une vente de dette d'État : le rendement obtenu montre l'appétit des investisseurs pour ce pays.", anticipates: 'Rendements obligataires, devise', nextRx: /auction/i, hiUp: true, noConcl: true },
  { rx: /current account/i, name: 'Balance courante', cat: 'Croissance', what: "Tous les échanges du pays avec l'étranger (biens, services, revenus).", anticipates: 'Devise, PIB', nextRx: /\bgdp\b|trade balance/i, hiUp: true },
  { rx: /zew|\bifo\b|sentix|business climate|economic sentiment/i, name: 'Climat des affaires', cat: 'Croissance', what: "Le moral des investisseurs et des entreprises : un signal AVANCÉ de l'activité.", anticipates: 'PIB, PMI', nextRx: /\bgdp\b|pmi/i, hiUp: true },
  { rx: /money supply|\bm2\b|\bm3\b/i, name: 'Masse monétaire', cat: 'Inflation', what: 'La quantité de monnaie en circulation dans l\'économie.', anticipates: 'Inflation à moyen terme', nextRx: /\bcpi\b|inflation/i, hiUp: true, noConcl: true },
  { rx: /capacity utilization|factory orders/i, name: 'Activité industrielle', cat: 'Croissance', what: 'Le remplissage des usines et leurs carnets de commandes.', anticipates: 'PIB, production industrielle', nextRx: /\bgdp\b|industrial/i, hiUp: true },
  { rx: /\bpmi\b/i, name: 'PMI', cat: 'Croissance', what: 'Le moral des directeurs d\'achats (au-dessus de 50 = expansion, en dessous = contraction).', anticipates: 'PIB, tendance de l\'activité', nextRx: /\bgdp\b/i, hiUp: true },
];
// Événements de BANQUE CENTRALE (discours, minutes, conférences, décisions)
// Détection ÉVÉNEMENT BANQUE CENTRALE (discours, minutes, conférences ET surtout DÉCISIONS DE TAUX).
// Élargi (demande user : « BoC Interest Rate » n'apparaissait pas) → capte tous les libellés de décision :
// interest/cash/bank/overnight/official/policy/deposit/refi rate, OCR, rate decision/statement/announcement…
const _CAL_CB_RX = /speech|speaks|testif|press\s+conference|minutes|(?:interest|cash|bank|overnight|official|policy|deposit|refi(?:nancing)?|lending|repo)\s+rate|\bocr\b|rate\s+(?:decision|statement|announcement|call)|policy\s+(?:report|decision|statement)|monetary\s+policy|\bfomc\b|interest\s+rate\s+decision/i;
const _CAL_CB_BY_CCY = { USD: { bank: 'Fed (FOMC)', rx: /\b(?:fed|fomc|powell)\b/i }, EUR: { bank: 'BCE', rx: /\b(?:ecb|bce|lagarde)\b/i }, GBP: { bank: 'BoE', rx: /\b(?:boe|bank of england|bailey)\b/i }, JPY: { bank: 'BoJ', rx: /\b(?:boj|bank of japan|ueda)\b/i }, CHF: { bank: 'BNS (SNB)', rx: /\b(?:snb|bns|swiss national bank)\b/i }, CAD: { bank: 'BoC', rx: /\b(?:boc|bank of canada|macklem)\b/i }, AUD: { bank: 'RBA', rx: /\b(?:rba|reserve bank of australia)\b/i }, NZD: { bank: 'RBNZ', rx: /\b(?:rbnz|reserve bank of new zealand)\b/i } };
// Discours « CLÉS » mis en avant dans la liste (23/07, demande user « mettre les discours importants ») :
// têtes de banque centrale (le marché bouge surtout sur eux) + auditions parlementaires + minutes +
// conférences de presse. Noms = gouverneurs/présidents en poste (à tenir à jour aux changements).
const _CAL_CB_KEY_RX = /\b(?:powell|lagarde|bailey|ueda|schlegel|macklem|bullock|orr|hawkesby|gov)\b|testif|press\s+conference|minutes/i;
const _CAL_HAWK_RX = /hik(?:e|es|ing)|rais(?:e|ing)\s+rates|tighten|restrictive|higher\s+for\s+longer|inflation(?:ary)?\s+(?:too\s+high|persistent|sticky|elevated|pressures?)|price\s+pressures?|upside\s+risks?|not\s+(?:yet\s+)?done|not\s+gone\s+away|further\s+(?:tightening|increases?)|premature\s+to\s+(?:cut|eas)|vigilan|hawkish/i;
const _CAL_DOVE_RX = /\bcut(?:s|ting)?\b|eas(?:e|ing)|lower(?:ing)?\s+rates?|accommodat|downside\s+risks?|dovish|ready\s+to\s+(?:act|support)|slow(?:ing|down|er)|cool(?:ing|ed)?|disinflation|moderat(?:e|ing|ion)|weaker\s+(?:growth|labou?r|demand)/i;
const _CAL_HOLD_RX = /\bhold\b|pause|patient|data[\s-]dependent|wait[\s-]and[\s-]see|steady|unchanged|maintain/i;
function _calToneOf(texts) {
  let hawk = 0, dove = 0, hold = 0;
  /* ⚠️ UN PROPOS RESTRICTIF SORTAIT « NEUTRE » (09/09, mesuré). Les trois listes étaient appliquées
     au MÊME texte, indépendamment, et la liste restrictive contient des tournures qui NIENT un mot
     accommodant : « premature to cut », « not done », « further tightening ». « premature to cut »
     comptait donc UN point restrictif ET UN point accommodant — parce que « cut » y est présent —,
     les deux s'annulaient, et la phrase la plus clairement restrictive du lexique ressortait grise.
     On lit donc le restrictif D'ABORD, on RETIRE du texte ce qu'il a consommé, et on relit le reste.
     L'inverse n'est pas nécessaire, et ce n'est pas une négligence : la liste accommodante ne
     contient AUCUNE négation d'un terme restrictif (« ready to act », « disinflation », « slowing »
     se lisent seuls). Une symétrie posée sans motif se paierait sur des phrases mixtes. */
  texts.forEach(t => {
    const brut = String(t || '');
    const restrictif = _CAL_HAWK_RX.test(brut);
    const reste = restrictif ? brut.replace(new RegExp(_CAL_HAWK_RX.source, 'gi'), ' ') : brut;
    if (restrictif) hawk++;
    if (_CAL_DOVE_RX.test(reste)) dove++;
    if (_CAL_HOLD_RX.test(reste)) hold++;
  });
  // COULEUR SÉMANTIQUE (13/08, demande user). L ambre et le BLEU venaient d une palette « ton de banque
  // centrale » qui n existe nulle part ailleurs dans le desk : les badges .wr-cb-* et les mails disent
  // déjà hawkish=vert / dovish=rouge. Un même ton sortait donc bleu ici et rouge deux vues plus loin.
  // Lecture retenue, identique partout : hawkish = resserrement = SOUTIENT la devise -> vert ;
  // dovish = assouplissement -> rouge ; neutre = gris. (Valeurs de la charte : #22c55e / #ef4444.)
  /* LIBELLÉS EN FRANÇAIS (audit 28/08) : le Décryptage disait « Dovish » quand le Radar de Biais dit
     « Accommodante » pour la MÊME banque — c'est le même desk qui se contredit d'une vue à l'autre.
     Accordé au masculin : le badge qualifie un TON (« ton restrictif »), le Radar une ORIENTATION.
     Les clés internes ('hawk'/'dove') ne bougent pas — seule l'étiquette affichée est traduite. */
  if (hawk > dove && hawk >= hold) return { key: 'hawk', label: 'Restrictif', sens: 'penche vers des taux plus hauts', color: '#22c55e' };
  if (dove > hawk && dove >= hold) return { key: 'dove', label: 'Accommodant', sens: 'penche vers des taux plus bas', color: '#ef4444' };
  if (hawk || dove || hold) return { key: 'hold', label: 'Neutre', sens: 'maintien / attentisme', color: '#9a9aa4' };
  return null;
}
// Découpe un propos rapporté « <Banque/Speaker>: <déclaration> » → attribution (VO) + déclaration.
// La déclaration rendue ici est la VO : c'est la matière d'ANALYSE (le ton se lit sur des regex
// anglaises). Ce qui s'AFFICHE est sa traduction quand elle est prête — cf. le champ `fr`.
function _calQuoteParts(h) {
  h = String(h || '').trim();
  const c = h.indexOf(':');
  if (c <= 0 || c > 48) return { who: '', statement: h };
  return { who: h.slice(0, c).trim(), statement: h.slice(c + 1).trim() };
}
const _CAL_MON_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function _calShortDateFr(ts) { try { const d = new Date(ts); return d.getDate() + ' ' + _CAL_MON_FR[d.getMonth()]; } catch (e) { return ''; } }
// « La banque surveille » (23/07) : le MANDAT de chaque banque — ce qui la fait monter ou baisser ses
// taux. C'est la grille de lecture d'un discours : l'intervenant est toujours jugé sur ces axes-là.
// CAUSE → CONSÉQUENCE, une par ligne, flèches alignées en colonne (grille .cal-flux). Un trader
// balaie la colonne de gauche (la condition) et lit la conséquence en face, sans relire la phrase.
function _calFlux(paires) {
  if (!paires || !paires.length) return '';
  return '<span class="cal-flux">' + paires.map(p =>
    `<span class="cal-flux-a">${p[0]}</span><span class="cal-flux-x">→</span><span class="cal-flux-b">${p[1]}</span>`
  ).join('') + '</span>';
}
// Ce que surveille chaque banque : le MANDAT en une ligne, puis ses règles de décision en couples.
// Les couples ne font que dérouler ce que la phrase disait déjà — rien n'a été ajouté.
const _CAL_CB_WATCH = {
  USD: { quoi: "L'inflation (PCE, cible 2%) et le plein emploi : le double mandat.", flux: [
    ['Inflation tenace', 'taux élevés plus longtemps'],
    ['Inflation qui recolle à 2% et emploi qui se tasse', 'arguments pour baisser'],
  ] },
  EUR: { quoi: "L'inflation de la zone euro (cible 2%), les salaires et la croissance.", flux: [
    ['Inflation sous contrôle', 'porte ouverte aux baisses'],
    ['Salaires et services tenaces', 'statu quo'],
  ] },
  GBP: { quoi: "L'inflation (cible 2%), les salaires et les prix des services : les points durs du Royaume-Uni.", flux: [
    ['Salaires et services encore élevés', 'la BoE freine les baisses'],
  ] },
  JPY: { quoi: "Une inflation DURABLE portée par les salaires (négociations de printemps) et le yen.", flux: [
    ['Salaires qui montent durablement', 'la condition pour continuer à remonter les taux'],
  ] },
  CHF: { quoi: "L'inflation (fourchette 0-2%) et la force du franc.", flux: [
    ['Franc trop fort', 'la BNS peut intervenir sur le change'],
  ] },
  CAD: { quoi: "L'inflation sous-jacente (médiane/tronquée), l'emploi et l'immobilier.", flux: [
    ['Ménages très endettés', 'chaque hausse de taux pèse vite'],
  ] },
  AUD: { quoi: "L'inflation trimestrielle (cible 2-3%), l'emploi et la consommation des ménages.", flux: [] },
  NZD: { quoi: "L'inflation (cible 1-3%) et l'emploi : mandat double, politique souvent tranchée.", flux: [] },
};
// « Lecture pour la réunion » (23/07) : croise le TON du discours et le SCÉNARIO pricé par le marché
// (probabilités /api/rates) → phrase déterministe : hausse/baisse/maintien attendu + ce que ce ton
// confirme ou tempère. Sans ton (aucun propos récent) → mode « à écouter » (grille d'interprétation).
// Ce que le ton récent implique pour la réunion à venir. Le BADGE affiché à côté porte déjà le ton
// (NEUTRE / HAWKISH / DOVISH) : la phrase ne le répète pas, elle dit seulement ce qu'il change.
// Le pricing n'est rappelé ici que si aucune autre ligne de la fiche ne l'affiche (opts.pricingAilleurs).
function _calMeetReading(tone, sc, opts) {
  const o = opts || {};
  const list = [['hike', 'hausse', sc.hike], ['hold', 'maintien', sc.hold], ['cut', 'baisse', sc.cut]].filter(x => x[2] != null);
  list.sort((a, b) => b[2] - a[2]);
  const dom = list[0];
  if (!dom && !tone) return '';
  const M = {
    hawk: { hike: 'dans le sens de la hausse attendue', hold: 'maintien probable, hausse pas exclue', cut: 'tempère la baisse attendue' },
    dove: { cut: 'dans le sens de la baisse attendue', hold: 'maintien probable, baisse qui se rapproche', hike: 'contredit la hausse attendue' },
    hold: { hike: 'peut confirmer ou tempérer la hausse attendue', hold: 'en ligne avec le maintien attendu', cut: 'peut confirmer ou tempérer la baisse attendue' },
  };
  let txt;
  if (!tone) txt = o.aDesPropos
    // Des propos EXISTENT et sont listés juste en dessous : dire « aucun propos récent » serait
    // faux. Ce qui manque, c'est un signal de taux dans ces propos — nuance qui change tout pour
    // le lecteur (« la banque n'a rien dit » vs « elle a parlé d'autre chose »).
    ? 'propos récents sans signal de politique monétaire : c\'est ce discours qui donnera le ton'
    : 'aucun propos récent : le ton du discours fera la différence';
  else if (!dom) txt = tone.sens;
  else txt = (M[tone.key] || {})[dom[0]] || tone.sens;
  if (dom && !o.pricingAilleurs) txt += ` : marché : <strong>${dom[1]} ${Math.round(dom[2])}%</strong>`;
  return txt;
}
// Extraits de discours BC (23/07) : le SERVEUR balaie 14 j d'historique news (le client n'en garde
// qu'~1-2 j en mémoire → souvent aucun propos, cas « Fed Jefferson Speech » sans ton). Cache client
// 10 min par (devise, speaker). Renvoie { speaker, quotes:[{h,ts}] } ; [] si rien/erreur.
const _calCbQuotesCache = {};
async function _calCbQuotesGet(ccy, speaker) {
  const key = ccy + '|' + (speaker || '');
  const c = _calCbQuotesCache[key];
  if (c && Date.now() - c.at < 10 * 60 * 1000) return c.data;
  try {
    const url = '/api/cb-quotes?ccy=' + encodeURIComponent(ccy) + (speaker ? '&speaker=' + encodeURIComponent(speaker) : '');
    const j = await (window._dtpJSON ? window._dtpJSON(url) : fetch(url).then(r => r.json()));
    if (j && Array.isArray(j.quotes)) { _calCbQuotesCache[key] = { at: Date.now(), data: j }; return j; }
  } catch {}
  return { speaker: null, quotes: [] };
}
// Payload /api/rates du desk, mis en cache 10 min (même source que l'onglet TAUX)
let _calRatesCache = { at: 0, data: null };
async function _calRatesGet() {
  if (_calRatesCache.data && Date.now() - _calRatesCache.at < 10 * 60 * 1000) return _calRatesCache.data;
  try {
    const j = await fetch('/api/rates').then(r => r.json());
    if (j && Array.isArray(j.banks)) { _calRatesCache = { at: Date.now(), data: j }; return j; }
  } catch {}
  return _calRatesCache.data;
}
function _calFmtDateFr(iso) {
  try { return new Date(iso + 'T00:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }); } catch { return iso; }
}
// Valeur numérique d'une cellule calendrier (« 0.2% », « 45B », « -1.5 »)
// RÉSULTAT d'une décision de taux : ce qui est SORTI, en une phrase.
//   · sens vs précédent  → maintenu / relevé / abaissé (avec l'écart en points de %)
//   · écart vs prévision → conforme / au-dessus / en dessous des attentes
// Renvoie null tant que le chiffre réel n'est pas publié : avant, il n'y a rien à annoncer.
// Un événement de banque centrale peut ne porter AUCUN chiffre (conférence de presse, discours)
// alors que la DÉCISION du même jour, elle, est publiée : ce sont deux lignes distinctes du
// calendrier. Sans ce rattachement, la fiche d'une conférence de presse tenue juste après le FOMC
// ignorait la décision et continuait d'afficher le pricing d'AVANT-réunion (« maintien 49 % ·
// hausse 51 % ») pour une réunion déjà tenue, plus un « Taux actuel » tiré du pricing.
// On cherche donc, le même jour et sur la même devise, l'événement de décision qui porte un chiffre.
const _CAL_DEC_RX = /rate\s+(?:decision|statement|announcement)|(?:interest|cash|bank|overnight|official|policy|deposit|refi(?:nancing)?)\s+rate|\bocr\b/i;
function _calDecisionDuJour(ev) {
  if (!Array.isArray(_calEvents) || !ev || !ev.timestamp) return null;
  const jour = t => { const d = new Date(t); return d.getUTCFullYear() + '-' + d.getUTCMonth() + '-' + d.getUTCDate(); };
  const j = jour(ev.timestamp);
  return _calEvents.find(e => e && e.currency === ev.currency && e.timestamp && jour(e.timestamp) === j
    && e !== ev && _CAL_DEC_RX.test(e.title || '') && _calNum(e.actual) != null) || null;
}
/* ⚠️ DEUX SIGNAUX D UNITE, PARCE QUE LE CALENDRIER MELANGE LES DEUX (03/09, capture user).
   La RBNZ est sortie avec `actual` = « 25b » — vingt-cinq POINTS DE BASE, le MOUVEMENT — pendant que
   `forecast` et `previous` donnaient des NIVEAUX en pourcentage (2,75 % et 2,50 %). `_calNum` ne lit
   que le premier nombre : 25. Le desk a donc affiche « RELEVE ses taux a 25% (+22,5 pt) » et
   « au-dessus des attentes (2,75% prevu) », deux phrases fausses ecrites avec l aplomb du code.
   On refuse desormais de comparer ce qui n est pas comparable. Deux filets :
     1. UNITE EXPLICITE — un `actual` portant un marqueur de points de base (« 25b », « 25bp »,
        « +25 bps ») face a des voisins en pourcentage : incomparables, quel que soit l ecart ;
     2. ECART INVRAISEMBLABLE — au-dela de 5 points en une seule reunion, c est un probleme d unite
        et non une decision. Le seuil est LARGE a dessein : la BCB a deja bouge de 3 pts, la CBRT de
        7,5 pts un jour de 2023. On prefere laisser passer une vraie decision extreme que d en
        inventer une fausse a chaque publication en bps.
   Quand un filet se declenche, on n affirme NI delta NI surprise : on rend le niveau publie, seul. */
function _calBpsSuspect(brut) { return /\d\s*b(?:ps?|p)?\b/i.test(String(brut == null ? '' : brut)); }
function _calDecisionOutcome(ev) {
  const fr = x => String(x).replace('.', ',');   // interface francaise : virgule decimale
  const a = _calNum(ev && ev.actual); if (a == null) return null;
  const p = _calNum(ev && ev.previous), f = _calNum(ev && ev.forecast);
  const _pct = x => x != null && !_calBpsSuspect(x);
  const _incomparable = (_calBpsSuspect(ev && ev.actual) && (_pct(ev && ev.previous) || _pct(ev && ev.forecast)))
    || (p != null && Math.abs(a - p) > 5)
    || (f != null && Math.abs(a - f) > 5);
  if (_incomparable) {
    const banque0 = (ev && ev.__bank) || 'La banque centrale';
    return { sens: banque0 + ' : décision publiée (' + _calEsc(String(ev.actual)) + ')', attente: '',
      couleur: '#9aa0aa', geste: 'Décision publiée', taux: null, incomparable: true };
  }
  // On NOMME l action de la banque (demande user) : maintien / hausse / baisse, avec le verbe en
  // premier. « La Fed MAINTIENT ses taux » se lit plus vite qu un constat impersonnel.
  const banque = (ev && ev.__bank) || 'La banque centrale';
  let geste = 'Décision publiée', sens = geste, couleur = '#9aa0aa', taux = a;
  if (p != null) {
    const d = Math.round((a - p) * 100) / 100;
    if (d === 0)      { geste = 'MAINTIENT'; sens = banque + ' MAINTIENT ses taux à ' + fr(a) + '%'; couleur = '#9aa0aa'; }
    /* ⚠️ LES DEUX COULEURS ETAIENT INVERSEES (03/09, constat user : « pourquoi t as mis en rouge
       alors que c positif ? »). Elles suivaient l instinct « taux qui montent = mauvaise nouvelle »,
       qui vaut pour un emprunteur ou pour les actions — pas pour un desk FX. Ici tout se lit DU
       POINT DE VUE DE LA DEVISE, et le reste du produit le fait deja : `_mtCls('ratedir')` dans
       app.js rend `mt-pos` (vert) sur « Hausse » et `mt-neg` (rouge) sur « Baisse », et le niveau
       d inflation porte le meme raisonnement en toutes lettres — « Elevee → pression hawkish →
       SOUTIENT la devise → vert ». Cette fonction etait le SEUL endroit a dire le contraire.
       HAUSSE = hawkish = soutient la devise = vert #00e676 (charte : BULLISH).
       BAISSE = dovish  = pese sur la devise = rouge #ff3d00 (charte : BEARISH). */
    else if (d > 0)   { geste = 'RELÈVE';    sens = banque + ' RELÈVE ses taux à ' + fr(a) + '% (+' + fr(d) + ' pt)'; couleur = '#00e676'; }
    else              { geste = 'ABAISSE';   sens = banque + ' ABAISSE ses taux à ' + fr(a) + '% (' + fr(d) + ' pt)'; couleur = '#ff3d00'; }
  } else sens = banque + ' : taux à ' + fr(a) + '%';
  let attente = '';
  if (f != null) {
    if (a === f) attente = 'conforme aux attentes';
    else if (a > f) attente = 'au-dessus des attentes (' + fr(f) + '% prévu) : surprise restrictive';
    else attente = 'en dessous des attentes (' + fr(f) + '% prévu) : surprise accommodante';
  }
  return { sens, attente, couleur, geste, taux };
}
function _calNum(s) { const m = String(s == null ? '' : s).replace(/,/g, '.').match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : null; }
// « CONCLUSION » (demande user) : PAS la réaction théorique générique, mais l'INTERPRÉTATION du résultat
// publié — écart réel vs consensus + implications concrètes (politique monétaire, devise, obligations,
// actions). Déterministe (kb.cat + kb.hiUp) → instantané, ancré sur le vrai chiffre, jamais inventé.
function _calConclusion(kb, a, f, ev) {
  const A = _calEsc(ev.actual), F = _calEsc(ev.forecast);
  // Cas 1 — RÉSULTAT PUBLIÉ : le verdict sur sa ligne, puis « ce que ça implique → pour quels
  // actifs » en couple aligné. Même contenu qu'avant (aucun jargon réintroduit), mais on ne lit
  // plus une phrase de trois lignes pour trouver la conséquence.
  if (a != null && f != null) {
    if (a === f) return `<span class="cal-kb-line"><strong>Chiffre conforme aux attentes</strong> (${F})</span>`
      + _calFlux([['Rien ne change vraiment pour les taux', 'réaction en général <strong>faible</strong>']]);
    const strong = (a > f) === !!kb.hiUp;   // « fort » pour la devise (tient compte de hiUp : chômage & inscriptions inversés)
    const M = {
      Inflation: {
        s: ['Inflation plus forte que prévu', 'La banque centrale est plutôt poussée à garder des taux élevés', '<strong>positif pour la devise</strong>, <strong>négatif pour les obligations</strong> (et souvent pour les actions)'],
        w: ['Inflation plus faible que prévu', 'La banque centrale a moins de raisons de monter les taux', '<strong>négatif pour la devise</strong>, <strong>positif pour les obligations et les actions</strong>'],
      },
      Emploi: {
        s: ['Emploi plus solide que prévu', 'La banque centrale peut garder des taux élevés plus longtemps', '<strong>positif pour la devise</strong> ; les actions peuvent souffrir si les baisses s\'éloignent'],
        w: ['Emploi plus faible que prévu', 'Cela pousse plutôt la banque centrale vers des baisses de taux', '<strong>négatif pour la devise</strong>, <strong>positif pour les actions</strong>'],
      },
      Croissance: {
        s: ['Croissance plus forte que prévu', "Signe d'une économie solide", '<strong>positif pour la devise et les actions</strong>'],
        w: ['Croissance plus faible que prévu', "Signe d'un ralentissement", '<strong>négatif pour la devise et les actions</strong>, <strong>positif pour les obligations</strong>'],
      },
    };
    const m = (M[kb.cat] || M.Croissance)[strong ? 's' : 'w'];
    return `<span class="cal-kb-line"><strong>${m[0]}</strong> (${A} contre ${F} attendu)</span>` + _calFlux([[m[1], m[2]]]);
  }
  // Cas 2 — À VENIR : les deux scénarios face à face, au lieu de « ; en dessous, l'inverse ».
  if (f != null) {
    return `<span class="cal-kb-line">Chiffre à venir : les deux scénarios :</span>` + _calFlux(kb.hiUp
      ? [[`Au-dessus de ${F}`, 'plutôt <strong>bon pour la devise</strong>'], [`En dessous de ${F}`, 'plutôt <strong>négatif</strong>']]
      : [[`En dessous de ${F}`, 'plutôt <strong>bon pour la devise</strong>'], [`Au-dessus de ${F}`, 'plutôt <strong>négatif</strong>']]);
  }
  return '';
}
// ── Bloc « Décryptage DTP » d'un événement (async : peut attendre /api/rates, en cache) ──
async function _calValueBlockHtml(ev) {
  const title = String(ev.title || '');
  const rows = [];
  // 1) BANQUE CENTRALE (prioritaire : un « CPI » dans un titre de discours reste un discours)
  const cb = _CAL_CB_RX.test(title) ? _CAL_CB_BY_CCY[ev.currency] : null;
  if (cb) {
    // Derniers propos : titres du fil (7 jours) qui citent le SPEAKER (« Fed Logan Speech » → Logan).
    // REPLI BANQUE (23/07, demande user « ton du discours pour interpréter la prochaine réunion ») :
    // les intervenants secondaires (Musalem, Hunter…) n'ont souvent AUCUN titre à leur nom dans le fil
    // → le bloc restait muet. Sans propos du speaker, on lit le ton des propos récents de la BANQUE
    // (n'importe quel officiel Fed/RBA…) — c'est le ton de l'institution qui guide la réunion.
    const spk = title.match(/(?:fed|fomc|ecb|boe|boj|snb|boc|rba|rbnz)(?:'s)?\s+([A-Z][a-zà-ÿ'-]+)\s+(?:speech|speaks|testif)/i);
    const speaker = spk ? spk[1] : '';
    // SOURCE PRIMAIRE = serveur (14 j d'historique, cf. /api/cb-quotes) : extraits du discours du speaker,
    // sinon des propos récents de la banque. REPLI instantané = fil en mémoire (au cas où le serveur cale).
    // ⚠️ DIRE LE TEMPS QU IL EST (06/08, question user : « comment on peut prevoir les discours ? »).
    // On ne prevoit RIEN. Quand l evenement est A VENIR, les propos affiches sont ceux d AVANT — ceux
    // d un autre intervenant, plus tot dans la journee ou la semaine. Le libelle « Propos de la banque »
    // ne le disait pas, et on pouvait lire le ton comme celui du discours qui n a pas encore eu lieu.
    // Le titre du bloc porte desormais la difference : « DERNIERS propos avant ce discours » si
    // l evenement est futur, « Propos recents » s il a deja eu lieu.
    const _quandEv = (ev && (ev.ts || ev.timestamp || (ev.date ? Date.parse(ev.date) : 0))) || 0;
    const _discoursAVenir = _quandEv > Date.now() + 60000;
    /* ══ LE DISCOURS PASSÉ A SES PROPOS À LUI (29/08, demande user : « mets pendant ou après,
       récupère son discours et mets à jour une fois qu'on l'a — comme on a le avant ») ═══════════
       La fiche montrait « Derniers propos AVANT ce discours »… y compris une fois le discours
       TENU : ce que l'intervenant venait de dire — la seule chose qui compte alors, celle qui
       donne le ton pour la prochaine réunion — se noyait dans les propos d'avant, triés par
       signal. Un discours passé partage désormais ses propos autour de son heure, exactement
       comme la fiche d'une réunion le fait autour de la décision : « Ton du discours » +
       citations du discours d'un côté, « avant » de l'autre. Rien à générer : les citations
       arrivent par le fil (« Fed's Goolsbee: … ») et par /api/cb-quotes au fil de l'eau — la
       fiche se met à jour d'elle-même à chaque ouverture. */
    const _estDiscoursPasse = !_discoursAVenir && /\b(speech|speaks|testif)/i.test(title);
    let quotes = [], quotesLbl = _discoursAVenir ? 'Derniers propos avant ce discours' : 'Propos récents';
    try {
      const srv = await _calCbQuotesGet(ev.currency, speaker);
      if (srv && srv.quotes && srv.quotes.length) {
        quotes = srv.quotes.map(q => ({ h: q.h, ts: q.ts || 0, fr: q.fr || '' }));
        if (spk && !srv.speaker) quotesLbl = _discoursAVenir ? 'Derniers propos de la banque' : 'Propos de la banque';   // repli banque (speaker sans propos propres)
      }
    } catch {}
    if (!quotes.length) {   // repli fil en mémoire (client court)
      const items = (typeof allItems !== 'undefined' && Array.isArray(allItems)) ? allItems : [];
      const nameRx = spk ? new RegExp('\\b' + speaker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i') : cb.rx;
      const cutoff = Date.now() - 30 * 86400e3;
      const pool = items.filter(i => i && i.headline && (i.timestamp || 0) > cutoff && /:/.test(i.headline)).map(i => ({ h: i.headline, ts: i.timestamp || 0 }));   // « Fed's Logan: … » = propos rapporté
      quotes = pool.filter(i => nameRx.test(i.h));
      if (!quotes.length && spk) { quotes = pool.filter(i => cb.rx.test(i.h)); quotesLbl = _discoursAVenir ? 'Derniers propos de la banque' : 'Propos de la banque'; }
    }
    // Découpe (attribution + déclaration VO) + classe chaque propos ; PRIORITÉ à ceux qui portent un SIGNAL
    // (hawkish/dovish/hold) — ce sont eux qui aident à interpréter la prochaine réunion — puis les plus récents.
    /* ⚠️ DEUX TEXTES, DEUX USAGES, ET C'EST LE POINT DÉLICAT. `statement` reste la VO : c'est elle
       que `_calToneOf` analyse, et ses regex (`_CAL_HAWK_RX`, `_CAL_DOVE_RX`, `_CAL_HOLD_RX`) sont
       ANGLAISES. Y mettre la traduction rendrait le badge hawkish/dovish muet — le panneau perdrait
       sa lecture de posture pour gagner une lecture de propos. `fr` ne sert QU'À PEINDRE. */
    quotes = quotes.map(q => { const p = _calQuoteParts(q.h); return { h: q.h, ts: q.ts, fr: q.fr || '', who: p.who, statement: p.statement, t: _calToneOf([p.statement]) }; });
    // TON AVANT / APRÈS RÉUNION (demande user) : on partage les propos autour de l heure de
    // l evenement. Le calcul se fait sur la liste COMPLETE — le tronquer a 3 citations d abord
    // biaiserait le partage (les 3 retenues peuvent toutes etre du meme cote).
    const _evTs = ev.timestamp || 0;
    const _tonAvant = _evTs ? _calToneOf(quotes.filter(q => (q.ts || 0) <  _evTs).map(q => q.statement || q.h)) : null;
    const _tonApres = _evTs ? _calToneOf(quotes.filter(q => (q.ts || 0) >= _evTs).map(q => q.statement || q.h)) : null;
    quotes.sort((a, b) => (b.t ? 1 : 0) - (a.t ? 1 : 0) || (b.ts || 0) - (a.ts || 0));
    const _quotesTout = quotes.slice();   // le pool COMPLET : le mode « discours passé » partage dessus
    quotes = quotes.slice(0, 3);
    const tone = _calToneOf(quotes.map(q => q.statement || q.h));
    // RESULTAT EN PREMIER des qu il est publie : c est la seule chose qu on vient chercher ici.
    let _res = _calDecisionOutcome(Object.assign({ __bank: cb.bank }, ev));   // cb.bank = « Fed (FOMC) », « BCE »…
    // Pas de chiffre sur CET événement (conférence de presse, discours) ? La décision du jour, elle,
    // est peut-être tombée : on la rattache. La fiche passe alors en mode APRÈS-décision — résultat
    // annoncé, pricing d'avant-réunion masqué, taux de référence = celui qui vient d'être fixé.
    const _decJour = _res ? null : _calDecisionDuJour(ev);
    if (_decJour) _res = _calDecisionOutcome(Object.assign({ __bank: cb.bank }, _decJour));
    if (_res) rows.push(`<div class="cal-kb-row"><span class="cal-kb-lbl">${_decJour ? 'Décision du jour' : 'Résultat'}</span><span class="cal-kb-val"><b style="color:${_res.couleur};">${_calEsc(_res.sens)}</b>${_res.attente ? ` <span class="cal-kb-sub">${_calEsc(_res.attente)}</span>` : ''}</span></div>`);
    // Le ton « avant réunion » n a plus d objet une fois la decision connue.
    // Le ton « avant » situe le contexte, le ton « après » dit ce que la banque a réellement
    // communiqué. Les deux sont utiles APRÈS la réunion — c est la comparaison qui informe.
    const _ligneTon = (lbl, t) => `<div class="cal-kb-row"><span class="cal-kb-lbl">${lbl}</span><span class="cal-kb-val"><span class="cal-kb-tone" style="color:${t.color};border-color:${t.color}44;">${t.label}</span> ${t.sens}</span></div>`;
    // Le pricing est nécessaire à la ligne « Lecture » : on le récupère AVANT de composer les
    // lignes (appel en cache, donc instantané) au lieu de le chercher au milieu du bloc.
    const rates = await _calRatesGet();
    const bank = rates && rates.banks && rates.banks.find(b => b.code === ev.currency);
    const _sc = (bank && bank.scenario) || {};
    // Une fois la décision publiée, « prochaine réunion » pointerait encore CELLE QUI VIENT
    // d'avoir lieu (« dans 0 j ») avec son pricing d'avant-réunion : deux informations fausses.
    const _aVenir = !!(bank && bank.next) && (!_res || (bank.nextDays != null && bank.nextDays > 0));
    // HONNÊTETÉ DE LA SOURCE : source=market = pricing RÉEL, sinon estimation maison. Les branches
    // à 0 % sont masquées (un « baisse 0 % » calculé laissait croire à une certitude de marché).
    const _pv = v => (v != null && Math.round(v) > 0) ? Math.round(v) : null;
    const _parts = [_pv(_sc.hold) ? `maintien ${_pv(_sc.hold)}%` : '', _pv(_sc.cut) ? `baisse ${_pv(_sc.cut)}%` : '', _pv(_sc.hike) ? `hausse ${_pv(_sc.hike)}%` : ''].filter(Boolean);
    /* « (PRICING INDISPONIBLE) » RETIRÉ LE 01/09 (demande user, capture à l'appui). C'était du
       diagnostic de fournisseur écrit sur la fiche d'un client : dire qu'une donnée qu'on n'affiche
       pas est indisponible n'apprend rien à qui lit une probabilité. La MENTION DE SOURCE, elle,
       RESTE — et ce n'est pas une demi-mesure : sans elle, « maintien 7% · hausse 93% » se lirait
       comme un pricing de marché alors que c'est le modèle du desk, ce qui EST l'incident client du
       29/08, signalé preuves en main. Le texte dit maintenant exactement la même chose que la ligne
       jumelle du bloc « banque centrale » plus bas, qui portait déjà « · estimation DTP » tout court :
       les deux surfaces cessent au passage de dire la même chose de deux façons. */
    const _probs = _parts.length ? _parts.join(' · ') + (bank && bank.source === 'market' ? ' · pricing de marché' : ' · estimation DTP') : '';

    // AVANT la réunion : le ton et sa portée disent la même chose → UNE ligne. Le badge porte le
    // ton, la phrase ce qu'il implique, et le pricing n'est rappelé que s'il n'apparaît nulle part
    // ailleurs. APRÈS la réunion, on repasse aux deux lignes ton avant / ton après : c'est leur
    // COMPARAISON qui informe, et la lecture prospective n'a plus d'objet.
    /* Un discours passé ne prend pas la lecture prospective générique : son bloc dédié (ci-dessous)
       dit le ton RÉEL du discours, ce qui vaut mieux qu'une projection. */
    const reading = (_res || _estDiscoursPasse) ? '' : _calMeetReading(tone, _sc, { pricingAilleurs: !!(_aVenir && _probs), aDesPropos: quotes.length > 0 });
    if (reading) {
      const _bd = tone ? `<span class="cal-kb-tone" style="color:${tone.color};border-color:${tone.color}44;">${tone.label}</span> ` : '';
      rows.push(`<div class="cal-kb-row"><span class="cal-kb-lbl">Lecture</span><span class="cal-kb-val">${_bd}${reading}</span></div>`);
    } else if (!_estDiscoursPasse) {
      if (_tonAvant) rows.push(_ligneTon('Ton · avant réunion', _tonAvant));
      if (_tonApres) rows.push(_ligneTon('Ton · après réunion', _tonApres));
      if (!_tonAvant && !_tonApres && tone) rows.push(_ligneTon('Ton récent', tone));
    }
    /* Rangée de citations réutilisable (mêmes puces de signal que le bloc historique). */
    const _qRow = (lbl, liste) => {
      const qh = liste.map(q => {
        const chip = q.t ? `<span class="cal-kb-qtone" style="color:${q.t.color};border-color:${q.t.color}55;">${q.t.label}</span>` : '';
        const dt = q.ts ? ' · ' + _calShortDateFr(q.ts) : '';
        return `<div class="cal-kb-qline">${chip}<span class="cal-kb-quote">${_calEsc(q.fr || q.statement || q.h)}</span><span class="cal-kb-qwho"> : ${_calEsc(q.who || cb.bank)}${dt}</span></div>`;
      }).join('');
      return `<div class="cal-kb-row"><span class="cal-kb-lbl">${_calEsc(lbl)}</span><span class="cal-kb-val">${qh}</span></div>`;
    };
    if (_estDiscoursPasse) {
      /* Le partage se fait sur la liste NON tronquée : les 3 « meilleures » citations peuvent
         toutes être d'avant, et le discours aurait disparu du tri. On repart donc du pool complet
         (le .slice(0,3) plus haut ne s'applique qu'au chemin générique). */
      const _tri = a => a.sort((x, y) => (y.t ? 1 : 0) - (x.t ? 1 : 0) || (y.ts || 0) - (x.ts || 0));
      const _qPend = _tri(_quotesTout.filter(q => (q.ts || 0) >= _quandEv));
      const _qAv = _tri(_quotesTout.filter(q => (q.ts || 0) < _quandEv));
      if (_qPend.length) {
        const tDisc = _calToneOf(_qPend.map(q => q.statement || q.h));
        if (tDisc) rows.push(_ligneTon('Ton du discours', tDisc));
        rows.push(_qRow('Propos du discours', _qPend.slice(0, 3)));
        if (_qAv.length) rows.push(_qRow('Avant ce discours', _qAv.slice(0, 1)));
      } else {
        const tAv = _tonAvant || tone;
        if (tAv) rows.push(_ligneTon('Ton · avant le discours', tAv));
        if (_qAv.length) rows.push(_qRow('Derniers propos avant ce discours', _qAv.slice(0, 3)));
        rows.push(`<div class="cal-kb-row"><span class="cal-kb-lbl">Propos du discours</span><span class="cal-kb-val cal-kb-muted">Pas encore relayés : la fiche se met à jour dès que le fil reçoit les premières citations (généralement dans l'heure qui suit la prise de parole).</span></div>`);
      }
    } else if (quotes.length) {
      const qhtml = quotes.map(q => {
        const chip = q.t ? `<span class="cal-kb-qtone" style="color:${q.t.color};border-color:${q.t.color}55;">${q.t.label}</span>` : '';   // signal du propos : hausse/baisse/maintien
        const dt = q.ts ? ' · ' + _calShortDateFr(q.ts) : '';
        /* La traduction PRÉCHAUFFÉE si elle est là (français instantané, aucune requête), sinon la
           VO — que `_dtpTranslateQuotes` tentera encore de traduire en place, en dernier recours. */
        return `<div class="cal-kb-qline">${chip}<span class="cal-kb-quote">${_calEsc(q.fr || q.statement || q.h)}</span><span class="cal-kb-qwho"> : ${_calEsc(q.who || cb.bank)}${dt}</span></div>`;
      }).join('');
      rows.push(`<div class="cal-kb-row"><span class="cal-kb-lbl">${_calEsc(quotesLbl)}</span><span class="cal-kb-val">${qhtml}</span></div>`);
    } else {
      rows.push(`<div class="cal-kb-row"><span class="cal-kb-lbl">Propos récents</span><span class="cal-kb-val cal-kb-muted">Aucune intervention récente à citer (période de réserve avant réunion possible) : voir la lecture ci-dessus.</span></div>`);
    }
    if (bank) {
      // Après une décision publiée, le taux de référence est CELUI QUI VIENT D'ÊTRE DÉCIDÉ : la
      // source de pricing peut avoir quelques heures de retard, et afficher 3,63 % sous
      // « maintenu à 3,75 % » donnait deux chiffres contradictoires dans le même bloc.
      const _tauxRef = (_res && _res.taux != null) ? _res.taux : bank.rate;
      if (_tauxRef != null) rows.push(`<div class="cal-kb-row"><span class="cal-kb-lbl">Taux actuel</span><span class="cal-kb-val">${_calEsc(String(_tauxRef).replace('.', ','))}%</span></div>`);
      if (_aVenir) rows.push(`<div class="cal-kb-row"><span class="cal-kb-lbl">Prochaine réunion</span><span class="cal-kb-val">${_calEsc(_calFmtDateFr(bank.next))}${bank.nextDays != null ? (bank.nextDays === 0 ? ' (aujourd\'hui)' : ` (dans ${bank.nextDays} j)`) : ''}${_probs ? `<div class="cal-kb-sub">${_probs}</div>` : ''}</span></div>`);
    }
    // « La banque surveille » : ce qui la fait monter ou baisser les taux — la grille de lecture
    // du discours (un intervenant est TOUJOURS jugé sur ces axes-là).
    const _watch = _CAL_CB_WATCH[ev.currency];
    if (_watch && !_res) rows.push(`<div class="cal-kb-row"><span class="cal-kb-lbl">La banque surveille</span><span class="cal-kb-val"><span class="cal-kb-line">${_watch.quoi}</span>${_calFlux(_watch.flux)}</span></div>`);
    if (!rows.length) return '';
    return `<div class="cal-kb"><div class="cal-detail-section">Banque centrale · ${_calEsc(cb.bank)}</div>${rows.join('')}</div>`;
  }
  // 2) DONNÉE ÉCO : base de connaissance pédagogique
  const kb = CAL_KB.find(k => k.rx.test(title));
  if (!kb) {
    // JAMAIS de cul-de-sac (demande user 23/07 « décryptage pour chaque événement ») : bloc GÉNÉRIQUE honnête
    // pour un indicateur hors familles majeures — lecture par la SURPRISE, sans jugement de polarité inventé.
    const a2 = _calNum(ev.actual), f2 = _calNum(ev.forecast);
    const g = [];
    g.push(`<div class="cal-kb-row"><span class="cal-kb-lbl">À savoir</span><span class="cal-kb-val"><span class="cal-kb-cat">Indicateur</span> Indicateur secondaire (hors familles majeures suivies par le desk) : il se lit par sa SURPRISE (réel vs prévision) plus que par son niveau, réaction de marché généralement limitée.</span></div>`);
    if (a2 != null && f2 != null) {
      const lec = a2 > f2 ? 'AU-DESSUS de la prévision' : a2 < f2 ? 'SOUS la prévision' : 'EN LIGNE avec la prévision';
      g.push(`<div class="cal-kb-row"><span class="cal-kb-lbl">Lecture</span><span class="cal-kb-val">Réel (${_calEsc(ev.actual)}) ${lec} (${_calEsc(ev.forecast)}).</span></div>`);
    } else if (ev.previous) {
      g.push(`<div class="cal-kb-row"><span class="cal-kb-lbl">Repère</span><span class="cal-kb-val">Valeur précédente : ${_calEsc(ev.previous)}.</span></div>`);
    }
    return `<div class="cal-kb"><div class="cal-detail-section">Décryptage DTP</div>${g.join('')}</div>`;
  }
  rows.push(`<div class="cal-kb-row"><span class="cal-kb-lbl">Ce que ça mesure</span><span class="cal-kb-val"><span class="cal-kb-cat">${kb.cat}</span> ${_calEsc(kb.what)}</span></div>`);
  // Lecture factuelle du chiffre publié vs prévision
  const a = _calNum(ev.actual), f = _calNum(ev.forecast);
  if (a != null && f != null) {
    const lecture = a > f ? 'AU-DESSUS de la prévision' : a < f ? 'SOUS la prévision' : 'EN LIGNE avec la prévision';
    rows.push(`<div class="cal-kb-row"><span class="cal-kb-lbl">Lecture</span><span class="cal-kb-val">Réel (${_calEsc(ev.actual)}) ${lecture} (${_calEsc(ev.forecast)}).</span></div>`);
  }
  const conclusion = kb.noConcl ? '' : _calConclusion(kb, a, f, ev);   // noConcl : polarité devise non univoque → pas de verdict automatique
  if (conclusion) rows.push(`<div class="cal-kb-row"><span class="cal-kb-lbl">Conclusion</span><span class="cal-kb-val">${conclusion}</span></div>`);
  rows.push(`<div class="cal-kb-row"><span class="cal-kb-lbl">Peut aider à anticiper</span><span class="cal-kb-val">${_calEsc(kb.anticipates)}</span></div>`);
  // Prochaine échéance LIÉE réellement présente dans le calendrier chargé (même devise, après cet événement)
  if (kb.nextRx && Array.isArray(_calEvents)) {
    const nxt = _calEvents.find(e => e && e.currency === ev.currency && (e.timestamp || 0) > (ev.timestamp || 0) && kb.nextRx.test(e.title || ''));
    if (nxt) {
      const d = nxt.timestamp ? new Date(nxt.timestamp).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) : '';
      rows.push(`<div class="cal-kb-row"><span class="cal-kb-lbl">Prochaine échéance liée</span><span class="cal-kb-val">${_calEsc(nxt.title)}${d ? ' : ' + _calEsc(d) : ''}</span></div>`);
    }
  }
  /* ── POSTURE BANQUE CENTRALE SOUS LA DONNÉE (23/08, call mentor : « CPI UK au-dessus des
     attentes, GBP sans réaction : BoE dovish » — une donnée ne se lit qu'à travers la posture de
     SA banque). Le bloc BC était réservé aux ÉVÉNEMENTS de banque centrale : une publication
     (CPI, NFP…) sortait sans le ton du banquier ni le pricing — Bailey absent de la news CPI UK,
     constat user. Version COMPACTE, déterministe, jamais bloquante : ton récent mesuré + la ligne
     de lecture mentor + 1-2 derniers propos DATÉS et ATTRIBUÉS + prochaine réunion pricée. */
  try {
    if (!_CAL_CB_RX.test(title)) {
      const bcHtml = await _calBcCompactHtml(ev.currency, ev.timestamp || 0);
      if (bcHtml) rows.push(bcHtml);
    }
  } catch (e) {}
  return `<div class="cal-kb"><div class="cal-detail-section">Décryptage DTP</div>${rows.join('')}</div>`;
}

/* ── BLOC « BANQUE CENTRALE » COMPACT, RÉUTILISABLE (23/08, call mentor) ────────────────────────
   Rendu sous les publications du CALENDRIER (via _calValueBlockHtml ci-dessus) ET sous l'Info
   des publications majeures du FIL (app.js, dtpBcBlockHtml) — le Décryptage complet reste
   réservé au calendrier (décision user du 23/07), seul CE bloc voyage : ton mesuré, lecture par
   la posture, propos datés/attribués, prochaine réunion pricée. Jamais bloquant. */
async function _calBcCompactHtml(ccy, tsPub) {
  try {
    const cbD = _CAL_CB_BY_CCY[ccy];
    if (cbD) {
      const bcRows = [];
      let q2 = [];
      try { const srv2 = await _calCbQuotesGet(ccy, null); if (srv2 && srv2.quotes) q2 = srv2.quotes.map(q => ({ h: q.h, ts: q.ts || 0, fr: q.fr || '' })); } catch (e) {}
      /* REPLI FIL EN MÉMOIRE (23/08, constat user « on n'a pas eu le ton avec le discours ») :
         la fiche des réunions l'a toujours eu, le bloc compact ne l'avait pas — si l'endpoint
         des propos revenait vide, le ton disparaissait alors que les dépêches « BoE's
         Bailey: … » étaient LÀ, dans le fil. Même filet que la fiche réunion. */
      if (!q2.length) {
        const items2 = (typeof allItems !== 'undefined' && Array.isArray(allItems)) ? allItems : [];
        const cutoff2 = Date.now() - 30 * 86400e3;
        q2 = items2.filter(i => i && i.headline && (i.timestamp || 0) > cutoff2 && /:/.test(i.headline) && cbD.rx.test(i.headline))
          .map(i => ({ h: i.headline, ts: i.timestamp || 0 }));
      }
      q2 = q2.map(q => { const p = _calQuoteParts(q.h); return { ts: q.ts, who: p.who, statement: p.statement, t: _calToneOf([p.statement]) }; });
      /* TON AVANT / APRÈS LA PUBLICATION (23/08, validé user) : même partage que la fiche des
         réunions — les propos se séparent autour de l'heure de la publication. C'est la
         COMPARAISON qui informe : la posture au moment où le chiffre est tombé (celle qui a
         décidé de la réaction) et ce que la banque a dit DEPUIS. */
      const _tsPub = tsPub || 0;
      const _avant2 = _tsPub ? q2.filter(q => (q.ts || 0) < _tsPub) : q2;
      const _apres2 = _tsPub ? q2.filter(q => (q.ts || 0) >= _tsPub) : [];
      const tonAvant2 = _calToneOf(_avant2.map(q => q.statement || ''));
      const tonApres2 = _calToneOf(_apres2.map(q => q.statement || ''));
      const ton2 = tonAvant2 || _calToneOf(q2.map(q => q.statement || ''));
      if (ton2) {
        // La leçon du mentor, rendue déterministe par le ton MESURÉ (jamais supposé). Le ton
        // retenu pour la lecture est celui d'AVANT la publication : c'est lui qui a décidé de
        // la réaction (CPI UK chaud + BoE dovish = GBP immobile).
        /* ⚠️ ON LIT LA CLÉ, PAS L'ÉTIQUETTE (09/09, mesuré). Ces deux tests portaient sur
           `ton2.label` — et l'étiquette a été TRADUITE le 28/08 : « Restrictif », « Accommodant ».
           `/hawk/` ne trouve rien dans « Restrictif », `/dov/` rien dans « Accommodant » : la
           phrase tombait donc TOUJOURS dans la branche neutre. Le desk affichait un badge rouge
           « Accommodant » suivi de « sans posture affirmée » — la couleur disait une chose, le
           texte à côté disait le contraire. C'est très exactement pour cela que `_calToneOf`
           conserve une clé interne ('hawk'/'dove'/'hold') que la traduction ne touche jamais ;
           encore fallait-il s'en servir. Une étiquette est de l'AFFICHAGE, elle ne décide de rien. */
        const sens2 = ton2.key === 'hawk'
          ? 'ce ton AMPLIFIE les surprises qui vont dans son sens (inflation chaude, emploi solide) et amortit les autres'
          : ton2.key === 'dove'
            ? 'ce ton AMORTIT les surprises de fermeté : un chiffre chaud bouge peu, le marché sait que la banque n\'entend pas réagir'
            : 'sans posture affirmée, la surprise garde tout son poids';
        bcRows.push(`<div class="cal-kb-row"><span class="cal-kb-lbl">Lecture par la posture</span><span class="cal-kb-val"><span class="cal-kb-tone" style="color:${ton2.color};border-color:${ton2.color}44;">${ton2.label}</span> ${sens2}.</span></div>`);
      }
      const _ligneTon2 = (lbl, t) => `<div class="cal-kb-row"><span class="cal-kb-lbl">${lbl}</span><span class="cal-kb-val"><span class="cal-kb-tone" style="color:${t.color};border-color:${t.color}44;">${t.label}</span> ${t.sens || ''}</span></div>`;
      if (_tsPub && tonAvant2 && tonApres2) {
        bcRows.push(_ligneTon2('Ton · avant la publication', tonAvant2));
        bcRows.push(_ligneTon2('Ton · depuis la publication', tonApres2));
      }
      // Propos affichés : 1 d'avant + 1 d'après quand les deux existent (la comparaison), sinon
      // les 2 plus parlants (signal d'abord, puis fraîcheur).
      const _tri2 = a => a.sort((x, y) => (y.t ? 1 : 0) - (x.t ? 1 : 0) || (y.ts || 0) - (x.ts || 0));
      let _montres2 = [];
      if (_avant2.length && _apres2.length) _montres2 = [_tri2(_avant2.slice())[0], _tri2(_apres2.slice())[0]];
      else _montres2 = _tri2(q2.slice()).slice(0, 2);
      if (_montres2.length) {
        const qh2 = _montres2.map(q => `<div class="cal-kb-qline"><span class="cal-kb-quote">${_calEsc(q.fr || q.statement || '')}</span><span class="cal-kb-qwho"> : ${_calEsc(q.who || cbD.bank)}${q.ts ? ' · ' + _calShortDateFr(q.ts) : ''}</span></div>`).join('');
        bcRows.push(`<div class="cal-kb-row"><span class="cal-kb-lbl">Derniers propos</span><span class="cal-kb-val">${qh2}</span></div>`);
      }
      let bank2 = null; try { const r2 = await _calRatesGet(); bank2 = r2 && r2.banks && r2.banks.find(b => b.code === ccy); } catch (e) {}
      if (bank2 && bank2.next) {
        const sc2 = bank2.scenario || {};
        const pv2 = v => (v != null && Math.round(v) > 0) ? Math.round(v) : null;
        const pr2 = [pv2(sc2.hold) ? `maintien ${pv2(sc2.hold)}%` : '', pv2(sc2.cut) ? `baisse ${pv2(sc2.cut)}%` : '', pv2(sc2.hike) ? `hausse ${pv2(sc2.hike)}%` : ''].filter(Boolean).join(' · ');
        bcRows.push(`<div class="cal-kb-row"><span class="cal-kb-lbl">Prochaine réunion</span><span class="cal-kb-val">${_calEsc(_calFmtDateFr(bank2.next))}${bank2.nextDays != null && bank2.nextDays > 0 ? ` (dans ${bank2.nextDays} j)` : ''}${pr2 ? `<div class="cal-kb-sub">${pr2}${bank2.source === 'market' ? ' · pricing de marché' : ' · estimation DTP'}</div>` : ''}</span></div>`);
      }
      if (bcRows.length) return `<div class="cal-detail-section">Banque centrale · ${_calEsc(cbD.bank)}</div>` + bcRows.join('');
    }
  } catch (e) {}
  return '';
}
// Exposé au FIL (app.js) : le bloc BC seul, prêt à s'insérer en bas du panneau Info d'une
// publication majeure — enveloppé .cal-kb par l'appelant pour hériter des styles du Décryptage.
async function dtpBcBlockHtml(ccy, tsPub) { return _calBcCompactHtml(ccy, tsPub || 0); }

// ── Exposés pour le FIL DE NEWS (app.js) : une news d'événement (donnée éco / banque centrale)
//    porte le MÊME Décryptage DTP que le calendrier (onglet « Décryptage » au dépliage). ──
// INFÉRENCE DE DEVISE (demande user 22/07 « décryptage DTP pour chaque news intelligemment ») : la plupart
// des news du fil n'ont PAS de champ currency → le bloc Banque centrale (« Powell : … ») et la « prochaine
// échéance liée » ne sortaient jamais. On déduit la devise du TITRE (banque/pays), déterministe, 0 IA.
function _dtpNewsCcy(headline, currency) {
  if (currency) return currency;
  const h = String(headline || '');
  if (/\b(fed(?:'s)?|fomc|powell)\b/i.test(h)) return 'USD';
  if (/\b(ecb(?:'s)?|bce|lagarde)\b/i.test(h)) return 'EUR';
  if (/\b(boe(?:'s)?|bank of england|bailey)\b/i.test(h)) return 'GBP';
  if (/\b(boj(?:'s)?|bank of japan|ueda)\b/i.test(h)) return 'JPY';
  if (/\b(snb|bns|swiss national bank)\b/i.test(h)) return 'CHF';
  if (/\b(boc(?:'s)?|bank of canada|macklem)\b/i.test(h)) return 'CAD';
  if (/\b(rba|reserve bank of australia)\b/i.test(h)) return 'AUD';
  if (/\b(rbnz|reserve bank of new zealand)\b/i.test(h)) return 'NZD';
  if (/\b(us|u\.s\.|american)\b/i.test(h)) return 'USD';
  if (/\b(german|french|euro ?zone|euro area|spanish|italian)\b/i.test(h)) return 'EUR';
  if (/\b(uk|british|britain)\b/i.test(h)) return 'GBP';
  if (/\b(japan(?:ese)?)\b/i.test(h)) return 'JPY';
  if (/\b(swiss|switzerland)\b/i.test(h)) return 'CHF';
  if (/\b(canad(?:a|ian))\b/i.test(h)) return 'CAD';
  if (/\b(australian?)\b/i.test(h)) return 'AUD';
  if (/\b(new zealand|kiwi)\b/i.test(h)) return 'NZD';
  return '';
}
function dtpEventInsightMatch(headline, currency) {
  const h = String(headline || '');
  const ccy = _dtpNewsCcy(headline, currency);
  if (_CAL_CB_RX.test(h) && _CAL_CB_BY_CCY[ccy]) return true;
  return CAL_KB.some(k => k.rx.test(h));
}
/* Le FIL DE NEWS a besoin de la DÉFINITION d'un indicateur, pas du bloc complet : le « Décryptage »
   reste réservé au calendrier (décision user du 23/07, commit c383758). On expose donc la seule
   fiche, pour que la description d'une news s'appuie sur LA MÊME BASE que le calendrier, celle
   tirée de la fiche pédagogique « Learning Economics News ».
   ⚠️ C'est le point de la manœuvre : j'avais d'abord écrit une seconde liste d'indicateurs dans
   app.js, à côté de celle-ci. Deux listes qui disent la même chose finissent toujours par diverger,
   et c'est la copie oubliée qui se met à mentir. Une seule base, deux surfaces. */
function dtpKbPourTitre(headline) {
  const h = String(headline || '');
  return CAL_KB.find(k => k.rx.test(h)) || null;
}
/* LA MÊME FICHE, RETROUVÉE PAR SON NOM (31/08). La reconnaissance ci-dessus lit l'ANGLAIS du
   calendrier (« gross domestic », « core pce ») : elle ne peut rien faire d'un titre français comme
   « ANALYSE PIB US : … ». Quand le desk sait déjà de quel indicateur il parle — c'est le cas d'une
   analyse d'événement, qui est produite POUR un indicateur précis — il le nomme, et on va chercher
   sa fiche directement. On rend un objet minimal plutôt que rien si la fiche manque : le tag doit
   pouvoir s'afficher même sans définition à mettre en infobulle. */
function dtpKbParNom(nom) {
  const n = String(nom || '').trim();
  if (!n) return null;
  return CAL_KB.find(k => k.name === n) || { name: n };
}
async function dtpEventInsightHtml(item) {
  return _calValueBlockHtml({ title: item.headline, currency: _dtpNewsCcy(item.headline, item.currency), actual: item.actual, forecast: item.forecast, timestamp: item.timestamp });
}

// Clic sur un événement → ouvre/ferme un DÉROULÉ INLINE sous la ligne (accordéon). PAS de fenêtre modale.
async function toggleCalDetailRow(tr, ev) {
  if (!tr || !tr.parentNode) return;
  const tbody = tr.parentNode;
  // Toggle : si le déroulé de CETTE ligne est déjà ouvert juste en dessous → le fermer
  const after = tr.nextElementSibling;
  if (after && after.classList.contains('cal-detail-row')) {
    after.remove();
    tr.classList.remove('cal-row--expanded');
    return;
  }
  // Un seul déroulé ouvert à la fois : fermer les autres
  tbody.querySelectorAll('.cal-detail-row').forEach(r => r.remove());
  tbody.querySelectorAll('.cal-row--expanded').forEach(r => r.classList.remove('cal-row--expanded'));
  tr.classList.add('cal-row--expanded');

  const dateStr = ev.timestamp
    ? new Date(ev.timestamp).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' })
    : '';   // Europe/Paris (bug 17/07 : la date UTC affichait « jeudi 16 » pour un événement du vendredi 17 à 01:00, l'heure étant déjà en Paris)
  const timeStr = calFormatTime(ev.timestamp) || ev.time || '';
  const detailRow = document.createElement('tr');
  detailRow.className = 'cal-detail-row';
  /* ⚠️ LE NOMBRE DE COLONNES SE COMPTE SUR LA LIGNE, PAS DANS UN RÉGLAGE (31/08, capture user
     « il y a un décalage quand on déroule une news »).
     Ce déroulé est PARTAGÉ par deux rendus qui ne lisent pas le même réglage de colonnes :
     la vue plein écran suit la préférence globale de l'onglet (`_calColVisible`, DTPPref
     « calcolhigh »), le panneau à ONGLETS suit une option propre à la carte (widgets.js,
     `opt(it, W, 'col_high')`). Masquer Haut et Bas sur la carte laissait donc la préférence
     globale à sa valeur par défaut — visible — et le déroulé annonçait 10 colonnes à une table
     qui n'en compte que 8. Deux colonnes fantômes entraient au modèle et, dans ce conteneur-là,
     les colonnes RÉELLES s'effondraient : mesuré au banc, bandeau de jour et dernière cellule
     tombant de 851 px à 504 px pendant que le déroulé gardait toute la largeur.
     (D'abord corrigé le même jour par la formule `8 + Haut + Bas` — juste pour la vue plein
     écran, sans effet dans le panneau à onglets, qui est justement celui de la capture.)
     La ligne cliquée porte la vérité : autant de colonnes que de cellules, quel que soit le
     rendu qui l'a produite et quels que soient les réglages de demain. */
  const _nbCol = tr.children.length || 8;
  detailRow.innerHTML = `<td colspan="${_nbCol}"><div class="cal-detail-inline">
      <div class="cal-detail-inline-head">
        <span class="cal-detail-flag">${CAL_FLAG(ev.currency)}</span>
        <div>
          <div class="cal-detail-title">${_calEsc(ev.title || '')}</div>
          <div class="cal-detail-sub">${_calEsc(ev.currency || '')} · ${_calEsc(dateStr)}${timeStr ? ' · ' + _calEsc(timeStr) : ''}</div>
        </div>
      </div>
      ${_calDetailHeadVals(ev)}
      <div class="cal-detail-body">${window.dtpLoader ? window.dtpLoader('Chargement des détails…', { small: true }) : 'Chargement…'}</div>
    </div></td>`;
  tr.after(detailRow);
  const bodyEl = detailRow.querySelector('.cal-detail-body');

  // Bloc « Décryptage DTP » (pédagogie donnée éco OU banque centrale) — TOUJOURS tenté, il remplace
  // le cul-de-sac « Aucun détail supplémentaire disponible » (demande user 16/07).
  let kbHtml = '';
  try { kbHtml = await _calValueBlockHtml(ev) || ''; } catch {}

  if (!ev.url) {
    if (bodyEl && bodyEl.isConnected) {
      bodyEl.innerHTML = kbHtml || '<div class="cal-detail-empty">Aucun détail supplémentaire disponible.</div>';
      if (window._dtpTranslateQuotes) window._dtpTranslateQuotes(bodyEl, '.cal-kb-quote');   // propos BC (titres du fil, EN) → FR en place (demande user 17/07)
      _calAppendHistory(bodyEl, ev);   // fiche événement : historique des publications (~6 mois), async
    }
    return;
  }

  // Cache navigateur
  /* ⚠️ LE SERVEUR PEUT RÉPONDRE « JE CHERCHE ENCORE » (10/09, retour user : « il prend du temps à
     charger »). Il ouvre un navigateur complet sur la page de l'événement ; au-delà de six
     secondes il rend la main avec `pending: true` et poursuit sa récupération en fond. Le desk ne
     doit donc pas retomber sur « Détails indisponibles » — ce serait dire faux — mais annoncer
     l'attente ET redemander tout seul. Une seule relance, cinq secondes plus tard : à ce
     moment-là le cache du serveur est rempli et la réponse est immédiate. Si elle ne l'est pas,
     on le dit franchement plutôt que de tourner indéfiniment.
     ⚠️ ET ON N'ENTRE JAMAIS UNE RÉPONSE D'ATTENTE DANS LE CACHE : elle est vide par construction,
     la mettre en cache figerait le vide pour toute la session. */
  let d = _calDetailCache[ev.url];
  if (!d) {
    /* fetch borné (dtpFetchBorne, app.js) : sans lui, un serveur qui ne répond jamais — même pas
       par { pending: true } — laissait « Chargement des détails… » tourner à l'infini (capture
       user 11/09, Core CPI m/m). 15 s = large marge au-delà des 6 s annoncées par le serveur
       avant son propre relais en pending. */
    const demander = () => (window.dtpFetchBorne ? window.dtpFetchBorne('/api/calendar-detail?url=' + encodeURIComponent(ev.url), {}, 15000) : fetch('/api/calendar-detail?url=' + encodeURIComponent(ev.url))).then(r => r.json()).catch(() => null);
    try {
      d = await demander();
      if (d && d.pending) {
        if (bodyEl && bodyEl.isConnected) {
          bodyEl.innerHTML = '<div class="cal-detail-empty">Les détails arrivent : la source est lente à répondre. Nouvel essai dans 5 secondes…</div>';
        }
        await new Promise(r => setTimeout(r, 5000));
        if (!bodyEl || !bodyEl.isConnected) return;      // déroulé refermé pendant l'attente
        d = await demander();
        if (d && d.pending) d = null;                    // toujours rien : on tombera sur le message d'indisponibilité
      }
      if (d && ((d.specs && d.specs.length) || (d.history && d.history.length))) _calDetailCache[ev.url] = d;
    } catch { d = null; }
  }
  if (!bodyEl || !bodyEl.isConnected) return;   // déroulé fermé entre-temps
  const detHtml = _calDetailBodyHtml(d, ev.title);
  bodyEl.innerHTML = (kbHtml + detHtml) || '<div class="cal-detail-empty">Détails indisponibles pour le moment.</div>';
  if (window._dtpTranslateQuotes) window._dtpTranslateQuotes(bodyEl, '.cal-kb-quote');   // propos BC → FR en place
  _calAppendHistory(bodyEl, ev);   // fiche événement : historique des publications (~6 mois), async
}

// ── FICHE ÉVÉNEMENT — « Historique des publications » (phase 2 différée, livrée 23/07) : les dernières
//    sorties du MÊME indicateur (~6 mois, /api/event-history) en MINI-BARRES + valeurs, ancien → récent.
//    Réel coloré par la SURPRISE (vert = mieux que prévu pour la devise ; chômage/inscriptions inversés).
//    Ajouté APRÈS le rendu du déroulé (async) ; silencieux si < 2 publications. 0 IA. ──
async function _calAppendHistory(bodyEl, ev) {
  if (!bodyEl || !ev || !ev.title || !ev.currency) return;
  if (bodyEl.querySelector('.cal-hist-table')) return;   // le déroulé a déjà une table Historique (scrape détail) — pas de doublon
  try {
    const j = await fetch('/api/event-history?ccy=' + encodeURIComponent(ev.currency) + '&title=' + encodeURIComponent(ev.title)).then(r => r.json());
    const rows = (j && j.items) || [];
    if (rows.length < 2 || !bodyEl.isConnected) return;
    const nums = rows.map(r => _calNum(r.actual)).filter(v => v != null);
    if (nums.length < 2) return;
    const min = Math.min.apply(null, nums), max = Math.max.apply(null, nums), ecart = max - min;
    // ÉCHELLE. L'ancienne version mettait le minimum à 10 % de hauteur : sur une série PLATE
    // (taux inchangé depuis 6 mois) toutes les valeurs SONT le minimum → cinq moignons de 4 px,
    // illisibles. « Inchangé » est pourtant une information forte : on la rend par un plateau
    // franc à mi-hauteur. Quand la série bouge, un socle sous le minimum garde la plus petite
    // barre lisible tout en laissant voir l'écart entre publications.
    const socle = ecart ? min - ecart * 0.28 : 0;
    const haut = v => v == null ? 8 : (ecart ? Math.round(40 + ((v - socle) / (max - socle)) * 60) : 58);
    const plateau = !ecart && rows.length >= 3;
    const inv = /unemployment|jobless|claims/i.test(ev.title || '');
    const cols = rows.map((r, i) => {
      const d = r.ts ? new Date(r.ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '';
      const a = _calNum(r.actual), f = _calNum(r.forecast);
      let cls = '';
      if (a != null && f != null && a !== f) cls = ((a > f) === !inv) ? 'g' : 'r';
      const hpct = haut(a);
      return `<div class="cal-hist-col${i === rows.length - 1 ? ' last' : ''}" title="${_calEsc(r.actual)}${r.forecast ? ' (prév. ' + _calEsc(r.forecast) + ')' : ''}, ${_calEsc(d)}">
        <div class="cal-hist-barwrap"><div class="cal-hist-bar ${cls}" style="height:${hpct}%"></div></div>
        <div class="cal-hist-val ${cls}">${_calEsc(r.actual)}</div>
        <div class="cal-hist-prev">${r.forecast ? 'prév. ' + _calEsc(r.forecast) : '&nbsp;'}</div>
        <div class="cal-hist-date">${_calEsc(d)}</div></div>`;
    }).join('');
    const box = document.createElement('div');
    box.className = 'cal-kb cal-hist';
    box.innerHTML = `<div class="cal-detail-section">Historique des publications <span class="cal-hist-sub">ancien → récent${plateau ? ' · inchangé sur les ' + rows.length + ' dernières publications' : ' · ~6 mois'}</span></div><div class="cal-hist-row custom-scrollbar">${cols}</div>`;
    bodyEl.appendChild(box);
  } catch {}
}

// ── Calendar helper: refresh data from server ─────────────────────────────────
async function _refreshCalendarData(silent = false) {
  try {
    const res  = await fetch(_calFetchUrl());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const items = json.items || [];
    if (items.length > 0) {
      _calEvents = items.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      if (!silent) renderCalTable();
      _calUpdateDateRangeLabel();
      return true;
    }
  } catch (e) { console.warn('[Cal] Refresh failed:', e.message); }
  return false;
}

// Libellé de plage « DD/MM/YYYY – DD/MM/YYYY » (min→max des events chargés). Heure LOCALE (cohérent avec les lignes de jour).
function _calUpdateDateRangeLabel() {
  const el = document.getElementById('cal-daterange');
  if (!el || !_calEvents.length) return;
  const dates = _calEvents.map(e => e.timestamp).filter(Boolean);
  if (!dates.length) return;
  const fmt = ts => new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  el.textContent = `${fmt(Math.min(...dates))} – ${fmt(Math.max(...dates))}`;
}

// ── Navigation historique du calendrier : flèches ‹ › (jusqu'à 3 mois en arrière ; 0 = live). ──
let _calNavBusy = false;   // verrou anti-course : un seul aller-retour de navigation à la fois
function _calUpdateRangeNav() {
  const prev = document.getElementById('cal-range-prev');
  const next = document.getElementById('cal-range-next');
  if (prev) prev.disabled = _calNavBusy || _calBackMonths >= 3;   // bornes : occupé, ou 3 mois max
  if (next) next.disabled = _calNavBusy || _calBackMonths <= 0;   // bornes : occupé, ou présent (live)
}
async function _calSetBack(months) {
  months = Math.max(0, Math.min(3, months));
  if (_calNavBusy || months === _calBackMonths) return;   // fetch en cours ou déjà à ce niveau → clic ignoré (anti-course)
  _calNavBusy = true;
  const prevMonths = _calBackMonths;
  _calBackMonths = months;
  _calNeedsScroll = (months === 0);                // retour live → scroll sur l'événement courant ; historique → géré ci-dessous
  const wrap = document.getElementById('cal-table-wrap');
  if (wrap) wrap.innerHTML = _calSkel();
  _calUpdateRangeNav();                            // désactive les 2 flèches pendant le fetch
  const ok = await _refreshCalendarData(false);    // fetch _calFetchUrl() → remplace _calEvents + rend, seulement en cas de succès
  if (!ok) {                                        // échec réseau / plage indisponible → on revient à l'état précédent, sans perdre l'affichage
    _calBackMonths = prevMonths;
    if (_calEvents.length) renderCalTable();
  } else if (months > 0) {
    requestAnimationFrame(() => { const w = document.getElementById('cal-table-wrap'); if (w) w.scrollTop = 0; });   // historique → plus anciens en haut
  }
  _calNavBusy = false;
  _calUpdateRangeNav();
}
function _calWireRangeNav() {
  const prev = document.getElementById('cal-range-prev');
  const next = document.getElementById('cal-range-next');
  if (prev && !prev.dataset.wired) { prev.dataset.wired = '1'; prev.addEventListener('click', () => _calSetBack(_calBackMonths + 1)); }
  if (next && !next.dataset.wired) { next.dataset.wired = '1'; next.addEventListener('click', () => _calSetBack(_calBackMonths - 1)); }
  _calUpdateRangeNav();
}
// Réinitialise le calendrier sur le LIVE (appelé quand « Semaine à venir » s'ouvre) : le miroir « En direct »
// clone #cal-table-wrap → il ne doit JAMAIS refléter une vue historique. Vide _calEvents → rechargement live.
function _calResetToLive() {
  if (_calBackMonths === 0) return;
  _calBackMonths = 0;
  _calEvents = [];
  _calUpdateRangeNav();
}
window._calSetBack = _calSetBack;
window._calResetToLive = _calResetToLive;

// Skeleton du calendrier : epouse la structure reelle (.cal-table, 10 colonnes, separateurs de jour).
// Injecte dans #cal-table-wrap PENDANT le fetch -> auto-efface par le renderCalTable() qui reecrit ce conteneur.
function _calSkel() {
  // Memes classes cth-val--* que la vraie table : sans elles, le masquage responsive (par classe,
  // plus par position) ne s'appliquerait pas au squelette et il serait plus large que la table reelle.
  const cols = ['cth-time','cth-flag','cth-curr','cth-imp','cth-event','cth-val cth-val--reel','cth-val cth-val--haut','cth-val cth-val--prev','cth-val cth-val--bas','cth-val cth-val--prec'];
  let rows = '';
  for (let g = 0; g < 2; g++) {
    rows += '<tr class="cal-day-sep cal-skel-sep" aria-hidden="true"><td colspan="10"><span class="dtp-skel"></span></td></tr>';
    for (let i = 0; i < 6; i++) {
      rows += '<tr class="cal-row cal-skel-row" aria-hidden="true">'
        + cols.map(c => '<td class="' + c + '"><span class="dtp-skel"></span></td>').join('')
        + '</tr>';
    }
  }
  return '<table class="cal-table">'
    + '<thead><tr>'
    + '<th class="cth-time">Heure</th><th class="cth-flag">Pays</th><th class="cth-curr">Dev.</th>'
    + '<th class="cth-imp">IMPACT</th><th class="cth-event">ÉVÉNEMENT</th><th class="cth-val cth-val--reel">RÉEL</th>'
    + '<th class="cth-val cth-val--haut">HAUT</th><th class="cth-val cth-val--prev">PRÉVISION</th><th class="cth-val cth-val--bas">BAS</th><th class="cth-val cth-val--prec">PRÉCÉDENT</th>'
    + '</tr></thead>'
    + '<tbody>' + rows + '</tbody></table>';
}

async function buildCalendar() {
  // Mark that next renderCalTable call should auto-scroll to current event
  _calNeedsScroll = true;

  const wrap = document.getElementById('cal-table-wrap');
  if (!wrap) return;

  if (_calEvents.length === 0) {
    wrap.innerHTML = _calSkel();   // skeleton (epouse .cal-table) au lieu du loader texte

    let loaded = false;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res  = await fetch(_calFetchUrl());
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const items = json.items || [];
        if (items.length > 0) {
          _calEvents = items.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
          loaded = true;
          break;
        }
        // Empty response : server may still be fetching; wait and retry
        if (attempt < 4) {
          wrap.innerHTML = _calSkel();   // skeleton (epouse .cal-table) au lieu du loader texte
          await new Promise(r => setTimeout(r, 3000));
        }
      } catch {
        if (attempt < 4) {
          wrap.innerHTML = _calSkel();   // skeleton (au lieu de "Connexion…")
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    }

    if (!loaded) {
      wrap.innerHTML = `<div class="cal-empty" style="padding:40px 20px;text-align:center;">
        <div style="color:var(--text4);font-size:11px;margin-bottom:12px;">Calendrier indisponible : le serveur démarre peut-être encore.</div>
        <button onclick="window._retryCalendar()"
          style="background:var(--bg3);border:1px solid var(--border2);color:var(--text2);padding:4px 12px;font-size:10px;cursor:pointer;border-radius:2px;font-family:var(--font-mono);">
          Retry
        </button>
      </div>`;
      return;
    }
  }

  const impBar = document.getElementById('cal-impact-filter');
  if (impBar && !impBar.dataset.wired) {
    impBar.dataset.wired = '1';
    // Filtre d'impact MÉMORISÉ PAR COMPTE (12/08) : un trader qui ne suit que les annonces à fort
    // impact devait le re-sélectionner à chaque ouverture. On restaure avant le premier rendu.
    const _voulu = (function () { try { return DTPPref.get('calimp', ''); } catch (e) { return ''; } })();
    if (_voulu && impBar.querySelector('[data-imp="' + _voulu + '"]')) {
      _calImpFilter = _voulu;
      impBar.querySelectorAll('[data-imp]').forEach(b => b.classList.toggle('cal-imp-btn--active', b.dataset.imp === _voulu));
    }
    impBar.addEventListener('click', e => {
      const btn = e.target.closest('[data-imp]');
      if (!btn) return;
      _calImpFilter = btn.dataset.imp;
      try { DTPPref.set('calimp', _calImpFilter); } catch (e2) {}
      impBar.querySelectorAll('[data-imp]').forEach(b =>
        b.classList.toggle('cal-imp-btn--active', b.dataset.imp === _calImpFilter));
      renderCalTable();
    });
  }
  const searchEl = document.getElementById('cal-search');
  if (searchEl && !searchEl.dataset.wired) {
    searchEl.dataset.wired = '1';
    searchEl.addEventListener('input', e => { _calSearch = e.target.value; renderCalTable(); });
  }
  _calWireRangeNav();   // flèches ‹ › (navigation historique jusqu'à 3 mois)

  _calUpdateDateRangeLabel();   // libellé de plage (même helper que le refresh → format/TZ cohérents)

  renderCalTable();

  // Auto-refresh calendrier toutes les 5 min (les actuals apparaissent vite après chaque sortie)
  /* CADENCE ADAPTATIVE (12/08, demande user « la data doit être mise à jour instantanément à sa
     sortie »). Le serveur accélère déjà autour des publications ; si le client, lui, ne redemande
     que toutes les 5 minutes, le gain est perdu à la dernière étape. Même règle des deux côtés :
     dès qu'une publication à fort impact a dépassé son heure sans résultat affiché, on redemande
     toutes les 20 s jusqu'à ce que le chiffre tombe. Le reste de la journée, on reste à 5 min. */
  if (!window._calAutoRefreshInterval) {
    const EN_ATTENTE = () => {
      try {
        const now = Date.now();
        return (_calEvents || []).some(e => e
          && /high|medium/i.test(e.impact || '')
          && !(e.actual && String(e.actual).trim())
          && (e.timestamp || 0) <= now && (now - (e.timestamp || 0)) < 12 * 60 * 1000);
      } catch (e) { return false; }
    };
    let _dernier = 0;
    window._calAutoRefreshInterval = setInterval(() => {
      const rapide = EN_ATTENTE();
      const ecart = rapide ? 20 * 1000 : 5 * 60 * 1000;
      if (Date.now() - _dernier < ecart) return;
      _dernier = Date.now();
      _refreshCalendarData(false);
    }, 20 * 1000);
  }
}

window._retryCalendar = function() {
  _calEvents = [];
  buildCalendar();
};

// ═══════════════════════════════════════════════════════════════════════════════
//  Recherche symbole → onglet pair (chart TradingView + force devises + calendrier + news)
//  Taper une paire dans « Search Symbols » ouvre/maj un onglet dynamique (croix pour fermer),
//  vue 4 panneaux 100 % axée sur la paire. Volatil (recents non persistés).
// ═══════════════════════════════════════════════════════════════════════════════
// ── Splitters redimensionnables de la vue symbole (grille 2x2) : vertical entre colonnes (--sym-col),
//    horizontal entre lignes (--sym-row). Volatil : la taille vit inline → reset au reload (charte). ──
(function initSymResize() {
  const grid = document.getElementById('sym-grid');
  if (!grid) return;
  const vsplit = document.getElementById('sym-vsplit');
  const hsplit = document.getElementById('sym-hsplit');
  function drag(handle, axis, prop) {
    if (!handle) return;
    const down = e => {
      e.preventDefault();
      const rect = grid.getBoundingClientRect();
      /* ⚠️ GLISSEMENT EN DELTA, PLUS EN POSITION ABSOLUE (30/08, demande user « le déplacement doit
         correspondre exactement au mouvement de la souris »). L'ancien calcul posait la colonne à
         `clientX − rect.left` : il ignorait le padding de 8px de la grille (décalage constant) et,
         surtout, faisait SAUTER la ligne sous le curseur au premier mouvement dès qu'on n'avait pas
         saisi le splitter pile en son centre. On mesure la taille RÉELLE du premier volet au moment
         de la prise, puis chaque mouvement applique le seul déplacement de la souris : 1 px de
         souris = 1 px de splitter, zéro saut à la prise. */
      const p0 = (e.touches ? e.touches[0] : e);
      const dep = axis === 'x' ? p0.clientX : p0.clientY;
      const premier = grid.children[0] ? grid.children[0].getBoundingClientRect() : null;
      const base = premier ? (axis === 'x' ? premier.width : premier.height)
                           : (axis === 'x' ? rect.width / 2 : rect.height / 2);
      handle.classList.add('dragging'); grid.classList.add('sym-dragging');
      document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
      const move = ev => {
        const p = ev.touches ? ev.touches[0] : ev;
        if (axis === 'x') {
          const v = Math.max(rect.width * 0.22, Math.min(rect.width * 0.78, base + (p.clientX - dep)));
          grid.style.setProperty(prop, v + 'px');
        } else {
          const v = Math.max(rect.height * 0.2, Math.min(rect.height * 0.8, base + (p.clientY - dep)));
          grid.style.setProperty(prop, v + 'px');
        }
      };
      const up = () => {
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
        document.removeEventListener('touchmove', move); document.removeEventListener('touchend', up);
        handle.classList.remove('dragging'); grid.classList.remove('sym-dragging'); document.body.style.cursor = '';
        try { window.dispatchEvent(new Event('resize')); } catch {}   // le chart TradingView se recale sur la nouvelle largeur
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      document.addEventListener('touchmove', move, { passive: false }); document.addEventListener('touchend', up);
    };
    handle.addEventListener('mousedown', down);
    handle.addEventListener('touchstart', down, { passive: false });
  }
  drag(vsplit, 'x', '--sym-col');   // splitter vertical → colonnes
  drag(hsplit, 'y', '--sym-row');   // splitter horizontal → lignes
})();

(function initSymbolSearch() {
  const input = document.getElementById('topbar-symbol-input');
  const dd = document.getElementById('sym-dd');
  if (!input || !dd) return;
  /* ⚠️ TOUTE LA CASE répond, loupe et marges comprises (audit 28/08 : seuls 12px sur 32 posaient
     le curseur, un clic sur la loupe — l'affordance la plus évidente — ne faisait RIEN). L'input
     s'étire désormais en CSS ; ici on relaie ce que l'input ne couvre pas : les 14px de padding
     et la loupe (rendue traversante par pointer-events:none). L'overlay LIVE, lui, garde son rôle. */
  const enveloppe = input.closest('.topbar-symbol-search');
  if (enveloppe) enveloppe.addEventListener('mousedown', (e) => {
    if (e.target === input || e.target.closest('.breaking-news-flash')) return;
    e.preventDefault();               // sinon le mousedown sur la div vole le focus qu'on vient de poser
    try { input.focus(); } catch {}
  });
  // Portail : on déplace le dropdown dans <body> → il échappe à TOUT overflow:hidden / contexte d'empilement
  // d'un ancêtre (topbar, navbar…). Positionné en `fixed` sous l'input via positionDd().
  try { document.body.appendChild(dd); } catch {}
  const PAIRS = ['EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','EURGBP','EURJPY','EURCHF','EURAUD','EURCAD','EURNZD','GBPJPY','GBPCHF','GBPCAD','GBPAUD','GBPNZD','AUDJPY','AUDCHF','AUDCAD','AUDNZD','NZDJPY','NZDCHF','NZDCAD','CADJPY','CADCHF','CHFJPY','XAUUSD','XAGUSD'];
  const MAJORS = ['USD','EUR','JPY','GBP','AUD','CHF','CAD','NZD'];
  const FLAG = { USD:'us', EUR:'eu', JPY:'jp', GBP:'gb', AUD:'au', CHF:'ch', CAD:'ca', NZD:'nz' };
  const CCY_NAME = { USD:'USD', EUR:'EUR', JPY:'JPY', GBP:'GBP', AUD:'AUD', CHF:'CHF', CAD:'CAD', NZD:'NZD', XAU:'Or', XAG:'Argent' };   // les devises s'écrivent par leur CODE (veto user 28/08) ; les métaux, en français
  // Mots-clés de filtrage news par devise = la devise + sa BANQUE CENTRALE (abréviations EN/FR + gouverneur).
  // → la news d'une paire capte aussi l'actualité des 2 banques (ex. EURAUD → BCE/ECB/Lagarde ET RBA).
  const NEWS_KW = {
    USD: 'dollar|fed\\b|fomc|powell|federal reserve|réserve fédérale',
    EUR: 'euro|ecb\\b|bce\\b|lagarde|banque centrale européenne|european central bank',
    JPY: 'yen|boj\\b|ueda|bank of japan|banque du japon',
    GBP: 'pound|sterling|boe\\b|bailey|bank of england',
    AUD: 'aussie|rba\\b|reserve bank of australia',
    CHF: 'franc|snb\\b|bns\\b|swiss national bank|banque nationale suisse',
    CAD: 'loonie|boc\\b|macklem|bank of canada|banque du canada',
    NZD: 'kiwi|rbnz\\b|reserve bank of new zealand',
  };
  const _RECENT_KEY = 'dtp_sym_recent';   // historique PERSISTANT (léger : ~6 codes de paire) : exception localStorage validée par l'utilisateur
  // `_subtab` : sous-onglet de la vue symbole, mémorisé par compte (12/08) — l'utilisateur qui vit
  // dans l'onglet BIAIS d'une paire ne repart plus sur « Aperçu » à chaque ouverture.
  let _recent = [], _active = null, _tvPending = false;
  let _subtab = (function () { try { return DTPPref.get('symsub', 'overview'); } catch (e) { return 'overview'; } })();
  try { const _r = JSON.parse(localStorage.getItem(_RECENT_KEY) || '[]'); if (Array.isArray(_r)) _recent = _r.filter(p => PAIRS.includes(p)).slice(0, 8); } catch {}
  const _saveRecent = () => {
    try { localStorage.setItem(_RECENT_KEY, JSON.stringify(_recent.slice(0, 8))); } catch {}                       // cache local instantané
    try { fetch('/api/sym-recent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recent: _recent.slice(0, 8) }) }).catch(() => {}); } catch {}   // synchro compte (suit la reconnexion)
  };
  // Au chargement : on récupère l'historique LIÉ AU COMPTE (suit la reconnexion, même autre appareil).
  // S'il existe côté serveur, il fait foi et re-synchronise le cache local.
  fetch('/api/sym-recent').then(r => r.json()).then(d => {
    if (d && Array.isArray(d.recent) && d.recent.length) {
      _recent = d.recent.filter(p => PAIRS.includes(p)).slice(0, 8);
      try { localStorage.setItem(_RECENT_KEY, JSON.stringify(_recent)); } catch {}
      if (dd && !dd.classList.contains('hidden')) renderDd(input.value);   // rafraîchir si le menu est déjà ouvert
    }
  }).catch(() => {});
  // Caches volatils (réinitialisés au reload) → évitent de refetch à chaque changement de sous-onglet.
  let _cBias = null, _cCot = null, _cRates = null, _cFx = null, _cRetail = null;
  // Période du Force des Devises de la vue symbole : MÉMORISÉE PAR COMPTE (12/08). Elle repartait à
  // TD à chaque rechargement, alors que celle de l'onglet FORCE, elle, se souvenait — deux barres
  // identiques à l'écran, deux comportements. Défaut TD, comme l'accueil.
  let _symStrPeriod = (function () { try { return DTPPref.get('symstf', 'today'); } catch (e) { return 'today'; } })();
  const pretty = p => p.slice(0,3) + '/' + p.slice(3);
  // ⚠️ UN SEUL BROKER PARTOUT : FXCM (préfixe « FX: » chez TradingView), demande utilisateur.
  // L'or et l'argent venaient d'OANDA, les paires de FXCM : deux cotations différentes dans le
  // même onglet, avec leurs propres écarts et horaires. Vérifié auprès de la recherche de
  // symboles TradingView : FXCM expose bien FX:XAUUSD et FX:XAGUSD, il n'y a rien à concéder.
  const tvSymbol = p => 'FX:' + p;
  const _esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  const _nf = n => (n == null || isNaN(n)) ? '-' : Number(n).toLocaleString('fr-FR');
  // Drapeau rond pour le dropdown (devise → flagcdn, métaux → pastille dorée/argentée).
  const _ddFlag = (c, extra) => {
    const f = FLAG[c];
    if (f) return '<img class="sym-dd-flag' + (extra || '') + '" src="https://flagcdn.com/40x30/' + f + '.png" alt="">';
    const m = c === 'XAU' ? 'Au' : c === 'XAG' ? 'Ag' : '·';
    return '<span class="sym-dd-flag sym-dd-flag--metal' + (extra || '') + '">' + m + '</span>';
  };
  // Valeur de biais → classe couleur sémantique FIXE (mêmes hex que .sbm-* de la vue BIAS).
  const _biasCls = v => ({ 'Very Bullish':'sbm-vbull','Bullish':'sbm-bull','Weak Bullish':'sbm-bull','Uptrend':'sbm-bull','Bearish':'sbm-bear','Weak Bearish':'sbm-bear','Downtrend':'sbm-bear','Very Bearish':'sbm-vbear','N/A':'sbm-na' }[v] || 'sbm-neut');
  const _DD_CLOCK = '<svg class="sym-dd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const _DD_HASH = '<span class="sym-dd-hash">#</span>';

  // ── Dropdown d'autocomplétion : en-tête « # Paires de devises (N) » + double drapeau rond + codes des deux jambes ──
  // Une ligne de paire : double drapeau rond + code + nom complet des 2 devises.
  function _ddRow(p) {
    const c1 = p.slice(0,3), c2 = p.slice(3);
    const name = (CCY_NAME[c1] || c1) + ' / ' + (CCY_NAME[c2] || c2);
    return '<div class="sym-dd-row" data-pair="' + p + '">'
      + '<span class="sym-dd-flags">' + _ddFlag(c1, '') + _ddFlag(c2, ' sym-dd-flag--2') + '</span>'
      + '<span class="sym-dd-txt"><span class="sym-dd-sym">' + p + '</span><span class="sym-dd-name">' + name + '</span></span></div>';
  }
  function _ddSection(iconHtml, title, list) {
    if (!list.length) return '';
    return '<div class="sym-dd-head">' + iconHtml + ' ' + title + ' <span class="sym-dd-count">(' + list.length + ')</span></div>'
      + list.map(_ddRow).join('');
  }
  // Dropdown « intelligent » épuré :
  //  • champ VIDE (clic/focus) → UNIQUEMENT « Recherches récentes » (horloge) = 6 dernières paires ouvertes ;
  //    s'il n'y a aucun historique → état vide « Aucune recherche récente » (JAMAIS les paires majeures).
  //  • en SAISIE → « Recherches récentes » filtrées + « Paires de devises » (celles qui matchent, préfixe d'abord).
  function renderDd(q) {
    q = (q || '').toUpperCase().replace(/[^A-Z]/g, '');
    let html;
    if (!q) {
      const recents = _recent.slice(0, 6);
      html = '<div class="sym-dd-head">' + _DD_CLOCK + ' Recherches récentes <span class="sym-dd-count">(' + recents.length + ')</span></div>'
        + (recents.length ? recents.map(_ddRow).join('') : '<div class="sym-dd-empty">Aucune recherche récente</div>');
    } else {
      const recents = _recent.slice(0, 6).filter(p => p.includes(q));
      const fx = PAIRS.filter(p => p.includes(q) && !recents.includes(p))
        .sort((a, b) => (a.startsWith(q) ? 0 : 1) - (b.startsWith(q) ? 0 : 1) || a.localeCompare(b))
        .slice(0, 10);
      html = _ddSection(_DD_CLOCK, 'Recherches récentes', recents) + _ddSection(_DD_HASH, 'Paires de devises', fx);
      if (!html) html = '<div class="sym-dd-empty">Aucune paire</div>';
    }
    dd.innerHTML = html;
    positionDd();
    dd.classList.remove('hidden');
  }
  // Positionne le dropdown (fixed) EXACTEMENT sous la BARRE de recherche, MÊME LARGEUR qu'elle.
  // On cale sur le CONTENEUR .topbar-symbol-search (la barre visible), PAS sur le champ texte seul (plus
  // étroit à cause de l'icône) → sinon le dropdown ne prenait pas toute la largeur de la barre. Le dropdown
  // est porté dans <body> → on annule aussi le CSS min-width:100%/max-width:92vw (calculés sur le viewport).
  function positionDd() {
    const box = input.closest('.topbar-symbol-search') || input;
    const r = box.getBoundingClientRect();
    // ZOOM D'AFFICHAGE (réglage Apparence) : getBoundingClientRect() rend des coordonnées VISUELLES —
    // déjà multipliées par le zoom CSS de <html> — alors qu'un left/top en position:fixed est
    // RE-multiplié par ce zoom au rendu. Sans la division, à 80 % le menu atterrissait ~20 % trop à
    // gauche et un peu trop haut (constaté user : « il y a un décalage là »).
    const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dtp-zoom')) || 1;
    dd.style.position = 'fixed';
    dd.style.left = Math.round(r.left / z) + 'px';
    dd.style.top = Math.round((r.bottom + 6) / z) + 'px';
    dd.style.width = Math.round(r.width / z) + 'px';
    dd.style.minWidth = '0';
    dd.style.maxWidth = 'none';
    dd.style.boxSizing = 'border-box';
  }
  const hideDd = () => dd.classList.add('hidden');

  input.addEventListener('focus', () => renderDd(input.value));
  input.addEventListener('click', () => renderDd(input.value));
  input.addEventListener('input', () => renderDd(input.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const q = input.value.toUpperCase().replace(/[^A-Z]/g,''); if (q.length < 2) return; const m = PAIRS.find(p => p === q) || PAIRS.find(p => p.includes(q)); if (m) openSymbol(m); }
    else if (e.key === 'Escape') { hideDd(); input.blur(); }
  });
  dd.addEventListener('mousedown', e => { const row = e.target.closest('.sym-dd-row'); if (row) { e.preventDefault(); openSymbol(row.dataset.pair); } });
  document.addEventListener('click', e => { if (!e.target.closest('.topbar-symbol-search') && !e.target.closest('#sym-dd')) hideDd(); });
  window.addEventListener('resize', () => { if (!dd.classList.contains('hidden')) positionDd(); });
  window.addEventListener('scroll', () => { if (!dd.classList.contains('hidden')) positionDd(); }, true);

  // ── Barre de sous-onglets (délégation : #sym-subtabs est statique dans le HTML) ──
  const subtabs = document.getElementById('sym-subtabs');
  if (subtabs) subtabs.addEventListener('click', e => { const b = e.target.closest('.sym-subtab'); if (b && b.dataset.sub) setSubtab(b.dataset.sub); });

  function setSubtab(name) {
    _subtab = name;
    try { DTPPref.set('symsub', name); } catch (e) {}   // sous-onglet mémorisé par compte (12/08)
    document.querySelectorAll('#sym-subtabs .sym-subtab').forEach(b => b.classList.toggle('sym-subtab--active', b.dataset.sub === name));
    document.querySelectorAll('#sym-content .sym-subview').forEach(v => v.classList.toggle('hidden', v.id !== 'sym-sub-' + name));
    loadSymbolView();
  }

  function openSymbol(pair) {
    _active = pair;
    _recent = [pair, ..._recent.filter(p => p !== pair)].slice(0, 8); _saveRecent();
    input.value = ''; hideDd(); try { input.blur(); } catch {}
    const nav = document.getElementById('topbar-nav');
    let tab = document.getElementById('nav-symbol');
    if (!tab && nav) {
      tab = document.createElement('a'); tab.id = 'nav-symbol'; tab.href = '#';
      tab.className = 'nav-item nav-item--symbol'; tab.dataset.view = 'symbol';
      const mob = nav.querySelector('.nav-item--mobile-only');
      mob ? nav.insertBefore(tab, mob) : nav.appendChild(tab);
    }
    if (tab) {
      const f = FLAG[pair.slice(0,3)];
      tab.innerHTML = (f ? '<img class="sym-tab-flag" src="https://flagcdn.com/16x12/' + f + '.png" alt="">' : '')
        + '<span>' + pretty(pair) + '</span><span class="sym-x" title="Fermer">×</span>';
      const x = tab.querySelector('.sym-x');
      if (x) x.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); closeSymbol(); });
    }
    if (window.activateView) window.activateView('symbol');
    /* ⚠️ AMENER L'ONGLET DANS LE CHAMP. Sur telephone la barre deborde largement (734 px de
       contenu pour 433 visibles a 390 px) : un onglet cree en 10e position naissait HORS ECRAN.
       La vue basculait, mais la barre montrait encore les premiers onglets — on ne savait ni ou
       l'on etait, ni comment fermer la paire. Le navigateur ne fait pas ce defilement seul. */
    try { if (tab && tab.scrollIntoView) tab.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' }); } catch (_) {}
  }
  window.openSymbol = openSymbol;

  function closeSymbol() {
    _active = null; window._symLastTvPair = null; window._symOvPair = null;
    setSubtab('overview');   // remet la barre + les volets sur Overview pour la prochaine ouverture
    const tab = document.getElementById('nav-symbol'); if (tab) tab.remove();
    const host = document.getElementById('sym-tv'); if (host) host.innerHTML = '';
    if (window.activateView) window.activateView('news');
  }
  window.closeSymbol = closeSymbol;

  function ensureTv(cb) {
    if (window.TradingView) { cb(); return; }
    if (_tvPending) { let n = 0; const t = setInterval(() => { if (window.TradingView || ++n > 60) { clearInterval(t); if (window.TradingView) cb(); } }, 200); return; }
    _tvPending = true;
    const s = document.createElement('script'); s.src = 'https://s3.tradingview.com/tv.js'; s.async = true;
    s.onload = () => { if (window.TradingView) cb(); }; document.head.appendChild(s);
  }

  // ── Rendu principal : labels communs (paire en orange) + dispatch vers le sous-onglet actif ──
  function loadSymbolView() {
    const pair = _active; if (!pair) return;
    const c1 = pair.slice(0,3), c2 = pair.slice(3);
    const base = MAJORS.includes(c1) ? c1 : (MAJORS.includes(c2) ? c2 : 'USD');
    const ccys = [c1, c2].filter(c => MAJORS.includes(c));
    const barLbl = document.getElementById('sym-bar-pair'); if (barLbl) barLbl.textContent = '[' + pretty(pair) + ']';
    const lbl = document.getElementById('sym-pair-lbl'); if (lbl) lbl.textContent = '[' + pretty(pair) + ']';
    const cbBtn = document.querySelector('#sym-subtabs .sym-subtab[data-sub="cotbase"]'); if (cbBtn) cbBtn.textContent = 'COT ' + c1;
    const cqBtn = document.querySelector('#sym-subtabs .sym-subtab[data-sub="cotquote"]'); if (cqBtn) cqBtn.textContent = 'COT ' + c2;
    if (_subtab === 'overview') renderOverview(pair, base, ccys);
    else if (_subtab === 'bias') renderBias(pair, c1, c2);
    else if (_subtab === 'cotbase') renderCot('sym-sub-cotbase', c1, pair, 'base');
    else if (_subtab === 'cotquote') renderCot('sym-sub-cotquote', c2, pair, 'quote');
    else if (_subtab === 'seasonality') renderSeasonality(pair);
    else if (_subtab === 'retail') renderRetail(pair);
    else if (_subtab === 'cb') renderCb(pair, ccys);
  }
  window.loadSymbolView = loadSymbolView;

  // ── Force des Devises de la vue symbole : widget complet (sélecteur de période TD/TW/8H/1D/7D/1M)
  //    focalisé sur la paire (les 2 devises de la paire colorées, les autres masquées/re-cliquables) ──
  function _pairCcys() {
    const p = _active; if (!p) return [];
    return [p.slice(0, 3), p.slice(3)].filter(c => MAJORS.includes(c));
  }
  function buildSymStrengthBar() {
    const bar = document.getElementById('sym-strength-tf');
    if (!bar || bar.dataset.built) return;
    bar.dataset.built = '1';
    const ORDER = (typeof STF_ORDER !== 'undefined' && STF_ORDER.length) ? STF_ORDER : ['today', 'week', '8h', '1d', '7d', '1m'];
    const LBL   = (typeof STF_LABELS !== 'undefined') ? STF_LABELS : { today: 'TD', week: 'TW', '8h': '8H', '1d': '1D', '7d': '7D', '1m': '1M' };
    bar.innerHTML = ORDER.map(p => '<button class="stf-btn sym-stf-btn' + (p === _symStrPeriod ? ' stf-btn--active' : '') + '" data-period="' + p + '">' + (LBL[p] || p) + '</button>').join('');
    bar.addEventListener('click', e => {
      const b = e.target.closest('.sym-stf-btn'); if (!b) return;
      bar.querySelectorAll('.sym-stf-btn').forEach(x => x.classList.remove('stf-btn--active'));
      b.classList.add('stf-btn--active');
      _symStrPeriod = b.dataset.period;
      try { DTPPref.set('symstf', _symStrPeriod); } catch (e) {}
      loadSymStrength();
    });
  }
  function loadSymStrength() {
    const sEl = document.getElementById('sym-strength'); if (!sEl) return;
    const ccys = _pairCcys();
    fetch('/api/currency-strength?period=' + _symStrPeriod).then(r => r.json()).then(data => {
      if (!data || !data.currencies) { sEl.innerHTML = '<div class="sym-empty">Force des devises indisponible.</div>'; return; }
      try { if (typeof disposeRoot === 'function') disposeRoot('sym-strength'); } catch {}   // anti-fuite amCharts (Render 512Mo)
      sEl.innerHTML = '';
      try {
        const sc = (typeof buildStrengthChart === 'function')
          ? buildStrengthChart('sym-strength', data, ccys.length ? { onlyCurrencies: ccys } : {})
          : null;
        if (!sc && window.buildIsolatedStrength) {
          window.buildIsolatedStrength('sym-strength', ccys[0] || 'USD', _symStrPeriod);
        }
      } catch { sEl.innerHTML = '<div class="sym-empty">Force des devises indisponible.</div>'; }
    }).catch(() => { sEl.innerHTML = '<div class="sym-empty">Force des devises indisponible.</div>'; });
  }

  // ── Overview : chart TradingView + Force des Devises (doublon du compteur par défaut) + calendrier + news filtrés ──
  function renderOverview(pair, base, ccys) {
    // Chart TradingView (recréé seulement si la paire change)
    const host = document.getElementById('sym-tv');
    if (host && (window._symLastTvPair !== pair || !host.firstElementChild)) {
      host.innerHTML = '<div id="sym-tv-w" style="width:100%;height:100%"></div>';
      window._symLastTvPair = pair;
      // Même bascule de thème que les graphiques maison : lue sur html[data-theme] au montage.
      ensureTv(() => { try { new window.TradingView.widget({ container_id: 'sym-tv-w', symbol: tvSymbol(pair), interval: '60', timezone: 'Europe/Paris', theme: _deskLight() ? 'light' : 'dark', style: '1', locale: 'fr', autosize: true, hide_side_toolbar: true, allow_symbol_change: false, save_image: false, withdateranges: true });
        // TradingView (autosize) ne se recalibre que sur un resize global → on le pousse après le chargement
        // de l'iframe pour qu'il remplisse tout le panneau (sinon zone grise à droite du chart).
        [350, 1000, 1800].forEach(d => setTimeout(() => { try { window.dispatchEvent(new Event('resize')); } catch {} }, d));
      } catch (e) {} });
    }
    // Les panneaux data ne se re-rendent que si la paire a changé (évite de refetch en revenant sur Overview).
    if (window._symOvPair === pair) return;
    window._symOvPair = pair;
    // Force des Devises = doublon du widget de l'accueil (sélecteur de période TD/TW/8H/1D/7D/1M),
    // mais focalisé sur la paire : seules les 2 devises de la paire restent colorées (les autres masquées).
    buildSymStrengthBar();
    loadSymStrength();
    // Calendrier filtré sur la paire : MÊME rendu que Semaine à Venir (.cal-table : drapeaux ronds, points d'impact,
    // ACTUAL/FORECAST/PREVIOUS, séparateurs de jour) via les helpers globaux du calendrier.
    fetch('/api/calendar-events').then(r => r.json()).then(d => {
      const cal = document.getElementById('sym-cal'); if (!cal) return;
      const evs = ((d && d.items) || []).filter(e => e && ccys.includes(e.currency))
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)).slice(0, 80);
      if (!evs.length) { cal.innerHTML = '<div class="sym-empty">Aucun événement pour ' + pretty(pair) + '.</div>'; return; }
      const now = Date.now();
      const nextIdx = evs.findIndex(e => (e.timestamp || 0) >= now);
      let lastDay = '', tb = '';
      evs.forEach((ev, i) => {
        const ts = ev.timestamp || 0;
        if (ts) {
          const dk = new Date(ts).toLocaleDateString('en-GB', { timeZone: 'UTC' });
          if (dk !== lastDay) {
            lastDay = dk; const dt = new Date(ts);
            tb += '<tr class="cal-day-sep"><td colspan="8">'
              + dt.toLocaleDateString('fr-FR', { weekday: 'long', timeZone: 'UTC' }) + ', '
              + dt.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }) + '</td></tr>';
          }
        }
        const imp = (ev.impact || '').toLowerCase();
        const cls = 'cal-row' + (i === nextIdx ? ' cal-row--next' : '') + (ts && ts < now ? ' cal-row--past' : '') + (imp === 'high' ? ' cal-row--high' : imp === 'medium' ? ' cal-row--med' : '');
        const fc = (ev.forecast != null && ev.forecast !== '') ? '<span class="cv-forecast">' + _esc(ev.forecast) + '</span>' : '<span class="cv-empty">-</span>';
        const pv = (ev.previous != null && ev.previous !== '') ? '<span class="cv-prev">' + _esc(ev.previous) + '</span>' : '<span class="cv-empty">-</span>';
        tb += '<tr class="' + cls + '">'
          + '<td class="cth-time">' + calFormatTime(ts) + '</td>'
          + '<td class="cth-flag">' + CAL_FLAG(ev.currency) + '</td>'
          + '<td class="cth-curr">' + (ev.currency || '') + '</td>'
          + '<td class="cth-imp">' + calImpDots(ev.impact) + '</td>'
          + '<td class="cth-event">' + _esc(ev.title || '') + '</td>'
          + '<td class="cth-val cth-val--reel" data-lbl="Réel">' + calActualCell(ev.actual, ev.forecast, null, ev.title) + '</td>'
          + '<td class="cth-val cth-val--prev" data-lbl="Prév.">' + fc + '</td>'
          + '<td class="cth-val cth-val--prec" data-lbl="Préc.">' + pv + '</td></tr>';
      });
      cal.innerHTML = '<table class="cal-table"><thead><tr><th class="cth-time">Heure</th><th class="cth-flag">Pays</th><th class="cth-curr">Dev.</th><th class="cth-imp">IMPACT</th><th class="cth-event">ÉVÉNEMENT</th><th class="cth-val cth-val--reel">RÉEL</th><th class="cth-val cth-val--prev">PRÉVISION</th><th class="cth-val cth-val--prec">PRÉCÉDENT</th></tr></thead><tbody>' + tb + '</tbody></table>';
    }).catch(() => {});
    // News filtrées sur la paire : EXACTEMENT le « Realtime Headline Ticker » de l'onglet News :
    // on tire du tableau maître (allItems) et on rend chaque item via buildNewsItem (badges, icône
    // d'alerte, chevron, expansion). Filtre = 2 devises de la paire + leurs banques centrales.
    const parts = ccys.map(c => '\\b' + c.toLowerCase() + '\\b' + (NEWS_KW[c] ? '|' + NEWS_KW[c] : '')).join('|');
    const re = parts ? new RegExp('(' + parts + ')', 'i') : null;
    (function renderSymNews() {
      const nl = document.getElementById('sym-news'); if (!nl) return;
      const master = (typeof window.getNewsMaster === 'function') ? window.getNewsMaster() : [];
      const items = (Array.isArray(master) ? master : []).filter(n => n
        && !(n._briefing || n.source === 'DTP')                              // pas de briefings PRIMER (masqués du site)
        && !/^\s*\[?\s*primer\b/i.test(n.headline || '')
        && ((re && re.test(n.headline || '')) || (Array.isArray(n.tags) && n.tags.some(t => ccys.includes((t || '').toUpperCase()))))
      ).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 40);
      // Grappes de propos repliées comme dans le fil du desk (13/08) : sans ça, une audition de
      // banque centrale remplissait tout le volet de la paire avec 10 citations du même orateur.
      const items2 = (typeof window.groupSpeakerQuotes === 'function') ? window.groupSpeakerQuotes(items) : items;
      if (!items2.length) { nl.innerHTML = '<div class="sym-empty">Pas de news récente pour ' + pretty(pair) + '.</div>'; return; }
      nl.innerHTML = '';
      const frag = document.createDocumentFragment();
      let lastD = '';
      items2.forEach(n => {
        const ts = n.timestamp || 0;
        if (ts) {
          const dk = new Date(ts).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
          if (dk !== lastD) { lastD = dk; const hd = document.createElement('div'); hd.className = 'date-header'; hd.textContent = dk; frag.appendChild(hd); }
        }
        try {
          if (typeof window.buildNewsItem === 'function') frag.appendChild(window.buildNewsItem(n));
          else { const d2 = document.createElement('div'); d2.className = 'news-item'; d2.innerHTML = '<div class="news-time">' + (ts ? new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '') + '</div><div class="news-content"><div class="news-headline">' + _esc(n.headline || '') + '</div></div>'; frag.appendChild(d2); }
        } catch {}
      });
      nl.appendChild(frag);
    })();
  }

  // ── Radar de Biais : 2 colonnes (base / quote) tirées de /api/smart-bias ──
  function renderBias(pair, c1, c2) {
    const hostEl = document.getElementById('sym-sub-bias'); if (!hostEl) return;
    hostEl.innerHTML = '<div class="sym-load">Chargement du Radar de Biais…</div>';
    const go = d => {
      const cur = (d && d.currencies) || [], rows = (d && d.rows) || [];
      const cols = [c1, c2].filter(c => cur.includes(c));
      if (!cols.length) { hostEl.innerHTML = '<div class="sym-empty">Radar de Biais indisponible pour ' + pretty(pair) + '.</div>'; return; }
      const colHtml = cols.map(c => {
        const concl = (d.conclusion && d.conclusion[c]) || 'Neutral';
        const flag = FLAG[c] ? '<img class="sym-bz-flag" src="https://flagcdn.com/40x30/' + FLAG[c] + '.png" alt="">' : '';
        const indis = rows.map(r => {
          const v = (r.values && r.values[c]) || 'N/A';
          return '<div class="sym-bz-row"><span class="sym-bz-lbl">' + _esc(r.label || r.key || '') + '</span><span class="sym-bz-badge ' + _biasCls(v) + '">' + _esc(v) + '</span></div>';
        }).join('');
        const narr = (d.narrative && d.narrative[c]) ? _esc(String(d.narrative[c]).replace(/\*\*/g, '')) : '';
        return '<div class="sym-bz-col">'
          + '<div class="sym-bz-head">' + flag + '<span class="sym-bz-ccy">' + c + '</span><span class="sym-bz-concl ' + _biasCls(concl) + '">' + _esc(concl) + '</span></div>'
          + '<div class="sym-bz-rows">' + indis + '</div>'
          + (narr ? '<div class="sym-bz-narr">' + narr + '</div>' : '')
          + '</div>';
      }).join('');
      hostEl.innerHTML = '<div class="sym-bz-grid">' + colHtml + '</div>'
        + '<div class="sym-src">Source : Radar de Biais (matrice multi-indicateurs · COT, Myfxbook, calendrier, saisonnalité, rapports banques). Narratif IA figé chaque semaine.</div>';
    };
    if (_cBias) { go(_cBias); return; }
    fetch('/api/smart-bias').then(r => r.json()).then(d => { if (d && d.currencies) _cBias = d; go(d); }).catch(() => { hostEl.innerHTML = '<div class="sym-empty">Radar de Biais indisponible.</div>'; });
  }

  // ── COT (CFTC) : positionnement non-commercial de la devise (base ou quote) ──
  function renderCot(hostId, ccy, pair, role) {
    const hostEl = document.getElementById(hostId); if (!hostEl) return;
    hostEl.innerHTML = '<div class="sym-load">Chargement COT (CFTC)…</div>';
    const go = d => {
      const arr = (d && d.currencies) || [];
      const row = arr.find(x => x.key === ccy);
      if (!row) { hostEl.innerHTML = '<div class="sym-empty">Données COT (CFTC) indisponibles pour ' + ccy + '.</div>'; return; }
      const lp = Math.round(row.longPct || 0), sp = Math.round(row.shortPct || 0);
      const sent = row.sentiment || 'Neutral';
      const sCls = /bull/i.test(sent) ? 'g' : /bear/i.test(sent) ? 'r' : 'n';
      const flag = FLAG[ccy] ? '<img class="sym-cot-flag" src="https://flagcdn.com/40x30/' + FLAG[ccy] + '.png" alt="">' : '';
      const rd = row.reportDate ? new Date(row.reportDate).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' }) : '-';
      hostEl.innerHTML =
        '<div class="sym-cot">'
        + '<div class="sym-cot-head">' + flag + '<span class="sym-cot-ccy">' + ccy + '</span>'
        + '<span class="sym-cot-role">' + (role === 'base' ? 'Devise de base' : 'Devise de cotation') + ' · ' + pretty(pair) + '</span>'
        + '<span class="sym-cot-sent rtc-move ' + sCls + '">' + _esc(sent) + '</span></div>'
        + '<div class="sym-cot-bar"><i class="sym-cot-long" style="width:' + lp + '%">' + (lp >= 12 ? 'Long ' + lp + '%' : '') + '</i><i class="sym-cot-short" style="width:' + sp + '%">' + (sp >= 12 ? 'Short ' + sp + '%' : '') + '</i></div>'
        + '<div class="sym-cot-metrics">'
        + '<div><span class="sym-cot-k">Position nette</span><span class="sym-cot-v ' + ((row.net || 0) >= 0 ? 'g' : 'r') + '">' + ((row.net || 0) >= 0 ? '+' : '') + _nf(row.net) + '</span></div>'
        + '<div><span class="sym-cot-k">Contrats longs</span><span class="sym-cot-v">' + _nf(row.longPos) + '</span></div>'
        + '<div><span class="sym-cot-k">Contrats shorts</span><span class="sym-cot-v">' + _nf(row.shortPos) + '</span></div>'
        + '<div><span class="sym-cot-k">Rapport CFTC</span><span class="sym-cot-v" style="font-size:12px">' + rd + '</span></div>'
        + '</div>'
        + '<div class="sym-src">Source : CFTC Commitments of Traders : Legacy Futures, traders non-commerciaux (spéculateurs)' + (d.updatedAt ? ' · MAJ ' + new Date(d.updatedAt).toLocaleString('fr-FR') : '') + '.</div>'
        + '</div>';
    };
    if (_cCot) { go(_cCot); return; }
    fetch('/api/cot?type=noncomm').then(r => r.json()).then(d => { if (d && d.currencies) _cCot = d; go(d); }).catch(() => { hostEl.innerHTML = '<div class="sym-empty">COT indisponible.</div>'; });
  }

  // ── Seasonality : courbe du rendement mensuel cumulé moyen (3 ans), via /api/fxlist ──
  function renderSeasonality(pair) {
    const hostEl = document.getElementById('sym-sub-seasonality'); if (!hostEl) return;
    hostEl.innerHTML = '<div class="sym-load">Chargement de la saisonnalité…</div>';
    const sym = pretty(pair);
    const go = d => {
      const pairs = (d && d.pairs) || [];
      const row = pairs.find(p => p.symbol === sym) || pairs.find(p => (p.base + p.quote) === pair);
      const seas = row && Array.isArray(row.seasonal) ? row.seasonal : null;
      if (!seas || !seas.length) { hostEl.innerHTML = '<div class="sym-empty">Saisonnalité indisponible pour ' + sym + '.</div>'; return; }
      const M = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Aoû','Sep','Oct','Nov','Déc'];
      const cur = new Date().getMonth();
      const mn = Math.min(0, ...seas), mx = Math.max(0, ...seas), rng = (mx - mn) || 1;
      const W = 760, H = 230, P = 30, bw = (W - 2 * P) / seas.length;
      const y0 = H - P - ((0 - mn) / rng) * (H - 2 * P);
      const bars = seas.map((v, i) => {
        const x = P + i * bw + 3, h = Math.abs((v / rng) * (H - 2 * P)), w = bw - 6;
        const y = v >= 0 ? y0 - h : y0;
        const col = v >= 0 ? '#00e676' : '#ff3d00';
        const hl = i === cur ? ' class="sym-seas-cur"' : '';
        return '<rect' + hl + ' x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1, h).toFixed(1) + '" fill="' + col + '" rx="1.5"/>'
          + '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - P + 14) + '" text-anchor="middle" class="sym-seas-mlbl">' + M[i] + '</text>';
      }).join('');
      hostEl.innerHTML =
        '<div class="sym-seas">'
        + '<div class="sym-seas-head"><span class="sym-seas-ttl">Saisonnalité : rendement mensuel cumulé moyen</span><span class="sym-seas-sub">[' + sym + ']</span></div>'
        + '<svg viewBox="0 0 ' + W + ' ' + H + '" class="sym-seas-svg" preserveAspectRatio="xMidYMid meet">'
        + '<line x1="' + P + '" y1="' + y0.toFixed(1) + '" x2="' + (W - P) + '" y2="' + y0.toFixed(1) + '" stroke="#2a2a30" stroke-width="1"/>'
        + bars + '</svg>'
        + '<div class="sym-src">Mois courant en surbrillance orange. Source : rendements mensuels Yahoo Finance moyennés sur 3 ans (vert = mois historiquement haussier, rouge = baissier).</div>'
        + '</div>';
    };
    if (_cFx) { go(_cFx); return; }
    fetch('/api/fxlist').then(r => r.json()).then(d => { if (d && d.pairs) _cFx = d; go(d); }).catch(() => { hostEl.innerHTML = '<div class="sym-empty">Saisonnalité indisponible.</div>'; });
  }

  // ── Retail Sentiment : jauge long/short particuliers (Myfxbook), via /api/community-outlook ──
  function renderRetail(pair) {
    const hostEl = document.getElementById('sym-sub-retail'); if (!hostEl) return;
    hostEl.innerHTML = '<div class="sym-load">Chargement du sentiment retail…</div>';
    const go = d => {
      const arr = (d && d.symbols) || [];
      const row = arr.find(s => s.symbol === pair) || arr.find(s => (s.symbol || '').replace('/', '') === pair);
      if (!row) { hostEl.innerHTML = '<div class="sym-empty">Sentiment retail indisponible pour ' + pretty(pair) + '.</div>'; return; }
      const lp = Math.round(row.longPct || 0), sp = Math.round(row.shortPct || 0);
      const lean = lp >= sp ? 'Long' : 'Short';
      const contra = lp >= sp ? 'Bearish' : 'Bullish';
      hostEl.innerHTML =
        '<div class="sym-rt">'
        + '<div class="sym-rt-head"><span class="sym-rt-ttl">Retail Sentiment</span><span class="sym-rt-sub">[' + pretty(pair) + ']</span></div>'
        + '<div class="sym-rt-bar"><i class="sym-rt-long" style="width:' + lp + '%"></i><i class="sym-rt-short" style="width:' + sp + '%"></i></div>'
        + '<div class="sym-rt-lbls"><span class="g">Long ' + lp + '%</span><span class="r">Short ' + sp + '%</span></div>'
        + '<div class="sym-rt-note">La majorité des traders particuliers est positionnée <b>' + lean + '</b> → lecture contrarian : biais <b class="' + (contra === 'Bullish' ? 'g' : 'r') + '">' + (contra === 'Bullish' ? 'Haussier' : 'Baissier') + '</b>.</div>'
        + '<div class="sym-src">Source : Myfxbook Community Outlook (positions réelles des comptes particuliers)' + (d.updatedAt ? ' · MAJ ' + new Date(d.updatedAt).toLocaleString('fr-FR') : '') + '.</div>'
        + '</div>';
    };
    if (_cRetail) { go(_cRetail); return; }
    fetch('/api/community-outlook?period=H1').then(r => r.json()).then(d => { if (d && d.symbols) _cRetail = d; go(d); }).catch(() => { hostEl.innerHTML = '<div class="sym-empty">Sentiment retail indisponible.</div>'; });
  }

  // ── Central Bank pricing : cartes TAUX (réutilise le rendu .rtc) des 2 banques de la paire ──
  function renderCb(pair, ccys) {
    const hostEl = document.getElementById('sym-sub-cb'); if (!hostEl) return;
    hostEl.innerHTML = '<div class="sym-load">Chargement du pricing banques centrales…</div>';
    const card = _rtcCard;   // même carte « Interest Rate Probability » que l'onglet TAUX (clone pro, une seule source de vérité)
    const go = d => {
      const banks = (d && d.banks) || [];
      const sel = ccys.map(c => banks.find(b => b.code === c)).filter(Boolean);
      if (!sel.length) { hostEl.innerHTML = '<div class="sym-empty">Pricing banques centrales indisponible pour ' + pretty(pair) + '.</div>'; return; }
      hostEl.innerHTML = '<div class="sym-cb-grid">' + sel.map(card).join('') + '</div>';
    };
    if (_cRates) { go(_cRates); return; }
    fetch('/api/rates').then(r => r.json()).then(d => { if (d && d.banks) _cRates = d; go(d); }).catch(() => { hostEl.innerHTML = '<div class="sym-empty">Pricing indisponible.</div>'; });
  }
})();

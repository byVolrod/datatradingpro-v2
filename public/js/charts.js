/* ═══════════════════════════════════════════════
   DataTradingPro — amCharts 5 Charts
   Stock · Strength · Risk · Meter · COT · DMX
═══════════════════════════════════════════════ */
'use strict';

// ── amCharts theme matching DataTradingPro ────────────────────────────────────
function applyTerminalTheme(root) {
  const theme = am5.Theme.new(root);

  theme.rule('ColorSet').setAll({
    colors: [
      am5.color(0xf7941d), // orange
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

  theme.rule('Grid').setAll({ stroke: am5.color(0x1e1e1e), strokeOpacity: 1, strokeWidth: 1 });
  theme.rule('AxisRendererX').setAll({ stroke: am5.color(0x1e1e1e), strokeOpacity: 1 });
  theme.rule('AxisRendererY').setAll({ stroke: am5.color(0x1e1e1e), strokeOpacity: 1 });
  theme.rule('Label').setAll({ fill: am5.color(0x666666), fontSize: 10, fontFamily: '-apple-system, "Inter", "Segoe UI", sans-serif' });
  theme.rule('Tooltip').setAll({
    background: am5.Rectangle.new(root, {
      fill: am5.color(0x141414),
      stroke: am5.color(0x252525),
      strokeWidth: 1,
      cornerRadiusTL: 3, cornerRadiusTR: 3, cornerRadiusBL: 3, cornerRadiusBR: 3,
    }),
    paddingTop: 6, paddingBottom: 6, paddingLeft: 10, paddingRight: 10,
  });
  theme.rule('Label', ['tooltip']).setAll({ fill: am5.color(0xd8d8d8), fontSize: 11, fontFamily: '-apple-system, "Inter", "Segoe UI", sans-serif' });

  return theme;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function disposeRoot(id) {
  try {
    const existing = am5.registry.rootElements.find(r => r.dom && r.dom.id === id);
    if (existing) existing.dispose();
  } catch (_) {}
}

// ── OHLC data generator ──────────────────────────────────────────────────────

function generateOHLC(basePrice, periods, tfHours = 4, volatility = 0.0008) {
  const data = [];
  let close = basePrice;
  const now = Date.now();
  const tfMs = tfHours * 3600000;

  for (let i = periods; i >= 0; i--) {
    const ts = now - i * tfMs;
    const open = close;
    const change = close * volatility * 10 * (Math.random() - 0.48);
    close = Math.max(open + change, 0.001);
    const hi = Math.max(open, close) * (1 + Math.random() * volatility * 3);
    const lo = Math.min(open, close) * (1 - Math.random() * volatility * 3);
    const vol = Math.round(800 + Math.random() * 4200);

    data.push({
      Date: ts,
      Open: parseFloat(open.toFixed(5)),
      High: parseFloat(hi.toFixed(5)),
      Low: parseFloat(lo.toFixed(5)),
      Close: parseFloat(close.toFixed(5)),
      Volume: vol,
    });
  }
  return data;
}

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
  priceState[p.name] = { price: p.base, prev: p.base, data: generateOHLC(p.base, 200, 4, p.vol) };
});

function tickPrices() {
  [...FX_PAIRS, ...INDICES, ...COMMODITIES].forEach(p => {
    const s = priceState[p.name];
    s.prev = s.price;
    s.price += s.price * p.vol * 5 * (Math.random() - 0.49);
    s.price = parseFloat(s.price.toFixed(p.base < 10 ? 5 : p.base < 1000 ? 2 : 0));
  });
}

// (tickPrices désactivé : il alimentait l'ancien sidebar de prix simulés, qui n'est plus
//  construit — c'était un intervalle 3 s tournant à vide. Le Smart Bias réel le remplace.)
void tickPrices;

// ═══════════════════════════════════════════════
//  BIAS SIDEBAR
// ═══════════════════════════════════════════════

let activePair = 'EUR/USD';
let activeTimeframe = 'H4';
let stockRoot = null;

function buildBiasSidebar() {
  const pairsEl = document.getElementById('bias-pairs');
  const idxEl   = document.getElementById('bias-indices');
  const comEl   = document.getElementById('bias-commodities');

  function makeItem(p, container) {
    const s = priceState[p.name];
    const chg = ((s.price - p.base) / p.base * 100).toFixed(2);
    const dir = chg >= 0 ? 'up' : 'down';
    const dec = p.base < 10 ? 5 : p.base < 1000 ? 2 : 0;
    const div = document.createElement('div');
    div.className = `bias-pair-item${p.name === activePair ? ' active' : ''}`;
    div.dataset.symbol = p.name;
    div.innerHTML = `
      <div>
        <div class="pair-name">${p.name}</div>
        <div class="pair-price" id="price-${p.name.replace('/','_')}">${s.price.toFixed(dec)}</div>
      </div>
      <div class="pair-change ${dir}" id="chg-${p.name.replace('/','_')}">${chg >= 0 ? '+' : ''}${chg}%</div>`;
    div.addEventListener('click', () => selectPair(p.name));
    container.appendChild(div);
  }

  FX_PAIRS.forEach(p => makeItem(p, pairsEl));
  INDICES.forEach(p => makeItem(p, idxEl));
  COMMODITIES.forEach(p => makeItem(p, comEl));

  // Tick UI
  setInterval(updateSidebarPrices, 3000);
}

function updateSidebarPrices() {
  [...FX_PAIRS, ...INDICES, ...COMMODITIES].forEach(p => {
    const s = priceState[p.name];
    const dec = p.base < 10 ? 5 : p.base < 1000 ? 2 : 0;
    const chg = ((s.price - p.base) / p.base * 100).toFixed(2);
    const key = p.name.replace('/','_');
    const priceEl = document.getElementById(`price-${key}`);
    const chgEl   = document.getElementById(`chg-${key}`);
    if (priceEl) { priceEl.textContent = s.price.toFixed(dec); priceEl.style.color = s.price >= s.prev ? 'var(--green)' : 'var(--red)'; setTimeout(() => { if (priceEl) priceEl.style.color = ''; }, 800); }
    if (chgEl)  { chgEl.textContent = (chg >= 0 ? '+' : '') + chg + '%'; chgEl.className = `pair-change ${chg >= 0 ? 'up' : 'down'}`; }
  });
}

function selectPair(name) {
  activePair = name;
  document.querySelectorAll('.bias-pair-item').forEach(el => el.classList.toggle('active', el.dataset.symbol === name));
  const allPairs = [...FX_PAIRS, ...INDICES, ...COMMODITIES];
  const p = allPairs.find(x => x.name === name);
  if (!p) return;
  const s = priceState[name];
  const dec = p.base < 10 ? 5 : p.base < 1000 ? 2 : 0;
  const chg = s.price - p.base;
  const chgPct = (chg / p.base * 100).toFixed(2);
  document.getElementById('bias-symbol-name').textContent = name;
  document.getElementById('bias-symbol-price').textContent = s.price.toFixed(dec);
  const chgEl = document.getElementById('bias-symbol-change');
  chgEl.textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(dec)} (${chg >= 0 ? '+' : ''}${chgPct}%)`;
  chgEl.className = `bias-symbol-change ${chg >= 0 ? 'positive' : 'negative'}`;
  rebuildStockChart(name);
}

// ═══════════════════════════════════════════════
//  STOCK CHART (BIAS view)
// ═══════════════════════════════════════════════

function buildStockChart(symbol) {
  disposeRoot('chart-stock');
  const all = [...FX_PAIRS, ...INDICES, ...COMMODITIES];
  const p = all.find(x => x.name === symbol) || FX_PAIRS[0];
  const tfMap = { M1: [1/60, 100], M5: [5/60, 100], M15: [0.25, 100], H1: [1, 150], H4: [4, 200], D1: [24, 365], W1: [168, 104] };
  const [tfH, periods] = tfMap[activeTimeframe] || [4, 200];

  // Regenerate data for the selected pair + timeframe
  const s = priceState[symbol];
  const ohlcData = generateOHLC(s.price, periods, tfH, p.vol);

  const root = am5.Root.new('chart-stock');
  stockRoot = root;
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

  mainPanel.set('background', am5.Rectangle.new(root, { fill: am5.color(0x0d0d0d), fillOpacity: 1 }));

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

  candleSeries.columns.template.setAll({
    strokeOpacity: 0,
    cornerRadiusBR: 0,
    cornerRadiusTR: 0,
    width: am5.percent(80),
  });

  candleSeries.columns.template.adapters.add('fill', (_fill, target) => {
    const dataItem = target.dataItem;
    if (!dataItem) return am5.color(0xf7941d);
    return dataItem.get('valueY') >= dataItem.get('openValueY')
      ? am5.color(0x2ecc71)
      : am5.color(0xe74c3c);
  });

  // ── EMA 20 ───────────────────────────────────
  const ema20 = mainPanel.series.push(
    am5xy.LineSeries.new(root, {
      name: 'EMA 20',
      xAxis: dateAxis,
      yAxis: valueAxis,
      valueXField: 'Date',
      valueYField: 'Close',
      stroke: am5.color(0xf7941d),
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

  // ── Volume panel ─────────────────────────────
  const volumePanel = stockChart.panels.push(
    am5stock.StockPanel.new(root, {
      wheelY: 'zoomX',
      panX: true,
      height: am5.percent(16),
    })
  );

  volumePanel.set('background', am5.Rectangle.new(root, { fill: am5.color(0x0d0d0d), fillOpacity: 1 }));

  const volumeValueAxis = volumePanel.yAxes.push(
    am5xy.ValueAxis.new(root, {
      renderer: am5xy.AxisRendererY.new(root, { pan: 'zoom', opposite: true }),
      numberFormat: '#.0a',
    })
  );

  const volumeDateAxis = volumePanel.xAxes.push(
    am5xy.GaplessDateAxis.new(root, {
      baseInterval: dateAxis.get('baseInterval'),
      renderer: am5xy.AxisRendererX.new(root, {}),
    })
  );

  const volumeSeries = volumePanel.series.push(
    am5xy.ColumnSeries.new(root, {
      name: 'Volume',
      clustered: false,
      valueXField: 'Date',
      valueYField: 'Volume',
      xAxis: volumeDateAxis,
      yAxis: volumeValueAxis,
    })
  );

  volumeSeries.columns.template.setAll({
    width: am5.percent(80),
    strokeOpacity: 0,
    cornerRadiusTL: 1,
    cornerRadiusTR: 1,
  });

  volumeSeries.columns.template.adapters.add('fill', (_fill, target) => {
    const di = target.dataItem;
    if (!di) return am5.color(0x444444);
    const idx = di.index;
    if (idx === 0) return am5.color(0x444444);
    const prev = volumeSeries.dataItems[idx - 1];
    return di.get('valueY') >= (prev?.get('valueY') ?? 0) ? am5.color(0x1a5c32) : am5.color(0x5c1a1a);
  });

  // ── RSI panel ────────────────────────────────
  const rsiPanel = stockChart.panels.push(
    am5stock.StockPanel.new(root, {
      wheelY: 'zoomX',
      panX: true,
      height: am5.percent(16),
    })
  );

  rsiPanel.set('background', am5.Rectangle.new(root, { fill: am5.color(0x0d0d0d), fillOpacity: 1 }));

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

  scrollbar.set('background', am5.Rectangle.new(root, { fill: am5.color(0x0d0d0d), fillOpacity: 1 }));

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
      stroke: am5.color(0xf7941d),
      fill: am5.color(0xf7941d),
    })
  );
  sbSeries.fills.template.setAll({ fillOpacity: 0.08, visible: true });

  // ── Stock toolbar ─────────────────────────────
  const toolbar = am5stock.StockToolbar.new(root, {
    container: document.getElementById('chart-stock'),
    stockChart,
    controls: [
      am5stock.IndicatorControl.new(root, { stockChart, legend: mainPanel.children.push(am5.Legend.new(root, { centerX: am5.percent(100), x: am5.percent(100) })) }),
      am5stock.DrawingControl.new(root, { stockChart }),
      am5stock.ResetControl.new(root, { stockChart }),
      am5stock.SettingsControl.new(root, { stockChart }),
    ],
  });

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
  volumeSeries.data.setAll(ohlcData);
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
  [volumePanel, rsiPanel].forEach(panel => {
    panel.set('cursor', am5xy.XYCursor.new(root, { behavior: 'zoomX', xAxis: panel.xAxes.getIndex(0) }));
  });

  candleSeries.appear(800, 100);

  return root;
}

function rebuildStockChart(symbol) {
  if (stockRoot) { try { stockRoot.dispose(); } catch (_) {} stockRoot = null; }
  stockRoot = buildStockChart(symbol);
}

// ═══════════════════════════════════════════════
//  STRENGTH — Real Currency Strength (Single Chart + TF Selector)
// ═══════════════════════════════════════════════

// Palette exacte (référence DataTradingPro)
const CS_COLORS = {
  USD: 0xff7a00,  // orange vif
  EUR: 0xdc2626,  // rouge
  JPY: 0x06b6d4,  // cyan
  GBP: 0x22c55e,  // vert flashy
  AUD: 0x2563eb,  // bleu roi
  CHF: 0xeab308,  // jaune
  CAD: 0xa855f7,  // violet
  NZD: 0xec4899,  // rose magenta
};

const STF_ORDER  = ['today', 'week', '8h', '1d', '7d', '1m'];   // 5D retiré
const STF_LABELS = { today: 'TD', week: 'TW', '8h': '8H', '1d': '1D', '7d': '7D', '1m': '1M' };

let _strengthRoot  = null;
let _strengthTimer = null;
let _meterTimer    = null;

// Smooth a series with a 3-point moving average.
// The last point is NOT smoothed so the current market value is shown as-is.
function _smoothCS(pts) {
  return pts.map((d, i) => {
    if (d.v == null) return d;
    if (i === pts.length - 1) return d; // keep last point raw — no look-behind pull
    const p = i > 0 && pts[i - 1].v != null ? pts[i - 1].v : d.v;
    const n = pts[i + 1]?.v != null ? pts[i + 1].v : d.v;
    return { ...d, v: +((p + d.v + n) / 3).toFixed(4) };
  });
}

// Teinte CLAIRE d'une couleur (blend vers le blanc) → rectangle de droite du badge (valeur).
function _lighten(hexInt, amt) {
  const r = (hexInt >> 16) & 255, g = (hexInt >> 8) & 255, b = hexInt & 255;
  const lr = Math.round(r + (255 - r) * amt), lg = Math.round(g + (255 - g) * amt), lb = Math.round(b + (255 - b) * amt);
  return '#' + ((lr << 16) | (lg << 8) | lb).toString(16).padStart(6, '0');
}
// Badge bi-couleur (façon DTP) : [code devise — couleur pleine] [valeur — teinte claire], texte noir.
function _csBadgeHtml(ccy, fullHex, lightHex, valStr) {
  return `<div class="cs-badge"><span class="cs-badge-ccy" style="background:${fullHex}">${ccy}</span><span class="cs-badge-val" style="background:${lightHex}">${valStr}</span></div>`;
}
function buildStrengthChart(containerId, data, opts = {}) {
  const _focus = opts.focusCurrency || null;   // (optionnel) 1 devise mise en avant, les autres grisées
  const _iso   = !!opts.isolated;              // graphique autonome (rapport) → ne touche pas la réf. globale
  disposeRoot(containerId);
  const container = document.getElementById(containerId);
  if (container) container.innerHTML = '';
  const root = am5.Root.new(containerId);
  root.setThemes([applyTerminalTheme(root)]);
  root._logo?.set('forceHidden', true);
  if (!_iso) _strengthRoot = root;   // l'onglet STRENGTH garde sa réf. ; le graphique du rapport est autonome

  const chart = root.container.children.push(
    am5xy.XYChart.new(root, {
      paddingLeft: 0, paddingRight: 2, paddingTop: 4, paddingBottom: 3,
      layout: root.verticalLayout,
    })
  );
  chart.set('background', am5.Rectangle.new(root, { fill: am5.color(0x0d0d0d), fillOpacity: 1 }));  // anthracite doux (un peu moins noir)
  chart.zoomOutButton.set('forceHidden', true);
  // Clip : SEULES les courbes sont clippées (pas les axes ni les badges → l'axe X et les étiquettes droites restent visibles)
  chart.plotContainer.set('maskContent', true);

  const _firstSeries = Object.values(data.series).find(s => s.length >= 2) || [];
  const _dtMs = _firstSeries.length >= 2 ? _firstSeries[1].t - _firstSeries[0].t : 0;
  const baseInterval =
    _dtMs >= 12 * 3600000 ? { timeUnit: 'day',    count: 1 } :
    _dtMs >=      3600000 ? { timeUnit: 'hour',   count: 1 } :
                            { timeUnit: 'minute', count: 5 };

  const xAxis = chart.xAxes.push(
    am5xy.DateAxis.new(root, {
      baseInterval, extraMin: 0, extraMax: 0,
      renderer: am5xy.AxisRendererX.new(root, { minGridDistance: 60 }),
    })
  );
  // Axe X : AUCUN tooltip de date — curseur « sans information » demandé
  // (uniquement le croisillon + le point d'ancrage coloré sur la courbe survolée).
  xAxis.get('renderer').labels.template.setAll({
    fill: am5.color(0x6b7280), fontSize: 10,            // gris discret (façon DTP)
    fontFamily: '-apple-system, "Inter", "Segoe UI", sans-serif',
    minPosition: 0.012, maxPosition: 0.99,
  });
  xAxis.get('renderer').grid.template.setAll({ stroke: am5.color(0x1c1c1e), strokeOpacity: 0.9, strokeDasharray: [3, 3] });   // gris très sombre discret (DTP)
  // Axe X façon DTP : la DATE pleine au changement de jour (ex. "05/06/2026" tout à gauche) + heures HH:mm ensuite.
  xAxis.set('dateFormats',             { minute: 'HH:mm', hour: 'HH:mm', day: 'dd/MM/yyyy', week: 'dd/MM', month: 'MMM yyyy' });
  xAxis.set('periodChangeDateFormats', { minute: 'HH:mm', hour: 'dd/MM/yyyy', day: 'dd/MM/yyyy', week: 'MMM', month: 'yyyy' });
  xAxis.set('gridIntervals', [
    { timeUnit: 'minute', count: 30 }, { timeUnit: 'hour', count: 1 }, { timeUnit: 'hour', count: 3 },
    { timeUnit: 'hour', count: 6 }, { timeUnit: 'day', count: 1 }, { timeUnit: 'week', count: 1 }, { timeUnit: 'month', count: 1 },
  ]);

  const yAxisRenderer = am5xy.AxisRendererY.new(root, { opposite: true, inside: false, minWidth: 66 });
  // Chiffres de l'axe Y dans la gouttière (hors zone de tracé → pas de chevauchement)
  yAxisRenderer.labels.template.setAll({
    visible: true,
    fill: am5.color(0x94a3b8), fontSize: 9,
    fontFamily: '-apple-system, "Inter", "Segoe UI", sans-serif',
    minPosition: 0.02, maxPosition: 0.98,
    paddingLeft: 4,
  });
  // Échelle DTP : 2 décimales fixes + décimale FRANÇAISE (virgule) → "4,00 / 0,00 / -16,00".
  yAxisRenderer.labels.template.adapters.add('text', t => (t == null ? t : String(t).replace('.', ',')));
  // Grille horizontale discrète : pointillés gris foncé
  yAxisRenderer.grid.template.setAll({
    stroke: am5.color(0x1c1c1e), strokeOpacity: 0.9, strokeWidth: 1, strokeDasharray: [3, 3],   // gris très sombre discret (DTP)
  });

  const yAxis = chart.yAxes.push(
    am5xy.ValueAxis.new(root, { renderer: yAxisRenderer, numberFormat: '#0.00' })
  );

  // Zero reference line — gris clair UNI (distincte de la grille pointillée)
  const zeroRange = yAxis.createAxisRange(yAxis.makeDataItem({ value: 0 }));
  zeroRange.get('grid').setAll({ stroke: am5.color(0xffffff), strokeWidth: 1, strokeOpacity: 0.45 });
  zeroRange.get('label').set('visible', false);

  const seriesArr = [];
  const seriesMap = {};
  const labelMap  = {};   // ccy → { range } pour mise à jour en place

  // Échelle INSTITUTIONNELLE (façon DTP) : force ×100 → 0.11 devient 11,86. Compression UNIQUEMENT si extrême.
  function computeScale(d) {
    const BASE = 100;
    const abs = d.currencies
      .flatMap(c => (d.series[c] || []).map(x => x.v != null ? Math.abs(x.v) : null).filter(v => v != null))
      .sort((a, b) => a - b);
    const ref    = abs.length > 10 ? abs[Math.floor(abs.length * 0.99)] : (abs[abs.length - 1] || 0.01);
    const refMax = ref * BASE;
    const CAP    = 45;   // DTP culmine à ~±28 → cap large pour ne jamais déborder
    return refMax > CAP ? (BASE * CAP / refMax) : BASE;
  }
  let scaleFactor = computeScale(data);

  for (const ccy of data.currencies) {
    const dim      = _focus && ccy !== _focus;            // courbe à estomper (devise non sélectionnée)
    const hexColor = dim ? 0x5b6471 : (CS_COLORS[ccy] || 0x888888);
    const hexStr   = '#' + hexColor.toString(16).padStart(6, '0');
    const color    = am5.color(hexColor);
    const pts      = (data.series[ccy] || [])
      .filter(d => d.v != null && d.t != null)
      .map(d => ({ ...d, v: d.v * scaleFactor }));

    const series = chart.series.push(
      am5xy.LineSeries.new(root, {
        name: ccy, xAxis, yAxis,
        valueXField: 't', valueYField: 'v',
        stroke: color, connect: true,
        tooltip: am5.Tooltip.new(root, {
          labelText: `[bold ${hexStr}]${ccy}[/]: {valueY.formatNumber("+#.##;-#.##;0.00")}`,
          getFillFromSprite: false,
          background: am5.Rectangle.new(root, {
            fill: am5.color(0x141414), stroke: am5.color(0x252525), strokeWidth: 1,
          }),
        }),
      })
    );
    series.strokes.template.setAll({ strokeWidth: dim ? 1.1 : 1.8, strokeOpacity: dim ? 0 : 1 });   // isolé : autres devises DÉSACTIVÉES (masquées)
    const cleanPts = _smoothCS(pts);
    series.data.setAll(cleanPts);

    // Étiquette flottante sur l'axe Y à la dernière valeur
    const lastPt = cleanPts[cleanPts.length - 1];
    const lastV  = (lastPt && lastPt.v != null) ? lastPt.v : 0;
    const rangeItem = yAxis.makeDataItem({ value: lastV });
    const range     = yAxis.createAxisRange(rangeItem);
    const valStr    = lastV.toFixed(2).replace('.', ',');   // valeur SANS "+", décimale FR (façon DTP)
    range.get('label').setAll({
      html: _csBadgeHtml(ccy, hexStr, _lighten(hexColor, 0.6), valStr),
      centerY: am5.percent(50),
      centerX: am5.percent(0),   // ancré à l'axe → colonne droite parfaitement alignée (aucun décalage horizontal)
    });
    range.get('tick').set('visible', false);
    range.get('grid').setAll({ stroke: color, strokeOpacity: 0.20, strokeDasharray: [3, 3] });
    if (dim) {   // mode isolé : on masque le badge + la ligne de la devise estompée
      range.get('label').set('visible', false);
      range.get('grid').set('strokeOpacity', 0);
    }

    seriesArr.push(series);
    seriesMap[ccy] = series;
    labelMap[ccy]  = { range, value: lastV, hexStr, hexColor };

    // Légende cliquable : masquer une courbe masque AUSSI son badge flottant (et le rétablit)
    series.events.on('hidden', () => { try { range.get('label')?.set('forceHidden', true);  range.get('grid')?.set('forceHidden', true);  } catch {} });
    series.events.on('shown',  () => { try { range.get('label')?.set('forceHidden', false); range.get('grid')?.set('forceHidden', false); } catch {} });
  }

  // ── Légende cliquable (en haut) : clic sur une devise = masquer / réafficher sa courbe ──
  if (!_focus) {
    const legend = chart.children.unshift(am5.Legend.new(root, {
      centerX: am5.percent(0), x: am5.percent(0),
      marginTop: 0, marginBottom: 6, paddingLeft: 0, paddingTop: 0,
    }));
    legend.labels.template.setAll({ fill: am5.color(0xcbd5e1), fontSize: 11, fontFamily: '-apple-system, "Inter", "Segoe UI", sans-serif', paddingLeft: 3, paddingRight: 0 });
    legend.valueLabels.template.set('forceHidden', true);                       // pas de valeur dans la légende (juste le nom)
    legend.markers.template.setAll({ width: 11, height: 11 });
    legend.markerRectangles.template.setAll({ cornerRadiusTL: 2, cornerRadiusTR: 2, cornerRadiusBL: 2, cornerRadiusBR: 2 });
    legend.itemContainers.template.setAll({ paddingTop: 1, paddingBottom: 1, paddingLeft: 4, paddingRight: 4 });
    legend.data.setAll(chart.series.values);
  }

  // Croisillon : ligne verticale pointillés gris clair, suit la souris + dots magnétiques
  // snapToSeriesBy 'y!' → le tooltip suit la courbe la PLUS PROCHE du curseur (celle réellement
  // survolée) et n'affiche QUE celle-ci → on lit le bon nom (USD sur USD, GBP sur GBP…).
  const cursor = chart.set('cursor', am5xy.XYCursor.new(root, {
    behavior: 'none', snapToSeries: seriesArr, snapToSeriesBy: 'y!',
  }));
  cursor.lineX.setAll({ stroke: am5.color(0x475569), strokeWidth: 1, strokeDasharray: [3, 3], strokeOpacity: 0.9 });
  // Croisillon complet (vertical + horizontal), pointillés gris — comme l'image demandée.
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

  chart.series.values.forEach((s, i) => s.appear(500, i * 20));

  // ── Anti-collision des badges : écarte verticalement ceux trop proches ───────
  function declutter() {
    try {
      const min = yAxis.get('min'), max = yAxis.get('max');
      const h = chart.plotContainer.height();
      if (min == null || max == null || !h || max === min) return;
      const GAP = 20;  // hauteur badge + marge (façon DTP) : empilement strict, aucun chevauchement
      // Position pixel réelle de fin de chaque courbe (0 = haut), triée de haut en bas
      const arr = Object.entries(labelMap).map(([ccy, o]) => {
        const v = o.value != null ? o.value : 0;
        const px = (max - v) / (max - min) * h;
        return { ccy, o, basePx: px, px };
      }).filter(x => isFinite(x.basePx)).sort((a, b) => a.px - b.px);
      // Passe descendante : tout badge à moins de GAP du précédent est poussé vers le bas
      for (let i = 1; i < arr.length; i++) {
        if (arr[i].px - arr[i - 1].px < GAP) arr[i].px = arr[i - 1].px + GAP;
      }
      // Si la pile déborde en bas du cadre, on la remonte EN BLOC → aucun badge coupé / hors-grille
      const over = arr.length ? Math.max(0, arr[arr.length - 1].px - (h - 2)) : 0;
      if (over > 0) arr.forEach(x => { x.px -= over; });
      arr.forEach(x => {
        const lbl = x.o.range?.get('label');
        if (lbl) try { lbl.set('dy', Math.round(x.px - x.basePx)); } catch {}
      });
    } catch {}
  }
  setTimeout(declutter, 700);

  // ── Mise à jour EN PLACE (pas de reconstruction → aucun clignotement) ────────
  function update(newData) {
    if (!newData || !newData.currencies) return;
    scaleFactor = computeScale(newData);
    for (const ccy of newData.currencies) {
      const s = seriesMap[ccy];
      if (!s) continue;
      const pts = (newData.series[ccy] || [])
        .filter(d => d.v != null && d.t != null)
        .map(d => ({ ...d, v: d.v * scaleFactor }));
      const cleanPts = _smoothCS(pts);
      s.data.setAll(cleanPts);                      // animation fluide intégrée amCharts
      // Repositionner + retexter le badge flottant
      const lp = cleanPts[cleanPts.length - 1];
      const lv = (lp && lp.v != null) ? lp.v : 0;
      const lbl = labelMap[ccy];
      if (lbl && lbl.range) {
        lbl.value = lv;
        try { lbl.range.set('value', lv); } catch {}
        try { lbl.range.get('label')?.set('html', _csBadgeHtml(ccy, lbl.hexStr, _lighten(lbl.hexColor, 0.6), lv.toFixed(2).replace('.', ','))); } catch {}
      }
    }
    setTimeout(declutter, 60);   // recalibrer l'anti-collision après mise à jour
  }

  return { root, seriesMap, update };
}

// Graphique de force ISOLÉ (réutilisé par le Weekly Recap) :
// la devise `focusCurrency` garde sa couleur à 100 %, les 7 autres passent en gris à 10 %.
async function buildIsolatedStrength(containerId, focusCurrency, period = 'week') {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = (window.dtpLoader ? window.dtpLoader('Chargement de la force des devises…') : 'Chargement…');
  try {
    const data = await fetch(`/api/currency-strength?period=${period}`).then(r => r.json());
    if (!data || !data.currencies) { el.innerHTML = '<div class="wr-chart-loading">Force des devises indisponible.</div>'; return; }
    el.innerHTML = '';
    return buildStrengthChart(containerId, data, { focusCurrency, isolated: true });
  } catch {
    el.innerHTML = '<div class="wr-chart-loading">Force des devises indisponible.</div>';
  }
}
window.buildIsolatedStrength = buildIsolatedStrength;

// Ranked snapshot view — horizontal bars sorted strongest → weakest
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
      const hex    = '#' + (CS_COLORS[s.ccy] || 0x888888).toString(16).padStart(6, '0');
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

async function buildStrengthCharts() {
  const wrap = document.getElementById('strength-charts-row');
  if (!wrap) return;

  // Nettoyage
  if (_strengthRoot) { try { _strengthRoot.dispose(); } catch {} _strengthRoot = null; }
  _strengthTimers.forEach(t => clearInterval(t)); _strengthTimers = [];
  ['chart-strength-L', 'chart-strength-R'].forEach(id => { try { disposeRoot(id); } catch {} });

  const paneHtml = (side, defPeriod) => `
    <div class="strength-pane" data-side="${side}">
      <div class="strength-tf-bar">
        <span class="strength-chart-label">Currency Strength</span>
        <span style="flex:1"></span>
        ${STF_ORDER.map(p =>
          `<button class="stf-btn stf-tf-btn${p === defPeriod ? ' stf-btn--active' : ''}" data-period="${p}">${STF_LABELS[p]}</button>`
        ).join('')}
      </div>
      <div class="strength-main-chart" id="chart-strength-${side}"></div>
    </div>`;

  wrap.innerHTML = paneHtml('L', 'today') + paneHtml('R', 'week');

  // Contrôleur d'un panneau (chargement + rendu + auto-refresh indépendants)
  function makePane(side, initialPeriod) {
    const pane        = wrap.querySelector(`.strength-pane[data-side="${side}"]`);
    const containerId = `chart-strength-${side}`;
    let activePeriod  = initialPeriod;
    let chartCtl      = null;   // { root, seriesMap, update }

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
        const data = await fetch(url).then(r => r.json());
        if (!data.currencies) throw new Error(data.error || 'No data');
        if (chartCtl && chartCtl.update && !periodChanged) {
          chartCtl.update(data);            // ← prolonge la courbe sans clignoter
        } else {
          try { disposeRoot(containerId); } catch {}
          chartCtl = buildStrengthChart(containerId, data);
        }
      } catch (e) {
        console.error('[Strength]', side, e.message);
        if (!chartCtl) {
          const el2 = document.getElementById(containerId);
          if (el2) el2.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--red);font-size:10px;font-family:var(--font-mono)">${e.message}</div>`;
        }
      }
    }

    pane.querySelectorAll('.stf-tf-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        pane.querySelectorAll('.stf-tf-btn').forEach(b => b.classList.remove('stf-btn--active'));
        btn.classList.add('stf-btn--active');
        chartCtl = null;                    // changement de période → reconstruction
        load(btn.dataset.period, { force: false });
      });
    });

    load(initialPeriod, { force: true });
    // Rafraîchissement rapide et fluide (20s) — uniquement quand l'onglet STRENGTH est visible
    _strengthTimers.push(setInterval(() => {
      const panel = document.getElementById('rtab-strength');
      if (!panel || !panel.classList.contains('active')) { _strengthTimers.forEach(t => clearInterval(t)); _strengthTimers = []; return; }
      load(activePeriod, { silent: true });
    }, 20_000));
  }

  makePane('L', 'today');  // gauche → TD (intraday)
  makePane('R', 'week');   // droite → TW (hebdomadaire)
}

// ═══════════════════════════════════════════════
//  RISK — Real Risk Sentiment Widget
// ═══════════════════════════════════════════════

let _riskRefreshTimer = null;
let _riskGaugeOnUpdate = null;   // listener du snapshot risque partagé (source unique)
let _riskGaugeRoot    = null;
let _riskHandDI       = null;
let _riskScoreLabel   = null;
let _riskBadgeLabel   = null;

// Bande sentiment (● LABEL: phrase EN) — partagée build + mise à jour du widget risque
const _RISK_BAND_EN = {
  'STRONG RISK-ON':  'Strong appetite for risk. Capital rotates into equities and high-beta. Safe havens sold.',
  'RISK-ON':         'Risk appetite prevails. Equities and risk assets bid; defensive assets soft.',
  'WEAK RISK-ON':    'Mild risk appetite. Constructive tone but limited conviction.',
  'NEUTRAL':         'Balanced sentiment. Mixed signals across risk assets, no clear direction.',
  'WEAK RISK-OFF':   'Cautious sentiment prevails. Mixed flows. Safe havens supported. Volatility elevated.',
  'RISK-OFF':        'Risk aversion in play. Flight to safety — bonds, gold, JPY and CHF bid.',
  'STRONG RISK-OFF': 'Strong risk aversion. Significant flight to safety across havens. Volatility high.',
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
    'STRONG RISK-ON':  'Strong appetite for risk.',
    'RISK-ON':         'Risk appetite firmly in play.',
    'WEAK RISK-ON':    'Risk appetite improving gradually.',
    'NEUTRAL':         'Balanced risk appetite. Markets consolidating.',
    'WEAK RISK-OFF':   'Caution creeping in.',
    'RISK-OFF':        'Risk aversion in play.',
    'STRONG RISK-OFF': 'Strong risk aversion.',
  };
  const eqTxt    = eq    > 0.1 ? 'Equities bid' : eq    < -0.1 ? 'Equities under pressure' : 'Equities steady';
  const havenTxt = haven > 0.1 ? 'safe havens bid' : haven < -0.1 ? 'safe havens soften' : 'safe havens mixed';
  const vixTxt   = `VIX ${vix >= 0 ? '+' : ''}${vix.toFixed(1)}%`;
  const phrase = (data.assets && data.assets.length)
    ? `${LEAD[data.label] || ''} ${eqTxt}, ${havenTxt}. ${vixTxt}.`
    : (_RISK_BAND_EN[data.label] || data.description || '');
  return `<span class="risk-ticker-dot"></span><span class="risk-ticker-txt"><strong>${data.label}:</strong> ${phrase}</span>`;
}

function buildRiskGauge() {
  const wrap = document.getElementById('risk-widget');
  if (!wrap) return;

  clearInterval(_riskRefreshTimer);
  if (_riskGaugeRoot) { _riskGaugeRoot.dispose(); _riskGaugeRoot = null; }
  _riskHandDI = _riskScoreLabel = _riskBadgeLabel = null;

  wrap.innerHTML = (window.dtpLoader ? window.dtpLoader('Chargement de la jauge de risque…') : 'Chargement…');

  let isBuilt = false;

  async function loadAndRender(dataArg) {
    try {
      // Source unique : on réutilise le snapshot partagé (fetché par app.js) si dispo,
      // sinon on fetch une fois et on alimente le snapshot. → jamais de divergence.
      const data = dataArg || window._dtpRisk || await fetch('/api/risk-sentiment').then(r => r.json());
      if (data.error) throw new Error(data.error);
      window._dtpRisk = data;

      const GAUGE_LABEL_FR = {
        'STRONG RISK-ON':  'FORT APPÉTIT POUR LE RISQUE',
        'RISK-ON':         'APPÉTIT POUR LE RISQUE',
        'WEAK RISK-ON':    'FAIBLE APPÉTIT AU RISQUE',
        'NEUTRAL':         'NEUTRE',
        'WEAK RISK-OFF':   'LÉGÈRE AVERSION AU RISQUE',
        'RISK-OFF':        'AVERSION AU RISQUE',
        'STRONG RISK-OFF': 'FORTE AVERSION AU RISQUE',
      };
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
              <div class="risk-readout-score" id="risk-score-val">${display}</div>
              <div class="risk-readout-badge ${cls}" id="risk-badge-val">${data.label}</div>
            </div>
          </div>`;

        const root = am5.Root.new('risk-gauge-div');
        root.setThemes([am5themes_Dark.new(root)]);
        root._logo?.set('forceHidden', true);
        _riskGaugeRoot = root;

        const chart = root.container.children.push(
          am5radar.RadarChart.new(root, {
            panX: false, panY: false,
            startAngle: -180, endAngle: 0,
            radius: am5.percent(80),
            innerRadius: am5.percent(73),               // arc plus FIN (épuré)
            paddingTop: 14, paddingBottom: 64,           // + d'espace sous l'arc → dégage le pivot du texte
            paddingLeft: 44, paddingRight: 44,
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

        // Aiguille moderne et épurée : fine, effilée, teinte neutre claire. PAS de gros rond
        // au pivot → juste un petit point net de la même couleur (look jauge pro).
        _riskHandDI = axis.makeDataItem({ value: 0 });
        const hand = am5radar.ClockHand.new(root, {
          pinRadius: am5.percent(3),                 // petit point discret (plus de gros hub sombre)
          radius: am5.percent(60),
          innerRadius: am5.percent(0),
          bottomWidth: 6,                            // aiguille fine
          topWidth: 0,
        });
        hand.pin.setAll({ fill: am5.color(0xe9ebee), fillOpacity: 1, strokeOpacity: 0 });   // point net, même teinte
        hand.hand.setAll({ fill: am5.color(0xe9ebee), strokeOpacity: 0 });

        _riskHandDI.set('bullet', am5xy.AxisBullet.new(root, { sprite: hand }));
        axis.createAxisRange(_riskHandDI);
        _riskHandDI.get('grid')?.setAll({ visible: false });

        // Score label
        // Score + badge sont rendus en HTML CENTRÉ (overlay .risk-readout) → centrage garanti
        // sous la jauge, design net et facile à styliser. (Plus de labels amCharts ici.)

        // Animate needle to initial value
        _riskHandDI.animate({
          key: 'value', to: gaugeVal,
          duration: 1000, easing: am5.ease.out(am5.ease.cubic),
        });

      } else {
        // Refresh: animate needle + update labels
        if (_riskHandDI) {
          _riskHandDI.animate({
            key: 'value', to: gaugeVal,
            duration: 800, easing: am5.ease.out(am5.ease.cubic),
          });
        }
        const scoreEl = document.getElementById('risk-score-val');
        if (scoreEl) scoreEl.textContent = display;
        const badgeEl = document.getElementById('risk-badge-val');
        if (badgeEl) { badgeEl.textContent = data.label; badgeEl.className = `risk-readout-badge ${cls}`; }
        const ticker = document.getElementById('risk-ticker');
        if (ticker) {
          ticker.className = `risk-ticker ${cls}`;
          ticker.innerHTML = _riskBandInner(data);
        }
      }

      const updEl = document.getElementById('risk-updated');
      if (updEl && data.updatedAt) {
        const d = new Date(data.updatedAt);
        updEl.textContent = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      }

    } catch (e) {
      if (!isBuilt) wrap.innerHTML = `<div style="padding:16px;color:var(--red);font-size:11px">Error: ${e.message}</div>`;
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
//  METER — Sentiment Gauge
// ═══════════════════════════════════════════════

// Métadonnées devises (code pays ISO pour flagcdn + nom complet)
const METER_META = {
  USD: { iso: 'us', name: 'US Dollar' },
  EUR: { iso: 'eu', name: 'Euro' },
  JPY: { iso: 'jp', name: 'Japanese Yen' },
  GBP: { iso: 'gb', name: 'British Pound' },
  AUD: { iso: 'au', name: 'Australian Dollar' },
  CHF: { iso: 'ch', name: 'Swiss Franc' },
  CAD: { iso: 'ca', name: 'Canadian Dollar' },
  NZD: { iso: 'nz', name: 'New Zealand Dollar' },
};
// Drapeau image (flagcdn) — fonctionne sur tous les OS (contrairement aux emojis)
function _flagImg(iso, size = 16) {
  return `<img class="meter-flag-img" src="https://flagcdn.com/w20/${iso}.png" `
       + `srcset="https://flagcdn.com/w40/${iso}.png 2x" width="${size}" alt="" loading="lazy">`;
}
const METER_ORDER  = ['USD', 'EUR', 'JPY', 'GBP', 'AUD', 'CHF', 'CAD', 'NZD'];
const METER_BRICKS = 10;   // briques par moitié (10 haut + 10 bas)

function buildMeterChart() {
  clearInterval(_meterTimer);
  const container = document.getElementById('chart-meter');
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
        const col2 = v >= 0 ? '#00da50' : '#ff3b3b';   // couleurs Meter DTP
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
      });
      // Valeur chiffrée sous la colonne (précision)
      const valEl = col.querySelector('.meter-col-val');
      if (valEl) {
        valEl.textContent = (v >= 0 ? '+' : '') + v.toFixed(2);
        valEl.style.color = v > 0 ? '#00da50' : v < 0 ? '#ff3b3b' : '#64748b';   // couleurs Meter DTP
      }
    });
  }

  buildSkeleton();
  container.querySelectorAll('.meter-brick').forEach(b => b.classList.add('meter-brick--off'));

  async function loadAndRender() {
    try {
      const resp = await fetch('/api/currency-strength?period=1d');
      const data = await resp.json();
      if (!data.currencies || !data.series) throw new Error(data.error || 'No data');
      const values = {};
      data.currencies.forEach(ccy => {
        const pts = (data.series[ccy] || []).filter(d => d.v != null);
        values[ccy] = pts.length ? +pts[pts.length - 1].v.toFixed(2) : 0;
      });
      applyValues(values);
    } catch (e) {
      console.error('[Meter]', e.message);
    }
  }

  loadAndRender();
  _meterTimer = setInterval(() => {
    const panel = document.getElementById('rtab-meter');
    if (!panel || !panel.classList.contains('active')) { clearInterval(_meterTimer); _meterTimer = null; return; }
    loadAndRender();                                      // ne poll que si l'onglet METER est visible
  }, 15 * 1000);   // temps réel : MAJ toutes les 15 s
}

// ═══════════════════════════════════════════════
//  COT — Commitment of Traders
// ═══════════════════════════════════════════════

function buildCOTChart() {
  const grid = document.getElementById('cot-grid');
  if (!grid) return;
  grid.innerHTML = (window.dtpLoader ? window.dtpLoader('Chargement des données COT…') : 'Chargement des données COT…');

  const activeTypeBtn = document.querySelector('.cot-type-btn--active');
  const cotType = activeTypeBtn ? activeTypeBtn.dataset.cotType : 'lev_money';

  fetch(`/api/cot?type=${cotType}`)
    .then(r => r.json())
    .then(data => {
      if (!data.currencies || data.currencies.length === 0) {
        grid.innerHTML = '<div style="padding:20px;color:#666;font-size:11px;">COT data unavailable</div>';
        return;
      }
      grid.innerHTML = '';

      const TYPE_LABELS = {
        noncomm: 'Non-Commercial', dealer: 'Courtier intermédiaire',
        asset_mgr: 'Asset Manager', lev_money: 'Fonds à effet de levier',
        other_rept: 'Autres reportables',
      };
      const typeLabel = TYPE_LABELS[cotType] || 'COT';
      const COT_ISO = { USD:'us', EUR:'eu', JPY:'jp', GBP:'gb', AUD:'au', CHF:'ch', CAD:'ca', NZD:'nz' };
      const cx = 40, cy = 40, r = 28;
      const C  = 2 * Math.PI * r;
      const fmtK = v => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(Math.round(v));

      for (const cur of data.currencies) {
        const sArc = (cur.shortPct / 100 * C).toFixed(2);
        const sGap = (C - cur.shortPct / 100 * C).toFixed(2);
        const lArc = (cur.longPct  / 100 * C).toFixed(2);
        const lGap = (C - cur.longPct  / 100 * C).toFixed(2);

        const bull   = cur.longPos >= cur.shortPos;
        const biasFr = bull ? 'Haussier' : 'Baissier';
        const biasCl = bull ? 'cot-green' : 'cot-red';
        const net    = Math.abs(cur.longPos - cur.shortPos);
        const flag   = _flagImg(COT_ISO[cur.key] || 'us', 14);

        const cell = document.createElement('div');
        cell.className = 'cot-cell';
        cell.innerHTML = `
          <div class="cot-card-head">
            <span class="cot-head-left">${flag}<span class="cot-head-ccy">${cur.key}${cur.derived ? '*' : ''}</span></span>
            <span class="cot-head-type">${typeLabel}</span>
          </div>
          <div class="cot-legend">
            <span class="cot-leg"><i class="cot-dot cot-dot--s"></i>Court</span>
            <span class="cot-leg"><i class="cot-dot cot-dot--l"></i>Long</span>
          </div>
          <div class="cot-gauge-wrap">
            <svg class="cot-donut" width="96" height="96" viewBox="0 0 80 80">
              <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="8"/>
              <g transform="rotate(-90 ${cx} ${cy})">
                <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f43f5e" stroke-width="8"
                  stroke-dasharray="${sArc} ${sGap}" stroke-linecap="round"/>
                <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#10b981" stroke-width="8"
                  stroke-dasharray="${lArc} ${lGap}" stroke-dashoffset="${lArc}" stroke-linecap="round"/>
              </g>
              <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="13" font-weight="700"
                fill="#e2e8f0" font-family="-apple-system,'Inter','Segoe UI',sans-serif">${cur.key}</text>
            </svg>
          </div>
          <div class="cot-stats">
            <div class="cot-stat">
              <div class="cot-stat-lbl">Positions courtes</div>
              <div class="cot-stat-val cot-red">${fmtK(cur.shortPos)}</div>
              <div class="cot-stat-pct">${cur.shortPct}%</div>
            </div>
            <div class="cot-stat">
              <div class="cot-stat-lbl">Positions longues</div>
              <div class="cot-stat-val cot-green">${fmtK(cur.longPos)}</div>
              <div class="cot-stat-pct">${cur.longPct}%</div>
            </div>
            <div class="cot-stat">
              <div class="cot-stat-lbl">Position nette</div>
              <div class="cot-stat-val ${biasCl}">${biasFr}</div>
              <div class="cot-stat-pct">${fmtK(net)}</div>
            </div>
          </div>`;
        grid.appendChild(cell);
      }
    })
    .catch(() => {
      grid.innerHTML = '<div style="padding:20px;color:#666;font-size:11px;">Failed to load COT data</div>';
    });
}

// ═══════════════════════════════════════════════
//  DMX — Myfxbook Community Outlook
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
  if (!ts) return 'Live';
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  return m < 1 ? 'Live · à l\'instant' : `Live · MAJ il y a ${m} min`;
}

function buildDMXChart(forceRefresh = false) {
  const wrap = document.getElementById('dmx-table-wrap');
  if (!wrap) return;

  const activeTfBtn = document.querySelector('.dmx-tf-btn--active');
  const period = activeTfBtn ? activeTfBtn.dataset.tf : 'H1';

  // En-tête : fraîcheur réelle du snapshot (Myfxbook = 1 jeu de données live partagé par les TF)
  const periodLbl = document.getElementById('dmx-period-label');
  if (periodLbl && !periodLbl.textContent) periodLbl.textContent = 'Live';

  // On NE force PLUS automatiquement : le serveur sert son cache INSTANTANÉMENT et le tient
  // à jour en arrière-plan (refresh 5 min). On ne force (refresh fond) que via le bouton Retry.
  const url = `/api/community-outlook?period=${period}${forceRefresh ? '&force=1' : ''}`;

  // On n'affiche "Chargement…" que si l'onglet est vide (sinon on garde l'ancien rendu → pas de flash)
  if (!wrap.querySelector('.dmx2-row')) wrap.innerHTML = (window.dtpLoader ? window.dtpLoader('Chargement des données DMX…') : 'Chargement…');

  fetch(url)
    .then(r => r.json())
    .then(data => {
      if (data.error) throw new Error(data.error);
      let symbols = (data.symbols || []).filter(row => _dmxAllowed(row.symbol));
      if (!symbols.length) {
        wrap.innerHTML = '<div class="dmx-loading">No data — Myfxbook connection pending…</div>';
        return;
      }

      _dmxLastUpdate = Date.now();
      if (periodLbl) periodLbl.textContent = _dmxAgo(data.updatedTs);

      const sortVal = document.getElementById('dmx-sort-select')?.value || 'az';
      if (sortVal === 'long')       symbols.sort((a, b) => b.longPct  - a.longPct);
      else if (sortVal === 'short') symbols.sort((a, b) => b.shortPct - a.shortPct);
      else                          symbols.sort((a, b) => a.symbol.localeCompare(b.symbol));

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

      // Auto-refresh tant que l'onglet DMX est visible (sert le cache serveur, MAJ 15 min)
      if (!_dmxTimer) {
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
      wrap.innerHTML = `<div class="dmx-loading">
        Connection error — retrying…<br>
        <button onclick="buildDMXChart(true)" style="margin-top:10px;background:var(--bg3);border:1px solid var(--border2);color:var(--text2);padding:3px 10px;font-size:10px;cursor:pointer;border-radius:2px;font-family:var(--font-mono);">Retry</button>
      </div>`;
      setTimeout(() => buildDMXChart(true), 15000);
    });
}

function initCOTTabs() {
  document.querySelectorAll('.cot-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cot-type-btn').forEach(b => b.classList.remove('cot-type-btn--active'));
      btn.classList.add('cot-type-btn--active');
      buildCOTChart();
    });
  });
}

const _DMX_TF_LABELS = { H1: 'Every Hour', H4: 'Every 4 Hours', D1: 'Every Day' };

function initDMXTabs() {
  document.querySelectorAll('.dmx-tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dmx-tf-btn').forEach(b => b.classList.remove('dmx-tf-btn--active'));
      btn.classList.add('dmx-tf-btn--active');
      // Update period label in header
      const lbl = document.getElementById('dmx-period-label');
      if (lbl) lbl.textContent = _DMX_TF_LABELS[btn.dataset.tf] || btn.dataset.tf;
      buildDMXChart(true);
    });
  });
}

// ═══════════════════════════════════════════════
//  SESSION MAP — amCharts 5 MapChart
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

function buildSessionMap() {
  if (typeof am5map === 'undefined' || typeof am5geodata_worldLow === 'undefined') {
    setTimeout(buildSessionMap, 800);
    return;
  }
  disposeRoot('am5-map');
  if (mapTimelineTimer) { clearInterval(mapTimelineTimer); mapTimelineTimer = null; }
  if (mapClockTimer)    { clearInterval(mapClockTimer);    mapClockTimer = null; }

  const root = am5.Root.new('am5-map');
  mapRoot = root;
  root.setThemes([applyTerminalTheme(root)]);
  root._logo?.set('forceHidden', true);
  root._logo?.dispose();

  const chart = root.container.children.push(
    am5map.MapChart.new(root, {
      projection:   am5map.geoMercator(),
      panX:         'rotateX',
      panY:         'none',
      wheelY:       'none',
      wheelX:       'none',
      homeZoomLevel: 1.05,
      homeGeoPoint: { longitude: 15, latitude: 20 },
      paddingTop: 4, paddingBottom: 4, paddingLeft: 4, paddingRight: 4,
    })
  );
  chart.set('background', am5.Rectangle.new(root, { fill: am5.color(0x000000), fillOpacity: 1 }));  // fond NOIR pur (comme DTP)

  // Rendu ÉPURÉ : pas de grille (graticule) → carte propre comme la référence.

  // Country polygons — vert plus clair sur océan noir (valeurs DTP)
  const polygonSeries = chart.series.push(
    am5map.MapPolygonSeries.new(root, { geoJSON: am5geodata_worldLow, exclude: ['AQ'] })
  );
  polygonSeries.mapPolygons.template.setAll({
    fill: am5.color(0x3d8f43), stroke: am5.color(0x4aa052),
    strokeWidth: 0.4, fillOpacity: 1, interactive: true, tooltipText: '{name}',
  });
  polygonSeries.mapPolygons.template.states.create('hover', { fill: am5.color(0x4aa052) });

  // ── Terminateur JOUR/NUIT : voile sombre plus DOUX/transparent (projection de session ~18%) ──
  const nightSeries = chart.series.push(am5map.MapPolygonSeries.new(root, {}));
  nightSeries.mapPolygons.template.setAll({ fill: am5.color(0x05070a), fillOpacity: 0.4, strokeOpacity: 0, interactive: false });
  function _nightPolygon(now) {
    const rad = Math.PI / 180, deg = 180 / Math.PI;
    const yStart = Date.UTC(now.getUTCFullYear(), 0, 0);
    const doy = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - yStart) / 86400000);
    const decl = -23.44 * Math.cos(rad * (360 / 365) * (doy + 10)) * rad;        // déclinaison solaire (rad)
    const utcH = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
    const lonSun = -15 * (utcH - 12);                                            // longitude subsolaire
    const tanDecl = Math.tan(decl) || 1e-9;
    const coords = [];
    for (let lon = -180; lon <= 180; lon += 2) {
      const lat = Math.atan(-Math.cos((lon - lonSun) * rad) / tanDecl) * deg;     // latitude du terminateur
      coords.push([lon, Math.max(-89.9, Math.min(89.9, lat))]);
    }
    const darkPole = decl > 0 ? -85 : 85;                                        // pôle en nuit (clampé = limite Mercator)
    coords.push([180, darkPole], [-180, darkPole], [coords[0][0], coords[0][1]]);
    return coords;
  }
  function refreshNight(now) {
    try { nightSeries.data.setAll([{ geometry: { type: 'Polygon', coordinates: [_nightPolygon(now)] } }]); } catch {}
  }
  refreshNight(new Date());

  // ── Orange UTC vertical line ──────────────────
  const utcLineSeries = chart.series.push(am5map.MapLineSeries.new(root, {}));
  utcLineSeries.mapLines.template.setAll({
    stroke: am5.color(0xf79400), strokeWidth: 1.4, strokeOpacity: 0.7,   // trait fin (DTP)
  });

  const utcLabelSeries = chart.series.push(am5map.MapPointSeries.new(root, {}));
  let _utcLabel = null;
  utcLabelSeries.bullets.push((r) => {
    const cont = am5.Container.new(r, {});
    cont.children.push(am5.RoundedRectangle.new(r, {
      width: 46, height: 19,
      fill: am5.color(0xf79400), fillOpacity: 1,
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
    return am5.Bullet.new(r, { sprite: cont });
  });

  let _lastUTCLineLon = null;
  function refreshUTCLine(now) {
    const h = now.getUTCHours() + now.getUTCMinutes() / 60;
    const lon = (h - 12) * 15;
    // Petit timer orange = COUNTDOWN jusqu'au prochain événement de session (ouverture/fermeture), comme DTP
    const utcH = h + now.getUTCSeconds() / 3600;
    let best = Infinity;
    SESSION_BLOCKS.forEach(s => {
      [s.utcOpen, s.utcClose].forEach(b => { let d = b - utcH; if (d <= 0) d += 24; if (d < best) best = d; });
    });
    const totalMin = Math.max(0, Math.round(best * 60));
    const cd = String(Math.floor(totalMin / 60)).padStart(2, '0') + ':' + String(totalMin % 60).padStart(2, '0');
    if (_utcLabel) _utcLabel.set('text', cd);
    if (_lastUTCLineLon === null || Math.abs(lon - _lastUTCLineLon) >= 0.25) {
      _lastUTCLineLon = lon;
      utcLineSeries.data.setAll([{ geometry: { type: 'LineString', coordinates: [[lon, 85], [lon, -85]] } }]);
      utcLabelSeries.data.setAll([{ geometry: { type: 'Point', coordinates: [lon, 68] } }]);
    }
  }

  // ── 4 key trading cities ──────────────────────
  const SESSION_CITIES = [
    { id: 'london',  name: 'London',   tz: 'Europe/London',    lon: -0.12,  lat: 51.5,  open: 8, close: 17, labelLeft: true,  color: 0xf79400 },
    { id: 'newyork', name: 'New York', tz: 'America/New_York', lon: -74.0,  lat: 40.7,  open: 9, close: 17, labelLeft: true,  color: 0xa855f7 },
    { id: 'tokyo',   name: 'Tokyo',    tz: 'Asia/Tokyo',       lon: 139.7,  lat: 35.7,  open: 9, close: 15, labelLeft: false, color: 0x22d3ee },
    { id: 'sydney',  name: 'Sydney',   tz: 'Australia/Sydney', lon: 151.2,  lat: -33.9, open: 9, close: 17, labelLeft: false, color: 0x34d399 },
  ];

  function isCityOpen4(city, now) {
    const local = new Date(now.toLocaleString('en-US', { timeZone: city.tz }));
    const h = local.getHours() + local.getMinutes() / 60;
    const dow = local.getDay();
    return dow !== 0 && dow !== 6 && h >= city.open && h < city.close;
  }

  const pointSeries = chart.series.push(am5map.MapPointSeries.new(root, {}));
  mapCityPointSeries = pointSeries;

  function buildCityData4(now) {
    return SESSION_CITIES.map(c => ({
      geometry:  { type: 'Point', coordinates: [c.lon, c.lat] },
      id:        c.id,
      name:      c.name,
      isOpen:    isCityOpen4(c, now),
      labelLeft: c.labelLeft,
      color:     c.color,
    }));
  }

  pointSeries.data.setAll(buildCityData4(new Date()));

  const _cityTimeLabelRefs = {};

  pointSeries.bullets.clear();
  pointSeries.bullets.push((root, series, dataItem) => {
    const data   = dataItem.dataContext;
    const isOpen = data.isOpen;
    const accent = data.color || 0xf79400;        // couleur propre à la session (London=orange, NY=violet…)
    const cont   = am5.Container.new(root, {});

    // City clock label box
    const boxX = data.labelLeft ? -94 : 8;

    const box = cont.children.push(am5.Container.new(root, {
      x: boxX - 4, y: -38,
      width: 78,
      paddingTop: 4, paddingBottom: 4, paddingLeft: 7, paddingRight: 7,
      layout: root.verticalLayout,
    }));

    box.set('background', am5.RoundedRectangle.new(root, {
      fill:          am5.color(0x0a0f1e),       // rgba(10,15,30,.85) — bleu nuit DTP
      fillOpacity:   0.85,
      stroke:        isOpen ? am5.color(accent) : am5.color(0x5078ff),
      strokeOpacity: isOpen ? 0.9 : 0.25,        // bordure bleue discrète (rgba(80,120,255,.25))
      strokeWidth:   isOpen ? 1.4 : 1,
      cornerRadiusTL: 5, cornerRadiusTR: 5, cornerRadiusBL: 5, cornerRadiusBR: 5,
      shadowColor: isOpen ? am5.color(accent) : undefined,
      shadowBlur:  isOpen ? 9 : 0, shadowOpacity: isOpen ? 0.3 : 0,
    }));

    const timeLabel = box.children.push(am5.Label.new(root, {
      text:       '--:--:--',
      fill:       am5.color(isOpen ? accent : 0xc8d2e0),   // texte plus lumineux
      fontSize:   11.5, fontWeight: '700',
      fontFamily: '-apple-system, "Inter", "Segoe UI", sans-serif',
      width: am5.percent(100),
    }));

    box.children.push(am5.Label.new(root, {
      text:       data.name,
      fill:       am5.color(isOpen ? 0xf4f6f9 : 0x8b97ab),
      fontSize:   9.5, fontWeight: '600',
      fontFamily: '-apple-system, "Inter", "Segoe UI", sans-serif',
      width: am5.percent(100),
    }));

    _cityTimeLabelRefs[data.id] = timeLabel;

    // Pulse ring for open sessions (couleur de la session)
    if (isOpen) {
      const ring = cont.children.push(
        am5.Circle.new(root, { radius: 7, fillOpacity: 0, stroke: am5.color(accent), strokeOpacity: 0.75, strokeWidth: 1.5 })
      );
      ring.animate({ key: 'radius',        from: 5,   to: 22, duration: 2000, loops: Infinity, easing: am5.ease.out(am5.ease.cubic) });
      ring.animate({ key: 'strokeOpacity', from: 0.75, to: 0, duration: 2000, loops: Infinity, easing: am5.ease.out(am5.ease.cubic) });
    }

    // City dot (couleur de la session si ouverte)
    cont.children.push(am5.Circle.new(root, {
      radius:      isOpen ? 5 : 3,
      fill:        isOpen ? am5.color(accent) : am5.color(0x555570),
      stroke:      isOpen ? am5.color(0xffffff) : am5.color(0x333350),
      strokeWidth: isOpen ? 1.4 : 0.8,
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
    // DTP affiche simplement "Live" (vert) à côté du point — pas la liste des sessions
    const labEl = document.getElementById('active-sessions-label');
    if (labEl) { labEl.textContent = 'Live'; labEl.style.color = '#22c55e'; }
  }

  let _nightTick = 0;
  mapClockTimer = setInterval(() => {
    const now = new Date();
    updateHeader(now);
    refreshUTCLine(now);
    updateCityTimes(now);
    if ((_nightTick++ % 60) === 0) refreshNight(now);   // terminateur jour/nuit : maj 1×/min
  }, 1000);

  updateHeader(new Date());
  refreshUTCLine(new Date());
  setTimeout(() => updateCityTimes(new Date()), 200);

  polygonSeries.events.on('datavalidated', () => chart.goHome(800));

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
  if (tab === 'meter')    { buildMeterChart();    return; }   // rebuild léger (briques HTML)
  if (tab === 'strength') { buildStrengthCharts(); return; }  // dispose + rebuild amCharts
  // Onglets statiques (carte, jauge risque) : construits une seule fois
  if (chartInited[tab]) return;
  chartInited[tab] = true;
  switch (tab) {
    case 'world':    buildSessionMap();     break;
    case 'risk':     buildRiskGauge();      break;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Tab switching
  document.getElementById('right-panel-tabs')?.addEventListener('click', e => {
    const tab = e.target.closest('[data-rtab]')?.dataset?.rtab;
    if (!tab) return;
    document.querySelectorAll('[data-rtab]').forEach(t => t.classList.toggle('right-tab--active', t.dataset.rtab === tab));
    document.querySelectorAll('.right-tab-panel').forEach(p => p.classList.toggle('active', p.id === `rtab-${tab}`));
    initRightTab(tab);
    try { localStorage.setItem('dtp_active_rtab', tab); } catch {}   // mémorise le sous-onglet
  });

  // ── View switching (main nav) ──────────────────────────────────────────────
  // Liste des onglets valides (pour valider une valeur mémorisée)
  const VALID_VIEWS = ['news', 'calendar', 'bias', 'fxlist', 'institution', 'analyst', 'weekahead', 'bank', 'taux', 'symbol'];
  // Titre d'onglet élégant : "DTP | <PAGE>" (NEWS par défaut = espace de travail "JOT")
  // Titre FIXE de l'onglet : "DataTradingPro - <nom utilisateur>" (ne dépend plus de la vue active).
  // Le nom est exposé par index.html après /api/auth/me (window._dtpUser).
  function _setDocTitle(_view) {
    try { document.title = 'DTP' + (window._dtpUser ? ' | ' + window._dtpUser : ''); } catch {}
  }

  async function loadTauxView() {
    const host = document.getElementById('taux-grid');
    if (!host) return;
    const MV = { HOLD: { lbl: 'Maintien', cls: 'n' }, HIKE: { lbl: 'Hausse', cls: 'g' }, CUT: { lbl: 'Baisse', cls: 'r' } };
    const fr  = d => { try { const p = String(d).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; } catch (e) { return d; } };
    const bps = v => (v > 0 ? '+' : '') + Number(v).toFixed(1) + ' bps';
    const SPK = { HIKE: 'M0 14 L12 10 L24 12 L36 5 L48 2', CUT: 'M0 2 L12 6 L24 4 L36 10 L48 14', HOLD: 'M0 9 L12 7 L24 9 L36 7 L48 8' };
    const SPC = { HIKE: '#00da50', CUT: '#ff4d2e', HOLD: '#abb4c3' };
    // Sparkline data-driven (probabilité / Δ implicite au fil des réunions) → tendance réelle, jamais inventée.
    const spk = (arr, color) => {
      if (!arr || arr.length < 2) arr = (arr && arr.length) ? [arr[0], arr[0]] : [0, 0];
      const n = arr.length, mn = Math.min(...arr), mx = Math.max(...arr), rng = (mx - mn) || 1, W = 48, H = 16, P = 2;
      const d = arr.map((v, i) => { const x = (i / (n - 1)) * W, y = H - P - ((v - mn) / rng) * (H - 2 * P); return x.toFixed(1) + ' ' + y.toFixed(1); });
      return '<svg class="rtc-msp" viewBox="0 0 ' + W + ' ' + H + '" fill="none"><path d="M' + d.join(' L') + '" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    };
    try {
      const r = await fetch('/api/rates');
      const d = await r.json();
      const banks = (d && d.banks) || [];
      if (!banks.length) { host.innerHTML = '<div class="taux-empty">Aucune donnée.</div>'; return; }
      host.innerHTML = banks.map(b => {
        const mv = MV[b.move] || MV.HOLD;
        const sc = b.scenario || { hold: 0, hike: 0, cut: 0 };
        const col = SPC[b.move] || SPC.HOLD;
        const probSeries = [b.prob].concat((b.meetings || []).map(m => Math.max(m.hold, m.hike, m.cut)));
        const bpsSeries = [0].concat((b.meetings || []).map(m => m.impliedBps));
        const rows = (b.meetings || []).map(m => {
          const mm = MV[m.baseCase] || MV.HOLD;
          return '<tr><td>' + fr(m.date) + '</td><td class="rtc-day">' + m.days + 'j</td>'
            + '<td class="r">' + m.cut + '%</td><td>' + m.hold + '%</td><td class="g">' + m.hike + '%</td>'
            + '<td class="rtc-impl">' + bps(m.impliedBps) + '</td>'
            + '<td><span class="rtc-base ' + mm.cls + '">' + m.baseCase + '</span></td></tr>';
        }).join('');
        return '<div class="rtc">'
          + '<div class="rtc-head"><img class="rtc-flag" src="https://flagcdn.com/32x24/' + b.cc + '.png" alt="" loading="lazy">'
          + '<span class="rtc-bank">' + b.bank + ' <i>· ' + (b.full || '') + '</i></span>'
          + '<span class="rtc-move ' + mv.cls + '">' + mv.lbl + '</span></div>'
          + '<div class="rtc-metrics">'
          + '<div class="rtc-m--rate"><span class="rtc-k">Taux actuel</span><span class="rtc-v rtc-rate">' + Number(b.rate).toFixed(2) + '%</span></div>'
          + '<div><span class="rtc-k">Probabilit&eacute;</span><span class="rtc-v ' + mv.cls + '">' + b.prob + '%</span>' + spk(probSeries, col) + '</div>'
          + '<div><span class="rtc-k">&Delta; attendu</span><span class="rtc-v">' + bps(b.expBps) + '</span>' + spk(bpsSeries.map(Math.abs), col) + '</div>'
          + '<div><span class="rtc-k">R&eacute;union</span><span class="rtc-v">' + (b.next ? fr(b.next) : '&mdash;') + '</span></div>'
          + '</div>'
          + '<div class="rtc-dist">'
          + '<div class="rtc-dist-h">Distribution des sc&eacute;narios</div>'
          + '<div class="rtc-bar"><span class="rtc-bl">Maintien</span><span class="rtc-track"><i class="n" style="width:' + sc.hold + '%"></i></span><span class="rtc-bp">' + sc.hold + '%</span></div>'
          + '<div class="rtc-bar"><span class="rtc-bl">Hausse</span><span class="rtc-track"><i class="g" style="width:' + sc.hike + '%"></i></span><span class="rtc-bp">' + sc.hike + '%</span></div>'
          + '<div class="rtc-bar"><span class="rtc-bl">Baisse</span><span class="rtc-track"><i class="r" style="width:' + sc.cut + '%"></i></span><span class="rtc-bp">' + sc.cut + '%</span></div>'
          + '<div class="rtc-axis"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>'
          + '</div>'
          + '<table class="rtc-tbl"><thead><tr><th>R&eacute;union</th><th>J</th><th>Baisse</th><th>Maintien</th><th>Hausse</th><th>&Delta; impl.</th><th>Base</th></tr></thead><tbody>' + rows + '</tbody></table>'
          + '</div>';
      }).join('');
    } catch (e) {
      host.innerHTML = '<div class="taux-empty">Erreur de chargement.</div>';
    }
  }

  function activateView(view, { persist = true } = {}) {
    // MARCHÉS (mobile uniquement) : on bascule sur la colonne de droite (horloges, RISK, STRENGTH, COT…)
    if (view === 'markets') {
      document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('nav-item--active', x.dataset.view === 'markets'));
      document.getElementById('main-layout')?.classList.add('show-right-mobile');
      _setDocTitle('markets');
      // Les graphiques (amCharts) ont pu être initialisés masqués → on force un recalcul à l'affichage
      setTimeout(() => { try { window.dispatchEvent(new Event('resize')); } catch {} }, 120);
      if (persist) { try { localStorage.setItem('dtp_active_view', 'markets'); } catch {} }
      return;   // on ne touche pas aux view-panel
    }
    if (!VALID_VIEWS.includes(view)) view = 'news';
    // WEEK AHEAD réservé au staff (admin/support) → un client est renvoyé sur 'news'.
    if (view === 'weekahead' && window._pdIsStaff === false) view = 'news';
    _setDocTitle(view);
    document.getElementById('main-layout')?.classList.remove('show-right-mobile');   // revient au flux

    document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('nav-item--active', x.dataset.view === view));
    document.querySelectorAll('.view-panel').forEach(p => p.classList.toggle('hidden', p.id !== `view-${view}`));

    // BANK : pleine largeur → on masque la colonne de droite (table seule).
    // FX LIST : côte à côte avec le panneau droit (World Clock/Mètre) comme DataTradingPro SUR GRAND
    //   ÉCRAN ; en dessous (~1600px) le CSS `.is-fxlist` repasse la table en pleine largeur (lisible).
    const _ml = document.getElementById('main-layout');
    _ml?.classList.toggle('hide-right-panel', view === 'bank' || view === 'weekahead' || view === 'taux' || view === 'symbol');   // Week Ahead / Symbole en pleine largeur
    _ml?.classList.toggle('is-fxlist', view === 'fxlist');
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
    }
    if (view === 'taux') loadTauxView();
    if (view === 'symbol' && window.loadSymbolView) window.loadSymbolView();

    // Mémoriser l'onglet actif pour le rouvrir au prochain retour.
    // 'symbol' = vue paire TRANSITOIRE (la paire est volatile) → jamais persistée, sinon au reload on
    // restaure une vue symbole sans paire = 4 panneaux vides. On garde donc la dernière vraie vue.
    if (persist && view !== 'symbol') { try { localStorage.setItem('dtp_active_view', view); } catch {} }
  }
  // Exposé globalement au cas où d'autres modules veulent changer de vue
  window.activateView = activateView;

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
      const saved = JSON.parse(localStorage.getItem(LS) || 'null');
      if (Array.isArray(saved) && saved.length) {
        const mob = mobileTab();
        saved.forEach(v => { const el = nav.querySelector('.nav-item[data-view="' + v + '"]'); if (el) { mob ? nav.insertBefore(el, mob) : nav.appendChild(el); } });
      }
    } catch {}
    const saveOrder = () => { try { localStorage.setItem(LS, JSON.stringify(tabsArr().map(t => t.dataset.view))); } catch {} };
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
    // Le clic qui suit immédiatement un déplacement ne doit PAS changer d'onglet.
    nav.addEventListener('click', e => { if (window._navDragEndedAt && Date.now() - window._navDragEndedAt < 300) { e.stopPropagation(); e.preventDefault(); window._navDragEndedAt = 0; } }, true);
  })();

  // ── Restaurer le dernier onglet visité (vue + sous-onglet du panneau droit) ──
  let _savedView = 'news';
  try { _savedView = localStorage.getItem('dtp_active_view') || 'news'; } catch {}
  // 'markets' n'a de sens que sur mobile (sinon retour au flux)
  if (_savedView === 'markets' && window.innerWidth > 768) _savedView = 'news';
  if (_savedView === 'symbol') _savedView = 'news';   // sécurité : ancienne valeur 'symbol' en cache → pas de paire au reload
  if (_savedView !== 'news') {
    activateView(_savedView, { persist: false });   // 'news' est déjà actif par défaut dans le HTML
  }
  // Restaurer le sous-onglet du panneau droit (WORLD/RISK/STRENGTH/METER/COT/DMX)
  try {
    const _rtab = localStorage.getItem('dtp_active_rtab');
    if (_rtab && _rtab !== 'world' && _savedView !== 'bias') {
      document.querySelector(`.right-tab[data-rtab="${_rtab}"]`)?.click();
    }
  } catch {}

  // Timeframe buttons
  document.querySelector('.bias-tf-group')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-tf]');
    if (!btn) return;
    activeTimeframe = btn.dataset.tf;
    document.querySelectorAll('.tf-btn').forEach(b => b.classList.toggle('tf-btn--active', b.dataset.tf === activeTimeframe));
    rebuildStockChart(activePair);
  });

  // Wire up COT type buttons and DMX timeframe buttons
  initCOTTabs();
  initDMXTabs();

  // WORLD is the default active right tab — init immediately
  initRightTab('world');
});

// ─── FX LIST — Overview table ─────────────────────────────────────────────────
const FXL_COLS = [
  { key: 'symbol',    label: 'Symbol',     sortable: true,  align: 'left',   type: 'sym'     },
  { key: 'sparkLast', label: 'Last Price', sortable: false, align: 'center', type: 'price'   },
  { key: 'changePct', label: 'Change %',   sortable: true,  align: 'right',  type: 'change'  },
  { key: 'seasonal',  label: 'Seasonal',   sortable: false, align: 'center', type: 'season'  },
  { key: 'dmx',       label: 'DMX',        sortable: true,  align: 'center', type: 'donut'   },
  { key: 'fund',      label: 'Fund.',      sortable: true,  align: 'center', type: 'badge'   },
  { key: 'research',  label: 'Research',   sortable: true,  align: 'center', type: 'badge'   },
  { key: 'bias',      label: 'Bias',       sortable: true,  align: 'center', type: 'badge'   },
  { key: 'ret1M',     label: '1M %',       sortable: true,  align: 'right',  type: 'pct', heat: true },
  { key: 'ret3M',     label: '3M %',       sortable: true,  align: 'right',  type: 'pct', heat: true },
  { key: 'ret12M',    label: '12M %',      sortable: true,  align: 'right',  type: 'pct', heat: true },
  { key: 'trend',     label: 'Trend',      sortable: false, align: 'center', type: 'trend'   },
  { key: 'strength',  label: 'Strength',   sortable: true,  align: 'center', type: 'str'     },
];
const _SIG_RANK = { Bullish: 1, Neutral: 0, Bearish: -1 };
let _fxlData = null;
let _fxlSort = { key: 'symbol', dir: 1 };
let _fxlLoading = false;

// Points (x,y) d'une série dans une boîte w×h (marge verticale 1px) — base commune des sparklines
function _fxlSparkPts(vals, w, h) {
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1, pad = 1, ih = h - 2 * pad, stepX = w / (vals.length - 1);
  return vals.map((v, i) => [ +(i * stepX).toFixed(1), +(pad + ih - ((v - min) / range) * ih).toFixed(1) ]);
}

// LAST PRICE — ligne blanche, dernier segment coloré selon le sens du dernier tick (vert/rouge fluo)
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

// SEASONAL — sparkline ondulé multi-segments : chaque segment coloré selon sa pente (turquoise / rouge)
function _fxlSeasonSpark(arr, w = 78, h = 14) {
  const vals = (arr || []).filter(v => v != null);
  if (vals.length < 2) return '';
  const pts = _fxlSparkPts(vals, w, h);
  let segs = '';
  for (let i = 1; i < pts.length; i++) {
    const up = vals[i] >= vals[i - 1];
    segs += `<line x1="${pts[i-1][0]}" y1="${pts[i-1][1]}" x2="${pts[i][0]}" y2="${pts[i][1]}" stroke="${up ? '#2dd4bf' : '#ff3b5c'}" stroke-width="1"/>`;
  }
  return `<svg class="fxl-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${segs}</svg>`;
}

// TREND — micro-ligne fine mono, couleur selon la direction macro
function _fxlTrendSpark(arr, w = 78, h = 14) {
  const vals = (arr || []).filter(v => v != null);
  if (vals.length < 2) return '';
  const pts = _fxlSparkPts(vals, w, h);
  const up = vals[vals.length - 1] >= vals[0];
  return `<svg class="fxl-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${up ? '#00cc99' : '#ff3b5c'}" stroke-width="1"/></svg>`;
}

// PATTERN — micro-matrice de 5 carrés : allumés (blanc) selon les hausses récentes, sinon éteints
function _fxlPattern(arr) {
  const vals = (arr || []).filter(v => v != null);
  if (vals.length < 2) return '<span class="fxl-pat"></span>';
  const n = 5, step = (vals.length - 1) / n, s = [];
  for (let i = 0; i <= n; i++) s.push(vals[Math.round(i * step)]);
  let sq = '';
  for (let i = 1; i <= n; i++) sq += `<i class="fxl-pat-sq${s[i] > s[i-1] ? ' on' : ''}"></i>`;
  return `<span class="fxl-pat">${sq}</span>`;
}

// CHANGE % — texte simple (N/A gris foncé si absent, sinon coloré sans fond)
function _fxlChangeCell(v) {
  if (v == null) return '<span class="fxl-na">N/A</span>';
  return `<span class="fxl-chg fxl-chg--${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : ''}${v.toFixed(2)}%</span>`;
}

// Heatmap Cell (1M/3M/12M) — fond plein vert/rouge à OPACITÉ ∝ |%|, texte turquoise/rouge
function _fxlPctCell(v) {
  if (v == null) return '<span class="fxl-pct fxl-na">N/A</span>';
  const cls = v >= 0 ? 'pos' : 'neg';
  const rgb = v >= 0 ? '16,185,129' : '225,29,46';
  const a = Math.max(0.12, Math.min(0.52, Math.abs(v) / 12 * 0.5 + 0.12));
  return `<span class="fxl-pct fxl-pct--${cls}" style="background:rgba(${rgb},${a.toFixed(3)})">${v >= 0 ? '+' : ''}${v.toFixed(2)}%</span>`;
}

// STRENGTH — vumètre horizontal ultra-fin (2px), remplissage vers la droite, turquoise/fuchsia
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

// DMX — donut radial bicolore segmenté : part turquoise = flux haussiers, reste fuchsia
function _fxlDonut(pct) {
  const v = Math.max(0, Math.min(100, pct ?? 50));
  const r = 7, c = 2 * Math.PI * r, bull = (c * v / 100).toFixed(2);
  return `<svg class="fxl-dmx" width="20" height="20" viewBox="0 0 20 20">`
    + `<circle cx="10" cy="10" r="${r}" fill="none" stroke="#ff0055" stroke-width="4"/>`
    + `<circle cx="10" cy="10" r="${r}" fill="none" stroke="#00cc99" stroke-width="4" stroke-dasharray="${bull} ${c.toFixed(2)}" transform="rotate(-90 10 10)"/>`
    + `</svg>`;
}

function _fxlBadge(label) {
  const cls = label === 'Bullish' ? 'bull' : label === 'Bearish' ? 'bear' : 'neut';
  return `<span class="fxl-badge fxl-badge--${cls}">${label || 'Neutral'}</span>`;
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

function renderFxList() {
  const head = document.getElementById('fxl-head');
  const body = document.getElementById('fxl-body');
  if (!head || !body) return;

  head.innerHTML = FXL_COLS.map(c => {
    const active = _fxlSort.key === c.key;
    // Flèche de tri ⇅ visible sur SYMBOL et STRENGTH (et sur la colonne triée active) ; les autres trient en silence
    const showArrow = c.sortable && (c.key === 'symbol' || c.key === 'strength' || active);
    const arrow = showArrow ? `<span class="fxl-sort${active ? ' active' : ''}">${active ? (_fxlSort.dir > 0 ? '▲' : '▼') : '⇅'}</span>` : '';
    return `<th class="fxl-th fxl-th--${c.align} ${c.sortable ? 'fxl-th--sortable' : ''}" ${c.sortable ? `data-sort="${c.key}"` : ''}>${c.label}${arrow}</th>`;
  }).join('');

  const _loader = document.getElementById('fxl-loader');
  if (!_fxlData) {
    body.innerHTML = '';
    if (_loader) {   // loader CENTRÉ dans la zone visible (overlay), pas dans la table large
      if (_fxlLoading) { _loader.innerHTML = (window.dtpLoader ? window.dtpLoader('Chargement de la FX List…') : 'Chargement…'); _loader.style.display = 'flex'; }
      else { _loader.innerHTML = '<div class="fxl-msg">Aucune donnée</div>'; _loader.style.display = 'flex'; }
    }
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
    FXL_COLS.map(c => `<td class="fxl-td fxl-td--${c.align}${c.heat ? ' fxl-td--heat' : ''}">${_fxlCell(c, p, maxAbsStr)}</td>`).join('') +
    `</tr>`
  ).join('');

  const upd = document.getElementById('fxl-updated');
  if (upd && _fxlData.updatedAt) {
    const d = new Date(_fxlData.updatedAt);
    upd.textContent = 'MAJ ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
}

async function loadFxListView(force = false, silent = false) {
  if (!silent) { _fxlLoading = true; renderFxList(); }   // silent = auto-refresh → on ne vide pas la table
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
  document.getElementById('fxl-head')?.addEventListener('click', e => {
    const th = e.target.closest('[data-sort]');
    if (!th) return;
    const key = th.dataset.sort;
    if (_fxlSort.key === key) _fxlSort.dir *= -1;
    else _fxlSort = { key, dir: key === 'symbol' ? 1 : -1 };
    renderFxList();
  });
  // Auto-actualisation (la donnée serveur est mise en cache 10 min) — UNIQUEMENT quand l'onglet
  // FX List est visible, sans vider la table (mise à jour silencieuse, façon flux temps réel).
  if (_fxlAutoTimer) clearInterval(_fxlAutoTimer);
  _fxlAutoTimer = setInterval(() => {
    const panel = document.getElementById('view-fxlist');
    if (panel && !panel.classList.contains('hidden') && _fxlData) loadFxListView(false, true);
  }, 3 * 60 * 1000);
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

function calImpDots(impact) {
  const l = (impact || '').toLowerCase();
  if (l === 'high')   return '<span class="ci-high">●●●</span>';
  if (l === 'medium') return '<span class="ci-med">●●<span class="ci-dot-off">●</span></span>';
  return '<span class="ci-low">●<span class="ci-dot-off">●●</span></span>';
}

// ─── Deviation Signaling — utilitaire SÉMANTIQUE UNIFIÉ ───────────────────────
// Compare une donnée chiffrée (actual) à sa référence (forecast) et renvoie la classe
// de la charte : 'cv-pos' (supérieur/favorable → vert), 'cv-neg' (inférieur → rouge),
// '' (égal ou non comparable → blanc). Fidèle DataTradingPro : SANS référence valable
// → neutre, on ne déduit JAMAIS un signal du previous. Réutilisable par tout composant
// data-driven affichant un résultat chiffré (calendrier, scanner, métriques…).
function deviationClass(actual, ref) {
  if (actual == null || actual === '' || ref == null || ref === '') return '';
  const a = parseFloat(String(actual).replace(',', '.'));
  const r = parseFloat(String(ref).replace(',', '.'));
  if (isNaN(a) || isNaN(r)) return '';
  return a > r ? 'cv-pos' : a < r ? 'cv-neg' : '';
}
window.deviationClass = deviationClass;

// Cellule ACTUAL du calendrier : déviation vs FORECAST seul (blanc si forecast absent).
function calActualCell(actual, forecast) {
  if (actual == null || actual === '') return '<span class="cv-empty">—</span>';
  return `<span class="cv-actual ${deviationClass(actual, forecast)}">${actual}</span>`;
}

function calFormatTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'UTC',
  });
}

function renderCalTable() {
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
    wrap.innerHTML = '<div class="cal-empty">No events match the filter.</div>';
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
    const dayKey = ev.timestamp
      ? new Date(ev.timestamp).toLocaleDateString('en-GB', { timeZone: 'UTC' })
      : (ev.time || '').substring(0, 10);
    if (dayKey && dayKey !== lastDayKey) {
      const d       = ev.timestamp ? new Date(ev.timestamp) : new Date(dayKey);
      const weekday = d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
      const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
      tbody += `<tr class="cal-day-sep"><td colspan="10">${weekday}, ${dateStr}</td></tr>`;
      lastDayKey = dayKey;
    }

    const imp      = (ev.impact || '').toLowerCase();
    const isNext   = i === nextIdx;
    const isPast   = (ev.timestamp || 0) < nowMs;
    const dispTime = calFormatTime(ev.timestamp) || ev.time || '—';

    // ── Row classes ──
    let rowCls = 'cal-row';
    if (isNext)                rowCls += ' cal-row--next';
    if (isPast)                rowCls += ' cal-row--past';
    if (imp === 'high')        rowCls += ' cal-row--high';
    else if (imp === 'medium') rowCls += ' cal-row--med';

    const fcast = ev.forecast && ev.forecast !== ''
      ? `<span class="cv-forecast">${ev.forecast}</span>`
      : '<span class="cv-empty">—</span>';
    const prev = ev.previous && ev.previous !== ''
      ? `<span class="cv-prev">${ev.previous}</span>`
      : '<span class="cv-empty">—</span>';
    // HIGH / LOW — not in ForexFactory XML, show dash when absent
    const hi  = ev.high  && ev.high  !== '' ? `<span class="cv-forecast">${ev.high}</span>`  : '<span class="cv-empty">—</span>';
    const lo  = ev.low   && ev.low   !== '' ? `<span class="cv-prev">${ev.low}</span>`        : '<span class="cv-empty">—</span>';

    const timeCell = `<td class="cth-time"><span class="cal-chv">›</span> ${dispTime}</td>`;

    // Day-separator colspan includes all 9 columns (no chv column)
    const _evUrl = ev.url ? ` data-url="${encodeURIComponent(ev.url)}"` : '';
    tbody += `<tr class="${rowCls} cal-row--click" data-idx="${i}"${_evUrl}>
      ${timeCell}
      <td class="cth-flag">${CAL_FLAG(ev.currency)}</td>
      <td class="cth-curr">${ev.currency || ''}</td>
      <td class="cth-imp">${calImpDots(ev.impact)}</td>
      <td class="cth-event">${ev.title || ''}</td>
      <td class="cth-val">${calActualCell(ev.actual, ev.forecast)}</td>
      <td class="cth-val">${hi}</td>
      <td class="cth-val">${fcast}</td>
      <td class="cth-val">${lo}</td>
      <td class="cth-val">${prev}</td>
    </tr>`;
  });

  wrap.innerHTML = `<table class="cal-table">
    <thead>
      <tr>
        <th class="cth-time">Time</th>
        <th class="cth-flag">CNTRY</th>
        <th class="cth-curr">CURR.</th>
        <th class="cth-imp">IMPACT</th>
        <th class="cth-event">EVENT</th>
        <th class="cth-val">ACTUAL</th>
        <th class="cth-val">HIGH</th>
        <th class="cth-val">FORECAST</th>
        <th class="cth-val">LOW</th>
        <th class="cth-val">PREVIOUS</th>
      </tr>
    </thead>
    <tbody>${tbody}</tbody>
  </table>`;

  // Clic sur une ligne → DÉROULÉ INLINE (Specs + History) sous la ligne — PAS de fenêtre modale
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
      const next = wrap.querySelector('.cal-row--next');
      if (next) {
        next.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        const past = wrap.querySelectorAll('.cal-row--past');
        if (past.length > 0) past[past.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }
}

// ─── Panneau détail d'un événement calendrier (Specs + History) ───────────────
const _calDetailCache = {};   // url → { specs, history } (cache navigateur : pas de re-fetch)
function _calEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function _calColorCell(actual, forecast) {
  if (!actual) return '<span class="cv-empty">—</span>';
  // Même Deviation Signaling unifié que la table (comparaison au FORECAST seul).
  return `<span class="cv-actual ${deviationClass(actual, forecast)}">${_calEsc(actual)}</span>`;
}
// En-tête de valeurs (Actual / Forecast / Previous) d'un événement
function _calDetailHeadVals(ev) {
  return `
    <div class="cal-detail-vals">
      <div class="cdv"><span class="cdv-lbl">Actual</span>${_calColorCell(ev.actual, ev.forecast, ev.previous)}</div>
      <div class="cdv"><span class="cdv-lbl">Forecast</span><span class="cv-forecast">${ev.forecast ? _calEsc(ev.forecast) : '—'}</span></div>
      <div class="cdv"><span class="cdv-lbl">Previous</span><span class="cv-prev">${ev.previous ? _calEsc(ev.previous) : '—'}</span></div>
    </div>`;
}
// HTML Specs + History à partir des données détail (réutilisé par le déroulé inline)
function _calDetailBodyHtml(d) {
  const specsHtml = (d && d.specs && d.specs.length)
    ? `<div class="cal-detail-section">Specs</div>
       <table class="cal-specs-table">${d.specs.map(s => `<tr><td class="cal-spec-lbl">${_calEsc(s.label)}</td><td class="cal-spec-val">${_calEsc(s.value)}</td></tr>`).join('')}</table>`
    : '';
  const histHtml = (d && d.history && d.history.length)
    ? `<div class="cal-detail-section">History</div>
       <table class="cal-hist-table">
         <thead><tr><th>Date</th><th>Actual</th><th>Forecast</th><th>Previous</th></tr></thead>
         <tbody>${d.history.map(h => `<tr>
           <td>${_calEsc(h.date || '')}</td>
           <td>${_calColorCell(h.actual, h.forecast, h.previous)}</td>
           <td><span class="cv-forecast">${h.forecast ? _calEsc(h.forecast) : '—'}</span></td>
           <td><span class="cv-prev">${h.previous ? _calEsc(h.previous) : '—'}</span></td>
         </tr>`).join('')}</tbody>
       </table>`
    : '';
  return (specsHtml + histHtml);
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
    ? new Date(ev.timestamp).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : '';
  const timeStr = calFormatTime(ev.timestamp) || ev.time || '';
  const detailRow = document.createElement('tr');
  detailRow.className = 'cal-detail-row';
  detailRow.innerHTML = `<td colspan="10"><div class="cal-detail-inline">
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

  if (!ev.url) { if (bodyEl) bodyEl.innerHTML = '<div class="cal-detail-empty">Aucun détail supplémentaire disponible.</div>'; return; }

  // Cache navigateur
  let d = _calDetailCache[ev.url];
  if (!d) {
    try {
      d = await fetch('/api/calendar-detail?url=' + encodeURIComponent(ev.url)).then(r => r.json());
      if (d && ((d.specs && d.specs.length) || (d.history && d.history.length))) _calDetailCache[ev.url] = d;
    } catch { d = null; }
  }
  if (!bodyEl || !bodyEl.isConnected) return;   // déroulé fermé entre-temps
  bodyEl.innerHTML = _calDetailBodyHtml(d) || '<div class="cal-detail-empty">Détails indisponibles pour le moment.</div>';
}

// ── Calendar helper: refresh data from server ─────────────────────────────────
async function _refreshCalendarData(silent = false) {
  try {
    const res  = await fetch('/api/calendar-events');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const items = json.items || [];
    if (items.length > 0) {
      _calEvents = items.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      if (!silent) renderCalTable();
      // Update date range label
      const dateRangeEl = document.getElementById('cal-daterange');
      if (dateRangeEl && _calEvents.length) {
        const dates = _calEvents.map(e => e.timestamp).filter(Boolean);
        const fmt   = ts => new Date(ts).toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric', timeZone: 'UTC' });
        dateRangeEl.textContent = `${fmt(Math.min(...dates))} – ${fmt(Math.max(...dates))}`;
      }
      return true;
    }
  } catch (e) { console.warn('[Cal] Refresh failed:', e.message); }
  return false;
}

async function buildCalendar() {
  // Mark that next renderCalTable call should auto-scroll to current event
  _calNeedsScroll = true;

  const wrap = document.getElementById('cal-table-wrap');
  if (!wrap) return;

  if (_calEvents.length === 0) {
    wrap.innerHTML = (window.dtpLoader ? window.dtpLoader('Chargement du calendrier économique…') : 'Chargement…');

    let loaded = false;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res  = await fetch('/api/calendar-events');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const items = json.items || [];
        if (items.length > 0) {
          _calEvents = items.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
          loaded = true;
          break;
        }
        // Empty response — server may still be fetching; wait and retry
        if (attempt < 4) {
          wrap.innerHTML = (window.dtpLoader ? window.dtpLoader('Chargement du calendrier économique…') : 'Chargement…');
          await new Promise(r => setTimeout(r, 3000));
        }
      } catch {
        if (attempt < 4) {
          wrap.innerHTML = (window.dtpLoader ? window.dtpLoader('Connexion…') : 'Connecting…');
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    }

    if (!loaded) {
      wrap.innerHTML = `<div class="cal-empty" style="padding:40px 20px;text-align:center;">
        <div style="color:var(--text4);font-size:11px;margin-bottom:12px;">Calendar unavailable — server may still be starting up.</div>
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
    impBar.addEventListener('click', e => {
      const btn = e.target.closest('[data-imp]');
      if (!btn) return;
      _calImpFilter = btn.dataset.imp;
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

  // Date range label (shown inline in title bar)
  const dateRangeEl = document.getElementById('cal-daterange');
  if (dateRangeEl && _calEvents.length) {
    const dates = _calEvents.map(e => e.timestamp).filter(Boolean);
    const fmt   = ts => new Date(ts).toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric', timeZone: 'UTC' });
    dateRangeEl.textContent = `${fmt(Math.min(...dates))} – ${fmt(Math.max(...dates))}`;
  }

  renderCalTable();

  // Auto-refresh calendrier toutes les 5 min (les actuals apparaissent vite après chaque sortie)
  if (!window._calAutoRefreshInterval) {
    window._calAutoRefreshInterval = setInterval(() => {
      _refreshCalendarData(false);
    }, 5 * 60 * 1000);
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
      handle.classList.add('dragging'); grid.classList.add('sym-dragging');
      document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
      const move = ev => {
        const p = ev.touches ? ev.touches[0] : ev;
        if (axis === 'x') {
          const v = Math.max(rect.width * 0.22, Math.min(rect.width * 0.78, p.clientX - rect.left));
          grid.style.setProperty(prop, v + 'px');
        } else {
          const v = Math.max(rect.height * 0.2, Math.min(rect.height * 0.8, p.clientY - rect.top));
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
  // Portail : on déplace le dropdown dans <body> → il échappe à TOUT overflow:hidden / contexte d'empilement
  // d'un ancêtre (topbar, navbar…). Positionné en `fixed` sous l'input via positionDd().
  try { document.body.appendChild(dd); } catch {}
  const PAIRS = ['EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','EURGBP','EURJPY','EURCHF','EURAUD','EURCAD','EURNZD','GBPJPY','GBPCHF','GBPCAD','GBPAUD','GBPNZD','AUDJPY','AUDCHF','AUDCAD','AUDNZD','NZDJPY','NZDCHF','NZDCAD','CADJPY','CADCHF','CHFJPY','XAUUSD','XAGUSD'];
  const MAJORS = ['USD','EUR','JPY','GBP','AUD','CHF','CAD','NZD'];
  const FLAG = { USD:'us', EUR:'eu', JPY:'jp', GBP:'gb', AUD:'au', CHF:'ch', CAD:'ca', NZD:'nz' };
  const CCY_NAME = { USD:'US Dollar', EUR:'Euro', JPY:'Japanese Yen', GBP:'British Pound', AUD:'Australian Dollar', CHF:'Swiss Franc', CAD:'Canadian Dollar', NZD:'New Zealand Dollar', XAU:'Gold', XAG:'Silver' };
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
  const _RECENT_KEY = 'dtp_sym_recent';   // historique PERSISTANT (léger : ~6 codes de paire) — exception localStorage validée par l'utilisateur
  let _recent = [], _active = null, _tvPending = false, _subtab = 'overview';
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
  let _symStrPeriod = 'today';   // période active du Currency Strength de la vue symbole (TD par défaut, comme l'accueil)
  const pretty = p => p.slice(0,3) + '/' + p.slice(3);
  const tvSymbol = p => p === 'XAUUSD' ? 'OANDA:XAUUSD' : p === 'XAGUSD' ? 'OANDA:XAGUSD' : 'FX:' + p;
  const _esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  const _nf = n => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('fr-FR');
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

  // ── Dropdown d'autocomplétion : en-tête « # Foreign Exchange (N) » + double drapeau rond + nom complet ──
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
  // Dropdown « intelligent » façon PMT :
  //  • champ VIDE (clic/focus) → UNIQUEMENT « Recent Searches » (horloge) = 6 dernières paires ouvertes ;
  //    s'il n'y a aucun historique → état vide « Aucune recherche récente » (JAMAIS les paires majeures).
  //  • en SAISIE → « Recent Searches » filtrées + « Foreign Exchange » (paires qui matchent, préfixe d'abord).
  function renderDd(q) {
    q = (q || '').toUpperCase().replace(/[^A-Z]/g, '');
    let html;
    if (!q) {
      const recents = _recent.slice(0, 6);
      html = '<div class="sym-dd-head">' + _DD_CLOCK + ' Recent Searches <span class="sym-dd-count">(' + recents.length + ')</span></div>'
        + (recents.length ? recents.map(_ddRow).join('') : '<div class="sym-dd-empty">Aucune recherche récente</div>');
    } else {
      const recents = _recent.slice(0, 6).filter(p => p.includes(q));
      const fx = PAIRS.filter(p => p.includes(q) && !recents.includes(p))
        .sort((a, b) => (a.startsWith(q) ? 0 : 1) - (b.startsWith(q) ? 0 : 1) || a.localeCompare(b))
        .slice(0, 10);
      html = _ddSection(_DD_CLOCK, 'Recent Searches', recents) + _ddSection(_DD_HASH, 'Foreign Exchange', fx);
      if (!html) html = '<div class="sym-dd-empty">Aucune paire</div>';
    }
    dd.innerHTML = html;
    positionDd();
    dd.classList.remove('hidden');
  }
  // Positionne le dropdown (fixed) juste sous l'input, aligné à gauche, largeur ≥ 330px.
  function positionDd() {
    const r = input.getBoundingClientRect();
    dd.style.left = Math.round(r.left) + 'px';
    dd.style.top = Math.round(r.bottom + 6) + 'px';
    dd.style.width = Math.max(330, Math.round(r.width)) + 'px';
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
    if (_subtab === 'overview') renderOverview(pair, base, ccys);
    else if (_subtab === 'bias') renderBias(pair, c1, c2);
    else if (_subtab === 'cotbase') renderCot('sym-sub-cotbase', c1, pair, 'base');
    else if (_subtab === 'cotquote') renderCot('sym-sub-cotquote', c2, pair, 'quote');
    else if (_subtab === 'seasonality') renderSeasonality(pair);
    else if (_subtab === 'retail') renderRetail(pair);
    else if (_subtab === 'cb') renderCb(pair, ccys);
  }
  window.loadSymbolView = loadSymbolView;

  // ── Currency Strength de la vue symbole : widget complet (sélecteur de période TD/TW/8H/1D/7D/1M)
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
        const sc = (typeof buildStrengthChart === 'function') ? buildStrengthChart('sym-strength', data, {}) : null;
        if (sc && sc.seriesMap && ccys.length) {
          Object.keys(sc.seriesMap).forEach(c => { if (!ccys.includes(c)) { try { sc.seriesMap[c].hide(0); } catch {} } });
        } else if (!sc && window.buildIsolatedStrength) {
          window.buildIsolatedStrength('sym-strength', ccys[0] || 'USD', _symStrPeriod);
        }
      } catch { sEl.innerHTML = '<div class="sym-empty">Force des devises indisponible.</div>'; }
    }).catch(() => { sEl.innerHTML = '<div class="sym-empty">Force des devises indisponible.</div>'; });
  }

  // ── Overview : chart TradingView + Currency Strength (doublon du compteur par défaut) + calendrier + news filtrés ──
  function renderOverview(pair, base, ccys) {
    // Chart TradingView (recréé seulement si la paire change)
    const host = document.getElementById('sym-tv');
    if (host && (window._symLastTvPair !== pair || !host.firstElementChild)) {
      host.innerHTML = '<div id="sym-tv-w" style="width:100%;height:100%"></div>';
      window._symLastTvPair = pair;
      ensureTv(() => { try { new window.TradingView.widget({ container_id: 'sym-tv-w', symbol: tvSymbol(pair), interval: '60', timezone: 'Europe/Paris', theme: 'dark', style: '1', locale: 'fr', autosize: true, hide_side_toolbar: true, allow_symbol_change: false, save_image: false, withdateranges: true });
        // TradingView (autosize) ne se recalibre que sur un resize global → on le pousse après le chargement
        // de l'iframe pour qu'il remplisse tout le panneau (sinon zone grise à droite du chart).
        [350, 1000, 1800].forEach(d => setTimeout(() => { try { window.dispatchEvent(new Event('resize')); } catch {} }, d));
      } catch (e) {} });
    }
    // Les panneaux data ne se re-rendent que si la paire a changé (évite de refetch en revenant sur Overview).
    if (window._symOvPair === pair) return;
    window._symOvPair = pair;
    // Currency Strength = doublon du widget de l'accueil (sélecteur de période TD/TW/8H/1D/7D/1M),
    // mais focalisé sur la paire : seules les 2 devises de la paire restent colorées (les autres masquées).
    buildSymStrengthBar();
    loadSymStrength();
    // Calendrier filtré sur la paire — MÊME rendu que Week Ahead (.cal-table : drapeaux ronds, points d'impact,
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
              + dt.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' }) + ', '
              + dt.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }) + '</td></tr>';
          }
        }
        const imp = (ev.impact || '').toLowerCase();
        const cls = 'cal-row' + (i === nextIdx ? ' cal-row--next' : '') + (ts && ts < now ? ' cal-row--past' : '') + (imp === 'high' ? ' cal-row--high' : imp === 'medium' ? ' cal-row--med' : '');
        const fc = (ev.forecast != null && ev.forecast !== '') ? '<span class="cv-forecast">' + _esc(ev.forecast) + '</span>' : '<span class="cv-empty">—</span>';
        const pv = (ev.previous != null && ev.previous !== '') ? '<span class="cv-prev">' + _esc(ev.previous) + '</span>' : '<span class="cv-empty">—</span>';
        tb += '<tr class="' + cls + '">'
          + '<td class="cth-time">' + calFormatTime(ts) + '</td>'
          + '<td class="cth-flag">' + CAL_FLAG(ev.currency) + '</td>'
          + '<td class="cth-curr">' + (ev.currency || '') + '</td>'
          + '<td class="cth-imp">' + calImpDots(ev.impact) + '</td>'
          + '<td class="cth-event">' + _esc(ev.title || '') + '</td>'
          + '<td class="cth-val">' + calActualCell(ev.actual, ev.forecast) + '</td>'
          + '<td class="cth-val">' + fc + '</td>'
          + '<td class="cth-val">' + pv + '</td></tr>';
      });
      cal.innerHTML = '<table class="cal-table"><thead><tr><th class="cth-time">Time</th><th class="cth-flag">CNTRY</th><th class="cth-curr">CURR.</th><th class="cth-imp">IMPACT</th><th class="cth-event">EVENT</th><th class="cth-val">ACTUAL</th><th class="cth-val">FORECAST</th><th class="cth-val">PREVIOUS</th></tr></thead><tbody>' + tb + '</tbody></table>';
    }).catch(() => {});
    // News filtrées sur la paire — EXACTEMENT le « Realtime Headline Ticker » de l'onglet News :
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
      if (!items.length) { nl.innerHTML = '<div class="sym-empty">Pas de news récente pour ' + pretty(pair) + '.</div>'; return; }
      nl.innerHTML = '';
      const frag = document.createDocumentFragment();
      let lastD = '';
      items.forEach(n => {
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

  // ── Smart Bias : 2 colonnes (base / quote) tirées de /api/smart-bias ──
  function renderBias(pair, c1, c2) {
    const hostEl = document.getElementById('sym-sub-bias'); if (!hostEl) return;
    hostEl.innerHTML = '<div class="sym-load">Chargement du Smart Bias…</div>';
    const go = d => {
      const cur = (d && d.currencies) || [], rows = (d && d.rows) || [];
      const cols = [c1, c2].filter(c => cur.includes(c));
      if (!cols.length) { hostEl.innerHTML = '<div class="sym-empty">Smart Bias indisponible pour ' + pretty(pair) + '.</div>'; return; }
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
        + '<div class="sym-src">Source : Smart Bias Tracker (matrice multi-indicateurs · COT, Myfxbook, calendrier, saisonnalité, rapports banques). Narratif IA figé chaque semaine.</div>';
    };
    if (_cBias) { go(_cBias); return; }
    fetch('/api/smart-bias').then(r => r.json()).then(d => { if (d && d.currencies) _cBias = d; go(d); }).catch(() => { hostEl.innerHTML = '<div class="sym-empty">Smart Bias indisponible.</div>'; });
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
      const rd = row.reportDate ? new Date(row.reportDate).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' }) : '—';
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
        + '<div class="sym-src">Source : CFTC Commitments of Traders — Legacy Futures, traders non-commerciaux (spéculateurs)' + (d.updatedAt ? ' · MAJ ' + new Date(d.updatedAt).toLocaleString('fr-FR') : '') + '.</div>'
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
        + '<div class="sym-seas-head"><span class="sym-seas-ttl">Saisonnalité — rendement mensuel cumulé moyen</span><span class="sym-seas-sub">[' + sym + ']</span></div>'
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
        + '<div class="sym-rt-note">La majorité des traders particuliers est positionnée <b>' + lean + '</b> → lecture contrarian : biais <b class="' + (contra === 'Bullish' ? 'g' : 'r') + '">' + contra + '</b>.</div>'
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
    const MV = { HOLD: { lbl:'Maintien', cls:'n' }, HIKE: { lbl:'Hausse', cls:'g' }, CUT: { lbl:'Baisse', cls:'r' } };
    const fr = s => { try { const p = String(s).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; } catch (e) { return s; } };
    const bps = v => (v > 0 ? '+' : '') + Number(v).toFixed(1) + ' bps';
    const card = b => {
      const mv = MV[b.move] || MV.HOLD, sc = b.scenario || { hold:0, hike:0, cut:0 };
      const rows = (b.meetings || []).map(m => { const mm = MV[m.baseCase] || MV.HOLD;
        return '<tr><td>' + fr(m.date) + '</td><td class="rtc-day">' + m.days + 'j</td><td class="r">' + m.cut + '%</td><td>' + m.hold + '%</td><td class="g">' + m.hike + '%</td><td class="rtc-impl">' + bps(m.impliedBps) + '</td><td><span class="rtc-base ' + mm.cls + '">' + m.baseCase + '</span></td></tr>'; }).join('');
      return '<div class="rtc">'
        + '<div class="rtc-head"><img class="rtc-flag" src="https://flagcdn.com/32x24/' + b.cc + '.png" alt="" loading="lazy"><span class="rtc-bank">' + b.bank + ' <i>· ' + (b.full || '') + '</i></span><span class="rtc-move ' + mv.cls + '">' + mv.lbl + '</span></div>'
        + '<div class="rtc-metrics">'
        + '<div class="rtc-m--rate"><span class="rtc-k">Taux actuel</span><span class="rtc-v rtc-rate">' + Number(b.rate).toFixed(2) + '%</span></div>'
        + '<div><span class="rtc-k">Probabilit&eacute;</span><span class="rtc-v ' + mv.cls + '">' + b.prob + '%</span></div>'
        + '<div><span class="rtc-k">&Delta; attendu</span><span class="rtc-v">' + bps(b.expBps) + '</span></div>'
        + '<div><span class="rtc-k">R&eacute;union</span><span class="rtc-v">' + (b.next ? fr(b.next) : '&mdash;') + '</span></div>'
        + '</div>'
        + '<div class="rtc-dist"><div class="rtc-dist-h">Distribution des sc&eacute;narios</div>'
        + '<div class="rtc-bar"><span class="rtc-bl">Maintien</span><span class="rtc-track"><i class="n" style="width:' + sc.hold + '%"></i></span><span class="rtc-bp">' + sc.hold + '%</span></div>'
        + '<div class="rtc-bar"><span class="rtc-bl">Hausse</span><span class="rtc-track"><i class="g" style="width:' + sc.hike + '%"></i></span><span class="rtc-bp">' + sc.hike + '%</span></div>'
        + '<div class="rtc-bar"><span class="rtc-bl">Baisse</span><span class="rtc-track"><i class="r" style="width:' + sc.cut + '%"></i></span><span class="rtc-bp">' + sc.cut + '%</span></div>'
        + '</div>'
        + '<table class="rtc-tbl"><thead><tr><th>R&eacute;union</th><th>J</th><th>Baisse</th><th>Maintien</th><th>Hausse</th><th>&Delta; impl.</th><th>Base</th></tr></thead><tbody>' + rows + '</tbody></table>'
        + '</div>';
    };
    const go = d => {
      const banks = (d && d.banks) || [];
      const sel = ccys.map(c => banks.find(b => b.code === c)).filter(Boolean);
      if (!sel.length) { hostEl.innerHTML = '<div class="sym-empty">Pricing banques centrales indisponible pour ' + pretty(pair) + '.</div>'; return; }
      hostEl.innerHTML = '<div class="sym-cb-note">Estimation <b>modèle maison</b> ré-ancrée sur les décisions réelles du calendrier — ce n\'est PAS un pricing de marché (OIS / Fed Funds futures).</div>'
        + '<div class="sym-cb-grid">' + sel.map(card).join('') + '</div>';
    };
    if (_cRates) { go(_cRates); return; }
    fetch('/api/rates').then(r => r.json()).then(d => { if (d && d.banks) _cRates = d; go(d); }).catch(() => { hostEl.innerHTML = '<div class="sym-empty">Pricing indisponible.</div>'; });
  }
})();

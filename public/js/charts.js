/* ═══════════════════════════════════════════════
   Prime Terminal — amCharts 5 Charts
   Stock · Strength · Risk · Meter · COT · DMX
═══════════════════════════════════════════════ */
'use strict';

// ── amCharts theme matching Prime Terminal ────────────────────────────────────
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
  theme.rule('Label').setAll({ fill: am5.color(0x666666), fontSize: 10, fontFamily: '"JetBrains Mono", monospace' });
  theme.rule('Tooltip').setAll({
    background: am5.Rectangle.new(root, {
      fill: am5.color(0x141414),
      stroke: am5.color(0x252525),
      strokeWidth: 1,
      cornerRadiusTL: 3, cornerRadiusTR: 3, cornerRadiusBL: 3, cornerRadiusBR: 3,
    }),
    paddingTop: 6, paddingBottom: 6, paddingLeft: 10, paddingRight: 10,
  });
  theme.rule('Label', ['tooltip']).setAll({ fill: am5.color(0xd8d8d8), fontSize: 11, fontFamily: '"JetBrains Mono", monospace' });

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

setInterval(tickPrices, 3000);

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
    am5xy.SmoothedXLineSeries.new(root, {
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
    am5xy.SmoothedXLineSeries.new(root, {
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

  volumePanel.set('background', am5.Rectangle.new(root, { fill: am5.color(0x0a0a0a), fillOpacity: 1 }));

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

  rsiPanel.set('background', am5.Rectangle.new(root, { fill: am5.color(0x0a0a0a), fillOpacity: 1 }));

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

// Palette exacte (référence Prime Terminal)
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

const STF_ORDER  = ['today', 'week', '8h', '1d', '5d', '7d', '1m'];
const STF_LABELS = { today: 'TD', week: 'TW', '8h': '8H', '1d': '1D', '5d': '5D', '7d': '7D', '1m': '1M' };

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

function buildStrengthChart(containerId, data) {
  disposeRoot(containerId);
  const container = document.getElementById(containerId);
  if (container) container.innerHTML = '';
  const root = am5.Root.new(containerId);
  root.setThemes([applyTerminalTheme(root)]);
  root._logo?.set('forceHidden', true);
  _strengthRoot = root;

  const chart = root.container.children.push(
    am5xy.XYChart.new(root, {
      paddingLeft: 0, paddingRight: 0, paddingTop: 4, paddingBottom: 0,
      layout: root.verticalLayout,
    })
  );
  chart.set('background', am5.Rectangle.new(root, { fill: am5.color(0x0b0b0c), fillOpacity: 1 }));  // noir mat profond
  chart.zoomOutButton.set('forceHidden', true);
  // Clip strict : les courbes ne débordent jamais hors de la zone de tracé
  chart.plotContainer.set('maskContent', true);
  chart.set('maskContent', true);

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
  // Badge temporel dynamique sur l'axe X (fond noir opaque, bordure grise, mono blanc)
  const xTip = am5.Tooltip.new(root, {
    getFillFromSprite: false,
    labelText: '{valueX.formatDate("dd/MM/yyyy HH:mm")}',
  });
  xTip.get('background').setAll({
    fill: am5.color(0x0b0b0c), fillOpacity: 1,
    stroke: am5.color(0x3a3a42), strokeWidth: 1,
  });
  xTip.label.setAll({
    fill: am5.color(0xffffff), fontSize: 10,
    fontFamily: '"JetBrains Mono", monospace', fontWeight: '400',
  });
  xAxis.set('tooltip', xTip);
  xAxis.set('tooltipDateFormat', 'dd/MM/yyyy HH:mm');
  xAxis.get('renderer').labels.template.setAll({
    fill: am5.color(0xffffff), fontSize: 10,
    fontFamily: '"JetBrains Mono", monospace',
  });
  xAxis.get('renderer').grid.template.setAll({ stroke: am5.color(0x1f2937), strokeOpacity: 0.5, strokeDasharray: [3, 3] });

  const yAxisRenderer = am5xy.AxisRendererY.new(root, { opposite: true, inside: false, minWidth: 46 });
  // Chiffres de l'axe Y dans la gouttière (hors zone de tracé → pas de chevauchement)
  yAxisRenderer.labels.template.setAll({
    visible: true,
    fill: am5.color(0x94a3b8), fontSize: 9,
    fontFamily: '"JetBrains Mono", monospace',
    minPosition: 0.02, maxPosition: 0.98,
    paddingLeft: 4,
  });
  // Grille horizontale discrète : pointillés gris foncé
  yAxisRenderer.grid.template.setAll({
    stroke: am5.color(0x1f2937), strokeOpacity: 0.7, strokeWidth: 1, strokeDasharray: [3, 3],
  });

  const yAxis = chart.yAxes.push(
    am5xy.ValueAxis.new(root, { renderer: yAxisRenderer })
  );

  // Zero reference line — gris clair UNI (distincte de la grille pointillée)
  const zeroRange = yAxis.createAxisRange(yAxis.makeDataItem({ value: 0 }));
  zeroRange.get('grid').setAll({ stroke: am5.color(0xffffff), strokeWidth: 1, strokeOpacity: 0.45 });
  zeroRange.get('label').set('visible', false);

  const seriesArr = [];
  const seriesMap = {};
  const labelMap  = {};   // ccy → { range } pour mise à jour en place

  // Échelle proportionnelle (99e percentile) recalculée à chaque jeu de données
  function computeScale(d) {
    const abs = d.currencies
      .flatMap(c => (d.series[c] || []).map(x => x.v != null ? Math.abs(x.v) : null).filter(v => v != null))
      .sort((a, b) => a - b);
    const refMax = abs.length > 10 ? abs[Math.floor(abs.length * 0.99)] : (abs[abs.length - 1] || 0.01);
    const CAP = 25;
    return refMax > CAP ? CAP / refMax : 1;
  }
  let scaleFactor = computeScale(data);

  for (const ccy of data.currencies) {
    const hexColor = CS_COLORS[ccy] || 0x888888;
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
    series.strokes.template.setAll({ strokeWidth: 1.8 });   // lignes fines et lisses
    const cleanPts = _smoothCS(pts);
    series.data.setAll(cleanPts);

    // Étiquette flottante sur l'axe Y à la dernière valeur
    const lastPt = cleanPts[cleanPts.length - 1];
    const lastV  = (lastPt && lastPt.v != null) ? lastPt.v : 0;
    const rangeItem = yAxis.makeDataItem({ value: lastV });
    const range     = yAxis.createAxisRange(rangeItem);
    const valStr    = (lastV >= 0 ? '+' : '') + lastV.toFixed(2);
    range.get('label').setAll({
      text: `${ccy}  ${valStr}`,
      fill: am5.color(0xffffff),
      fontSize: 10, fontFamily: '"JetBrains Mono", monospace', fontWeight: '700',
      centerY: am5.percent(50),
      paddingTop: 3, paddingBottom: 3, paddingLeft: 6, paddingRight: 6,
      background: am5.RoundedRectangle.new(root, {
        fill: color, fillOpacity: 1,
        cornerRadiusTL: 3, cornerRadiusTR: 3, cornerRadiusBL: 3, cornerRadiusBR: 3,
      }),
    });
    range.get('tick').set('visible', false);
    range.get('grid').setAll({ stroke: color, strokeOpacity: 0.20, strokeDasharray: [3, 3] });

    seriesArr.push(series);
    seriesMap[ccy] = series;
    labelMap[ccy]  = { range, value: lastV };
  }

  // Croisillon : ligne verticale pointillés gris clair, suit la souris + dots magnétiques
  const cursor = chart.set('cursor', am5xy.XYCursor.new(root, {
    behavior: 'none', snapToSeries: seriesArr, snapToSeriesBy: 'x',
  }));
  cursor.lineX.setAll({ stroke: am5.color(0x475569), strokeWidth: 1, strokeDasharray: [3, 3], strokeOpacity: 0.9 });
  cursor.lineY.set('visible', false);
  // Point d'ancrage coloré sur chaque courbe au croisement du croisillon
  seriesArr.forEach(s => {
    s.bullets.clear();
    s.set('snapTooltip', true);
  });

  chart.series.values.forEach((s, i) => s.appear(500, i * 20));

  // ── Anti-collision des badges : écarte verticalement ceux trop proches ───────
  function declutter() {
    try {
      const min = yAxis.get('min'), max = yAxis.get('max');
      const h = chart.plotContainer.height();
      if (min == null || max == null || !h || max === min) return;
      const GAP = 16;  // px minimum entre deux badges
      // Position pixel de chaque badge (0 = haut)
      const arr = Object.entries(labelMap).map(([ccy, o]) => {
        const v = o.value != null ? o.value : 0;
        const px = (max - v) / (max - min) * h;
        return { ccy, o, basePx: px, px };
      }).filter(x => isFinite(x.basePx)).sort((a, b) => a.px - b.px);
      // Passe descendante : pousse vers le bas si trop proche
      for (let i = 1; i < arr.length; i++) {
        if (arr[i].px - arr[i - 1].px < GAP) arr[i].px = arr[i - 1].px + GAP;
      }
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
        try { lbl.range.get('label')?.set('text', `${ccy}  ${(lv >= 0 ? '+' : '') + lv.toFixed(2)}`); } catch {}
      }
    }
    setTimeout(declutter, 60);   // recalibrer l'anti-collision après mise à jour
  }

  return { root, seriesMap, update };
}

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
        <span class="strength-chart-label">Force de la devise</span>
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
        if (el && !chartCtl) el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text4);font-size:10px;font-family:var(--font-mono)">Loading…</div>';
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
    // Rafraîchissement rapide et fluide (20s) — mise à jour en place
    _strengthTimers.push(setInterval(() => load(activePeriod, { silent: true }), 20_000));
  }

  makePane('L', 'today');  // gauche → TD (intraday)
  makePane('R', 'week');   // droite → TW (hebdomadaire)
}

// ═══════════════════════════════════════════════
//  RISK — Real Risk Sentiment Widget
// ═══════════════════════════════════════════════

let _riskRefreshTimer = null;
let _riskGaugeRoot    = null;
let _riskHandDI       = null;
let _riskScoreLabel   = null;
let _riskBadgeLabel   = null;

function buildRiskGauge() {
  const wrap = document.getElementById('risk-widget');
  if (!wrap) return;

  clearInterval(_riskRefreshTimer);
  if (_riskGaugeRoot) { _riskGaugeRoot.dispose(); _riskGaugeRoot = null; }
  _riskHandDI = _riskScoreLabel = _riskBadgeLabel = null;

  wrap.innerHTML = '<div style="color:var(--text4);padding:16px;font-size:11px">Loading…</div>';

  let isBuilt = false;

  async function loadAndRender() {
    try {
      const data = await fetch('/api/risk-sentiment').then(r => r.json());
      if (data.error) throw new Error(data.error);

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
      const gaugeVal  = Math.max(-100, Math.min(100, +(data.score * 50).toFixed(1)));   // échelle de référence (widget Risk)
      const display   = `${gaugeVal > 0 ? '+' : ''}${gaugeVal.toFixed(1)}%`;

      // Sync topbar sentiment button
      if (typeof _applyRiskTopbar === 'function') _applyRiskTopbar(data);

      if (!isBuilt) {
        isBuilt = true;
        wrap.innerHTML = `
          <div id="risk-ticker" class="risk-ticker ${cls}">• ${frLabel} — ${data.description}</div>
          <div id="risk-gauge-div" style="flex:1;min-height:0;width:100%;"></div>`;

        const root = am5.Root.new('risk-gauge-div');
        root.setThemes([am5themes_Dark.new(root)]);
        root._logo?.set('forceHidden', true);
        _riskGaugeRoot = root;

        const chart = root.container.children.push(
          am5radar.RadarChart.new(root, {
            panX: false, panY: false,
            startAngle: -180, endAngle: 0,
            radius: am5.percent(78),
            innerRadius: am5.percent(70),
            paddingTop: 10, paddingBottom: 20,
            paddingLeft: 40, paddingRight: 40,
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

        // Ultra-smooth 40-band gradient: crimson → orange → amber → lime → emerald
        const _gs = [
          [0.00, [185, 10,  20 ]],
          [0.18, [220, 45,  8  ]],
          [0.35, [240, 105, 0  ]],
          [0.50, [255, 185, 30 ]],
          [0.65, [160, 225, 10 ]],
          [0.82, [55,  205, 60 ]],
          [1.00, [25,  165, 75 ]],
        ];
        const _lc = (s, t) => {
          for (let i = 0; i < s.length - 1; i++) {
            const [t0, c0] = s[i], [t1, c1] = s[i + 1];
            if (t <= t1) {
              const u = (t - t0) / (t1 - t0);
              return (Math.round(c0[0]+u*(c1[0]-c0[0])) << 16) |
                     (Math.round(c0[1]+u*(c1[1]-c0[1])) <<  8) |
                      Math.round(c0[2]+u*(c1[2]-c0[2]));
            }
          }
          return 0x19a54b;
        };
        for (let i = 0; i < 40; i++) {
          const v  = -100 + i * 5;
          const ev = v + 5;
          const c  = _lc(_gs, (i + 0.5) / 40);
          const r  = axis.createAxisRange(axis.makeDataItem({ value: v, endValue: ev }));
          r.get('axisFill').setAll({ visible: true, fill: am5.color(c), fillOpacity: 1, strokeOpacity: 0 });
          r.get('grid')?.setAll({ visible: false });
          r.get('tick')?.setAll({ visible: false });
          r.get('label')?.setAll({ visible: false });
        }

        // Dark separator marks at key zone boundaries
        [-50, 0, 50].forEach(v => {
          const hw = v === 0 ? 1.0 : 0.7;
          const dr = axis.createAxisRange(axis.makeDataItem({ value: v - hw, endValue: v + hw }));
          dr.get('axisFill').setAll({ visible: true, fill: am5.color(0x0a0e14), fillOpacity: 0.8, strokeOpacity: 0 });
          ['grid', 'tick', 'label'].forEach(k => dr.get(k)?.setAll({ visible: false }));
        });

        // Slim triangle needle
        _riskHandDI = axis.makeDataItem({ value: 0 });
        const hand = am5radar.ClockHand.new(root, {
          pinRadius: am5.percent(2),
          radius: am5.percent(62),
          innerRadius: am5.percent(2),
          bottomWidth: 24,
          topWidth: 0,
        });
        hand.pin.setAll({ fill: am5.color(0x555555), strokeOpacity: 0 });
        hand.hand.setAll({ fill: am5.color(sentColor), strokeOpacity: 0 });

        _riskHandDI.set('bullet', am5xy.AxisBullet.new(root, { sprite: hand }));
        axis.createAxisRange(_riskHandDI);
        _riskHandDI.get('grid')?.setAll({ visible: false });

        // Score label
        _riskScoreLabel = chart.children.push(
          am5.Label.new(root, {
            text: display,
            centerX: am5.percent(50),
            x: am5.percent(50),
            y: am5.percent(76),
            fontSize: 36,
            fontWeight: '700',
            fill: am5.color(0xffffff),
            fontFamily: '"Inter", sans-serif',
          })
        );

        // Sentiment badge
        _riskBadgeLabel = chart.children.push(
          am5.Label.new(root, {
            text: frLabel,
            centerX: am5.percent(50),
            x: am5.percent(50),
            y: am5.percent(90),
            fontSize: 12,
            fontWeight: '700',
            letterSpacing: 2,
            fill: am5.color(sentColor),
            paddingLeft: 24, paddingRight: 24,
            paddingTop: 8, paddingBottom: 8,
            background: am5.RoundedRectangle.new(root, {
              fill: am5.color(0x110d00), fillOpacity: 1,
              stroke: am5.color(sentColor), strokeOpacity: 0.5, strokeWidth: 1,
              cornerRadiusTL: 4, cornerRadiusTR: 4,
              cornerRadiusBL: 4, cornerRadiusBR: 4,
            }),
          })
        );

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
        if (_riskScoreLabel) _riskScoreLabel.set('text', display);
        if (_riskBadgeLabel) {
          _riskBadgeLabel.set('text', frLabel);
          _riskBadgeLabel.set('fill', am5.color(sentColor));
          _riskBadgeLabel.get('background')?.setAll({ fill: am5.color(0x110d00), stroke: am5.color(sentColor) });
        }
        const ticker = document.getElementById('risk-ticker');
        if (ticker) {
          ticker.className = `risk-ticker ${cls}`;
          ticker.textContent = `• ${frLabel} — ${data.description}`;
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
  _riskRefreshTimer = setInterval(loadAndRender, 3 * 60 * 1000);
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
        const col2 = v >= 0 ? '#22c55e' : '#dc2626';
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
    const maxAbs = Math.max(...Object.values(values).map(v => Math.abs(v)), 1);
    METER_ORDER.forEach(ccy => {
      const v   = values[ccy] || 0;
      const col = container.querySelector(`.meter-col[data-ccy="${ccy}"]`);
      if (!col) return;
      const lit = Math.round(Math.abs(v) / maxAbs * METER_BRICKS);  // 0..10
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
        valEl.style.color = v > 0 ? '#22c55e' : v < 0 ? '#dc2626' : '#64748b';
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
  _meterTimer = setInterval(loadAndRender, 30 * 1000);
}

// ═══════════════════════════════════════════════
//  COT — Commitment of Traders
// ═══════════════════════════════════════════════

function buildCOTChart() {
  const grid = document.getElementById('cot-grid');
  if (!grid) return;
  grid.innerHTML = '<div style="padding:20px;color:#666;font-size:11px;">Loading COT data…</div>';

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
            <span class="cot-float cot-float--short">Short ${fmtK(cur.shortPos)}</span>
            <svg class="cot-donut" width="96" height="96" viewBox="0 0 80 80">
              <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="8"/>
              <g transform="rotate(-90 ${cx} ${cy})">
                <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f43f5e" stroke-width="8"
                  stroke-dasharray="${sArc} ${sGap}" stroke-linecap="round"/>
                <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#10b981" stroke-width="8"
                  stroke-dasharray="${lArc} ${lGap}" stroke-dashoffset="${lArc}" stroke-linecap="round"/>
              </g>
              <text x="${cx}" y="${cy - 1}" text-anchor="middle" font-size="13" font-weight="700"
                fill="#e2e8f0" font-family="JetBrains Mono,monospace">${cur.key}</text>
              <text x="${cx}" y="${cy + 10}" text-anchor="middle" font-size="6.5" fill="#64748b"
                font-family="JetBrains Mono,monospace">${cur.derived ? 'calc' : 'CME'}</text>
            </svg>
            <span class="cot-float cot-float--long">Long ${fmtK(cur.longPos)}</span>
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

function buildDMXChart(forceRefresh = false) {
  const wrap = document.getElementById('dmx-table-wrap');
  if (!wrap) return;

  const activeTfBtn = document.querySelector('.dmx-tf-btn--active');
  const period = activeTfBtn ? activeTfBtn.dataset.tf : 'H1';

  // Sync period label in header
  const periodLbl = document.getElementById('dmx-period-label');
  if (periodLbl) periodLbl.textContent = _DMX_TF_LABELS[period] || period;

  // Auto-force if data is older than 10 minutes
  const stale = Date.now() - _dmxLastUpdate > 10 * 60 * 1000;
  const url = `/api/community-outlook?period=${period}${(forceRefresh || stale) ? '&force=1' : ''}`;

  wrap.innerHTML = '<div class="dmx-loading">Loading data…</div>';

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
  chart.set('background', am5.Rectangle.new(root, { fill: am5.color(0x040c12), fillOpacity: 1 }));

  // Subtle graticule grid
  const graticuleSeries = chart.series.push(am5map.GraticuleSeries.new(root, { step: 30 }));
  graticuleSeries.mapLines.template.setAll({ stroke: am5.color(0x0a1408), strokeOpacity: 1, strokeWidth: 0.4 });

  // Country polygons — green on dark ocean
  const polygonSeries = chart.series.push(
    am5map.MapPolygonSeries.new(root, { geoJSON: am5geodata_worldLow, exclude: ['AQ'] })
  );
  polygonSeries.mapPolygons.template.setAll({
    fill: am5.color(0x2d6020), stroke: am5.color(0x3a7025),
    strokeWidth: 0.5, fillOpacity: 1, interactive: true, tooltipText: '{name}',
  });
  polygonSeries.mapPolygons.template.states.create('hover', { fill: am5.color(0x3a7a28) });

  // ── Orange UTC vertical line ──────────────────
  const utcLineSeries = chart.series.push(am5map.MapLineSeries.new(root, {}));
  utcLineSeries.mapLines.template.setAll({
    stroke: am5.color(0xf79400), strokeWidth: 2, strokeOpacity: 0.95,
  });

  const utcLabelSeries = chart.series.push(am5map.MapPointSeries.new(root, {}));
  let _utcLabel = null;
  utcLabelSeries.bullets.push((r) => {
    const cont = am5.Container.new(r, {});
    cont.children.push(am5.RoundedRectangle.new(r, {
      width: 54, height: 20,
      fill: am5.color(0xf79400), fillOpacity: 1,
      cornerRadiusTL: 4, cornerRadiusTR: 4, cornerRadiusBL: 4, cornerRadiusBR: 4,
      centerX: am5.percent(50), centerY: am5.percent(50),
    }));
    _utcLabel = cont.children.push(am5.Label.new(r, {
      text: '--:--',
      fill: am5.color(0x000000),
      fontSize: 10, fontFamily: '"JetBrains Mono", monospace', fontWeight: '700',
      centerX: am5.percent(50), centerY: am5.percent(50),
      oversizedBehavior: 'none',
    }));
    return am5.Bullet.new(r, { sprite: cont });
  });

  let _lastUTCLineLon = null;
  function refreshUTCLine(now) {
    const h = now.getUTCHours() + now.getUTCMinutes() / 60;
    const lon = (h - 12) * 15;
    const utcTime = now.toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false,
    });
    if (_utcLabel) _utcLabel.set('text', utcTime);
    if (_lastUTCLineLon === null || Math.abs(lon - _lastUTCLineLon) >= 0.25) {
      _lastUTCLineLon = lon;
      utcLineSeries.data.setAll([{ geometry: { type: 'LineString', coordinates: [[lon, 85], [lon, -85]] } }]);
      utcLabelSeries.data.setAll([{ geometry: { type: 'Point', coordinates: [lon, 68] } }]);
    }
  }

  // ── 4 key trading cities ──────────────────────
  const SESSION_CITIES = [
    { id: 'london',  name: 'London',   tz: 'Europe/London',    lon: -0.12,  lat: 51.5,  open: 8, close: 17, labelLeft: true  },
    { id: 'newyork', name: 'New York', tz: 'America/New_York', lon: -74.0,  lat: 40.7,  open: 9, close: 17, labelLeft: true  },
    { id: 'tokyo',   name: 'Tokyo',    tz: 'Asia/Tokyo',       lon: 139.7,  lat: 35.7,  open: 9, close: 15, labelLeft: false },
    { id: 'sydney',  name: 'Sydney',   tz: 'Australia/Sydney', lon: 151.2,  lat: -33.9, open: 9, close: 17, labelLeft: false },
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
    }));
  }

  pointSeries.data.setAll(buildCityData4(new Date()));

  const _cityTimeLabelRefs = {};

  pointSeries.bullets.clear();
  pointSeries.bullets.push((root, series, dataItem) => {
    const data   = dataItem.dataContext;
    const isOpen = data.isOpen;
    const cont   = am5.Container.new(root, {});

    // City clock label box
    const boxX = data.labelLeft ? -90 : 8;

    const box = cont.children.push(am5.Container.new(root, {
      x: boxX, y: -38,
      width: 82,
      paddingTop: 4, paddingBottom: 4, paddingLeft: 6, paddingRight: 6,
      layout: root.verticalLayout,
    }));

    box.set('background', am5.RoundedRectangle.new(root, {
      fill:        isOpen ? am5.color(0x1a1200) : am5.color(0x0c1526),
      fillOpacity: 0.93,
      stroke:      isOpen ? am5.color(0xf79400) : am5.color(0x253550),
      strokeWidth: 1,
      cornerRadiusTL: 3, cornerRadiusTR: 3, cornerRadiusBL: 3, cornerRadiusBR: 3,
    }));

    const timeLabel = box.children.push(am5.Label.new(root, {
      text:       '--:--:--',
      fill:       am5.color(isOpen ? 0xf79400 : 0x6688aa),
      fontSize:   11, fontWeight: '700',
      fontFamily: '"JetBrains Mono", monospace',
      width: am5.percent(100),
    }));

    box.children.push(am5.Label.new(root, {
      text:       data.name,
      fill:       am5.color(isOpen ? 0xccaa66 : 0x445566),
      fontSize:   9,
      fontFamily: '"JetBrains Mono", monospace',
      width: am5.percent(100),
    }));

    _cityTimeLabelRefs[data.id] = timeLabel;

    // Pulse ring for open sessions
    if (isOpen) {
      const ring = cont.children.push(
        am5.Circle.new(root, { radius: 7, fillOpacity: 0, stroke: am5.color(0xf7941d), strokeOpacity: 0.7, strokeWidth: 1.5 })
      );
      ring.animate({ key: 'radius',        from: 5,   to: 20, duration: 2000, loops: Infinity, easing: am5.ease.out(am5.ease.cubic) });
      ring.animate({ key: 'strokeOpacity', from: 0.7, to: 0,  duration: 2000, loops: Infinity, easing: am5.ease.out(am5.ease.cubic) });
    }

    // City dot
    cont.children.push(am5.Circle.new(root, {
      radius:      isOpen ? 5 : 3,
      fill:        isOpen ? am5.color(0xf7941d) : am5.color(0x555570),
      stroke:      isOpen ? am5.color(0xffc87a) : am5.color(0x333350),
      strokeWidth: isOpen ? 1.5 : 0.8,
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
    const utcH = now.getUTCHours() + now.getUTCMinutes() / 60;
    const active = SESSION_BLOCKS.filter(s => isSessionActive(s, utcH)).map(s => s.name);
    const labEl  = document.getElementById('active-sessions-label');
    if (labEl) {
      labEl.textContent = active.length ? active.join(' · ') + ' Open' : 'Closed';
      labEl.style.color = active.length ? 'var(--orange)' : 'var(--text4)';
    }
  }

  mapClockTimer = setInterval(() => {
    const now = new Date();
    updateHeader(now);
    refreshUTCLine(now);
    updateCityTimes(now);
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
  // DMX and COT always rebuild on tab activation so data stays fresh
  if (tab === 'dmx') { buildDMXChart(); return; }
  if (tab === 'cot') { buildCOTChart(); return; }
  if (chartInited[tab]) return;
  chartInited[tab] = true;
  switch (tab) {
    case 'world':    buildSessionMap();     break;
    case 'risk':     buildRiskGauge();      break;
    case 'strength': buildStrengthCharts(); break;
    case 'meter':    buildMeterChart();     break;
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
  });

  // ── View switching (main nav) ──────────────────────────────────────────────
  // Liste des onglets valides (pour valider une valeur mémorisée)
  const VALID_VIEWS = ['news', 'calendar', 'bias', 'fxlist', 'institution', 'analyst', 'bank'];

  function activateView(view, { persist = true } = {}) {
    if (!VALID_VIEWS.includes(view)) view = 'news';

    document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('nav-item--active', x.dataset.view === view));
    document.querySelectorAll('.view-panel').forEach(p => p.classList.toggle('hidden', p.id !== `view-${view}`));

    // BANK & BIAS : pleine largeur → on masque la colonne de droite (World Clock / Session Map)
    const fullWidth = (view === 'bank' || view === 'bias');
    document.getElementById('main-layout')?.classList.toggle('hide-right-panel', fullWidth);

    if (view === 'bias' && typeof loadBiasView === 'function') {
      loadBiasView();
    }
    if (view === 'bank' && typeof loadBankView === 'function') {
      loadBankView();
    }
    if (view === 'calendar') buildCalendar();
    if (view === 'institution' && typeof loadInstitutionView === 'function') {
      if (!window._institutionTabInited) { window._institutionTabInited = true; loadInstitutionView(); }
      else renderBrList();
    }
    if (view === 'analyst' && typeof loadAnalystView === 'function') {
      if (!window._analystTabInited) { window._analystTabInited = true; initAnalystTab(); }
      loadAnalystView();
    }

    // Mémoriser l'onglet actif pour le rouvrir au prochain retour
    if (persist) { try { localStorage.setItem('dtp_active_view', view); } catch {} }
  }
  // Exposé globalement au cas où d'autres modules veulent changer de vue
  window.activateView = activateView;

  document.getElementById('topbar-nav')?.addEventListener('click', e => {
    const a = e.target.closest('[data-view]');
    if (!a) return;
    e.preventDefault();
    activateView(a.dataset.view);
  });

  // ── Restaurer le dernier onglet visité ───────────────────────────────────────
  let _savedView = 'news';
  try { _savedView = localStorage.getItem('dtp_active_view') || 'news'; } catch {}
  if (_savedView !== 'news') {
    // 'news' est déjà actif par défaut dans le HTML — on ne réactive que si différent
    activateView(_savedView, { persist: false });
  }

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

function calActualCell(actual, forecast, previous) {
  if (!actual || actual === '') return '<span class="cv-empty">—</span>';
  const a = parseFloat(actual), f = parseFloat(forecast), p = parseFloat(previous);
  let cls = '', bolt = '';
  if (!isNaN(a) && !isNaN(f)) {
    cls  = a >= f ? 'cv-pos' : 'cv-neg';
    bolt = `<span class="cv-bolt">⚡</span>`;
  } else if (!isNaN(a) && !isNaN(p)) {
    cls  = a >= p ? 'cv-pos' : 'cv-neg';
    bolt = `<span class="cv-bolt">⚡</span>`;
  }
  return `<span class="cv-actual ${cls}">${bolt}${actual}</span>`;
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
    tbody += `<tr class="${rowCls}">
      ${timeCell}
      <td class="cth-flag">${CAL_FLAG(ev.currency)}</td>
      <td class="cth-curr">${ev.currency || ''}</td>
      <td class="cth-imp">${calImpDots(ev.impact)}</td>
      <td class="cth-event">${ev.title || ''}</td>
      <td class="cth-val">${calActualCell(ev.actual, ev.forecast, ev.previous)}</td>
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
    wrap.innerHTML = '<div class="cal-loading">Loading calendar…</div>';

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
          wrap.innerHTML = `<div class="cal-loading">Loading calendar… (attempt ${attempt}/4)</div>`;
          await new Promise(r => setTimeout(r, 3000));
        }
      } catch {
        if (attempt < 4) {
          wrap.innerHTML = `<div class="cal-loading">Connecting… (attempt ${attempt}/4)</div>`;
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

  // Auto-refresh calendar data every 15 minutes (single interval, started once)
  if (!window._calAutoRefreshInterval) {
    window._calAutoRefreshInterval = setInterval(() => {
      _refreshCalendarData(false);
    }, 15 * 60 * 1000);
  }
}

window._retryCalendar = function() {
  _calEvents = [];
  buildCalendar();
};

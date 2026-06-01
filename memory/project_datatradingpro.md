---
name: project-datatradingpro
description: DataTradingPro Prime Terminal — local trading news platform architecture and tech stack
metadata:
  type: project
---

Full-stack local trading news platform ("Prime Terminal") inspired by a professional trading terminal UI.

**Stack:** Node.js + Express + WebSocket (`ws`) backend, vanilla HTML/CSS/JS frontend (no framework).

**Architecture:**
- `server.js` — Express server, WebSocket broadcaster, refresh loop (60s RSS, 5min NewsAPI)
- `scrapers/rss.js` — 7 financial RSS feeds (Reuters, ForexLive, FXStreet, MarketWatch, FinancialJuice, Investing.com)
- `scrapers/financialjuice.js` — HTTP scraper with cheerio
- `scrapers/forexfactory.js` — HTTP scraper (ForexFactory returns 403 Cloudflare)
- `public/index.html` — Main layout with view switching (NEWS / BIAS / etc.)
- `public/css/style.css` — Dark terminal theme (#0a0a0a bg, #f7941d orange, Inter + JetBrains Mono)
- `public/js/app.js` — WebSocket, news rendering, clocks, SVG session map
- `public/js/charts.js` — All amCharts 5 charts (stock, strength, risk, meter, COT, DMX)

**amCharts 5 integration (CDN):**
- `https://cdn.amcharts.com/lib/5/index.js` + xy, stock, percent, radar, Animated theme
- Custom terminal theme overrides grid/label/tooltip colors to match #0a0a0a palette
- Charts: BIAS stock chart (candlestick+EMA20/50+Volume+RSI), STRENGTH (currency bar chart), RISK (treemap heatmap), METER (gauge), COT (grouped bars), DMX (DXY line)
- All charts use `disposeRoot()` guard before reinit to prevent double-mount

**View system:**
- Nav items have `data-view` attribute; clicking switches `.view-panel.hidden`
- BIAS view: symbol sidebar (FX pairs, indices, commodities) + amCharts StockChart full-width
- Right panel tabs: WORLD (SVG session map), RISK, STRENGTH, METER, COT, DMX, NOTES — lazy-inited on first click via `chartInited` guard

**API key:** NewsAPI `506db9fc2a6e4da6a7d5d6eec72ab093` (free tier — 5min poll)

**Known:** amCharts canvas does not render in Puppeteer screenshot tools due to RAF animation loop. Works perfectly in real browser. Free tier shows amCharts watermark.

**How to start:** `node server.js` → http://localhost:3000

const STYLE_ID = "pm-stock-chart-upgrade-style";
const UPGRADE_CLASS = "pm-stock-chart-upgrade";
const STATE_KEY = "pm_stock_chart_upgrade_state";
const HISTORY_CACHE_KEY = "pm_stock_chart_history_cache";
const DEFAULT_MAS = [20];
const MA_OPTIONS = [5, 20, 60, 120];
const RANGE_OPTIONS = [
  ["3mo", "3개월"],
  ["6mo", "6개월"],
  ["1y", "1년"],
];
const MARKET_BY_LABEL = {
  "한국주식": "KR",
  "한국주식(ISA)": "ISA",
  "미국주식": "US",
  "ETF": "ETF",
  "암호화폐": "CRYPTO",
  "금현물": "GOLD",
};
const CRYPTO_IDS = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
};
const MA_COLORS = {
  5: "#fbbf24",
  20: "#38bdf8",
  60: "#a78bfa",
  120: "#fb7185",
};

const state = {
  range: "1y",
  enabledMas: new Set(DEFAULT_MAS),
  expanded: false,
  symbolKey: "",
  data: [],
  loading: false,
  error: "",
};
let scanScheduled = false;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .${UPGRADE_CLASS} {
      margin-top: 12px;
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 12px;
      background: linear-gradient(180deg, rgba(15, 23, 42, 0.9), rgba(2, 6, 23, 0.74));
      overflow: hidden;
    }
    .pm-chart-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 12px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.12);
    }
    .pm-chart-title {
      color: #e2e8f0;
      font-size: 13px;
      font-weight: 900;
      line-height: 1.3;
    }
    .pm-chart-sub {
      color: #64748b;
      font-size: 10px;
      font-weight: 800;
      margin-top: 3px;
    }
    .pm-chart-actions, .pm-chart-row {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 6px;
    }
    .pm-chart-row {
      justify-content: flex-start;
      padding: 10px 12px 0;
    }
    .pm-chart-row-label {
      color: #64748b;
      font-size: 10px;
      font-weight: 900;
      margin-right: 2px;
    }
    .pm-chip {
      appearance: none;
      border: 1px solid rgba(148, 163, 184, 0.22);
      background: rgba(255, 255, 255, 0.045);
      color: #94a3b8;
      border-radius: 7px;
      padding: 5px 8px;
      font: inherit;
      font-size: 11px;
      font-weight: 900;
      line-height: 1;
      cursor: pointer;
      min-height: 26px;
    }
    .pm-chip[data-active="true"] {
      color: #f8fafc;
      border-color: var(--pm-accent, rgba(56, 189, 248, 0.65));
      background: color-mix(in srgb, var(--pm-accent, #38bdf8) 22%, transparent);
    }
    .pm-expand-btn {
      min-width: 30px;
      color: #cbd5e1;
    }
    .pm-chart-body {
      padding: 8px 12px 12px;
    }
    .pm-chart-svg-wrap {
      min-height: 250px;
    }
    .pm-chart-svg {
      width: 100%;
      height: 250px;
      display: block;
      overflow: visible;
    }
    .pm-chart-status {
      min-height: 150px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #64748b;
      font-size: 12px;
      font-weight: 800;
    }
    .pm-tech-summary {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 7px;
      margin-top: 9px;
    }
    .pm-tech-pill {
      min-width: 0;
      border: 1px solid rgba(148, 163, 184, 0.13);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.035);
      padding: 7px 8px;
    }
    .pm-tech-pill span {
      display: block;
      color: #64748b;
      font-size: 9px;
      font-weight: 900;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pm-tech-pill b {
      display: block;
      margin-top: 2px;
      color: #e2e8f0;
      font-size: 11px;
      line-height: 1.25;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pm-chart-modal {
      position: fixed;
      inset: 0;
      z-index: 600;
      background: rgba(2, 6, 23, 0.78);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
    }
    .pm-chart-modal-panel {
      width: min(1180px, 100%);
      max-height: min(88vh, 860px);
      overflow: auto;
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 14px;
      background: #07111f;
      box-shadow: 0 24px 80px rgba(0,0,0,0.45);
    }
    .pm-chart-modal .pm-chart-svg {
      height: min(58vh, 560px);
      min-height: 360px;
    }
    .pm-close-btn {
      color: #f8fafc;
      background: rgba(255,255,255,0.08);
    }
    @media (max-width: 640px) {
      .pm-chart-head {
        flex-direction: column;
        align-items: stretch;
      }
      .pm-chart-actions {
        justify-content: flex-start;
      }
      .pm-tech-summary {
        grid-template-columns: 1fr;
      }
      .pm-chart-modal {
        padding: 8px;
        align-items: flex-end;
      }
      .pm-chart-modal-panel {
        max-height: 92vh;
        border-radius: 14px 14px 0 0;
      }
      .pm-chart-modal .pm-chart-svg {
        min-height: 320px;
      }
    }
  `;
  document.head.appendChild(style);
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Best effort only.
  }
}

function restorePrefs() {
  const saved = readJson(STATE_KEY, null);
  if (!saved) return;
  if (saved.range) state.range = saved.range;
  if (Array.isArray(saved.enabledMas)) state.enabledMas = new Set(saved.enabledMas.filter((n) => MA_OPTIONS.includes(n)));
  if (!state.enabledMas.size) state.enabledMas = new Set(DEFAULT_MAS);
}

function persistPrefs() {
  writeJson(STATE_KEY, {
    range: state.range,
    enabledMas: Array.from(state.enabledMas),
  });
}

function findDetailPanel() {
  const overlays = Array.from(document.querySelectorAll("#root div"))
    .filter((node) => {
      const style = window.getComputedStyle(node);
      const text = node.textContent || "";
      return style.position === "fixed" && text.includes("주가 추이") && text.includes("종목 정보");
    });
  const overlay = overlays[0];
  if (!overlay) return null;
  return Array.from(overlay.children).find((child) => (child.textContent || "").includes("주가 추이")) || overlay;
}

function findChartCard(panel) {
  const title = Array.from(panel.querySelectorAll("div"))
    .find((node) => node.childElementCount === 0 && node.textContent.trim() === "📈 주가 추이");
  return title?.parentElement?.parentElement || null;
}

function findTicker(panel) {
  const tickerNode = Array.from(panel.querySelectorAll("span,div"))
    .find((node) => node.childElementCount === 0 && node.style.fontSize === "22px" && /^[A-Z0-9.=^-]{1,15}$/i.test(node.textContent.trim()));
  const fallback = Array.from(panel.querySelectorAll("span,div"))
    .find((node) => node.childElementCount === 0 && /^[A-Z0-9.=^-]{1,15}$/i.test(node.textContent.trim()));
  return (tickerNode || fallback)?.textContent.trim() || "";
}

function findMarket(panel) {
  const label = Array.from(panel.querySelectorAll("span,div"))
    .map((node) => node.childElementCount === 0 ? node.textContent.trim() : "")
    .find((text) => MARKET_BY_LABEL[text]);
  return MARKET_BY_LABEL[label] || "US";
}

function normalizeSymbol(ticker, market) {
  let symbol = String(ticker || "").trim();
  if (!symbol) return "";
  if (market === "GOLD") return "GC%3DF";
  const isKr = market === "KR" || market === "ISA" || (market === "ETF" && /^\d/.test(symbol));
  if (isKr && !symbol.includes(".")) symbol += ".KS";
  return symbol;
}

function rangeInterval(range) {
  if (range === "3mo" || range === "6mo" || range === "1y") return "1d";
  return "1d";
}

function formatLabel(ts) {
  return new Date(ts).toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
  });
}

async function fetchCryptoHistory(ticker, range) {
  const id = CRYPTO_IDS[ticker.toUpperCase()] || ticker.toLowerCase();
  const days = range === "3mo" ? "90" : range === "6mo" ? "180" : "365";
  const response = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("history failed");
  const data = await response.json();
  return (data.prices || []).map(([ts, price]) => ({
    ts,
    date: formatLabel(ts),
    price: Math.round(Number(price) * 100) / 100,
  })).filter((row) => Number.isFinite(row.price));
}

async function fetchHistory(ticker, market, range) {
  if (market === "CRYPTO") return fetchCryptoHistory(ticker, range);
  const symbol = normalizeSymbol(ticker, market);
  const interval = rangeInterval(range);
  const cacheKey = `${symbol}:${range}:${interval}`;
  const cache = readJson(HISTORY_CACHE_KEY, {});
  const cached = cache[cacheKey];
  if (cached?.ts && Date.now() - cached.ts < 10 * 60 * 1000 && Array.isArray(cached.data) && cached.data.length >= 2) {
    return cached.data;
  }
  const response = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("history failed");
  const payload = await response.json();
  const rows = (payload?.data || []).filter((row) => Number.isFinite(Number(row.price)));
  if (rows.length >= 2) {
    const nextCache = { ...cache, [cacheKey]: { ts: Date.now(), data: rows } };
    writeJson(HISTORY_CACHE_KEY, nextCache);
  }
  return rows;
}

function movingAverage(data, period) {
  const output = [];
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    sum += Number(data[i].price);
    if (i >= period) sum -= Number(data[i - period].price);
    output.push(i >= period - 1 ? sum / period : null);
  }
  return output;
}

function shortPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  if (n >= 1000000) return Math.round(n).toLocaleString("ko-KR");
  if (n >= 1000) return Math.round(n).toLocaleString("ko-KR");
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

function signedPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function technicalSummary(data) {
  if (!data.length) return [];
  const lastPrice = Number(data[data.length - 1].price);
  const ma20 = movingAverage(data, 20).at(-1);
  const ma60 = movingAverage(data, 60).at(-1);
  const ma120 = movingAverage(data, 120).at(-1);
  const gap20 = ma20 ? ((lastPrice - ma20) / ma20) * 100 : null;
  const trend = ma20 && ma60 && ma120
    ? (ma20 > ma60 && ma60 > ma120 ? "정배열" : ma20 < ma60 && ma60 < ma120 ? "역배열" : "혼조")
    : "데이터 확인";
  const position = gap20 == null ? "20일선 계산 중" : gap20 >= 0 ? `20일선 위 ${signedPct(gap20)}` : `20일선 아래 ${signedPct(gap20)}`;
  const status = gap20 == null ? "추세 확인 중" : gap20 > 12 ? "단기 과열권" : gap20 > 0 ? "상승 흐름" : gap20 > -5 ? "20일선 근접" : "단기 약세";
  return [
    ["현재 위치", position],
    ["배열", trend],
    ["상태", status],
  ];
}

function pointsFor(data, values, scale) {
  return values.map((value, index) => {
    if (value == null || !Number.isFinite(Number(value))) return null;
    return `${scale.x(index)},${scale.y(value)}`;
  });
}

function splitPolylines(points) {
  const lines = [];
  let current = [];
  points.forEach((point) => {
    if (point) current.push(point);
    else if (current.length) {
      lines.push(current.join(" "));
      current = [];
    }
  });
  if (current.length) lines.push(current.join(" "));
  return lines;
}

function chartSvg(data, enabledMas) {
  if (!data.length) return "";
  const w = 760;
  const h = 300;
  const pad = { t: 22, r: 54, b: 34, l: 54 };
  const maSeries = MA_OPTIONS.reduce((acc, period) => {
    acc[period] = movingAverage(data, period);
    return acc;
  }, {});
  const selectedValues = data.map((row) => Number(row.price));
  enabledMas.forEach((period) => {
    maSeries[period].forEach((value) => {
      if (value != null) selectedValues.push(value);
    });
  });
  const minRaw = Math.min(...selectedValues);
  const maxRaw = Math.max(...selectedValues);
  const spread = Math.max(maxRaw - minRaw, maxRaw * 0.02, 1);
  const min = minRaw - spread * 0.12;
  const max = maxRaw + spread * 0.12;
  const scale = {
    x: (index) => pad.l + (index / Math.max(1, data.length - 1)) * (w - pad.l - pad.r),
    y: (value) => pad.t + (1 - ((value - min) / Math.max(1, max - min))) * (h - pad.t - pad.b),
  };
  const pricePoints = data.map((row, index) => `${scale.x(index)},${scale.y(Number(row.price))}`);
  const fillPoints = `${pricePoints.join(" ")} ${scale.x(data.length - 1)},${h - pad.b} ${pad.l},${h - pad.b}`;
  const first = Number(data[0].price);
  const last = Number(data[data.length - 1].price);
  const priceColor = last >= first ? "#34d399" : "#f87171";
  const grid = [0, 0.25, 0.5, 0.75, 1].map((tick) => {
    const y = pad.t + tick * (h - pad.t - pad.b);
    const value = max - tick * (max - min);
    return `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" stroke="rgba(148,163,184,.12)" stroke-width="1"/><text x="${w - pad.r + 8}" y="${y + 4}" fill="#64748b" font-size="10" font-weight="800">${shortPrice(value)}</text>`;
  }).join("");
  const labels = [0, Math.floor((data.length - 1) / 2), data.length - 1].map((index) => {
    const x = scale.x(index);
    return `<text x="${x}" y="${h - 9}" fill="#64748b" font-size="10" font-weight="800" text-anchor="middle">${data[index]?.date || ""}</text>`;
  }).join("");
  const maLines = Array.from(enabledMas).map((period) => {
    const lines = splitPolylines(pointsFor(data, maSeries[period], scale));
    return lines.map((line) => `<polyline points="${line}" fill="none" stroke="${MA_COLORS[period]}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity=".95"/>`).join("");
  }).join("");
  const legend = Array.from(enabledMas).map((period, index) => (
    `<g transform="translate(${pad.l + index * 72}, 12)"><line x1="0" y1="0" x2="16" y2="0" stroke="${MA_COLORS[period]}" stroke-width="2"/><text x="21" y="4" fill="#cbd5e1" font-size="10" font-weight="900">${period}일</text></g>`
  )).join("");
  const lastX = scale.x(data.length - 1);
  const lastY = scale.y(last);
  return `
    <svg class="pm-chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="주가와 이동평균선 차트">
      <defs>
        <linearGradient id="pm-price-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="${priceColor}" stop-opacity=".22"/>
          <stop offset="100%" stop-color="${priceColor}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${w}" height="${h}" fill="transparent"/>
      ${grid}
      ${labels}
      <polygon points="${fillPoints}" fill="url(#pm-price-fill)"/>
      <polyline points="${pricePoints.join(" ")}" fill="none" stroke="${priceColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${maLines}
      ${legend}
      <circle cx="${lastX}" cy="${lastY}" r="4" fill="${priceColor}" stroke="#07111f" stroke-width="2"/>
      <text x="${Math.max(pad.l + 46, lastX - 6)}" y="${Math.max(pad.t + 13, lastY - 9)}" fill="#f8fafc" font-size="11" font-weight="900" text-anchor="end">${shortPrice(last)}</text>
    </svg>
  `;
}

function toolbarHtml(ticker, market, modal = false) {
  const rangeButtons = RANGE_OPTIONS.map(([range, label]) => (
    `<button class="pm-chip pm-range-btn" data-range="${range}" data-active="${state.range === range}">${label}</button>`
  )).join("");
  const maButtons = MA_OPTIONS.map((period) => (
    `<button class="pm-chip pm-ma-btn" data-period="${period}" data-active="${state.enabledMas.has(period)}" style="--pm-accent:${MA_COLORS[period]}">${period}</button>`
  )).join("");
  const action = modal
    ? `<button class="pm-chip pm-close-btn" data-close-chart="true">닫기</button>`
    : `<button class="pm-chip pm-expand-btn" data-expand-chart="true" title="큰 차트">확대</button>`;
  return `
    <div class="pm-chart-head">
      <div>
        <div class="pm-chart-title">이동평균선 차트</div>
        <div class="pm-chart-sub">${ticker} · ${market} · 20일선 기준 흐름</div>
      </div>
      <div class="pm-chart-actions">
        ${rangeButtons}
        ${action}
      </div>
    </div>
    <div class="pm-chart-row"><span class="pm-chart-row-label">이평선</span>${maButtons}</div>
  `;
}

function renderContent(ticker, market, modal = false) {
  const enabledMas = new Set(state.enabledMas);
  const summary = technicalSummary(state.data);
  const status = state.loading
    ? `<div class="pm-chart-status">차트 계산 중...</div>`
    : state.error
      ? `<div class="pm-chart-status">${state.error}</div>`
      : state.data.length < 2
        ? `<div class="pm-chart-status">차트 데이터를 불러올 수 없습니다</div>`
        : `<div class="pm-chart-svg-wrap">${chartSvg(state.data, enabledMas)}</div>`;
  const summaryHtml = summary.length ? `
    <div class="pm-tech-summary">
      ${summary.map(([label, value]) => `<div class="pm-tech-pill"><span>${label}</span><b>${value}</b></div>`).join("")}
    </div>
  ` : "";
  return `
    ${toolbarHtml(ticker, market, modal)}
    <div class="pm-chart-body">
      ${status}
      ${summaryHtml}
    </div>
  `;
}

function updateOriginalChartVisibility(card) {
  const headerTitle = Array.from(card.querySelectorAll("div"))
    .find((node) => node.childElementCount === 0 && node.textContent.trim() === "📈 주가 추이");
  const header = headerTitle?.parentElement || null;

  Array.from(card.children).forEach((child) => {
    if (child.classList?.contains(UPGRADE_CLASS)) return;
    if (child === header) {
      child.style.marginBottom = "0";
      Array.from(child.querySelectorAll("button")).forEach((button) => {
        button.style.display = "none";
      });
      return;
    }
    child.style.display = "none";
  });
}

function currentContext() {
  const panel = findDetailPanel();
  if (!panel) return null;
  const chartCard = findChartCard(panel);
  if (!chartCard) return null;
  const ticker = findTicker(panel);
  const market = findMarket(panel);
  if (!ticker) return null;
  return { panel, chartCard, ticker, market };
}

function getContainer(card) {
  let container = card.querySelector(`.${UPGRADE_CLASS}`);
  if (!container) {
    container = document.createElement("div");
    container.className = UPGRADE_CLASS;
    card.appendChild(container);
  }
  return container;
}

function renderAll() {
  const context = currentContext();
  if (!context) return;
  updateOriginalChartVisibility(context.chartCard);
  const container = getContainer(context.chartCard);
  container.dataset.ticker = context.ticker;
  container.dataset.market = context.market;
  const signature = [
    context.ticker,
    context.market,
    state.range,
    Array.from(state.enabledMas).sort((a, b) => a - b).join(","),
    state.loading ? "loading" : "ready",
    state.error,
    state.data.length,
    state.data.at(-1)?.price ?? "",
  ].join("|");
  if (container.dataset.renderSignature !== signature) {
    container.dataset.renderSignature = signature;
    container.innerHTML = renderContent(context.ticker, context.market);
  }
  const modalPanel = document.querySelector(".pm-chart-modal-panel");
  if (modalPanel && modalPanel.dataset.renderSignature !== signature) {
    modalPanel.dataset.renderSignature = signature;
    modalPanel.innerHTML = renderContent(context.ticker, context.market, true);
  }
}

async function loadData(ticker, market, range = state.range) {
  const symbolKey = `${ticker}:${market}:${range}`;
  if (state.symbolKey === symbolKey && state.loading) return;
  if (state.symbolKey === symbolKey && state.data.length) return;
  state.symbolKey = symbolKey;
  state.loading = true;
  state.error = "";
  renderAll();
  try {
    state.data = await fetchHistory(ticker, market, range);
    state.error = "";
  } catch {
    state.data = [];
    state.error = "차트 데이터를 불러오지 못했습니다";
  } finally {
    state.loading = false;
    renderAll();
  }
}

function openExpandedChart() {
  const context = currentContext();
  if (!context) return;
  let modal = document.querySelector(".pm-chart-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.className = "pm-chart-modal";
    modal.innerHTML = `<div class="pm-chart-modal-panel"></div>`;
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeExpandedChart();
    });
    document.body.appendChild(modal);
  }
  modal.querySelector(".pm-chart-modal-panel").innerHTML = renderContent(context.ticker, context.market, true);
}

function closeExpandedChart() {
  document.querySelector(".pm-chart-modal")?.remove();
}

function consumeChartClick(event) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
}

function onClick(event) {
  const rangeButton = event.target.closest?.(".pm-range-btn");
  if (rangeButton) {
    consumeChartClick(event);
    const context = currentContext();
    if (!context) return;
    state.range = rangeButton.dataset.range || "1y";
    state.data = [];
    persistPrefs();
    loadData(context.ticker, context.market, state.range);
    return;
  }

  const maButton = event.target.closest?.(".pm-ma-btn");
  if (maButton) {
    consumeChartClick(event);
    const period = Number(maButton.dataset.period);
    if (state.enabledMas.has(period)) state.enabledMas.delete(period);
    else state.enabledMas.add(period);
    persistPrefs();
    renderAll();
    return;
  }

  if (event.target.closest?.("[data-expand-chart]")) {
    consumeChartClick(event);
    openExpandedChart();
    return;
  }

  if (event.target.closest?.("[data-close-chart]")) {
    consumeChartClick(event);
    closeExpandedChart();
  }
}

function scan() {
  const context = currentContext();
  if (!context) {
    closeExpandedChart();
    state.symbolKey = "";
    return;
  }
  renderAll();
  loadData(context.ticker, context.market, state.range);
}

function scheduleScan() {
  if (scanScheduled) return;
  scanScheduled = true;
  window.requestAnimationFrame(() => {
    scanScheduled = false;
    scan();
  });
}

function start() {
  injectStyles();
  restorePrefs();
  document.addEventListener("click", onClick, true);
  const root = document.getElementById("root");
  if (root) {
    new MutationObserver(scheduleScan).observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
  scan();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}

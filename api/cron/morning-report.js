const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || "https://stockmanagehw-default-rtdb.firebaseio.com";
const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY || "";

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const isoKstDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

function etDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function marketDate(date = new Date()) {
  const p = etDateParts(date);
  return isoDate(p.year, p.month, p.day);
}

function isWeekend(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

function safeKey(value) {
  return encodeURIComponent(String(value || "").trim());
}

function maskKey(value) {
  const key = String(value || "");
  return key.length <= 4 ? "****" : `${key.slice(0, 2)}***${key.slice(-2)}`;
}

function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : Object.values(value).filter(Boolean);
}

function normalizeHolding(h) {
  const symbol = String(h?.ticker || h?.symbol || "").trim().toUpperCase();
  const quantity = Number(h?.quantity || 0);
  if (!symbol || quantity <= 0) return null;

  const market = String(h?.market || "").toUpperCase();
  const isUs = market === "US" || (market === "ETF" && !/^\d/.test(symbol));
  if (!isUs) return null;

  return {
    symbol,
    name: h?.name || symbol,
    quantity,
    averageCost: Number(h?.avgPrice || h?.averageCost || 0)
  };
}

function regularBarsOnly(values, ymd) {
  return values
    .filter((v) => typeof v.datetime === "string" && v.datetime.startsWith(ymd))
    .filter((v) => {
      const t = v.datetime.slice(11, 19);
      return t >= "09:30:00" && t <= "16:00:00";
    })
    .map((v) => ({
      time: v.datetime.replace(" ", "T"),
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
      volume: Number(v.volume || 0)
    }))
    .filter((bar) => bar.open > 0 && bar.close > 0)
    .sort((a, b) => a.time.localeCompare(b.time));
}

function etDateTimeFromUnix(seconds) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(new Date(seconds * 1000));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    ymd: `${map.year}-${map.month}-${map.day}`,
    time: `${map.hour}:${map.minute}:${map.second}`
  };
}

function yahooSymbol(symbol) {
  return symbol.replace(".", "-");
}

async function fetchYahooBars(holding, ymd) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(holding.symbol))}?interval=5m&range=5d&includePrePost=false`;
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 MorningReport/1.0" }
  });
  const data = await response.json();
  const result = data?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const timestamps = result?.timestamp || [];
  if (!response.ok || !result || !quote || !timestamps.length) {
    const message = data?.chart?.error?.description || `${holding.symbol} Yahoo 데이터 없음`;
    return { provider: "yahoo", ok: false, bars: [], message };
  }

  const bars = timestamps
    .map((ts, index) => {
      const et = etDateTimeFromUnix(ts);
      return {
        et,
        time: `${et.ymd}T${et.time}`,
        open: Number(quote.open?.[index]),
        high: Number(quote.high?.[index]),
        low: Number(quote.low?.[index]),
        close: Number(quote.close?.[index]),
        volume: Number(quote.volume?.[index] || 0)
      };
    })
    .filter((bar) => bar.et.ymd === ymd && bar.et.time >= "09:30:00" && bar.et.time <= "16:00:00")
    .filter((bar) => bar.open > 0 && bar.close > 0 && bar.high > 0 && bar.low > 0)
    .map(({ et, ...bar }) => bar)
    .sort((a, b) => a.time.localeCompare(b.time));

  return { provider: "yahoo", ok: bars.length > 0, bars, message: bars.length ? "" : `${holding.symbol} Yahoo 정규장 데이터 없음` };
}

async function fetchBars(holding, ymd) {
  if (!TWELVE_DATA_API_KEY) {
    return fetchYahooBars(holding, ymd);
  }

  const params = new URLSearchParams({
    symbol: holding.symbol,
    interval: "5min",
    start_date: `${ymd} 09:30:00`,
    end_date: `${ymd} 16:00:00`,
    timezone: "America/New_York",
    outputsize: "500",
    apikey: TWELVE_DATA_API_KEY
  });
  const response = await fetch(`https://api.twelvedata.com/time_series?${params}`);
  const data = await response.json();

  if (!response.ok || data.status === "error" || !Array.isArray(data.values)) {
    return fetchYahooBars(holding, ymd);
  }
  const bars = regularBarsOnly(data.values, ymd);
  return bars.length
    ? { provider: "twelve-data", ok: true, bars, message: "" }
    : fetchYahooBars(holding, ymd);
}

function summarize(holding, result) {
  const bars = result.bars;
  if (!bars.length) {
    return { symbol: holding.symbol, name: holding.name, quantity: holding.quantity, status: "no_data", message: result.message, chartBars: [] };
  }

  const open = bars[0].open;
  const close = bars[bars.length - 1].close;
  const high = Math.max(...bars.map((b) => b.high));
  const low = Math.min(...bars.map((b) => b.low));
  const volume = bars.reduce((sum, b) => sum + b.volume, 0);
  return {
    symbol: holding.symbol,
    name: holding.name,
    quantity: holding.quantity,
    status: "ok",
    open: money(open),
    close: money(close),
    high: money(high),
    low: money(low),
    volume: Math.round(volume),
    change: money(close - open),
    changePct: money(((close - open) / open) * 100),
    positionImpact: money((close - open) * holding.quantity),
    positionValueAtOpen: money(open * holding.quantity),
    positionValueAtClose: money(close * holding.quantity),
    chartBars: bars.map((b) => ({ ...b, open: money(b.open), high: money(b.high), low: money(b.low), close: money(b.close), volume: Math.round(b.volume) }))
  };
}

async function firebase(path, init) {
  const response = await fetch(`${FIREBASE_DB_URL}/${path}.json`, init);
  if (!response.ok) throw new Error(`Firebase ${path} HTTP ${response.status}`);
  return response.json();
}

async function writeReport(syncKey, report) {
  await firebase(`users/${safeKey(syncKey)}/morningReport/latest`, {
    method: "PUT",
    body: JSON.stringify(report)
  });
}

async function buildReport(syncKey, data, ymd) {
  const holdings = [...normalizeList(data?.holdings), ...normalizeList(data?.holdings2), ...normalizeList(data?.holdings4)]
    .map(normalizeHolding)
    .filter(Boolean);

  if (!holdings.length || isWeekend(ymd)) {
    const report = {
      report_date: isoKstDate(),
      market_session_date: ymd,
      generated_at: new Date().toISOString(),
      holdings_snapshot: holdings,
      per_symbol_metrics: holdings.map((h) => ({ symbol: h.symbol, name: h.name, quantity: h.quantity, status: "no_data", chartBars: [] })),
      total_change: 0,
      total_change_pct: 0,
      provider_status: { provider: "market-calendar", ok: false, message: isWeekend(ymd) ? "미국 주말이라 새 정규장 데이터가 없습니다." : "미국 보유 종목이 없습니다." }
    };
    await writeReport(syncKey, report);
    return { ok: false, symbols: holdings.length, report };
  }

  const symbolReports = [];
  for (const holding of holdings) {
    const bars = await fetchBars(holding, ymd);
    symbolReports.push(summarize(holding, bars));
  }

  const openValue = symbolReports.reduce((sum, s) => sum + (s.positionValueAtOpen || 0), 0);
  const closeValue = symbolReports.reduce((sum, s) => sum + (s.positionValueAtClose || 0), 0);
  const sortedByImpact = symbolReports.filter((s) => typeof s.positionImpact === "number").sort((a, b) => b.positionImpact - a.positionImpact);
  const report = {
    report_date: isoKstDate(),
    market_session_date: ymd,
    generated_at: new Date().toISOString(),
    holdings_snapshot: holdings,
    per_symbol_metrics: symbolReports,
    chart_bars: Object.fromEntries(symbolReports.map((s) => [s.symbol, s.chartBars || []])),
    total_open_value: money(openValue),
    total_close_value: money(closeValue),
    total_change: money(closeValue - openValue),
    total_change_pct: openValue ? money(((closeValue - openValue) / openValue) * 100) : 0,
    best_contributor: sortedByImpact[0] || null,
    worst_contributor: sortedByImpact[sortedByImpact.length - 1] || null,
    provider_status: { provider: TWELVE_DATA_API_KEY ? "twelve-data/yahoo" : "yahoo", ok: true }
  };
  await writeReport(syncKey, report);
  return { ok: true, symbols: holdings.length, report };
}

export default async function handler(req, res) {
  try {
    const requestedSyncKey = String(req.query?.syncKey || "").trim();
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.authorization || "";
    const querySecret = req.query?.secret;
    if (!requestedSyncKey && secret && auth !== `Bearer ${secret}` && querySecret !== secret) {
      return json(res, 401, { ok: false, error: "Unauthorized" });
    }

    const ymd = marketDate();
    if (requestedSyncKey) {
      const user = await firebase(`users/${safeKey(requestedSyncKey)}`);
      if (!user) return json(res, 404, { ok: false, error: "동기화 키에 해당하는 사용자를 찾을 수 없습니다." });

      const result = await buildReport(requestedSyncKey, user, ymd);
      return json(res, 200, {
        ok: true,
        market_session_date: ymd,
        user: { syncKey: maskKey(requestedSyncKey), symbols: result.symbols, ok: result.ok },
        report: result.report
      });
    }

    const users = (await firebase("users")) || {};
    const results = [];
    for (const [syncKey, data] of Object.entries(users)) {
      try {
        const result = await buildReport(syncKey, data, ymd);
        results.push({ syncKey: maskKey(syncKey), symbols: result.symbols, ok: result.ok });
      } catch (error) {
        results.push({ syncKey: maskKey(syncKey), ok: false, error: error?.message || "unknown error" });
      }
    }

    return json(res, 200, { ok: true, market_session_date: ymd, users: results });
  } catch (error) {
    return json(res, 500, { ok: false, error: error?.message || "unknown error" });
  }
}

// Vercel API: /api/dividends
// Uses Yahoo chart dividend events to infer per-share dividend and recurring months.

const YAHOO_HOSTS = ["query1", "query2"];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function normalizeSymbol(symbol) {
  const raw = String(symbol || "").trim().toUpperCase();
  if (!raw) return "";
  if (/^\d{6}$/.test(raw)) return `${raw}.KS`;
  return raw;
}

function inferCurrency(symbol) {
  return symbol.endsWith(".KS") || symbol.endsWith(".KQ") ? "KRW" : "USD";
}

function isoDateFromUnix(sec) {
  if (!sec) return "";
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

function monthFromIso(iso) {
  if (!iso) return null;
  const m = Number(iso.slice(5, 7));
  return m >= 1 && m <= 12 ? m : null;
}

function roundDividend(n) {
  const num = Number(n || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 1000000) / 1000000;
}

function summarizeDividends(symbol, result) {
  const meta = result?.meta || {};
  const rawEvents = result?.events?.dividends || {};
  const events = Object.values(rawEvents)
    .map(ev => ({
      date: isoDateFromUnix(ev?.date),
      amount: roundDividend(ev?.amount),
    }))
    .filter(ev => ev.date && ev.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!events.length) {
    return {
      ok: false,
      symbol,
      querySymbol: meta.symbol || symbol,
      currency: meta.currency || inferCurrency(symbol),
      reason: "no_dividend_events",
      source: "yahoo-chart-dividends",
    };
  }

  const latest = events[events.length - 1];
  const since = Date.now() - 1000 * 60 * 60 * 24 * 730;
  let monthBasis = events.filter(ev => new Date(`${ev.date}T00:00:00Z`).getTime() >= since);
  if (monthBasis.length < 2) monthBasis = events.slice(-8);
  const months = [...new Set(monthBasis.map(ev => monthFromIso(ev.date)).filter(Boolean))]
    .sort((a, b) => a - b);

  return {
    ok: true,
    symbol,
    querySymbol: meta.symbol || symbol,
    name: meta.longName || meta.shortName || meta.symbol || symbol,
    perShare: latest.amount,
    months,
    currency: meta.currency || inferCurrency(symbol),
    lastDividendDate: latest.date,
    eventCount: events.length,
    recentEvents: events.slice(-12),
    confidence: events.length >= 4 && months.length > 0 ? "high" : "medium",
    source: "yahoo-chart-dividends",
    note: "Yahoo dividend event dates are used to infer dividend months; actual broker deposit dates may differ.",
  };
}

async function fetchYahooDividendHistory(symbol) {
  const querySymbol = normalizeSymbol(symbol);
  if (!querySymbol) return null;

  for (const host of YAHOO_HOSTS) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(querySymbol)}?range=5y&interval=1mo&events=div%2Csplits`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "application/json",
          "Referer": "https://finance.yahoo.com",
        },
        signal: AbortSignal.timeout(9000),
      });
      if (!response.ok) continue;
      const data = await response.json();
      const result = data?.chart?.result?.[0];
      if (!result) continue;
      return summarizeDividends(querySymbol, result);
    } catch {
      continue;
    }
  }

  return {
    ok: false,
    symbol: querySymbol,
    querySymbol,
    currency: inferCurrency(querySymbol),
    reason: "fetch_failed",
    source: "yahoo-chart-dividends",
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const symbols = String(req.query.symbols || "")
    .split(",")
    .map(normalizeSymbol)
    .filter(Boolean);

  const uniqueSymbols = [...new Set(symbols)].slice(0, 80);
  if (!uniqueSymbols.length) {
    res.status(400).json({ error: "symbols required" });
    return;
  }

  const results = {};
  for (let i = 0; i < uniqueSymbols.length; i += 8) {
    const chunk = uniqueSymbols.slice(i, i + 8);
    await Promise.all(chunk.map(async (symbol) => {
      results[symbol] = await fetchYahooDividendHistory(symbol);
    }));
    if (i + 8 < uniqueSymbols.length) await sleep(120);
  }

  res.status(200).json({
    asOf: new Date().toISOString(),
    source: "yahoo-chart-dividends",
    results,
  });
}

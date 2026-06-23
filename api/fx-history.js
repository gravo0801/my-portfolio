import { applyApiSecurity } from "./_security.js";

const YAHOO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://finance.yahoo.com",
  "Cache-Control": "no-cache",
};

function normalizeDate(value) {
  const text = String(value || "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function parseDates(query) {
  const raw = Array.isArray(query.dates) ? query.dates.join(",") : String(query.dates || query.date || "");
  return [...new Set(raw.split(",").map(normalizeDate).filter(Boolean))].slice(0, 120);
}

function utcMs(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function ymdFromUnixSeconds(seconds) {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function nearestPreviousRate(bars, date) {
  const target = utcMs(date);
  let hit = null;
  for (const bar of bars) {
    if (bar.date <= date) hit = bar;
    else break;
  }
  if (!hit) return null;
  const diffDays = Math.round((target - utcMs(hit.date)) / 86400000);
  return diffDays >= 0 && diffDays <= 10 ? hit.rate : null;
}

async function fetchYahooUsdKrw(dates) {
  const ordered = [...dates].sort();
  const startMs = utcMs(ordered[0]) - 10 * 86400000;
  const endMs = utcMs(ordered[ordered.length - 1]) + 3 * 86400000;
  const period1 = Math.floor(startMs / 1000);
  const period2 = Math.floor(endMs / 1000);
  const path = `/v8/finance/chart/KRW%3DX?period1=${period1}&period2=${period2}&interval=1d`;

  for (const host of ["query1", "query2"]) {
    try {
      const response = await fetch(`https://${host}.finance.yahoo.com${path}`, {
        headers: YAHOO_HEADERS,
        signal: AbortSignal.timeout(9000),
      });
      if (!response.ok) continue;
      const data = await response.json();
      const result = data?.chart?.result?.[0];
      const timestamps = result?.timestamp || [];
      const closes = result?.indicators?.quote?.[0]?.close || [];
      const bars = timestamps
        .map((ts, index) => ({
          date: ymdFromUnixSeconds(ts),
          rate: Number(closes[index]),
        }))
        .filter((bar) => Number.isFinite(bar.rate) && bar.rate > 900 && bar.rate < 2500)
        .sort((a, b) => a.date.localeCompare(b.date));

      if (!bars.length) continue;

      const rates = {};
      for (const date of dates) {
        const rate = nearestPreviousRate(bars, date);
        if (rate) rates[date] = Math.round(rate * 100) / 100;
      }
      if (Object.keys(rates).length) return rates;
    } catch {}
  }
  throw new Error("Yahoo USD/KRW history unavailable");
}

export default async function handler(req, res) {
  if (!applyApiSecurity(req, res, {
    methods: ["GET", "OPTIONS"],
    rateLimit: { key: "fx-history", windowMs: 60_000, max: 120 },
  })) return;

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  const dates = parseDates(req.query);
  if (!dates.length) {
    res.status(400).json({ error: "date or dates required" });
    return;
  }

  try {
    const rates = await fetchYahooUsdKrw(dates);
    res.status(200).json({ rates, source: "yahoo", ts: Date.now() });
  } catch (error) {
    res.status(502).json({ error: error?.message || "FX history fetch failed", rates: {} });
  }
}

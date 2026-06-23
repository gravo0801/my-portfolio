import { applyApiSecurity } from "./_security.js";
import { tossRequest } from "./_toss.js";

const FX_SYMBOLS = ["KRW=X", "JPY=X", "EURUSD=X", "CNY=X", "GBPUSD=X", "AUDUSD=X", "SGD=X", "HKD=X", "CHF=X", "CAD=X"];
const YAHOO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://finance.yahoo.com",
  "Cache-Control": "no-cache",
};

function parseYahooRates(quotes = []) {
  const rates = {};
  quotes.forEach((q) => {
    const p = q?.regularMarketPrice;
    if (!p) return;
    if (q.symbol === "KRW=X") rates.KRW = Math.round(p);
    if (q.symbol === "JPY=X") rates.JPY = Math.round(p * 10) / 10;
    if (q.symbol === "EURUSD=X") rates.EUR = p > 0 ? Math.round(10000 / p) / 10000 : null;
    if (q.symbol === "CNY=X") rates.CNY = Math.round(p * 1000) / 1000;
    if (q.symbol === "GBPUSD=X") rates.GBP = p > 0 ? Math.round(10000 / p) / 10000 : null;
    if (q.symbol === "AUDUSD=X") rates.AUD = p > 0 ? Math.round(10000 / p) / 10000 : null;
    if (q.symbol === "SGD=X") rates.SGD = Math.round(p * 1000) / 1000;
    if (q.symbol === "HKD=X") rates.HKD = Math.round(p * 100) / 100;
    if (q.symbol === "CHF=X") rates.CHF = Math.round(p * 1000) / 1000;
    if (q.symbol === "CAD=X") rates.CAD = Math.round(p * 1000) / 1000;
  });
  return rates;
}

async function fetchYahooRates() {
  const fields = "regularMarketPrice,currency";
  const path = `/v7/finance/quote?symbols=${FX_SYMBOLS.join(",")}&fields=${fields}`;
  for (const host of ["query1", "query2"]) {
    try {
      const response = await fetch(`https://${host}.finance.yahoo.com${path}`, {
        headers: YAHOO_HEADERS,
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) continue;
      const data = await response.json();
      const rates = parseYahooRates(data?.quoteResponse?.result || []);
      if (rates.KRW && rates.KRW > 900) return rates;
    } catch {}
  }
  throw new Error("Yahoo FX quotes unavailable");
}

async function fetchTossUsdKrw() {
  const data = await tossRequest("/api/v1/exchange-rate", {
    query: { baseCurrency: "USD", quoteCurrency: "KRW" },
    timeoutMs: 6000,
  });
  const result = data?.result || {};
  const rate = Number(result.rate || result.midRate);
  if (!Number.isFinite(rate) || rate < 900 || rate > 2000) {
    const error = new Error("Invalid Toss USD/KRW rate");
    error.detail = result;
    throw error;
  }
  return { rate, result };
}

async function fetchErApiRates() {
  const response = await fetch("https://open.er-api.com/v6/latest/USD", {
    signal: AbortSignal.timeout(6000),
  });
  const data = await response.json();
  if (data?.rates?.KRW > 900) return data.rates;
  throw new Error("open.er-api.com returned invalid KRW rate");
}

export default async function handler(req, res) {
  if (!applyApiSecurity(req, res, {
    methods: ["GET", "OPTIONS"],
    rateLimit: { key: "rates", windowMs: 60_000, max: 120 },
  })) return;

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  try {
    const toss = await fetchTossUsdKrw();
    let rates = { KRW: Math.round(toss.rate) };
    try {
      rates = { ...(await fetchYahooRates()), KRW: Math.round(toss.rate) };
    } catch {}
    return res.status(200).json({
      rates,
      ts: Date.now(),
      source: "toss",
      toss: toss.result,
    });
  } catch (tossError) {
    try {
      const rates = await fetchYahooRates();
      return res.status(200).json({
        rates,
        ts: Date.now(),
        source: "yahoo",
        fallbackReason: tossError?.message || undefined,
      });
    } catch (yahooError) {
      try {
        const rates = await fetchErApiRates();
        return res.status(200).json({
          rates,
          ts: Date.now(),
          source: "er-api",
          fallbackReason: tossError?.message || yahooError?.message || undefined,
        });
      } catch {
        res.status(502).json({ error: yahooError?.message || tossError?.message || "FX rate fetch failed" });
      }
    }
  }
}

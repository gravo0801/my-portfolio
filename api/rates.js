import { applyApiSecurity } from "./_security.js";
import { tossRequest } from "./_toss.js";

const FX_SYMBOLS = [
  "KRW=X",
  "JPY=X",
  "EURUSD=X",
  "CNY=X",
  "GBPUSD=X",
  "AUDUSD=X",
  "SGD=X",
  "HKD=X",
  "CHF=X",
  "CAD=X",
];
const YAHOO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://finance.yahoo.com",
  "Cache-Control": "no-cache",
};

let yahooCrumb = null;
let yahooCookie = null;
let yahooCrumbAt = 0;

async function getYahooSession() {
  if (yahooCrumb && yahooCookie && Date.now() - yahooCrumbAt < 30 * 60_000) {
    return { crumb: yahooCrumb, cookie: yahooCookie };
  }

  const cookieResponse = await fetch("https://fc.yahoo.com", {
    headers: YAHOO_HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(6000),
  });
  const cookie = (cookieResponse.headers.get("set-cookie") || "")
    .split(",")
    .map((value) => value.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
  const crumbResponse = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { ...YAHOO_HEADERS, Cookie: cookie },
    signal: AbortSignal.timeout(6000),
  });
  const crumb = (await crumbResponse.text()).trim();
  if (!crumbResponse.ok || !cookie || !crumb || crumb.includes("<")) {
    throw new Error("Yahoo session unavailable");
  }

  yahooCrumb = crumb;
  yahooCookie = cookie;
  yahooCrumbAt = Date.now();
  return { crumb, cookie };
}

function normalizeYahooRate(symbol, price) {
  if (!Number.isFinite(price) || price <= 0) return null;
  if (symbol === "KRW=X") return ["KRW", Math.round(price * 100) / 100];
  if (symbol === "JPY=X") return ["JPY", Math.round(price * 10000) / 10000];
  if (symbol === "EURUSD=X") return ["EUR", Math.round((1 / price) * 1e6) / 1e6];
  if (symbol === "CNY=X") return ["CNY", Math.round(price * 1e6) / 1e6];
  if (symbol === "GBPUSD=X") return ["GBP", Math.round((1 / price) * 1e6) / 1e6];
  if (symbol === "AUDUSD=X") return ["AUD", Math.round((1 / price) * 1e6) / 1e6];
  if (symbol === "SGD=X") return ["SGD", Math.round(price * 1e6) / 1e6];
  if (symbol === "HKD=X") return ["HKD", Math.round(price * 1e6) / 1e6];
  if (symbol === "CHF=X") return ["CHF", Math.round(price * 1e6) / 1e6];
  if (symbol === "CAD=X") return ["CAD", Math.round(price * 1e6) / 1e6];
  return null;
}

async function fetchYahooChartRate(symbol, session = {}) {
  const encodedSymbol = encodeURIComponent(symbol);
  const crumbQuery = session.crumb ? `&crumb=${encodeURIComponent(session.crumb)}` : "";
  for (const host of ["query1", "query2"]) {
    try {
      const response = await fetch(
        `https://${host}.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?interval=1m&range=1d${crumbQuery}`,
        {
          headers: { ...YAHOO_HEADERS, ...(session.cookie ? { Cookie: session.cookie } : {}) },
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!response.ok) continue;

      const data = await response.json();
      const result = data?.chart?.result?.[0];
      const timestamps = result?.timestamp || [];
      const closes = result?.indicators?.quote?.[0]?.close || [];
      let lastIndex = closes.length - 1;
      while (lastIndex >= 0 && (closes[lastIndex] == null || !Number.isFinite(Number(closes[lastIndex])))) lastIndex -= 1;

      const lastPrice = lastIndex >= 0 ? Number(closes[lastIndex]) : null;
      const regularPrice = Number(result?.meta?.regularMarketPrice);
      const price = Number.isFinite(lastPrice) && lastPrice > 0 ? lastPrice : regularPrice;
      const normalized = normalizeYahooRate(symbol, price);
      if (!normalized) continue;

      const marketTime = Number(result?.meta?.regularMarketTime || 0) * 1000;
      const barTime = Number(timestamps[lastIndex] || 0) * 1000;
      return {
        currency: normalized[0],
        rate: normalized[1],
        asOf: Math.max(marketTime, barTime) || Date.now(),
      };
    } catch {}
  }
  throw new Error(`Yahoo FX chart unavailable: ${symbol}`);
}

async function fetchYahooRates() {
  let session = {};
  try {
    session = await getYahooSession();
  } catch {}

  const results = await Promise.allSettled(FX_SYMBOLS.map((symbol) => fetchYahooChartRate(symbol, session)));
  const rates = {};
  const updatedAt = {};
  results.forEach((result) => {
    if (result.status !== "fulfilled") return;
    rates[result.value.currency] = result.value.rate;
    updatedAt[result.value.currency] = result.value.asOf;
  });

  if (!(rates.KRW > 900) || !(rates.JPY > 50)) {
    throw new Error("Yahoo FX charts missing core rates");
  }
  return { rates, updatedAt, asOf: updatedAt.KRW || Date.now() };
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
  const parsedTime = Date.parse(result.timestamp || result.updatedAt || result.tradedAt || "");
  return { rate, result, asOf: Number.isFinite(parsedTime) ? parsedTime : Date.now() };
}

async function fetchErApiRates() {
  const response = await fetch("https://open.er-api.com/v6/latest/USD", {
    signal: AbortSignal.timeout(6000),
  });
  const data = await response.json();
  if (data?.rates?.KRW > 900) {
    return {
      rates: data.rates,
      asOf: Number(data.time_last_update_unix || 0) * 1000 || Date.now(),
    };
  }
  throw new Error("open.er-api.com returned invalid KRW rate");
}

function buildResponse({ rates, source, asOf, updatedAt, granularity, fallbackReason, toss }) {
  const fetchedAt = Date.now();
  return {
    rates,
    // ts is retained for older clients, but now represents the provider's quote time.
    ts: asOf,
    asOf,
    fetchedAt,
    updatedAt,
    source,
    granularity: granularity || (source === "er-api" ? "daily" : "intraday"),
    stale: fetchedAt - asOf > (source === "er-api" ? 36 * 60 * 60_000 : 2 * 60 * 60_000),
    fallbackReason,
    toss,
  };
}

export default async function handler(req, res) {
  if (!applyApiSecurity(req, res, {
    methods: ["GET", "OPTIONS"],
    rateLimit: { key: "rates", windowMs: 60_000, max: 120 },
  })) return;

  // Browser refreshes frequently, but a short shared cache prevents bursts from
  // creating one Yahoo request per currency for every client refresh.
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");

  try {
    const yahoo = await fetchYahooRates();
    return res.status(200).json(buildResponse({
      ...yahoo,
      source: "yahoo-chart",
    }));
  } catch (yahooError) {
    try {
      const [toss, daily] = await Promise.all([
        fetchTossUsdKrw(),
        fetchErApiRates().catch(() => ({ rates: {} })),
      ]);
      return res.status(200).json(buildResponse({
        rates: { ...daily.rates, KRW: Math.round(toss.rate * 100) / 100 },
        source: "toss",
        asOf: toss.asOf,
        granularity: Object.keys(daily.rates).length ? "mixed" : "intraday",
        fallbackReason: yahooError?.message || undefined,
        toss: toss.result,
      }));
    } catch (tossError) {
      try {
        const daily = await fetchErApiRates();
        return res.status(200).json(buildResponse({
          ...daily,
          source: "er-api",
          fallbackReason: yahooError?.message || tossError?.message || undefined,
        }));
      } catch {
        res.status(502).json({ error: tossError?.message || yahooError?.message || "FX rate fetch failed" });
      }
    }
  }
}

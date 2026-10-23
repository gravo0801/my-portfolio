import { applyApiSecurity, secureFirebaseUrl, verifyFirebaseIdToken } from "../_security.js";

const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || "https://stockmanagehw-default-rtdb.firebaseio.com";
const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
};
const money = value => Math.round(value * 100) / 100;
const isoKstDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

// A conservative 15-minute finalization buffer also handles early-close days safely.
export function marketDate(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date).map(p => [p.type, p.value]));
  const day = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);
  if (Number(parts.hour) * 60 + Number(parts.minute) < 16 * 60 + 15) day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

function safeKey(value) {
  return encodeURIComponent(String(value || "").trim());
}

function queryParam(value) {
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return String(value || "").trim();
}

function cronAuthorization(req, secret) {
  const auth = String(req.headers.authorization || "");
  const querySecret = queryParam(req.query?.secret);
  if (!secret) return { ok: false, reason: "missing_cron_secret" };
  if (auth === `Bearer ${secret}` || querySecret === secret) return { ok: true };
  return { ok: false, reason: "invalid_cron_secret" };
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
  if (!symbol || !Number.isFinite(quantity) || quantity <= 0) return null;

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

export function dailyRows(result) {
  const quote = result?.indicators?.quote?.[0];
  return (result?.timestamp || []).map((ts, i) => ({
    date: new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ts * 1000)),
    open: Number(quote?.open?.[i]), close: Number(quote?.close?.[i])
  })).filter(r => Number.isFinite(r.close) && r.close > 0).sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchDaily(symbol) {
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.replaceAll(".", "-"))}?interval=1d&range=1mo&includePrePost=false`, {
    headers: { "user-agent": "Mozilla/5.0 MorningReport/2.0" }, signal: AbortSignal.timeout(8000)
  });
  const data = await response.json();
  const result = data?.chart?.result?.[0];
  if (!response.ok || !result) throw new Error("시세 제공처 응답 오류");
  return dailyRows(result);
}

export function summarize(holding, rows, ymd) {
  const index = rows.findIndex(r => r.date === ymd);
  const previous = rows[index - 1];
  const current = rows[index];
  if (!current || !previous || !(previous.close > 0)) return {
    ...holding, status: "no_data", message: "해당 거래일 종가 또는 이전 종가를 확인할 수 없습니다.", chartBars: []
  };
  return {
    ...holding, status: "ok", previousClose: previous.close, close: current.close,
    change: money(current.close - previous.close),
    changePct: money((current.close / previous.close - 1) * 100),
    positionImpact: money((current.close - previous.close) * holding.quantity),
    positionValueAtPreviousClose: previous.close * holding.quantity,
    positionValueAtClose: current.close * holding.quantity,
    chartBars: rows.slice(Math.max(0, index - 9), index + 1).map(r => ({ time: r.date, close: r.close }))
  };
}

async function firebase(path, init) {
  const response = await fetch(secureFirebaseUrl(FIREBASE_DB_URL, path), { ...init, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Firebase ${path} HTTP ${response.status}`);
  return response.json();
}

async function writeReport(syncKey, report) {
  await firebase(`users/${safeKey(syncKey)}/morningReport/latest`, {
    method: "PUT",
    body: JSON.stringify(report)
  });
}

export async function buildReport(syncKey, data, cutoff, dependencies = {}) {
  const readDaily = dependencies.fetchDaily || fetchDaily;
  const save = dependencies.writeReport || writeReport;
  const combined = new Map();
  for (const h of [...normalizeList(data?.holdings), ...normalizeList(data?.holdings2), ...normalizeList(data?.holdings4)].map(normalizeHolding).filter(Boolean)) {
    const prior = combined.get(h.symbol);
    combined.set(h.symbol, { ...h, quantity: h.quantity + (prior?.quantity || 0) });
  }
  const holdings = [...combined.values()];
  // The benchmark's actual daily bars resolve weekends and exchange holidays without a hard-coded calendar.
  const sessions = holdings.length ? (await readDaily("SPY")).filter(r => r.date <= cutoff) : [];
  const ymd = sessions.at(-1)?.date || cutoff;
  if (holdings.length && !sessions.length) throw new Error("최근 거래일을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  const cached = data?.morningReport?.latest;
  if (cached?.schema_version === 2 && cached.market_session_date === ymd && cached.provider_status?.ok &&
      JSON.stringify(cached.holdings_snapshot) === JSON.stringify(holdings)) return { ok: true, symbols: holdings.length, report: cached };
  const symbolReports = [];
  const deadline = Date.now() + 40_000;
  for (let start = 0; start < holdings.length; start += 4) {
    symbolReports.push(...await Promise.all(holdings.slice(start, start + 4).map(async holding => {
      try { if (Date.now() > deadline) throw new Error("deadline"); return summarize(holding, await readDaily(holding.symbol), ymd); }
      catch { return { ...holding, status: "no_data", message: "시세 조회 실패 · 새로고침으로 재시도", chartBars: [] }; }
    })));
  }
  const valid = symbolReports.filter(s => s.status === "ok");
  // Never erase a previous useful report when the provider is unavailable.
  if (holdings.length && !valid.length) throw new Error("모든 종목의 시세 조회에 실패했습니다. 기존 리포트를 유지합니다.");
  const previousValue = valid.reduce((sum, s) => sum + s.positionValueAtPreviousClose, 0);
  const closeValue = valid.reduce((sum, s) => sum + s.positionValueAtClose, 0);
  const complete = valid.length === holdings.length;
  const report = {
    schema_version: 2, report_date: isoKstDate(), market_session_date: ymd,
    generated_at: new Date().toISOString(), holdings_snapshot: holdings, per_symbol_metrics: symbolReports,
    total_previous_close_value: money(previousValue), total_close_value: money(closeValue),
    total_change: valid.length ? money(closeValue - previousValue) : null,
    total_change_pct: previousValue ? money((closeValue / previousValue - 1) * 100) : null,
    provider_status: { provider: "yahoo", ok: complete, partial: !complete, available: valid.length, total: holdings.length,
      message: !holdings.length ? "미국 보유 종목이 없습니다." : complete ? "" : `시세 확인 ${valid.length}/${holdings.length}종목 · 합계는 확인된 종목만 반영` }
  };
  await save(syncKey, report);
  return { ok: complete, symbols: holdings.length, report };
}

export default async function handler(req, res) {
  try {
    const requestedSyncKey = queryParam(req.query?.syncKey);
    const requestedDataKey = queryParam(req.query?.dataKey) || queryParam(req.query?.syncHash);
    const secret = String(process.env.CRON_SECRET || "").trim();
    if (requestedDataKey) {
      if (!applyApiSecurity(req, res, {
        methods:["GET", "OPTIONS"],
        rateLimit:{ key:"morning-report-user", windowMs:60_000, max:10 },
      })) return;

      const token = await verifyFirebaseIdToken(req);
      const uid = token.user_id || token.sub;
      const access = await firebase(`keyMap/${safeKey(requestedDataKey)}`);
      if (!access || (access.ownerUid !== uid && !access.members?.[uid])) {
        return json(res, 403, { ok: false, error: "Forbidden" });
      }

      const ymd = marketDate();
      const user = await firebase(`users/${safeKey(requestedDataKey)}`);
      if (!user) return json(res, 404, { ok: false, error: "Portfolio data not found." });

      const result = await buildReport(requestedDataKey, user, ymd);
      return json(res, 200, {
        ok: true,
        market_session_date: ymd,
        user: { dataKey: maskKey(requestedDataKey), symbols: result.symbols, ok: result.ok },
        report: result.report
      });
    }

    if (requestedSyncKey) {
      if (!applyApiSecurity(req, res, {
        methods:["GET", "OPTIONS"],
        rateLimit:{ key:"morning-report-legacy", windowMs:60_000, max:10 },
      })) return;

      const ymd = marketDate();
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

    const cronAuth = cronAuthorization(req, secret);
    if (!cronAuth.ok) {
      console.warn("[morning-report] cron authorization failed", {
        reason: cronAuth.reason,
        schedule: req.headers["x-vercel-cron-schedule"] || "",
        hasAuthorizationHeader: Boolean(req.headers.authorization),
      });
      return json(res, 401, { ok: false, error: "Unauthorized", reason: cronAuth.reason });
    }

    const ymd = marketDate();
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
    return json(res, error?.statusCode || 500, { ok: false, error: error?.message || "unknown error" });
  }
}

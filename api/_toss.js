const TOSS_BASE_URL = process.env.TOSSINVEST_BASE_URL || "https://openapi.tossinvest.com";
const TOSS_PROXY_URL = process.env.TOSS_PROXY_URL || "";
const TOSS_PROXY_TOKEN = process.env.TOSS_PROXY_TOKEN || "";

const tokenCache = {
  accessToken: "",
  expiresAt: 0,
};
let tokenPromise = null;

export function hasTossCredentials() {
  return Boolean(getTossProxyBaseUrl() || (getTossClientId() && getTossClientSecret()));
}

export function getDefaultTossAccount() {
  return process.env.TOSSINVEST_ACCOUNT
    || process.env.TOSSINVEST_ACCOUNT_SEQ
    || process.env.TOSS_ACCOUNT_SEQ
    || "";
}

function getTossClientId() {
  return process.env.TOSSINVEST_CLIENT_ID
    || process.env.TOSSINVEST_API_KEY
    || process.env.TOSS_OPENAPI_KEY
    || process.env.TOSS_API_KEY
    || "";
}

function getTossClientSecret() {
  return process.env.TOSSINVEST_CLIENT_SECRET
    || process.env.TOSSINVEST_SECRET_KEY
    || process.env.TOSS_OPENAPI_SECRET
    || process.env.TOSS_SECRET_KEY
    || "";
}

function getTossProxyBaseUrl() {
  return String(TOSS_PROXY_URL || "").trim().replace(/\/+$/, "");
}

async function getAccessToken() {
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt - 30_000) {
    return tokenCache.accessToken;
  }

  if (tokenPromise) return tokenPromise;
  tokenPromise = issueAccessToken().finally(() => {
    tokenPromise = null;
  });
  return tokenPromise;
}

async function issueAccessToken() {
  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("client_id", getTossClientId());
  body.set("client_secret", getTossClientSecret());

  const response = await fetch(`${TOSS_BASE_URL}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(8000),
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}

  if (!response.ok) {
    const error = new Error(data?.error_description || data?.error || text || `Toss auth failed: HTTP ${response.status}`);
    error.statusCode = response.status;
    error.detail = data || text;
    throw error;
  }

  const accessToken = data?.access_token;
  if (!accessToken) {
    const error = new Error("Toss auth response did not include access_token");
    error.statusCode = 502;
    throw error;
  }

  const expiresIn = Number(data?.expires_in || 3600);
  tokenCache.accessToken = accessToken;
  tokenCache.expiresAt = Date.now() + Math.max(60, expiresIn - 30) * 1000;
  return tokenCache.accessToken;
}

export function normalizeTossSymbol(symbol) {
  const raw = String(symbol || "").trim();
  if (!raw) return "";
  const withoutSuffix = raw.replace(/\.(KS|KQ)$/i, "");
  if (/^\d+$/.test(withoutSuffix)) return withoutSuffix.padStart(6, "0");
  return withoutSuffix.toUpperCase();
}

export function splitSymbols(value, max = 200) {
  return [...new Set(
    String(value || "")
      .split(",")
      .map(normalizeTossSymbol)
      .filter(Boolean)
  )].slice(0, max);
}

export async function tossRequest(path, {
  method = "GET",
  query = {},
  account = "",
  body,
  timeoutMs = 10_000,
} = {}) {
  if (!hasTossCredentials()) {
    const error = new Error("Toss Open API credentials or proxy are not configured");
    error.statusCode = 501;
    throw error;
  }

  const proxyBaseUrl = getTossProxyBaseUrl();
  if (proxyBaseUrl) {
    return tossProxyRequest(proxyBaseUrl, path, { method, query, account, body, timeoutMs });
  }

  const token = await getAccessToken();
  const url = new URL(path, TOSS_BASE_URL);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (account) headers["X-Tossinvest-Account"] = String(account);
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(url, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}

  if (!response.ok) {
    const tossError = data?.error || data;
    const error = new Error(tossError?.message || tossError?.code || text || `Toss API failed: HTTP ${response.status}`);
    error.statusCode = response.status;
    error.detail = tossError || text;
    error.requestId = response.headers.get("x-request-id") || tossError?.requestId || "";
    throw error;
  }

  return data;
}

async function tossProxyRequest(proxyBaseUrl, path, {
  method = "GET",
  query = {},
  account = "",
  body,
  timeoutMs = 10_000,
} = {}) {
  const url = new URL(path, `${proxyBaseUrl}/`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const headers = { Accept: "application/json" };
  if (TOSS_PROXY_TOKEN) {
    headers.Authorization = `Bearer ${TOSS_PROXY_TOKEN}`;
    headers["X-Toss-Proxy-Token"] = TOSS_PROXY_TOKEN;
  }
  if (account) headers["X-Tossinvest-Account"] = String(account);
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(url, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}

  if (!response.ok) {
    const proxyError = data?.error || data;
    const error = new Error(proxyError?.message || proxyError?.code || text || `Toss proxy failed: HTTP ${response.status}`);
    error.statusCode = response.status;
    error.detail = proxyError || text;
    error.requestId = response.headers.get("x-request-id") || proxyError?.requestId || "";
    throw error;
  }

  return data;
}

export function sendTossError(res, error) {
  const status = error?.statusCode || 502;
  res.status(status).json({
    error: error?.message || "Toss API request failed",
    requestId: error?.requestId || undefined,
    detail: error?.detail || undefined,
  });
}

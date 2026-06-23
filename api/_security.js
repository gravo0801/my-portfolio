import { createHash, createVerify } from "node:crypto";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "stockmanagehw";
const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || "https://stockmanagehw-default-rtdb.firebaseio.com";
const CERT_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const certCache = { expiresAt: 0, certs: null };
const buckets = new Map();

function allowedOrigins() {
  return [
    process.env.PUBLIC_APP_ORIGIN,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
    "https://my-portfolio-blue-pi-68.vercel.app",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
  ].filter(Boolean);
}

function isAllowedLocal(origin) {
  return /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || "");
}

export function isAllowedOrigin(origin) {
  return Boolean(origin && (allowedOrigins().includes(origin) || isAllowedLocal(origin)));
}

function referrerOrigin(req) {
  const ref = req.headers.referer || req.headers.referrer || "";
  try { return ref ? new URL(ref).origin : ""; } catch { return ""; }
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
}

export function applyApiSecurity(req, res, {
  methods = ["GET", "OPTIONS"],
  requireBrowser = true,
  rateLimit = { key:"default", windowMs:60_000, max:120 },
} = {}) {
  const origin = req.headers.origin || "";
  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", methods.join(", "));
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Tossinvest-Account, X-Portfolio-Data-Key, X-Portfolio-Data-Path, X-Portfolio-Sync-Key, X-Portfolio-Auth-Mode");

  if (req.method === "OPTIONS") {
    if (origin && !isAllowedOrigin(origin)) {
      res.status(403).json({ error:"Forbidden origin" });
      return false;
    }
    res.status(204).end();
    return false;
  }

  if (!methods.includes(req.method)) {
    res.status(405).json({ error:"Method not allowed" });
    return false;
  }

  if (requireBrowser) {
    const referer = referrerOrigin(req);
    const hasAllowedBrowserContext = isAllowedOrigin(origin) || isAllowedOrigin(referer);
    if (!hasAllowedBrowserContext) {
      res.status(403).json({ error:"Forbidden origin" });
      return false;
    }
  }

  if (rateLimit?.max) {
    const now = Date.now();
    const windowMs = rateLimit.windowMs || 60_000;
    const key = `${rateLimit.key || "default"}:${clientIp(req)}`;
    const bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      buckets.set(key, { count:1, resetAt:now + windowMs });
    } else {
      bucket.count += 1;
      if (bucket.count > rateLimit.max) {
        res.status(429).json({ error:"Too many requests" });
        return false;
      }
    }
  }

  return true;
}

function base64UrlDecode(value) {
  const base64 = String(value).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Buffer.from(base64, "base64");
}

async function getCerts() {
  if (certCache.certs && Date.now() < certCache.expiresAt) return certCache.certs;
  const res = await fetch(CERT_URL, { cache:"no-store" });
  if (!res.ok) throw new Error(`Firebase cert fetch failed: HTTP ${res.status}`);
  const cacheControl = res.headers.get("cache-control") || "";
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] || 3600);
  certCache.certs = await res.json();
  certCache.expiresAt = Date.now() + Math.max(60, maxAge - 60) * 1000;
  return certCache.certs;
}

export async function verifyFirebaseIdToken(req) {
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) {
    const error = new Error("Missing Firebase ID token");
    error.statusCode = 401;
    throw error;
  }

  const [headerPart, payloadPart, signaturePart] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart) {
    const error = new Error("Invalid Firebase ID token");
    error.statusCode = 401;
    throw error;
  }

  const header = JSON.parse(base64UrlDecode(headerPart).toString("utf8"));
  const payload = JSON.parse(base64UrlDecode(payloadPart).toString("utf8"));
  const certs = await getCerts();
  const cert = certs[header.kid];
  if (header.alg !== "RS256" || !cert) {
    const error = new Error("Untrusted Firebase ID token");
    error.statusCode = 401;
    throw error;
  }

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerPart}.${payloadPart}`);
  verifier.end();
  const valid = verifier.verify(cert, base64UrlDecode(signaturePart));
  const now = Math.floor(Date.now() / 1000);
  const claimsOk =
    valid &&
    payload.aud === PROJECT_ID &&
    payload.iss === `https://securetoken.google.com/${PROJECT_ID}` &&
    payload.sub &&
    payload.exp > now &&
    payload.iat <= now + 300;

  if (!claimsOk) {
    const error = new Error("Invalid Firebase ID token claims");
    error.statusCode = 401;
    throw error;
  }

  return payload;
}

function header(req, name) {
  return String(req.headers[name.toLowerCase()] || req.headers[name] || "").trim();
}

function safePortfolioKey(value) {
  const key = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{3,128}$/.test(key) ? key : "";
}

function sha256Hex(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

async function readFirebasePath(path) {
  const response = await fetch(secureFirebaseUrl(FIREBASE_DB_URL, path), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return null;
  return response.json();
}

async function verifyLegacyPortfolioSession(req) {
  const dataPath = header(req, "x-portfolio-data-path").replace(/^\/+|\/+$/g, "");
  const dataKeyHeader = safePortfolioKey(header(req, "x-portfolio-data-key"));
  const syncKey = safePortfolioKey(header(req, "x-portfolio-sync-key").toLowerCase());
  const match = dataPath.match(/^users\/([a-zA-Z0-9_-]{3,128})$/);
  const pathKey = safePortfolioKey(match?.[1] || "");
  if (!pathKey || !syncKey) return null;

  const allowedKeys = new Set([syncKey, sha256Hex(syncKey)]);
  if (!allowedKeys.has(pathKey)) return null;
  if (dataKeyHeader && dataKeyHeader !== pathKey) return null;

  const meta = await readFirebasePath(`users/${encodeURIComponent(pathKey)}/_meta`).catch(() => null);
  const ping = meta ? true : await readFirebasePath(`users/${encodeURIComponent(pathKey)}/ping`).catch(() => null);
  if (!meta && ping == null) return null;

  return {
    authMode: header(req, "x-portfolio-auth-mode") || "legacy-key",
    dataKey: pathKey,
    legacy: true,
  };
}

export async function verifyPortfolioApiAccess(req) {
  try {
    const token = await verifyFirebaseIdToken(req);
    return { authMode: "firebase-auth", token, legacy: false };
  } catch (tokenError) {
    const legacy = await verifyLegacyPortfolioSession(req);
    if (legacy) return legacy;
    throw tokenError;
  }
}

export function secureFirebaseUrl(baseUrl, path) {
  const token = process.env.FIREBASE_REST_AUTH || process.env.FIREBASE_DATABASE_AUTH || "";
  const cleanBase = String(baseUrl || "").replace(/\/$/, "");
  const query = token ? `?auth=${encodeURIComponent(token)}` : "";
  return `${cleanBase}/${path}.json${query}`;
}

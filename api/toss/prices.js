import { applyApiSecurity } from "../_security.js";
import { normalizeTossSymbol, sendTossError, splitSymbols, tossRequest } from "../_toss.js";

function aliasesFor(symbol, requestedSymbols) {
  const aliases = new Set([symbol]);
  if (/^\d{6}$/.test(symbol)) {
    aliases.add(`${symbol}.KS`);
    aliases.add(`${symbol}.KQ`);
  }
  requestedSymbols.forEach((raw) => {
    if (normalizeTossSymbol(raw) === symbol) aliases.add(raw);
  });
  return [...aliases];
}

export default async function handler(req, res) {
  if (!applyApiSecurity(req, res, {
    methods: ["GET", "OPTIONS"],
    rateLimit: { key: "toss-prices", windowMs: 60_000, max: 180 },
  })) return;

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  const requestedSymbols = String(req.query.symbols || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const symbols = splitSymbols(req.query.symbols);
  if (!symbols.length) {
    res.status(400).json({ error: "symbols required" });
    return;
  }

  try {
    const data = await tossRequest("/api/v1/prices", {
      query: { symbols: symbols.join(",") },
      timeoutMs: 8000,
    });
    const rows = Array.isArray(data?.result) ? data.result : [];
    const results = {};

    rows.forEach((row) => {
      const symbol = normalizeTossSymbol(row?.symbol);
      const price = Number(row?.lastPrice);
      if (!symbol || !Number.isFinite(price) || price <= 0) return;

      const quote = {
        price,
        regularPrice: price,
        currency: row?.currency || (/^\d{6}$/.test(symbol) ? "KRW" : "USD"),
        marketState: "REGULAR",
        tossTimestamp: row?.timestamp || null,
        source: "toss",
      };

      aliasesFor(symbol, requestedSymbols).forEach((alias) => {
        results[alias] = quote;
      });
    });

    res.status(200).json({ results, source: "toss", ts: Date.now() });
  } catch (error) {
    sendTossError(res, error);
  }
}

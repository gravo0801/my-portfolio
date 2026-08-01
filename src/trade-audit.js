export const TRADE_CLEANUP_BACKUP_KEY = "pm_trade_cleanup_backup_v1";

export function isValidTradeRecord(trade) {
  return Boolean(
    trade &&
    typeof trade === "object" &&
    (trade.type === "buy" || trade.type === "sell") &&
    String(trade.ticker || "").trim() &&
    Number.isFinite(Number(trade.quantity)) &&
    Number(trade.quantity) > 0 &&
    Number.isFinite(Number(trade.price)) &&
    Number(trade.price) > 0
  );
}

export function findSuspiciousTradeBatches(trades, visibleTickers, minimumBatchSize = 8) {
  const tickerSet = visibleTickers instanceof Set ? visibleTickers : new Set(visibleTickers || []);
  const byDate = new Map();

  for (const trade of trades || []) {
    if (!isValidTradeRecord(trade)) continue;
    if (trade.type !== "buy" || trade.source === "manual") continue;
    if (trade.portfolio && trade.portfolio !== "p1") continue;
    if (!trade.date || !tickerSet.has(trade.ticker)) continue;
    const records = byDate.get(trade.date) || [];
    records.push(trade);
    byDate.set(trade.date, records);
  }

  return [...byDate.entries()]
    .filter(([, records]) => records.length >= minimumBatchSize)
    .map(([date, records]) => ({
      date,
      records: [...records].sort((a, b) => String(a.ticker).localeCompare(String(b.ticker))),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function mergeRestoredTrades(currentTrades, restoredTrades) {
  const existingIds = new Set((currentTrades || []).map(trade => String(trade?.id)));
  return [
    ...(currentTrades || []),
    ...(restoredTrades || []).filter(trade => !existingIds.has(String(trade?.id))),
  ];
}

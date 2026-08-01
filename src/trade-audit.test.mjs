import test from "node:test";
import assert from "node:assert/strict";
import {
  findSuspiciousTradeBatches,
  isValidTradeRecord,
  mergeRestoredTrades,
} from "./trade-audit.js";

const trade = (id, date, ticker, extra = {}) => ({
  id,
  date,
  ticker,
  type: "buy",
  quantity: 1,
  price: 100,
  portfolio: "p1",
  ...extra,
});

test("validates the fields required to render a trade", () => {
  assert.equal(isValidTradeRecord(trade(1, "2026-07-19", "AAPL")), true);
  assert.equal(isValidTradeRecord({ id: 2, ticker: "AAPL", quantity: 10 }), false);
  assert.equal(isValidTradeRecord(trade(3, "2026-07-19", "AAPL", { quantity: 0 })), false);
});

test("detects a large unmarked same-day P1 buy batch", () => {
  const tickers = Array.from({ length: 9 }, (_, index) => `T${index}`);
  const trades = tickers.map((ticker, index) => trade(index, "2026-07-19", ticker));
  trades.push(trade(99, "2026-07-20", "SAFE", { source: "manual" }));

  const batches = findSuspiciousTradeBatches(trades, new Set([...tickers, "SAFE"]));
  assert.equal(batches.length, 1);
  assert.equal(batches[0].date, "2026-07-19");
  assert.equal(batches[0].records.length, 9);
});

test("does not flag explicit manual entries or small legacy groups", () => {
  const manual = Array.from({ length: 9 }, (_, index) => trade(index, "2026-07-19", `M${index}`, { source: "manual" }));
  const legacy = Array.from({ length: 7 }, (_, index) => trade(index + 20, "2026-07-18", `L${index}`));
  const tickers = new Set([...manual, ...legacy].map(item => item.ticker));
  assert.deepEqual(findSuspiciousTradeBatches([...manual, ...legacy], tickers), []);
});

test("restores only records that are not already present", () => {
  const current = [trade(1, "2026-07-20", "AAPL")];
  const restored = [trade(1, "2026-07-20", "AAPL"), trade(2, "2026-07-19", "AMD")];
  assert.deepEqual(mergeRestoredTrades(current, restored).map(item => item.id), [1, 2]);
});

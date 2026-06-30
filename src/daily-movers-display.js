const PRICE_CACHE_KEY = "pm_prices_cache";
const FX_CACHE_KEY = "pm_usd_krw";
const DAILY_ROWS_CACHE_KEY = "pm_daily_movers_rows_cache";

const readJson = (key, fallback) => {
  try {
    const raw = window.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const readText = (key, fallback = "") => {
  try {
    return window.localStorage?.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};

const listFromFirebaseValue = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return Object.entries(value)
    .map(([id, row]) => row && typeof row === "object" ? { id, ...row } : null)
    .filter(Boolean);
};

const safeNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const shortKRW = (value) => {
  const abs = Math.abs(safeNumber(value));
  if (abs >= 100000000) return `${(abs / 100000000).toFixed(abs >= 1000000000 ? 1 : 2)}억`;
  if (abs >= 10000) return `${Math.round(abs / 10000).toLocaleString("ko-KR")}만`;
  return Math.round(abs).toLocaleString("ko-KR");
};

const signedKRW = (value) => `${safeNumber(value) >= 0 ? "+" : "-"}${shortKRW(value)}원`;

const toKRW = (value, currency, fx) => (
  currency === "USD" ? safeNumber(value) * fx : safeNumber(value)
);

async function readFirebaseList(path) {
  if (!path || !window.firebaseDB) return [];
  try {
    const db = window.firebaseDB.getDatabase();
    const snap = await window.firebaseDB.get(window.firebaseDB.ref(db, path));
    return listFromFirebaseValue(snap.val());
  } catch {
    return [];
  }
}

async function loadHoldings() {
  const dataKey = readText("pm_sync_hash", readText("pm_synckey"));
  const dataPath = readText("pm_data_path", dataKey ? `users/${dataKey}` : "");
  if (!dataPath) return [];

  const [holdings, holdings2] = await Promise.all([
    readFirebaseList(`${dataPath}/holdings`),
    readFirebaseList(`${dataPath}/holdings2`),
  ]);
  return [
    ...holdings.map((row) => ({ ...row, _portfolio: row.market === "ISA" ? "p3" : "p1" })),
    ...holdings2.map((row) => ({ ...row, _portfolio: "p2" })),
  ];
}

function buildDailyRows(holdings) {
  const prices = readJson(PRICE_CACHE_KEY, {}) || {};
  const fx = safeNumber(readText(FX_CACHE_KEY), 1380) || 1380;

  return holdings
    .map((holding) => {
      const ticker = String(holding?.ticker || "").trim();
      if (!ticker) return null;

      const priceInfo = prices[ticker] || prices[`${ticker}.KS`] || prices[`${ticker}.KQ`] || (holding.market === "GOLD" ? prices.GOLD : null);
      const currency = holding.market === "CRYPTO"
        ? (priceInfo?.currency || "USD")
        : (holding.cur || priceInfo?.currency || (holding.market === "US" ? "USD" : "KRW"));
      const quantity = safeNumber(holding.quantity);
      const price = safeNumber(priceInfo?.price ?? holding.price ?? holding.avgPrice);
      const dayPct = safeNumber(priceInfo?.regularChangePercent ?? priceInfo?.changePercent ?? holding.regChgPct ?? holding.chgPct);
      const dayUnitMove = safeNumber(
        priceInfo?.regularChangeAmount ?? priceInfo?.changeAmount ?? holding.regChgAmt ?? holding.chgAmt,
        price * dayPct / 100
      );

      return {
        ticker,
        dayPnlKRW: toKRW(dayUnitMove * quantity, currency, fx),
      };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.dayPnlKRW) - Math.abs(a.dayPnlKRW));
}

function findTodayMoversCard() {
  const titles = Array.from(document.querySelectorAll("#root div"))
    .filter((node) => node.childElementCount === 0 && node.textContent.trim() === "오늘 움직임 큰 종목");
  const title = titles[0];
  return title?.parentElement?.parentElement || null;
}

function tickerFromButton(button) {
  const detail = button.children?.[1]?.children?.[1]?.textContent || "";
  return detail.split("·")[0].trim();
}

function applyDailyAmounts(rows) {
  const card = findTodayMoversCard();
  if (!card || !rows.length) return;

  const rowsByTicker = rows.reduce((map, row) => {
    if (!map.has(row.ticker)) map.set(row.ticker, []);
    map.get(row.ticker).push(row);
    return map;
  }, new Map());

  Array.from(card.querySelectorAll("button")).forEach((button) => {
    const ticker = tickerFromButton(button);
    const row = rowsByTicker.get(ticker)?.shift();
    const amountNode = button.children?.[2]?.children?.[1];
    if (!row || !amountNode) return;

    const nextText = signedKRW(row.dayPnlKRW);
    const nextColor = row.dayPnlKRW >= 0 ? "#34d399" : "#f87171";
    const nextTitle = "오늘 등락에 따른 추정 손익";

    if (amountNode.textContent !== nextText) amountNode.textContent = nextText;
    if (amountNode.style.color !== nextColor) amountNode.style.color = nextColor;
    if (amountNode.title !== nextTitle) amountNode.title = nextTitle;
  });
}

let cachedRows = [];
let refreshPromise = null;
let scheduled = false;
let refreshRequested = false;
let observer = null;
let observedRoot = null;
const observerOptions = {
  childList: true,
  subtree: true,
  characterData: true,
};
const runSoon = window.queueMicrotask
  ? window.queueMicrotask.bind(window)
  : (callback) => Promise.resolve().then(callback);

async function refreshRows() {
  if (!refreshPromise) {
    refreshPromise = loadHoldings()
      .then(buildDailyRows)
      .then((rows) => {
        cachedRows = rows;
        try {
          window.localStorage?.setItem(DAILY_ROWS_CACHE_KEY, JSON.stringify(rows.slice(0, 20)));
        } catch {
          // Cache writes are best-effort only.
        }
      })
      .catch(() => {})
      .finally(() => { refreshPromise = null; });
  }
  await refreshPromise;
}

function withObserverPaused(callback) {
  const shouldResume = observer && observedRoot;
  if (shouldResume) observer.disconnect();
  try {
    callback();
  } finally {
    if (shouldResume) observer.observe(observedRoot, observerOptions);
  }
}

function observeRoot(root) {
  observedRoot = root;
  if (!observer) observer = new MutationObserver(() => schedulePatch());
  observer.observe(observedRoot, observerOptions);
}

function schedulePatch({ refresh = false } = {}) {
  refreshRequested = refreshRequested || refresh;
  if (scheduled) return;
  scheduled = true;

  runSoon(() => {
    (async () => {
      scheduled = false;
      const shouldRefresh = refreshRequested || !cachedRows.length;
      refreshRequested = false;

      if (cachedRows.length) {
        withObserverPaused(() => applyDailyAmounts(cachedRows));
      }

      if (shouldRefresh) {
        await refreshRows();
        withObserverPaused(() => applyDailyAmounts(cachedRows));
      }
    })().catch(() => {});
  });
}

window.addEventListener("load", () => {
  cachedRows = readJson(DAILY_ROWS_CACHE_KEY, []);
  schedulePatch({ refresh: true });
  window.setTimeout(() => schedulePatch({ refresh: true }), 1500);
  window.setInterval(() => schedulePatch({ refresh: true }), 60_000);

  const root = document.getElementById("root");
  if (root) observeRoot(root);
});

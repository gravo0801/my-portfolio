import { useState, useEffect, useCallback, useRef } from "react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  BarChart, Bar, AreaChart, Area,
} from "recharts";

const CRYPTO_IDS = {
  BTC:"bitcoin",ETH:"ethereum",BNB:"binancecoin",SOL:"solana",
  XRP:"ripple",ADA:"cardano",DOGE:"dogecoin",AVAX:"avalanche-2",
  LINK:"chainlink",DOT:"polkadot",MATIC:"matic-network",UNI:"uniswap",
  ATOM:"cosmos",NEAR:"near",APT:"aptos",SUI:"sui",
};
const MARKET_LABEL = { KR:"한국주식", ISA:"한국주식(ISA)", US:"미국주식", ETF:"ETF", CRYPTO:"암호화폐", GOLD:"금현물" };
const MARKET_COLOR = { KR:"#6366f1", ISA:"#06b6d4", US:"#10b981", ETF:"#f59e0b", CRYPTO:"#a855f7", GOLD:"#eab308" };
const USD_KRW = 1380;
const TAX_ACCOUNTS = ["연금저축1(신한금융투자)", "연금저축2(미래에셋증권)", "IRP(미래에셋증권)"];
const fmtPrice = (n, cur) => cur === "KRW" ? Math.round(n).toLocaleString("ko-KR") + "₩" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits:2, maximumFractionDigits:2 });
const fmtPct = (n) => (n >= 0 ? "+" : "") + Number(n).toFixed(2) + "%";
const toKRW  = (v, cur) => cur === "KRW" ? v : v * USD_KRW;
const today  = () => new Date().toISOString().slice(0, 10);
const fmtKRW = (v) => Math.round(v).toLocaleString("ko-KR") + "₩";


// ── 반응형 훅 ─────────────────────────────────────────────────────────────────
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return isMobile;
}

let _bestProxy = parseInt(localStorage.getItem("pm_best_proxy")||"0");

async function fetchYahoo(ticker) {
  const q1 = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=2d`;
  const q2 = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=2d`;
  const allProxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(q1)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(q2)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(q1)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(q2)}`,
    `https://thingproxy.freeboard.io/fetch/${q1}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(q1)}`,
  ];
  // 마지막으로 성공한 프록시를 앞으로 이동
  const proxies = [
    allProxies[_bestProxy],
    ...allProxies.filter((_,i) => i !== _bestProxy),
  ];
  for (const url of proxies) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const d = await r.json();
      const m = d?.chart?.result?.[0]?.meta;
      if (!m?.regularMarketPrice) continue;
      const price = m.regularMarketPrice;
      const prev  = m.previousClose || m.chartPreviousClose || price;
      const proxyIdx = allProxies.indexOf(url);
      if (proxyIdx >= 0 && proxyIdx !== _bestProxy) {
        _bestProxy = proxyIdx;
        try { localStorage.setItem("pm_best_proxy", String(proxyIdx)); } catch {}
      }
      return { price, changePercent: ((price - prev) / prev) * 100, currency: m.currency };
    } catch { continue; }
  }
  // 마지막 수단: stooq (CORS 프록시 불필요)
  try {
    const tk = ticker.endsWith(".KS") || ticker.endsWith(".KQ") ? ticker.replace(".KS","").replace(".KQ","") + ".KR" : ticker + ".US";
    const r = await fetch(`https://stooq.com/q/l/?s=${tk}&f=sd2ohlcv&h&e=json`, { signal: AbortSignal.timeout(6000) });
    const d = await r.json();
    const row = d?.symbols?.[0];
    if (row?.close) {
      const price = parseFloat(row.close);
      const open  = parseFloat(row.open) || price;
      return { price, changePercent: ((price - open) / open) * 100, currency: ticker.endsWith(".KS")||ticker.endsWith(".KQ") ? "KRW" : "USD" };
    }
  } catch {}
  return null;
}
async function fetchCrypto(ticker) {
  try {
    const id = CRYPTO_IDS[ticker.toUpperCase()] || ticker.toLowerCase();
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`);
    const d = await r.json();
    const info = d[id];
    return info ? { price: info.usd, changePercent: info.usd_24h_change, currency: "USD" } : null;
  } catch { return null; }
}

async function fetchGold(liveUsdKrw) {
  // 금 현물: 국제 금 시세(troy oz) → 원화/g 환산
  try {
    const proxies = [
      `https://api.allorigins.win/raw?url=${encodeURIComponent("https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1d&range=1d")}`,
      `https://corsproxy.io/?url=${encodeURIComponent("https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1d&range=1d")}`,
    ];
    for (const url of proxies) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (!r.ok) continue;
        const d = await r.json();
        const m = d?.chart?.result?.[0]?.meta;
        if (!m?.regularMarketPrice) continue;
        const priceUsdOz = m.regularMarketPrice;
        const prev = m.previousClose || m.chartPreviousClose || priceUsdOz;
        const krwPerG = (priceUsdOz * liveUsdKrw) / 31.1035;
        const prevKrwPerG = (prev * liveUsdKrw) / 31.1035;
        return {
          price: Math.round(krwPerG),
          changePercent: ((krwPerG - prevKrwPerG) / prevKrwPerG) * 100,
          currency: "KRW",
          priceUsdOz,
        };
      } catch { continue; }
    }
  } catch {}
  return null;
}

async function fetchHistory(ticker, market) {
  const isKR = market === "KR";
  const isCrypto = market === "CRYPTO";
  if (isCrypto) {
    try {
      const id = CRYPTO_IDS[ticker.toUpperCase()] || ticker.toLowerCase();
      const r = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=30&interval=daily`);
      const d = await r.json();
      return (d.prices||[]).map(([ts, price]) => ({
        date: new Date(ts).toLocaleDateString("ko-KR",{month:"numeric",day:"numeric"}),
        price: Math.round(price*100)/100,
      }));
    } catch { return []; }
  }
  const tk = isKR && !ticker.includes(".") ? ticker + ".KS" : ticker;
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${tk}?interval=1d&range=3mo`;
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(yahooUrl)}`,
  ];
  for (const url of proxies) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const d = await r.json();
      const result = d?.chart?.result?.[0];
      if (!result) continue;
      const timestamps = result.timestamp || [];
      const closes = result.indicators?.quote?.[0]?.close || [];
      return timestamps.map((ts, i) => ({
        date: new Date(ts * 1000).toLocaleDateString("ko-KR",{month:"numeric",day:"numeric"}),
        price: closes[i] ? Math.round(closes[i]*100)/100 : null,
      })).filter(d => d.price !== null);
    } catch { continue; }
  }
  return [];
}

async function fetchStockInfo(ticker, market) {
  if (market === "CRYPTO") {
    try {
      const id = CRYPTO_IDS[ticker.toUpperCase()] || ticker.toLowerCase();
      const r = await fetch(`https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false`);
      const d = await r.json();
      return {
        marketCap: d.market_data?.market_cap?.usd,
        high24h: d.market_data?.high_24h?.usd,
        low24h: d.market_data?.low_24h?.usd,
        ath: d.market_data?.ath?.usd,
        supply: d.market_data?.circulating_supply,
        desc: d.description?.en?.replace(/<[^>]+>/g,"").slice(0,200),
      };
    } catch { return {}; }
  }
  const tk = market === "KR" && !ticker.includes(".") ? ticker + ".KS" : ticker;
  const yahooUrl = `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${tk}?modules=summaryDetail,defaultKeyStatistics,assetProfile`;
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(yahooUrl)}`,
  ];
  for (const url of proxies) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const d = await r.json();
      const sd = d?.quoteSummary?.result?.[0]?.summaryDetail;
      const ks = d?.quoteSummary?.result?.[0]?.defaultKeyStatistics;
      const ap = d?.quoteSummary?.result?.[0]?.assetProfile;
      if (!sd) continue;
      return {
        marketCap: sd.marketCap?.raw,
        pe: sd.trailingPE?.raw,
        high52: sd.fiftyTwoWeekHigh?.raw,
        low52: sd.fiftyTwoWeekLow?.raw,
        dividend: sd.dividendYield?.raw,
        beta: sd.beta?.raw,
        eps: ks?.trailingEps?.raw,
        sector: ap?.sector,
        industry: ap?.industry,
      };
    } catch { continue; }
  }
  return {};
}

const S = {
  inp: { background:"rgba(255,255,255,0.07)", border:"1.5px solid rgba(255,255,255,0.14)", color:"#f1f5f9", padding:"11px 14px", borderRadius:"10px", fontSize:"15px", width:"100%", boxSizing:"border-box", outline:"none", letterSpacing:"-0.01em" },
  btn: (bg="#6366f1", extra={}) => ({ background:bg, border:"none", color:"#fff", padding:"10px 18px", borderRadius:"10px", cursor:"pointer", fontSize:"14px", fontWeight:700, letterSpacing:"-0.01em", ...extra }),
  card: { background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"14px", padding:"22px" },
  TH: { textAlign:"left", padding:"8px 12px", color:"#94a3b8", fontSize:"12px", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", borderBottom:"1px solid rgba(255,255,255,0.09)" },
  TD: { padding:"10px 12px", fontSize:"14px", borderBottom:"1px solid rgba(255,255,255,0.05)", letterSpacing:"-0.01em" },
};

let _db = null;
function getDB() {
  if (_db) return _db;
  const app = window.firebaseApp.initializeApp();
  _db = window.firebaseDB.getDatabase(app);
  return _db;
}
function dbRef(path) { return window.firebaseDB.ref(getDB(), path); }
function dbSet(path, val) { return window.firebaseDB.set(dbRef(path), val); }
function dbOn(path, cb) { return window.firebaseDB.onValue(dbRef(path), snap => cb(snap.val())); }


// ── 날씨 & 환율 위젯 ─────────────────────────────────────────────────────────
function InfoWidget() {
  const [mode, setMode] = useState("weather"); // "weather" | "rate"
  const [weather, setWeather] = useState({ seoul:null, nyc:null });
  const [rates, setRates] = useState({ usd:null, jpy:null });
  const [wLoading, setWLoading] = useState(false);
  const [rLoading, setRLoading] = useState(false);

  const WX_CODE = {
    0:"맑음",1:"대체로맑음",2:"구름조금",3:"흐림",
    45:"안개",48:"안개",51:"이슬비",53:"이슬비",55:"이슬비",
    61:"비",63:"비",65:"비",71:"눈",73:"눈",75:"눈",
    80:"소나기",81:"소나기",82:"소나기",95:"천둥번개",96:"천둥번개",99:"천둥번개"
  };
  const WX_ICON = {
    0:"☀️",1:"🌤️",2:"⛅",3:"☁️",45:"🌫️",48:"🌫️",
    51:"🌦️",53:"🌦️",55:"🌦️",61:"🌧️",63:"🌧️",65:"🌧️",
    71:"❄️",73:"❄️",75:"❄️",80:"🌦️",81:"🌦️",82:"🌦️",
    95:"⛈️",96:"⛈️",99:"⛈️"
  };

  const fetchWeather = async () => {
    setWLoading(true);
    try {
      const [sRes, nRes] = await Promise.all([
        fetch("https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.9780&current=temperature_2m,weathercode&timezone=Asia/Seoul"),
        fetch("https://api.open-meteo.com/v1/forecast?latitude=40.7128&longitude=-74.0060&current=temperature_2m,weathercode&timezone=America/New_York"),
      ]);
      const [s, n] = await Promise.all([sRes.json(), nRes.json()]);
      setWeather({
        seoul: { temp: Math.round(s.current.temperature_2m), code: s.current.weathercode },
        nyc:   { temp: Math.round(n.current.temperature_2m), code: n.current.weathercode },
      });
    } catch {}
    setWLoading(false);
  };

  const fetchRates = async () => {
    setRLoading(true);
    try {
      const r = await fetch("https://api.frankfurter.app/latest?from=USD&to=KRW,JPY");
      const d = await r.json();
      const usdKrw = d.rates.KRW;
      // JPY to KRW: 1 USD = X JPY, 1 USD = Y KRW → 1 JPY = Y/X KRW
      const jpyKrw = usdKrw / d.rates.JPY;
      setRates({ usd: Math.round(usdKrw), jpy: Math.round(jpyKrw * 100) / 100 });
    } catch {}
    setRLoading(false);
  };

  useEffect(() => { fetchWeather(); fetchRates(); }, []);
  // 날씨 10분, 환율 10분마다 갱신
  useEffect(() => {
    const w = setInterval(fetchWeather, 600000);
    const r = setInterval(fetchRates,   600000);
    return () => { clearInterval(w); clearInterval(r); };
  }, []);

  const btnStyle = (active) => ({
    background: active ? "rgba(99,102,241,0.35)" : "transparent",
    border: active ? "1px solid rgba(99,102,241,0.5)" : "1px solid rgba(255,255,255,0.1)",
    color: active ? "#c7d2fe" : "#64748b",
    padding: "3px 10px", borderRadius: "6px", cursor: "pointer",
    fontSize: "11px", fontWeight: 700, letterSpacing: "-0.01em",
  });

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:"6px" }}>
      {/* 토글 버튼 */}
      <div style={{ display:"flex", gap:"4px" }}>
        <button style={btnStyle(mode==="weather")} onClick={()=>setMode("weather")}>🌤️ 날씨</button>
        <button style={btnStyle(mode==="rate")}    onClick={()=>setMode("rate")}>💱 환율</button>
      </div>

      {/* 날씨 */}
      {mode === "weather" && (
        <div style={{ display:"flex", gap:"8px" }}>
          {wLoading ? (
            <span style={{fontSize:"11px",color:"#475569"}}>불러오는 중...</span>
          ) : (<>
            {weather.seoul && (
              <div style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:"8px", padding:"5px 10px", textAlign:"center", minWidth:"70px" }}>
                <div style={{ fontSize:"10px", color:"#64748b", marginBottom:"2px", fontWeight:700 }}>🇰🇷 서울</div>
                <div style={{ fontSize:"16px", lineHeight:1 }}>{WX_ICON[weather.seoul.code]??'🌡️'}</div>
                <div style={{ fontSize:"13px", fontWeight:800, color:"#f1f5f9", marginTop:"2px" }}>{weather.seoul.temp}°C</div>
                <div style={{ fontSize:"10px", color:"#64748b" }}>{WX_CODE[weather.seoul.code]??""}</div>
              </div>
            )}
            {weather.nyc && (
              <div style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:"8px", padding:"5px 10px", textAlign:"center", minWidth:"70px" }}>
                <div style={{ fontSize:"10px", color:"#64748b", marginBottom:"2px", fontWeight:700 }}>🇺🇸 뉴욕</div>
                <div style={{ fontSize:"16px", lineHeight:1 }}>{WX_ICON[weather.nyc.code]??'🌡️'}</div>
                <div style={{ fontSize:"13px", fontWeight:800, color:"#f1f5f9", marginTop:"2px" }}>{weather.nyc.temp}°C</div>
                <div style={{ fontSize:"10px", color:"#64748b" }}>{WX_CODE[weather.nyc.code]??""}</div>
              </div>
            )}
          </>)}
        </div>
      )}

      {/* 환율 */}
      {mode === "rate" && (
        <div style={{ display:"flex", gap:"8px" }}>
          {rLoading ? (
            <span style={{fontSize:"11px",color:"#475569"}}>불러오는 중...</span>
          ) : (<>
            {rates.usd && (
              <div style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:"8px", padding:"5px 12px", textAlign:"center", minWidth:"80px" }}>
                <div style={{ fontSize:"10px", color:"#64748b", marginBottom:"3px", fontWeight:700 }}>🇺🇸 USD → KRW</div>
                <div style={{ fontSize:"15px", fontWeight:800, color:"#34d399" }}>{rates.usd.toLocaleString()}₩</div>
                <div style={{ fontSize:"10px", color:"#64748b" }}>1달러</div>
              </div>
            )}
            {rates.jpy && (
              <div style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:"8px", padding:"5px 12px", textAlign:"center", minWidth:"80px" }}>
                <div style={{ fontSize:"10px", color:"#64748b", marginBottom:"3px", fontWeight:700 }}>🇯🇵 JPY → KRW</div>
                <div style={{ fontSize:"15px", fontWeight:800, color:"#f59e0b" }}>{rates.jpy.toFixed(2)}₩</div>
                <div style={{ fontSize:"10px", color:"#64748b" }}>1엔</div>
              </div>
            )}
          </>)}
        </div>
      )}
    </div>
  );
}


// ── 차트 캐시 (세션 동안 유지) ───────────────────────────────────────────────
const _chartCache = {};
const _infoCache  = {};

// ── 종목 상세 패널 ────────────────────────────────────────────────────────────
function StockDetail({ holding, price, onClose, isMobile }) {
  const [history, setHistory]   = useState([]);
  const [info, setInfo]         = useState({});
  const [loading, setLoading]   = useState(true);
  const [range, setRange]       = useState("3mo");

  useEffect(() => {
    const key = holding.ticker;
    // 캐시 있으면 즉시 표시
    if (_chartCache[key] && _infoCache[key]) {
      setHistory(_chartCache[key]);
      setInfo(_infoCache[key]);
      setLoading(false);
      return;
    }
    setLoading(true);
    // 캐시 없으면 병렬로 fetch
    Promise.all([
      _chartCache[key] ? Promise.resolve(_chartCache[key]) : fetchHistory(holding.ticker, holding.market),
      _infoCache[key]  ? Promise.resolve(_infoCache[key])  : fetchStockInfo(holding.ticker, holding.market),
    ]).then(([h, i]) => {
      _chartCache[key] = h;
      _infoCache[key]  = i;
      setHistory(h);
      setInfo(i);
      setLoading(false);
    });
  }, [holding.ticker]);

  const cur = price?.currency || (holding.market === "KR" ? "KRW" : "USD");
  const currentPrice = price?.price ?? holding.avgPrice;
  const pnlPct = holding.avgPrice > 0 ? ((currentPrice - holding.avgPrice) / holding.avgPrice) * 100 : 0;
  const pnlAmt = (currentPrice - holding.avgPrice) * holding.quantity;

  const fmtNum = (n) => n >= 1e12 ? (n/1e12).toFixed(2)+"조" : n >= 1e8 ? (n/1e8).toFixed(0)+"억" : n >= 1e6 ? (n/1e6).toFixed(0)+"백만" : n?.toLocaleString() ?? "-";
  const fmtUSD = (n) => n ? "$"+n.toLocaleString("en-US",{minimumFractionDigits:0,maximumFractionDigits:0}) : "-";

  const minP = history.length ? Math.min(...history.map(d=>d.price)) : 0;
  const maxP = history.length ? Math.max(...history.map(d=>d.price)) : 1;
  const W = isMobile ? 340 : 560;
  const H = 160;
  const pad = { t:10, r:10, b:24, l:10 };

  const pts = history.map((d,i) => {
    const x = pad.l + (i/(history.length-1||1))*(W-pad.l-pad.r);
    const y = pad.t + (1-(d.price-minP)/(maxP-minP||1))*(H-pad.t-pad.b);
    return `${x},${y}`;
  }).join(" ");

  const isUp = history.length > 1 && history[history.length-1].price >= history[0].price;
  const lineColor = isUp ? "#34d399" : "#f87171";
  const fillColor = isUp ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)";

  const closePts = history.length > 0
    ? `${pad.l + (history.length-1)/(history.length-1||1)*(W-pad.l-pad.r)},${H-pad.b} ${pad.l},${H-pad.b}`
    : "";

  const infoItems = holding.market === "CRYPTO" ? [
    ["24h 고가", info.high24h ? "$"+info.high24h.toLocaleString("en-US",{maximumFractionDigits:2}) : "-"],
    ["24h 저가", info.low24h  ? "$"+info.low24h.toLocaleString("en-US",{maximumFractionDigits:2}) : "-"],
    ["역대 최고가", info.ath  ? "$"+info.ath.toLocaleString("en-US",{maximumFractionDigits:2}) : "-"],
    ["유통 공급량", info.supply ? (info.supply/1e6).toFixed(1)+"M" : "-"],
  ] : [
    ["시가총액", info.marketCap ? fmtUSD(info.marketCap) : "-"],
    ["52주 고가", info.high52 ? (cur==="KRW"?Math.round(info.high52).toLocaleString("ko-KR")+"₩":"$"+info.high52.toFixed(2)) : "-"],
    ["52주 저가", info.low52  ? (cur==="KRW"?Math.round(info.low52).toLocaleString("ko-KR")+"₩":"$"+info.low52.toFixed(2)) : "-"],
    ["P/E", info.pe ? info.pe.toFixed(1) : "-"],
    ["EPS", info.eps ? (cur==="KRW"?Math.round(info.eps).toLocaleString()+"₩":"$"+info.eps.toFixed(2)) : "-"],
    ["배당수익률", info.dividend ? (info.dividend*100).toFixed(2)+"%" : "-"],
    ["베타", info.beta ? info.beta.toFixed(2) : "-"],
    ["섹터", info.sector || "-"],
  ];

  return (
    <div style={{ position:"fixed", inset:0, zIndex:200, display:"flex", alignItems:isMobile?"flex-end":"center", justifyContent:"center", background:"rgba(0,0,0,0.6)", backdropFilter:"blur(4px)" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#0f172a", border:"1px solid rgba(255,255,255,0.12)", borderRadius:isMobile?"16px 16px 0 0":"16px", width:isMobile?"100%":"600px", maxHeight:isMobile?"90vh":"85vh", overflowY:"auto", padding:"20px" }}>

        {/* 헤더 */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"16px" }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
              <div style={{ width:"10px", height:"10px", borderRadius:"3px", background:MARKET_COLOR[holding.market] }}/>
              <span style={{ fontSize:"22px", fontWeight:800, letterSpacing:"-0.04em" }}>{holding.ticker}</span>
              <span style={{ fontSize:"13px", color:"#64748b" }}>{MARKET_LABEL[holding.market]}</span>
              {holding.broker && <span style={{ fontSize:"11px", background:"rgba(99,102,241,0.15)", color:"#a5b4fc", padding:"2px 8px", borderRadius:"20px", fontWeight:700 }}>{holding.broker}</span>}
            </div>
            {holding.name && <div style={{ fontSize:"14px", color:"#cbd5e1", marginTop:"4px" }}>{holding.name}</div>}
          </div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.08)", border:"none", color:"#94a3b8", cursor:"pointer", fontSize:"18px", borderRadius:"8px", width:"32px", height:"32px", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
        </div>

        {/* 현재가 & 손익 */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"8px", marginBottom:"16px" }}>
          {[
            ["현재가", cur==="KRW"?Math.round(currentPrice).toLocaleString("ko-KR")+"₩":"$"+currentPrice.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}), "#f8fafc"],
            ["수익률", (pnlPct>=0?"+":"")+pnlPct.toFixed(2)+"%", pnlPct>=0?"#34d399":"#f87171"],
            ["평가손익", (pnlAmt>=0?"+":"")+Math.round(pnlAmt).toLocaleString()+(cur==="KRW"?"₩":"$"), pnlAmt>=0?"#34d399":"#f87171"],
          ].map(([l,v,c])=>(
            <div key={l} style={{ background:"rgba(255,255,255,0.05)", borderRadius:"10px", padding:"10px 12px" }}>
              <div style={{ fontSize:"11px", color:"#64748b", marginBottom:"4px", fontWeight:700 }}>{l}</div>
              <div style={{ fontSize:"16px", fontWeight:800, color:c, letterSpacing:"-0.02em" }}>{v}</div>
            </div>
          ))}
        </div>

        {/* 주가 차트 */}
        <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:"12px", padding:"14px", marginBottom:"16px" }}>
          <div style={{ fontSize:"13px", fontWeight:700, color:"#94a3b8", marginBottom:"10px" }}>📈 최근 3개월 주가 추이</div>
          {loading ? (
            <div style={{ textAlign:"center", padding:"30px", color:"#475569", fontSize:"13px" }}>차트 불러오는 중...</div>
          ) : history.length < 2 ? (
            <div style={{ textAlign:"center", padding:"30px", color:"#475569", fontSize:"13px" }}>차트 데이터를 불러올 수 없습니다</div>
          ) : (
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width:"100%", height:"auto", display:"block" }}>
              {/* 배경 그리드 */}
              {[0.25,0.5,0.75].map(r=>(
                <line key={r} x1={pad.l} y1={pad.t+(H-pad.t-pad.b)*r} x2={W-pad.r} y2={pad.t+(H-pad.t-pad.b)*r} stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
              ))}
              {/* 채우기 */}
              <polygon points={`${pts} ${closePts}`} fill={fillColor}/>
              {/* 라인 */}
              <polyline points={pts} fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
              {/* 마지막 점 */}
              {history.length > 0 && (()=>{
                const lx = pad.l + (W-pad.l-pad.r);
                const ly = pad.t + (1-(history[history.length-1].price-minP)/(maxP-minP||1))*(H-pad.t-pad.b);
                return <circle cx={lx} cy={ly} r="3" fill={lineColor}/>;
              })()}
              {/* 최저/최고 라벨 */}
              <text x={pad.l+2} y={pad.t+10} fontSize="9" fill="#64748b">{cur==="KRW"?Math.round(maxP).toLocaleString()+"₩":"$"+maxP.toFixed(2)}</text>
              <text x={pad.l+2} y={H-pad.b-2} fontSize="9" fill="#64748b">{cur==="KRW"?Math.round(minP).toLocaleString()+"₩":"$"+minP.toFixed(2)}</text>
              {/* 날짜 라벨 */}
              {[0, Math.floor(history.length/2), history.length-1].map(i=>{
                if(!history[i]) return null;
                const x = pad.l + (i/(history.length-1||1))*(W-pad.l-pad.r);
                return <text key={i} x={x} y={H-4} fontSize="9" fill="#475569" textAnchor="middle">{history[i].date}</text>;
              })}
            </svg>
          )}
        </div>

        {/* 종목 정보 */}
        <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:"12px", padding:"14px", marginBottom:"16px" }}>
          <div style={{ fontSize:"13px", fontWeight:700, color:"#94a3b8", marginBottom:"10px" }}>📋 종목 정보</div>
          {loading ? (
            <div style={{ textAlign:"center", padding:"16px", color:"#475569", fontSize:"13px" }}>불러오는 중...</div>
          ) : (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px" }}>
              {[
                ["보유수량", holding.quantity.toLocaleString()+"주"],
                ["평균매수가", cur==="KRW"?Math.round(holding.avgPrice).toLocaleString("ko-KR")+"₩":"$"+holding.avgPrice.toFixed(2)],
                ["총 매수금액", cur==="KRW"?Math.round(holding.avgPrice*holding.quantity).toLocaleString("ko-KR")+"₩":"$"+(holding.avgPrice*holding.quantity).toFixed(0)],
                ["일 변동", price?.changePercent!=null?(price.changePercent>=0?"+":"")+price.changePercent.toFixed(2)+"%" : "-"],
                ...infoItems
              ].map(([l,v])=>(
                <div key={l} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 10px", background:"rgba(255,255,255,0.03)", borderRadius:"8px" }}>
                  <span style={{ fontSize:"12px", color:"#64748b" }}>{l}</span>
                  <span style={{ fontSize:"13px", fontWeight:600, color:"#e2e8f0", textAlign:"right", maxWidth:"55%" }}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}




// ── Overview 카드 컴포넌트 ───────────────────────────────────────────────────
function OverviewCard({ title, subtitle, items, prices, liveUsdKrw, color, onClick, isMobile }) {
  const toKRWL = (v, cur) => cur === "KRW" ? v : v * liveUsdKrw;
  const fmtK   = (v) => {
    const n = Math.abs(Math.round(v));
    if (n >= 100000000) return (Math.round(v/100000000*10)/10).toLocaleString("ko-KR") + "억₩";
    if (n >= 10000)     return (Math.round(v/10000)).toLocaleString("ko-KR") + "만₩";
    return Math.round(v).toLocaleString("ko-KR") + "₩";
  };

  const portfolio = items.map(h => {
    const p   = prices[h.ticker];
    const cur = h.market === "US" ? "USD"
      : h.market === "ETF" && !h.ticker.includes(".KS") && !h.ticker.includes(".KQ") ? "USD"
      : "KRW";
    const price  = p?.price ?? h.avgPrice;
    const value  = price * h.quantity;
    const cost   = h.avgPrice * h.quantity;
    return { ...h, value, cost, cur, hasLive: !!p };
  });

  const totalVal  = portfolio.reduce((s, h) => s + toKRWL(h.value, h.cur), 0);
  const totalCost = portfolio.reduce((s, h) => s + toKRWL(h.cost,  h.cur), 0);
  const totalPnL  = totalVal - totalCost;
  const pnlPct    = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;
  const isUp      = pnlPct >= 0;

  if (items.length === 0) return null;

  return (
    <div onClick={onClick} style={{
      background: `rgba(${color},0.07)`,
      border: `1px solid rgba(${color},0.25)`,
      borderRadius:"14px", padding:"16px",
      cursor: onClick ? "pointer" : "default",
      transition:"all 0.15s",
    }}
    onMouseEnter={e=>{ if(onClick) e.currentTarget.style.background=`rgba(${color},0.13)`; }}
    onMouseLeave={e=>{ if(onClick) e.currentTarget.style.background=`rgba(${color},0.07)`; }}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"12px"}}>
        <div>
          <div style={{fontSize:"15px",fontWeight:800,color:"#f1f5f9",letterSpacing:"-0.03em"}}>{title}</div>
          {subtitle&&<div style={{fontSize:"11px",color:"#64748b",marginTop:"2px"}}>{subtitle}</div>}
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:isMobile?"13px":"16px",fontWeight:800,color:"#f8fafc",letterSpacing:"-0.03em"}}>{fmtK(totalVal)}</div>
          <div style={{fontSize:"13px",fontWeight:700,color:isUp?"#34d399":"#f87171",marginTop:"2px"}}>
            {isUp?"+":""}{fmtK(totalPnL)} ({isUp?"+":""}{pnlPct.toFixed(2)}%)
          </div>
        </div>
      </div>
      {/* 비중 바 */}
      <div style={{background:"rgba(255,255,255,0.08)",borderRadius:"4px",height:"6px",overflow:"hidden",marginBottom:"10px"}}>
        <div style={{width:Math.min(Math.abs(pnlPct)*2+50,100)+"%",height:"100%",background:isUp?"#34d399":"#f87171",borderRadius:"4px"}}/>
      </div>
      {/* 종목 수 + 수익 종목 */}
      <div style={{display:"flex",justifyContent:"space-between",fontSize:"12px",color:"#64748b"}}>
        <span>{items.length}종목</span>
        <span style={{color:"#34d399"}}>▲{portfolio.filter(h=>{
          const p2=prices[h.ticker]; const cur=h.market==="US"?"USD":"KRW";
          const v=((p2?.price??h.avgPrice)*h.quantity); const c=h.avgPrice*h.quantity;
          return v>c;
        }).length}</span>
        <span style={{color:"#f87171"}}>▼{portfolio.filter(h=>{
          const p2=prices[h.ticker]; const cur=h.market==="US"?"USD":"KRW";
          const v=((p2?.price??h.avgPrice)*h.quantity); const c=h.avgPrice*h.quantity;
          return v<c;
        }).length}</span>
        {onClick&&<span style={{color:`rgb(${color})`,fontWeight:700}}>상세 →</span>}
      </div>
    </div>
  );
}


// ── Overview 카드 컴포넌트 ───────────────────────────────────────────────────
function OverviewCard({ title, subtitle, totalVal, totalCost, items, color, onClick, isMobile }) {
  const fmtK = (v) => {
    if (v >= 1e8) return (v/1e8).toFixed(1)+"억₩";
    if (v >= 1e4) return Math.round(v/1e4)+"만₩";
    return Math.round(v).toLocaleString("ko-KR")+"₩";
  };
  const pnl = totalVal - totalCost;
  const ret = totalCost > 0 ? ((pnl/totalCost)*100) : 0;
  const isUp = ret >= 0;
  const topItems = [...items].sort((a,b)=>b.value-a.value).slice(0,3);
  return (
    <div onClick={onClick} style={{background:"rgba(255,255,255,0.04)",border:`1px solid ${color}33`,borderRadius:"14px",padding:"16px",cursor:"pointer",transition:"all 0.15s",position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",top:0,left:0,right:0,height:"3px",background:color,borderRadius:"14px 14px 0 0"}}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"12px"}}>
        <div>
          <div style={{fontSize:"14px",fontWeight:800,color:"#f8fafc",letterSpacing:"-0.02em"}}>{title}</div>
          {subtitle && <div style={{fontSize:"11px",color:"#64748b",marginTop:"2px"}}>{subtitle}</div>}
        </div>
        <div style={{fontSize:"11px",color:"#64748b",background:"rgba(255,255,255,0.06)",padding:"2px 8px",borderRadius:"20px"}}>{items.length}종목</div>
      </div>
      <div style={{marginBottom:"10px"}}>
        <div style={{fontSize:"20px",fontWeight:800,color:"#f8fafc",letterSpacing:"-0.04em"}}>{fmtK(totalVal)}</div>
        <div style={{display:"flex",alignItems:"center",gap:"8px",marginTop:"3px"}}>
          <span style={{fontSize:"13px",fontWeight:700,color:isUp?"#34d399":"#f87171"}}>{isUp?"+":""}{ret.toFixed(2)}%</span>
          <span style={{fontSize:"12px",color:"#64748b"}}>{isUp?"+":""}{fmtK(Math.abs(pnl))}</span>
        </div>
      </div>
      {/* 미니 바 */}
      <div style={{background:"rgba(255,255,255,0.06)",borderRadius:"4px",height:"6px",overflow:"hidden",marginBottom:"10px"}}>
        <div style={{width:Math.min(Math.abs(ret)/20*100,100).toFixed(1)+"%",height:"100%",background:isUp?"#34d399":"#f87171",borderRadius:"4px"}}/>
      </div>
      {/* 상위 3종목 */}
      {topItems.length > 0 && (
        <div style={{display:"flex",gap:"4px",flexWrap:"wrap"}}>
          {topItems.map(h=>(
            <span key={h.id||h.ticker} style={{fontSize:"11px",background:"rgba(255,255,255,0.07)",color:"#94a3b8",padding:"2px 8px",borderRadius:"20px"}}>{h.ticker}</span>
          ))}
          {items.length > 3 && <span style={{fontSize:"11px",color:"#475569"}}>+{items.length-3}</span>}
        </div>
      )}
      <div style={{position:"absolute",bottom:"12px",right:"14px",fontSize:"11px",color:"#475569"}}>상세보기 →</div>
    </div>
  );
}

// ── 전체 현황 Overview ────────────────────────────────────────────────────────
function OverviewPanel({ portfolio, portfolio2, holdings, holdings2, prices, snapshots, liveUsdKrw, isMobile, onSelectAccount, setSelectedStock }) {
  const [viewMode, setViewMode] = useState("account"); // account | broker | region
  const toKRWL = (v, cur) => cur === "KRW" ? v : v * liveUsdKrw;
  const fmtK   = (v) => v >= 1e8 ? (v/1e8).toFixed(1)+"억₩" : v >= 1e4 ? Math.round(v/1e4)+"만₩" : Math.round(v).toLocaleString("ko-KR")+"₩";
  const fmtP   = (n) => (n>=0?"+":"")+n.toFixed(2)+"%";

  const allItems = [...portfolio, ...portfolio2];
  const totalVal  = allItems.reduce((s,h)=>s+toKRWL(h.value,h.cur),0);
  const totalCost = allItems.reduce((s,h)=>s+toKRWL(h.cost, h.cur),0);
  const totalPnL  = totalVal - totalCost;
  const totalRet  = totalCost > 0 ? (totalPnL/totalCost)*100 : 0;

  const snap = [...(snapshots||[])].sort((a,b)=>(a.id||0)-(b.id||0)).slice(-14);

  // 계좌별 그룹
  const ACCOUNT_GROUPS = [
    { key:"p1", title:"포트폴리오1", subtitle:"주식·코인·금현물", color:"#6366f1", items: portfolio },
    { key:"연금저축1(신한금융투자)", title:"연금저축1", subtitle:"신한금융투자", color:"#06b6d4",
      items: portfolio2.filter(h=>h.taxAccount==="연금저축1(신한금융투자)") },
    { key:"연금저축2(미래에셋증권)", title:"연금저축2", subtitle:"미래에셋증권", color:"#10b981",
      items: portfolio2.filter(h=>h.taxAccount==="연금저축2(미래에셋증권)") },
    { key:"IRP(미래에셋증권)", title:"IRP", subtitle:"미래에셋증권", color:"#f59e0b",
      items: portfolio2.filter(h=>h.taxAccount==="IRP(미래에셋증권)") },
  ].filter(g => g.items.length > 0);

  // 증권사별 그룹
  const brokerMap = {};
  allItems.forEach(h => {
    const b = h.broker || h.taxAccount || "미분류";
    if (!brokerMap[b]) brokerMap[b] = [];
    brokerMap[b].push(h);
  });
  const BROKER_GROUPS = Object.entries(brokerMap).map(([broker, items]) => ({
    key: broker, title: broker, color: "#818cf8", items
  }));

  // 국내/해외별
  const domestic = allItems.filter(h => h.market==="KR" || h.market==="ISA" || h.market==="GOLD");
  const overseas = allItems.filter(h => h.market==="US" || h.market==="ETF");
  const crypto   = allItems.filter(h => h.market==="CRYPTO");
  const REGION_GROUPS = [
    { key:"domestic", title:"국내 주식", subtitle:"KR · ISA · 금현물", color:"#6366f1", items: domestic },
    { key:"overseas", title:"해외 주식", subtitle:"미국 · ETF", color:"#10b981", items: overseas },
    { key:"crypto",   title:"암호화폐",  subtitle:"BTC · ETH 등", color:"#a855f7", items: crypto },
  ].filter(g => g.items.length > 0);

  const getGroups = () => {
    if (viewMode==="broker") return BROKER_GROUPS;
    if (viewMode==="region") return REGION_GROUPS;
    return ACCOUNT_GROUPS;
  };

  const W = isMobile?300:460, H=80, pad={t:6,r:6,b:16,l:6};
  const minP = snap.length ? Math.min(...snap.map(d=>d.returnRate)) : 0;
  const maxP = snap.length ? Math.max(...snap.map(d=>d.returnRate)) : 1;
  const pts = snap.map((d,i)=>{
    const x = pad.l+(i/(snap.length-1||1))*(W-pad.l-pad.r);
    const y = pad.t+(1-(d.returnRate-minP)/(maxP-minP||1))*(H-pad.t-pad.b);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const chartUp = snap.length>1 && snap[snap.length-1].returnRate >= snap[0].returnRate;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
      {/* 전체 요약 */}
      <div style={{background:"linear-gradient(135deg,rgba(99,102,241,0.12),rgba(16,185,129,0.08))",border:"1px solid rgba(99,102,241,0.25)",borderRadius:"16px",padding:"20px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"14px",flexWrap:"wrap",gap:"8px"}}>
          <div>
            <div style={{fontSize:"13px",color:"#64748b",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:"4px"}}>전체 포트폴리오</div>
            <div style={{fontSize:isMobile?"24px":"30px",fontWeight:800,color:"#f8fafc",letterSpacing:"-0.05em"}}>{fmtK(totalVal)}</div>
            <div style={{display:"flex",alignItems:"center",gap:"10px",marginTop:"5px",flexWrap:"wrap"}}>
              <span style={{fontSize:"15px",fontWeight:700,color:totalRet>=0?"#34d399":"#f87171"}}>{fmtP(totalRet)}</span>
              <span style={{fontSize:"13px",color:"#64748b"}}>{totalRet>=0?"+":""}{fmtK(Math.abs(totalPnL))}</span>
              <span style={{fontSize:"12px",color:"#475569"}}>{allItems.length}종목</span>
            </div>
          </div>
          {snap.length >= 2 && (
            <svg viewBox={`0 0 ${W} ${H}`} style={{width:isMobile?"140px":"180px",height:"60px"}}>
              <polyline points={pts} fill="none" stroke={chartUp?"#34d399":"#f87171"} strokeWidth="2" strokeLinejoin="round"/>
              {(()=>{const lx=pad.l+(W-pad.l-pad.r);const ly=pad.t+(1-(snap[snap.length-1].returnRate-minP)/(maxP-minP||1))*(H-pad.t-pad.b);return <circle cx={lx.toFixed(1)} cy={ly.toFixed(1)} r="3" fill={chartUp?"#34d399":"#f87171"}/>;})()}
            </svg>
          )}
        </div>
        {/* 전체 자산 비중 스택 바 */}
        {allItems.length > 0 && (()=>{
          const MK = {KR:"#6366f1",ISA:"#06b6d4",US:"#10b981",ETF:"#f59e0b",CRYPTO:"#a855f7",GOLD:"#eab308"};
          const mkVals = {};
          allItems.forEach(h=>{ mkVals[h.market]=(mkVals[h.market]||0)+toKRWL(h.value,h.cur); });
          const tot = Object.values(mkVals).reduce((s,v)=>s+v,0);
          return (
            <div>
              <div style={{display:"flex",height:"12px",borderRadius:"6px",overflow:"hidden",gap:"2px",marginBottom:"8px"}}>
                {Object.entries(mkVals).sort((a,b)=>b[1]-a[1]).map(([mk,val])=>(
                  <div key={mk} title={mk} style={{flex:val,background:MK[mk]||"#64748b"}}/>
                ))}
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:"8px"}}>
                {Object.entries(mkVals).sort((a,b)=>b[1]-a[1]).map(([mk,val])=>(
                  <span key={mk} style={{fontSize:"11px",color:"#94a3b8",display:"flex",alignItems:"center",gap:"4px"}}>
                    <span style={{width:"7px",height:"7px",borderRadius:"2px",background:MK[mk]||"#64748b",display:"inline-block"}}/>
                    {mk} <span style={{color:"#e2e8f0",fontWeight:700}}>{((val/tot)*100).toFixed(0)}%</span>
                  </span>
                ))}
              </div>
            </div>
          );
        })()}
      </div>

      {/* 뷰 모드 선택 */}
      <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
        {[["account","🏦 계좌별"],["broker","💼 증권사별"],["region","🌏 국내·해외별"]].map(([mode,label])=>(
          <button key={mode} onClick={()=>setViewMode(mode)} style={{background:viewMode===mode?"rgba(99,102,241,0.3)":"rgba(255,255,255,0.05)",border:viewMode===mode?"1px solid rgba(99,102,241,0.5)":"1px solid rgba(255,255,255,0.08)",color:viewMode===mode?"#c7d2fe":"#64748b",padding:"7px 14px",borderRadius:"20px",cursor:"pointer",fontSize:"13px",fontWeight:viewMode===mode?700:500}}>
            {label}
          </button>
        ))}
      </div>

      {/* 그룹 카드 그리드 */}
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(2,1fr)",gap:"12px"}}>
        {getGroups().map(g => {
          const gVal  = g.items.reduce((s,h)=>s+toKRWL(h.value,h.cur),0);
          const gCost = g.items.reduce((s,h)=>s+toKRWL(h.cost, h.cur),0);
          return (
            <OverviewCard
              key={g.key}
              title={g.title}
              subtitle={g.subtitle}
              totalVal={gVal}
              totalCost={gCost}
              items={g.items}
              color={g.color}
              isMobile={isMobile}
              onClick={()=>onSelectAccount({title:g.title+(g.subtitle?" ("+g.subtitle+")":""), items:g.items.map(h=>({...h,id:h.id||Math.random()}))})}
            />
          );
        })}
      </div>

      {/* 수익률 TOP/BOTTOM */}
      {allItems.length > 0 && (
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:"12px"}}>
          {[["🏆 수익률 TOP 5", [...allItems].sort((a,b)=>b.pnlPct-a.pnlPct).slice(0,5), true],
            ["📉 손실 TOP 5",  [...allItems].sort((a,b)=>a.pnlPct-b.pnlPct).slice(0,5), false]
          ].map(([title, items, isTop])=>(
            <div key={title} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"14px",padding:"16px"}}>
              <div style={{fontSize:"14px",fontWeight:800,marginBottom:"12px",letterSpacing:"-0.02em"}}>{title}</div>
              <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                {items.filter(h=>isTop?h.pnlPct>0:h.pnlPct<0).map((h,i)=>(
                  <div key={h.id||h.ticker} style={{display:"grid",gridTemplateColumns:"24px 1fr 70px",alignItems:"center",gap:"8px",cursor:"pointer"}} onClick={()=>setSelectedStock(h)}>
                    <span style={{fontSize:"12px",color:"#475569",fontWeight:700,textAlign:"center"}}>{i+1}</span>
                    <div>
                      <div style={{fontSize:"13px",fontWeight:700,color:"#a5b4fc"}}>{h.ticker}</div>
                      <div style={{fontSize:"11px",color:"#64748b"}}>{h.name||""}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:"13px",fontWeight:800,color:h.pnlPct>=0?"#34d399":"#f87171"}}>{h.pnlPct>=0?"+":""}{h.pnlPct.toFixed(2)}%</div>
                    </div>
                  </div>
                ))}
                {items.filter(h=>isTop?h.pnlPct>0:h.pnlPct<0).length===0&&(
                  <div style={{textAlign:"center",padding:"16px",color:"#475569",fontSize:"13px"}}>해당 없음</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 납입 현황 바 컴포넌트 ─────────────────────────────────────────────────────
function ContribProgressBar({ taxAccounts, holdings2, prices, liveUsdKrw, contribLimits, contribAmounts, onOpenSettings, isMobile }) {
  const toKRWL = (v, cur) => cur === "KRW" ? v : v * liveUsdKrw;
  const now = new Date();
  const yearPct = ((now.getMonth() * 30 + now.getDate()) / 365 * 100);
  const DEFAULTS = {
    "연금저축1(신한금융투자)": 9000000,
    "연금저축2(미래에셋증권)":  6000000,
    "IRP(미래에셋증권)":        3000000,
    "ISA":                      20000000,
  };
  const ALL_ACCOUNTS = [...taxAccounts, "ISA"];
  const getISAHoldings = () => holdings2 ? [] : []; // ISA는 포트폴리오1에서 관리

  return (
    <div style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(234,179,8,0.2)",borderRadius:"14px",padding:"18px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"16px",flexWrap:"wrap",gap:"8px"}}>
        <div>
          <div style={{fontSize:"15px",fontWeight:800,letterSpacing:"-0.03em"}}>💰 연간 납입 현황</div>
          <div style={{fontSize:"12px",color:"#64748b",marginTop:"3px"}}>올해 경과: {yearPct.toFixed(0)}% ({now.getMonth()+1}/{now.getDate()})</div>
        </div>
        <button onClick={onOpenSettings} style={{background:"rgba(234,179,8,0.15)",border:"1px solid rgba(234,179,8,0.35)",color:"#eab308",padding:"6px 14px",borderRadius:"8px",cursor:"pointer",fontSize:"13px",fontWeight:700}}>⚙️ 납입액 설정</button>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
        {taxAccounts.map(acc => {
          const limit  = contribLimits[acc]  ?? DEFAULTS[acc] ?? 0;
          const amount = contribAmounts[acc] ?? 0;
          const pct    = limit > 0 ? Math.min((amount / limit) * 100, 100) : 0;
          const remaining = Math.max(limit - amount, 0);
          const isAhead = pct >= yearPct;
          return (
            <div key={acc}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"6px",flexWrap:"wrap",gap:"4px"}}>
                <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                  <span style={{fontSize:"13px",fontWeight:700,color:"#e2e8f0"}}>{acc.replace("(신한금융투자)","").replace("(미래에셋증권)","")}</span>
                  <span style={{fontSize:"10px",color:"#64748b"}}>{acc.includes("(")?acc.split("(")[1]?.replace(")",""):""}</span>
                  <span style={{fontSize:"11px",background:isAhead?"rgba(52,211,153,0.15)":"rgba(245,158,11,0.15)",color:isAhead?"#34d399":"#f59e0b",padding:"1px 7px",borderRadius:"20px",fontWeight:700}}>
                    {pct.toFixed(1)}%
                  </span>
                </div>
                <span style={{fontSize:"12px",color:"#64748b"}}>{amount.toLocaleString("ko-KR")}₩ / {limit.toLocaleString("ko-KR")}₩</span>
              </div>
              <div style={{background:"rgba(255,255,255,0.07)",borderRadius:"6px",height:"14px",overflow:"hidden",position:"relative"}}>
                <div style={{position:"absolute",left:yearPct.toFixed(1)+"%",top:0,bottom:0,width:"2px",background:"rgba(255,255,255,0.35)",zIndex:2}}/>
                <div style={{width:pct.toFixed(1)+"%",height:"100%",background:pct>=100?"#34d399":isAhead?"#34d399":"#f59e0b",borderRadius:"6px",transition:"width 0.4s"}}/>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:"4px"}}>
                <span style={{fontSize:"10px",color:"#475569"}}>잔여: {remaining.toLocaleString("ko-KR")}₩</span>
                <span style={{fontSize:"10px",color:"#475569"}}>한도: {(limit/10000).toFixed(0)}만₩/년</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 계좌 상세 모달 ────────────────────────────────────────────────────────────
function AccountDetail({ title, items, prices, snapshots, onClose, isMobile, liveUsdKrw, isISA }) {
  const toKRWL = (v, cur) => cur === "KRW" ? v : v * liveUsdKrw;
  const fmtK = (v) => Math.round(v).toLocaleString("ko-KR") + "₩";
  const fmtP = (n) => (n >= 0 ? "+" : "") + Number(n).toFixed(2) + "%";

  const portfolio = items.map(h => {
    const p   = prices[h.ticker];
    const cur = h.market === "US" ? "USD"
      : h.market === "ETF" && !h.ticker.includes(".KS") && !h.ticker.includes(".KQ") ? "USD"
      : "KRW";
    const price  = p?.price ?? h.avgPrice;
    const value  = price * h.quantity;
    const cost   = h.avgPrice * h.quantity;
    const pnl    = value - cost;
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
    return { ...h, price, value, cost, pnl, pnlPct, cur, chgPct: p?.changePercent ?? 0, hasLive: !!p };
  });

  const totalVal  = portfolio.reduce((s, h) => s + toKRWL(h.value, h.cur), 0);
  const totalCost = portfolio.reduce((s, h) => s + toKRWL(h.cost,  h.cur), 0);
  const totalPnL  = totalVal - totalCost;
  const totalRet  = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;

  // 시장별 파이 데이터
  const COLORS = { KR:"#6366f1", ISA:"#06b6d4", US:"#10b981", ETF:"#f59e0b", CRYPTO:"#a855f7", GOLD:"#eab308" };
  const LABELS = { KR:"한국주식", ISA:"ISA", US:"미국주식", ETF:"ETF", CRYPTO:"코인", GOLD:"금" };
  const pieData = Object.keys(LABELS).map(k => ({
    name: LABELS[k], color: COLORS[k],
    value: Math.round(portfolio.filter(h => h.market === k).reduce((s, h) => s + toKRWL(h.value, h.cur), 0))
  })).filter(d => d.value > 0);
  const pieTotal = pieData.reduce((s, d) => s + d.value, 0);

  // 스냅샷 (해당 계좌의 것만 - 지금은 전체 공유, 추후 분리 가능)
  const snap = [...(snapshots||[])].sort((a,b)=>(a.id||0)-(b.id||0)).slice(-20);

  const W = isMobile ? 320 : 480, H = 120, pad = {t:8,r:8,b:20,l:8};
  const minP = snap.length ? Math.min(...snap.map(d=>d.returnRate)) : 0;
  const maxP = snap.length ? Math.max(...snap.map(d=>d.returnRate)) : 1;
  const pts  = snap.map((d,i) => {
    const x = pad.l + (i/(snap.length-1||1))*(W-pad.l-pad.r);
    const y = pad.t + (1-(d.returnRate-minP)/(maxP-minP||1))*(H-pad.t-pad.b);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const isUp = snap.length > 1 && snap[snap.length-1].returnRate >= snap[0].returnRate;

  return (
    <div style={{position:"fixed",inset:0,zIndex:300,display:"flex",alignItems:isMobile?"flex-end":"center",justifyContent:"center",background:"rgba(0,0,0,0.65)",backdropFilter:"blur(4px)"}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0f172a",border:"1px solid rgba(255,255,255,0.12)",borderRadius:isMobile?"16px 16px 0 0":"16px",width:isMobile?"100%":"560px",maxHeight:isMobile?"92vh":"88vh",overflowY:"auto",padding:"22px"}}>

        {/* 헤더 */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"18px"}}>
          <div>
            <div style={{fontSize:"20px",fontWeight:800,letterSpacing:"-0.04em",color:"#f8fafc"}}>{title}</div>
            <div style={{fontSize:"13px",color:"#64748b",marginTop:"3px"}}>{portfolio.length}종목</div>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.08)",border:"none",color:"#94a3b8",cursor:"pointer",fontSize:"18px",borderRadius:"8px",width:"32px",height:"32px",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>

        {/* 요약 카드 3개 */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"8px",marginBottom:"16px"}}>
          {[["총 평가금액",fmtK(totalVal),"#f8fafc"],["평가 손익",(totalPnL>=0?"+":"")+fmtK(totalPnL),totalPnL>=0?"#34d399":"#f87171"],["수익률",fmtP(totalRet),totalRet>=0?"#34d399":"#f87171"]].map(([l,v,c])=>(
            <div key={l} style={{background:"rgba(255,255,255,0.05)",borderRadius:"10px",padding:"10px 12px"}}>
              <div style={{fontSize:"11px",color:"#64748b",marginBottom:"4px",fontWeight:700}}>{l}</div>
              <div style={{fontSize:"16px",fontWeight:800,color:c,letterSpacing:"-0.03em"}}>{v}</div>
            </div>
          ))}
        </div>

        {/* 수익률 추이 차트 */}
        {snap.length >= 2 && (
          <div style={{background:"rgba(255,255,255,0.03)",borderRadius:"12px",padding:"14px",marginBottom:"14px"}}>
            <div style={{fontSize:"13px",fontWeight:700,color:"#94a3b8",marginBottom:"10px"}}>📈 수익률 추이</div>
            <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"auto",display:"block"}}>
              {[0.25,0.5,0.75].map(r=>(
                <line key={r} x1={pad.l} y1={pad.t+(H-pad.t-pad.b)*r} x2={W-pad.r} y2={pad.t+(H-pad.t-pad.b)*r} stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
              ))}
              <polyline points={pts} fill="none" stroke={isUp?"#34d399":"#f87171"} strokeWidth="2" strokeLinejoin="round"/>
              {snap.length > 0 && (()=>{
                const lx = pad.l + (W-pad.l-pad.r);
                const ly = pad.t + (1-(snap[snap.length-1].returnRate-minP)/(maxP-minP||1))*(H-pad.t-pad.b);
                return <circle cx={lx.toFixed(1)} cy={ly.toFixed(1)} r="3" fill={isUp?"#34d399":"#f87171"}/>;
              })()}
              <text x={pad.l+2} y={pad.t+10} fontSize="9" fill="#64748b">{maxP.toFixed(1)}%</text>
              <text x={pad.l+2} y={H-pad.b-2} fontSize="9" fill="#64748b">{minP.toFixed(1)}%</text>
            </svg>
          </div>
        )}

        {/* 자산 배분 */}
        {pieData.length > 0 && (
          <div style={{background:"rgba(255,255,255,0.03)",borderRadius:"12px",padding:"14px",marginBottom:"14px"}}>
            <div style={{fontSize:"13px",fontWeight:700,color:"#94a3b8",marginBottom:"10px"}}>🥧 자산 배분</div>
            <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
              {pieData.map(d=>(
                <div key={d.name} style={{display:"grid",gridTemplateColumns:"60px 1fr 80px",alignItems:"center",gap:"8px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                    <div style={{width:"8px",height:"8px",borderRadius:"2px",background:d.color,flexShrink:0}}/>
                    <span style={{fontSize:"12px",color:"#94a3b8",fontWeight:600}}>{d.name}</span>
                  </div>
                  <div style={{background:"rgba(255,255,255,0.06)",borderRadius:"4px",height:"8px",overflow:"hidden"}}>
                    <div style={{width:((d.value/pieTotal)*100).toFixed(1)+"%",height:"100%",background:d.color,borderRadius:"4px"}}/>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <span style={{fontSize:"12px",fontWeight:700,color:"#e2e8f0"}}>{((d.value/pieTotal)*100).toFixed(0)}%</span>
                    <span style={{fontSize:"11px",color:"#64748b"}}>{(d.value/10000).toFixed(0)}만</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 종목별 손익 */}
        <div style={{background:"rgba(255,255,255,0.03)",borderRadius:"12px",padding:"14px"}}>
          <div style={{fontSize:"13px",fontWeight:700,color:"#94a3b8",marginBottom:"10px"}}>📋 종목별 손익</div>
          <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
            {[...portfolio].sort((a,b)=>b.pnlPct-a.pnlPct).map(h=>(
              <div key={h.id} style={{display:"grid",gridTemplateColumns:"1fr 80px 80px",alignItems:"center",gap:"8px",padding:"8px 10px",background:"rgba(255,255,255,0.03)",borderRadius:"8px"}}>
                <div>
                  <div style={{fontWeight:700,fontSize:"14px"}}>{h.ticker}</div>
                  <div style={{fontSize:"11px",color:"#64748b"}}>{h.name||""}</div>
                </div>
                <div style={{fontSize:"13px",fontWeight:700,textAlign:"right"}}>
                  {h.cur==="KRW"?Math.round(h.price).toLocaleString("ko-KR")+"₩":"$"+h.price.toFixed(2)}
                </div>
                <div style={{fontSize:"13px",fontWeight:800,color:h.pnlPct>=0?"#34d399":"#f87171",textAlign:"right"}}>
                  {h.pnlPct>=0?"+":""}{h.pnlPct.toFixed(2)}%
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

// ── 납입 한도 관리 모달 ───────────────────────────────────────────────────────
function ContribModal({ limits, amounts, onSave, onClose, isMobile }) {
  const ACCOUNTS = [
    { key:"연금저축1(신한금융투자)", label:"연금저축1 (신한금융투자)", defaultLimit:9000000 },
    { key:"연금저축2(미래에셋증권)",  label:"연금저축2 (미래에셋증권)",  defaultLimit:6000000 },
    { key:"IRP(미래에셋증권)",        label:"IRP (미래에셋증권)",        defaultLimit:3000000 },
    { key:"ISA",                      label:"ISA 계좌",                   defaultLimit:20000000 },
  ];
  const [localLimits,  setLocalLimits]  = useState({ ...limits });
  const [localAmounts, setLocalAmounts] = useState({ ...amounts });

  const now = new Date();
  const yearPct = ((now.getMonth() * 30 + now.getDate()) / 365 * 100).toFixed(0);
  const inp = { background:"rgba(255,255,255,0.07)", border:"1.5px solid rgba(255,255,255,0.14)", color:"#f1f5f9", padding:"8px 12px", borderRadius:"8px", fontSize:"14px", width:"100%", boxSizing:"border-box", outline:"none" };

  return (
    <div style={{position:"fixed",inset:0,zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.7)",backdropFilter:"blur(4px)",padding:"20px"}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0f172a",border:"1px solid rgba(255,255,255,0.12)",borderRadius:"16px",width:isMobile?"100%":"480px",maxHeight:"88vh",overflowY:"auto",padding:"22px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"18px"}}>
          <div style={{fontSize:"18px",fontWeight:800,color:"#f8fafc",letterSpacing:"-0.03em"}}>💰 연간 납입 한도 설정</div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.08)",border:"none",color:"#94a3b8",cursor:"pointer",fontSize:"18px",borderRadius:"8px",width:"32px",height:"32px",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>
        <div style={{fontSize:"13px",color:"#64748b",marginBottom:"16px",padding:"10px 14px",background:"rgba(99,102,241,0.08)",borderRadius:"10px",lineHeight:1.7}}>
          올해 경과: <strong style={{color:"#a5b4fc"}}>{yearPct}%</strong> ({now.getMonth()+1}월 {now.getDate()}일 기준)
        </div>
        {ACCOUNTS.map(acc => {
          const limit  = localLimits[acc.key]  ?? acc.defaultLimit;
          const amount = localAmounts[acc.key] ?? 0;
          const pct    = limit > 0 ? Math.min((amount / limit) * 100, 100) : 0;
          const remaining = Math.max(limit - amount, 0);
          return (
            <div key={acc.key} style={{background:"rgba(255,255,255,0.04)",borderRadius:"12px",padding:"16px",marginBottom:"12px",border:"1px solid rgba(255,255,255,0.07)"}}>
              <div style={{fontSize:"14px",fontWeight:700,color:"#e2e8f0",marginBottom:"12px"}}>{acc.label}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginBottom:"12px"}}>
                <div>
                  <div style={{fontSize:"11px",color:"#64748b",marginBottom:"4px",fontWeight:700}}>연간 납입 한도 (원)</div>
                  <input type="number" value={limit} onChange={e=>setLocalLimits(p=>({...p,[acc.key]:+e.target.value}))} style={inp}/>
                </div>
                <div>
                  <div style={{fontSize:"11px",color:"#64748b",marginBottom:"4px",fontWeight:700}}>올해 납입 금액 (원)</div>
                  <input type="number" value={amount} onChange={e=>setLocalAmounts(p=>({...p,[acc.key]:+e.target.value}))} style={inp}/>
                </div>
              </div>
              {/* 진행 바 */}
              <div style={{marginBottom:"6px"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:"6px"}}>
                  <span style={{fontSize:"12px",color:"#94a3b8"}}>납입률 <strong style={{color:pct>=100?"#34d399":pct>=(+yearPct)?"#34d399":"#f59e0b"}}>{pct.toFixed(1)}%</strong></span>
                  <span style={{fontSize:"12px",color:"#64748b"}}>잔여 {remaining.toLocaleString("ko-KR")}원</span>
                </div>
                <div style={{background:"rgba(255,255,255,0.08)",borderRadius:"6px",height:"12px",overflow:"hidden",position:"relative"}}>
                  {/* 올해 경과 기준선 */}
                  <div style={{position:"absolute",left:yearPct+"%",top:0,bottom:0,width:"2px",background:"rgba(255,255,255,0.3)",zIndex:1}}/>
                  <div style={{width:pct+"%",height:"100%",background:pct>=100?"#34d399":pct>=(+yearPct)?"#34d399":"#f59e0b",borderRadius:"6px",transition:"width 0.3s"}}/>
                </div>
                <div style={{fontSize:"10px",color:"#475569",marginTop:"4px",textAlign:"right"}}>흰 선: 올해 경과({yearPct}%)</div>
              </div>
            </div>
          );
        })}
        <div style={{display:"flex",gap:"8px",marginTop:"8px"}}>
          <button onClick={()=>onSave(localLimits, localAmounts)} style={{flex:1,background:"#6366f1",border:"none",color:"#fff",padding:"12px",borderRadius:"10px",cursor:"pointer",fontSize:"14px",fontWeight:700}}>✓ 저장</button>
          <button onClick={onClose} style={{background:"#334155",border:"none",color:"#fff",padding:"12px 20px",borderRadius:"10px",cursor:"pointer",fontSize:"14px",fontWeight:700}}>취소</button>
        </div>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [key, setKey] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const handleLogin = async () => {
    const k = key.trim().toLowerCase().replace(/\s+/g, "-");
    if (k.length < 3) { setErr("동기화 키는 3자 이상이어야 합니다."); return; }
    if (!/^[a-z0-9\-]+$/.test(k)) { setErr("영문 소문자, 숫자, 하이픈(-)만 사용 가능합니다."); return; }
    setLoading(true);
    try {
      await window.firebaseDB.get(dbRef(`users/${k}/ping`));
      localStorage.setItem("pm_synckey", k);
      onLogin(k);
    } catch { setErr("Firebase 연결 실패. index.html 의 Firebase 설정값을 확인해주세요."); }
    setLoading(false);
  };
  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"linear-gradient(135deg,#0f172a 0%,#1e1b4b 100%)", padding:"20px" }}>
      <div style={{ ...S.card, maxWidth:"440px", width:"100%", padding:"38px" }}>
        <div style={{ textAlign:"center", marginBottom:"30px" }}>
          <div style={{ fontSize:"40px", marginBottom:"12px" }}>📈</div>
          <h1 style={{ fontSize:"24px", fontWeight:800, color:"#f8fafc", margin:"0 0 10px", letterSpacing:"-0.04em" }}>내 투자 포트폴리오</h1>
          <p style={{ fontSize:"15px", color:"#64748b", margin:0, lineHeight:1.7 }}>동기화 키를 입력하면 어느 기기에서든<br/>같은 데이터를 사용할 수 있습니다</p>
        </div>
        <label style={{ fontSize:"14px", color:"#94a3b8", display:"block", marginBottom:"8px", fontWeight:700 }}>동기화 키</label>
        <input placeholder="예: kim-portfolio-2025" value={key} onChange={e => { setKey(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && handleLogin()} style={{ ...S.inp, fontSize:"16px", marginBottom:"8px" }} autoFocus />
        <p style={{ fontSize:"13px", color:"#475569", margin:"0 0 16px", lineHeight:1.7 }}>처음이면 새로 만들어집니다. 같은 키를 다른 기기에 입력하면 동기화됩니다.</p>
        {err && <div style={{ background:"rgba(239,68,68,0.12)", border:"1px solid rgba(239,68,68,0.3)", borderRadius:"10px", padding:"12px 16px", fontSize:"14px", color:"#fca5a5", marginBottom:"16px" }}>{err}</div>}
        <button onClick={handleLogin} disabled={loading} style={{ ...S.btn(), width:"100%", padding:"14px", fontSize:"16px", opacity:loading?0.7:1 }}>{loading?"연결 중...":"시작하기 →"}</button>
        <div style={{ marginTop:"22px", padding:"16px", background:"rgba(99,102,241,0.09)", borderRadius:"12px", border:"1px solid rgba(99,102,241,0.2)" }}>
          <p style={{ fontSize:"14px", color:"#94a3b8", margin:0, lineHeight:1.8 }}>💡 <strong style={{ color:"#a5b4fc" }}>키를 꼭 기억하세요!</strong><br/>같은 키 → 핸드폰·PC 실시간 동기화</p>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const saved = localStorage.getItem("pm_synckey");
  const [syncKey, setSyncKey] = useState(saved || null);
  if (!syncKey) return <LoginScreen onLogin={setSyncKey} />;
  return <PortfolioApp syncKey={syncKey} onLogout={() => { localStorage.removeItem("pm_synckey"); setSyncKey(null); }} />;
}

function PortfolioApp({ syncKey, onLogout }) {
  const [tab, setTab]             = useState("overview");
  const [holdings, setHoldings]   = useState([]);
  const [trades, setTrades]       = useState([]);
  const [alerts, setAlerts]       = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [prices, setPrices] = useState(() => {
    try { const c = localStorage.getItem("pm_prices_cache"); return c ? JSON.parse(c) : {}; } catch { return {}; }
  });
  const [priceAge, setPriceAge] = useState(() => {
    try { return parseInt(localStorage.getItem("pm_prices_age")||"0"); } catch { return 0; }
  });
  const [loading, setLoading]     = useState(false);
  const [toasts, setToasts]       = useState([]);
  const [loaded, setLoaded]       = useState(false);
  const [showForm, setShowForm]   = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [mainTab, setMainTab]   = useState("p1"); // "p1" | "p2"
  const [overviewTab, setOverviewTab] = useState("all"); // "all"|"account"|"broker"|"market"
  const [currMode, setCurrMode] = useState("KRW");
  const [liveUsdKrw, setLiveUsdKrw] = useState(USD_KRW);
  const [selectedStock, setSelectedStock] = useState(null);
  const [sortBy, setSortBy]   = useState("default");
  const [groupBy, setGroupBy] = useState("none");
  const [holdings2, setHoldings2] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [showContrib, setShowContrib] = useState(false);
  const [contribLimits, setContribLimits] = useState(() => {
    try { const c = localStorage.getItem("pm_contrib_limits"); return c ? JSON.parse(c) : {}; } catch { return {}; }
  });
  const [contribAmounts, setContribAmounts] = useState(() => {
    try { const c = localStorage.getItem("pm_contrib_amounts"); return c ? JSON.parse(c) : {}; } catch { return {}; }
  });
  const [wForm, setWForm] = useState({ ticker:"", name:"", market:"KR", targetBuy:"", targetSell:"", memo:"" });
  const [hForm2, setHForm2] = useState({ ticker:"", name:"", market:"KR", quantity:"", avgPrice:"", taxAccount:"연금저축1(신한금융투자)", broker:"" });
  const isMobile = useIsMobile();
  const saving = useRef({});

  const [hForm, setHForm] = useState({ ticker:"", name:"", market:"KR", quantity:"", avgPrice:"", broker:"" });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ ticker:"", name:"", market:"KR", quantity:"", avgPrice:"", broker:"" });
  const [tForm, setTForm] = useState({ date:today(), ticker:"", type:"buy", quantity:"", price:"", fee:"", note:"" });
  const [aForm, setAForm] = useState({ ticker:"", direction:"down", threshold:"" });

  useEffect(() => {
    const unsubs = [];
    const attach = (path, setter, key) => {
      const u = dbOn(`users/${syncKey}/${path}`, val => {
        if (saving.current[key]) return;
        setter(val ? (Array.isArray(val) ? val : Object.values(val)) : []);
        setLoaded(true);
      });
      unsubs.push(u);
    };
    attach("holdings",  setHoldings,  "h");
    attach("trades",    setTrades,    "t");
    attach("alerts",    setAlerts,    "a");
    attach("snapshots", setSnapshots, "s");
    attach("holdings2",  setHoldings2, "h2");
    attach("watchlist",  setWatchlist, "wl");
    setTimeout(() => setLoaded(true), 2000);
    return () => unsubs.forEach(u => typeof u === "function" && u());
  }, [syncKey]);

  // 앱 시작 시 캐시된 시세 즉시 표시 (Firebase 로딩 전에도)
  useEffect(() => {
    try {
      const cached = localStorage.getItem("pm_prices_cache");
      const age    = parseInt(localStorage.getItem("pm_prices_age") || "0");
      if (cached) {
        const parsed = JSON.parse(cached);
        // 24시간 이내 캐시면 즉시 표시
        if (Date.now() - age < 86400000) {
          setPrices(parsed);
          setPriceAge(age);
        }
      }
    } catch {}
  }, []);

  // 실시간 환율 가져오기
  useEffect(() => {
    const fetchRate = async () => {
      try {
        const r = await fetch("https://api.frankfurter.app/latest?from=USD&to=KRW", { signal: AbortSignal.timeout(5000) });
        const d = await r.json();
        if (d?.rates?.KRW) {
          const rate = Math.round(d.rates.KRW);
          setLiveUsdKrw(rate);
          try { localStorage.setItem("pm_usd_krw", String(rate)); } catch {}
        }
      } catch {}
    };
    // 캐시된 환율 즉시 적용
    try {
      const cached = localStorage.getItem("pm_usd_krw");
      if (cached) setLiveUsdKrw(parseInt(cached));
    } catch {}
    fetchRate();
    const id = setInterval(fetchRate, 600000);
    return () => clearInterval(id);
  }, []);

  const saveData = useCallback((path, data, key) => {
    if (!loaded) return;
    saving.current[key] = true;
    dbSet(`users/${syncKey}/${path}`, data).finally(() => setTimeout(() => { saving.current[key] = false; }, 500));
  }, [syncKey, loaded]);

  useEffect(() => { if (loaded) saveData("holdings",  holdings.length  ? holdings  : [], "h");  }, [holdings,  loaded]);
  useEffect(() => { if (loaded) saveData("holdings2", holdings2.length ? holdings2 : [], "h2"); }, [holdings2, loaded]);
  useEffect(() => { if (loaded) saveData("watchlist",  watchlist.length  ? watchlist  : [], "wl"); }, [watchlist,  loaded]);
  useEffect(() => { if (loaded) saveData("trades",   trades.length   ? trades   : [], "t"); }, [trades,   loaded]);
  useEffect(() => { if (loaded) saveData("alerts",   alerts.length   ? alerts   : [], "a"); }, [alerts,   loaded]);

  const toast = useCallback((msg, type="info") => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(x => x.id !== id)), 7000);
  }, []);

  const fetchPrices = useCallback(async () => {
    if (!holdings.length) return;
    setLoading(true);
    const next = {};
    await Promise.all([...holdings, ...holdings2, ...watchlist].map(async h => {
      let result;
      if (h.market === "CRYPTO") {
        const raw = await fetchCrypto(h.ticker);
        if (raw) {
          result = {
            price: Math.round(raw.price * liveUsdKrw),
            changePercent: raw.changePercent,
            currency: "KRW",
          };
        }
      }
      else if (h.market === "GOLD") result = await fetchGold(liveUsdKrw);
      else {
        let tk = h.ticker;
        if ((h.market === "KR" || h.market === "ISA") && !tk.includes(".")) tk += ".KS";
        result = await fetchYahoo(tk);
      }
      if (result) next[h.ticker] = result;
    }));
    // 기존 캐시와 병합 - 새로 불러온 것만 업데이트, 실패한 것은 이전 값 유지
    setPrices(prev => {
      const merged = { ...prev, ...next };
      try {
        localStorage.setItem("pm_prices_cache", JSON.stringify(merged));
        localStorage.setItem("pm_prices_age", String(Date.now()));
      } catch {}
      return merged;
    });
    const now = new Date();
    setLastUpdated(now.toLocaleTimeString("ko-KR", { hour:"2-digit", minute:"2-digit" }));
    setPriceAge(now.getTime());

    const tv = holdings.reduce((s, h) => {
      const p = next[h.ticker];
      const cur = p?.currency || (h.market === "KR" ? "KRW" : "USD");
      return s + toKRWLive((p?.price ?? h.avgPrice) * h.quantity, cur);
    }, 0);
    const tc = holdings.reduce((s, h) => {
      const p = next[h.ticker];
      const cur = p?.currency || (h.market === "KR" ? "KRW" : "USD");
      return s + toKRWLive(h.avgPrice * h.quantity, cur);
    }, 0);
    if (tv > 0) {
      const sid = now.getTime().toString();
      const label = `${now.getMonth()+1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2,"0")}`;
      saving.current["s"] = true;
      dbSet(`users/${syncKey}/snapshots/${sid}`, {
        id: sid, label, date: today(),
        totalValue: Math.round(tv),
        returnRate: parseFloat((tc > 0 ? ((tv-tc)/tc)*100 : 0).toFixed(2))
      }).finally(() => setTimeout(() => { saving.current["s"] = false; }, 500));
    }

    // 관심종목 목표가 도달 알림
    watchlist.forEach(w => {
      const p = next[w.ticker]; if (!p) return;
      const price = p.price;
      if (w.targetBuy  && price <= +w.targetBuy)  toast(`🎯 ${w.ticker} 목표 매수가 ${Math.round(+w.targetBuy).toLocaleString()}₩ 도달!`, "up");
      if (w.targetSell && price >= +w.targetSell) toast(`🎯 ${w.ticker} 목표 매도가 ${Math.round(+w.targetSell).toLocaleString()}₩ 도달!`, "down");
    });
    alerts.filter(a => a.enabled).forEach(a => {
      const p = next[a.ticker]; if (!p) return;
      const chg = p.changePercent;
      if (a.direction === "up"   && chg >=  a.threshold) toast(`📈 ${a.ticker} +${chg.toFixed(2)}% 상승 알람!`, "up");
      if (a.direction === "down" && chg <= -a.threshold) toast(`📉 ${a.ticker} ${chg.toFixed(2)}% 하락 알람!`, "down");
    });
    setLoading(false);
  }, [holdings, alerts, toast, syncKey]);

  useEffect(() => {
    if (!loaded || !holdings.length) return;
    const ageMin = (Date.now() - priceAge) / 60000;
    let fetchTimer;
    if (ageMin > 5) {
      // 오래된 캐시 → 바로 갱신
      fetchPrices();
    } else {
      // 신선한 캐시 → 30초 뒤 백그라운드 갱신 (화면은 즉시 보임)
      fetchTimer = setTimeout(fetchPrices, 30000);
    }
    const interval = setInterval(fetchPrices, 60000);
    return () => {
      if (fetchTimer) clearTimeout(fetchTimer);
      clearInterval(interval);
    };
  }, [loaded, holdings.length > 0]);

  const marketCur = (market) => (market === "US" || market === "ETF") ? "USD" : "KRW";
  const portfolio = holdings.map(h => {
    const p   = prices[h.ticker];
    const cur = h.market === "US" ? "USD"
      : h.market === "ETF" ? (p?.currency || (h.ticker.includes(".KS")||h.ticker.includes(".KQ") ? "KRW" : "USD"))
      : "KRW"; // KR, ISA, CRYPTO, GOLD, GOLD 모두 원화
    const price = p?.price ?? h.avgPrice;
    const value = price * h.quantity;
    const cost  = h.avgPrice * h.quantity;
    const pnl   = value - cost;
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
    return { ...h, price, value, cost, pnl, pnlPct, cur, chgPct: p?.changePercent ?? 0, hasLive: !!p };
  });

  const toKRWLive = (v, cur) => cur === "KRW" ? v : v * liveUsdKrw;
  const totalCost = portfolio.reduce((s, h) => s + toKRWLive(h.cost,  h.cur), 0);
  const totalVal  = portfolio.reduce((s, h) => s + toKRWLive(h.value, h.cur), 0);
  const totalPnL  = totalVal - totalCost;
  const totalRet  = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;

  const pieData = Object.entries(MARKET_LABEL).map(([k, label]) => ({
    name: label, color: MARKET_COLOR[k],
    value: Math.round(portfolio.filter(h => h.market === k).reduce((s, h) => s + toKRWLive(h.value, h.cur), 0)),
  })).filter(d => d.value > 0);

  const snapshotList = [...snapshots].sort((a,b) => (a.id||0)-(b.id||0)).slice(-30);
  const tradePnLData = trades.map(t => ({
    name: `${t.date} ${t.ticker}`, ticker: t.ticker, type: t.type,
    pnl: t.type === "sell" ? (t.price * t.quantity - (t.fee||0)) : -(t.price * t.quantity + (t.fee||0)),
  }));

  const addH = () => {
    if (!hForm.ticker || !hForm.quantity || !hForm.avgPrice) return;
    setHoldings(p => [...p, { id: Date.now(), ...hForm, quantity: +hForm.quantity, avgPrice: +hForm.avgPrice }]);
    setHForm({ ticker:"", name:"", market:"KR", quantity:"", avgPrice:"" }); setShowForm(null);
  };
  const startEdit = (h) => {
    setEditingId(h.id);
    setEditForm({ ticker:h.ticker, name:h.name||"", market:h.market, quantity:String(h.quantity), avgPrice:String(h.avgPrice), broker:h.broker||"" });
  };
  const saveEdit = () => {
    if (!editForm.quantity || !editForm.avgPrice) return;
    setHoldings(p => p.map(x => x.id === editingId ? { ...x, ...editForm, quantity:+editForm.quantity, avgPrice:+editForm.avgPrice } : x));
    setEditingId(null);
  };
  const addT = () => {
    if (!tForm.ticker || !tForm.quantity || !tForm.price) return;
    setTrades(p => [...p, { id: Date.now(), ...tForm, quantity: +tForm.quantity, price: +tForm.price, fee: +(tForm.fee||0) }]);
    setTForm({ date:today(), ticker:"", type:"buy", quantity:"", price:"", fee:"", note:"" }); setShowForm(null);
  };
  const addH2 = () => {
    if (!hForm2.ticker || !hForm2.quantity || !hForm2.avgPrice) return;
    setHoldings2(p => [...p, { id: Date.now(), ...hForm2, quantity: +hForm2.quantity, avgPrice: +hForm2.avgPrice }]);
    setHForm2({ ticker:"", name:"", market:"KR", quantity:"", avgPrice:"", taxAccount:"연금저축1(신한금융투자)", broker:"" });
  };
  const addW = () => {
    if (!wForm.ticker) return;
    setWatchlist(p => [...p, { id: Date.now(), ...wForm }]);
    setWForm({ ticker:"", name:"", market:"KR", targetBuy:"", targetSell:"", memo:"" });
    setShowForm(null);
  };
  const addA = () => {
    if (!aForm.ticker || !aForm.threshold) return;
    setAlerts(p => [...p, { id: Date.now(), ...aForm, threshold: +aForm.threshold, enabled: true }]);
    setAForm({ ticker:"", direction:"down", threshold:"" }); setShowForm(null);
  };

  // 테이블 행 렌더러
  const renderTableRow = (h) => (
    <>
    <tr key={h.id}>
      <td style={{...S.TD,cursor:"pointer"}} onClick={()=>setSelectedStock(h)} onMouseEnter={()=>{if(!_chartCache[h.ticker]){fetchHistory(h.ticker,h.market).then(d=>{_chartCache[h.ticker]=d});fetchStockInfo(h.ticker,h.market).then(d=>{_infoCache[h.ticker]=d});} }}>
        <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
          <div style={{width:"10px",height:"10px",borderRadius:"3px",background:MARKET_COLOR[h.market],flexShrink:0}}/>
          <div>
            <div style={{fontWeight:800,fontSize:"15px",letterSpacing:"-0.03em",color:"#a5b4fc",textDecoration:"underline",textDecorationStyle:"dotted",textUnderlineOffset:"3px"}}>{h.ticker}</div>
            <div style={{fontSize:"12px",color:"#cbd5e1",fontWeight:500}}>{h.name||MARKET_LABEL[h.market]}</div>
            {h.market==="ISA"&&<div style={{fontSize:"10px",color:"#06b6d4",background:"rgba(6,182,212,0.12)",border:"1px solid rgba(6,182,212,0.3)",display:"inline-block",padding:"1px 7px",borderRadius:"4px",fontWeight:800,marginTop:"2px",letterSpacing:"0.05em"}}>ISA</div>}
                                {h.broker&&<div style={{fontSize:"11px",color:"#6366f1",background:"rgba(99,102,241,0.12)",display:"inline-block",padding:"1px 6px",borderRadius:"4px",fontWeight:700,marginTop:"2px"}}>{h.broker}</div>}
          </div>
        </div>
      </td>
      <td style={S.TD}><div style={{fontWeight:700}}>{fmtPrice(h.price,h.cur)}</div>{!h.hasLive&&<div style={{fontSize:"11px",color:"#475569"}}>매수가 기준</div>}</td>
      <td style={{...S.TD,color:h.chgPct>=0?"#34d399":"#f87171",fontWeight:800}}>{fmtPct(h.chgPct)}</td>
      <td style={S.TD}>{h.quantity.toLocaleString()}</td>
      <td style={{...S.TD,fontWeight:700}}>{currMode==="KRW"?fmtKRW(toKRWLive(h.value,h.cur)):fmtPrice(h.value,h.cur)}</td>
      <td style={{...S.TD,color:h.pnlPct>=0?"#34d399":"#f87171",fontWeight:800}}>{fmtPct(h.pnlPct)}</td>
      <td style={S.TD}>
        <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
          <button onClick={()=>editingId===h.id?setEditingId(null):startEdit(h)} style={{background:"none",border:"1px solid rgba(99,102,241,0.4)",color:"#a5b4fc",cursor:"pointer",fontSize:"12px",padding:"3px 10px",borderRadius:"6px",fontWeight:700}}>수정</button>
          <button onClick={()=>setHoldings(p=>p.filter(x=>x.id!==h.id))} style={{background:"none",border:"none",color:"#475569",cursor:"pointer",fontSize:"18px"}}>✕</button>
        </div>
      </td>
    </tr>
    {editingId===h.id&&(
      <tr key={h.id+"_edit"}>
        <td colSpan={7} style={{padding:"0 0 12px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
          <div style={{background:"rgba(99,102,241,0.08)",border:"1px solid rgba(99,102,241,0.3)",borderRadius:"10px",padding:"16px",margin:"8px 14px"}}>
            <div style={{fontSize:"13px",color:"#a5b4fc",fontWeight:700,marginBottom:"12px"}}>✏️ {h.ticker} 수정</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
              <div><div style={{fontSize:"12px",color:"#64748b",marginBottom:"4px"}}>종목명</div><input value={editForm.name} onChange={e=>setEditForm(p=>({...p,name:e.target.value}))} style={{...S.inp,fontSize:"13px",padding:"8px 10px"}}/></div>
              <div><div style={{fontSize:"12px",color:"#64748b",marginBottom:"4px"}}>시장</div><select value={editForm.market} onChange={e=>setEditForm(p=>({...p,market:e.target.value}))} style={{...S.inp,appearance:"none",fontSize:"13px",padding:"8px 10px"}}><option value="KR">한국주식</option><option value="ISA">한국주식(ISA)</option><option value="US">미국주식</option><option value="ETF">ETF</option><option value="CRYPTO">암호화폐</option><option value="GOLD">금현물</option></select></div>
              <div><div style={{fontSize:"12px",color:"#64748b",marginBottom:"4px"}}>수량</div><input type="number" value={editForm.quantity} onChange={e=>setEditForm(p=>({...p,quantity:e.target.value}))} style={{...S.inp,fontSize:"13px",padding:"8px 10px"}}/></div>
              <div><div style={{fontSize:"12px",color:"#64748b",marginBottom:"4px"}}>현재 평단가</div><input type="number" value={editForm.avgPrice} onChange={e=>setEditForm(p=>({...p,avgPrice:e.target.value}))} style={{...S.inp,fontSize:"13px",padding:"8px 10px"}}/></div>
              <div style={{gridColumn:"1/-1"}}><div style={{fontSize:"12px",color:"#64748b",marginBottom:"4px"}}>증권사</div>
              <select value={editForm.broker||""} onChange={e=>setEditForm(p=>({...p,broker:e.target.value}))} style={{...S.inp,appearance:"none",fontSize:"13px",padding:"8px 10px"}}>
                <option value="">증권사 선택</option>
                <option value="미래에셋증권">미래에셋증권</option><option value="신한금융투자">신한금융투자</option>
                <option value="토스증권">토스증권</option><option value="카카오페이증권">카카오페이증권</option>
                <option value="메리츠증권">메리츠증권</option><option value="키움증권">키움증권</option><option value="업비트">업비트</option>
              </select></div>
            </div>
            <div style={{background:"rgba(16,185,129,0.07)",border:"1px solid rgba(16,185,129,0.25)",borderRadius:"8px",padding:"14px",margin:"12px 0"}}>
              <div style={{fontSize:"13px",color:"#34d399",fontWeight:700,marginBottom:"10px"}}>➕ 추가매수 계산기</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginBottom:"10px"}}>
                <input type="number" placeholder="추가 수량" value={editForm.addQty||""} onChange={e=>{const addQty=e.target.value;const addPrice=editForm.addPrice||0;const curQty=+editForm.quantity||0;const curAvg=+editForm.avgPrice||0;const newQty=curQty+(+addQty||0);const newAvg=newQty>0?((curQty*curAvg)+((+addQty||0)*(+addPrice||0)))/newQty:curAvg;setEditForm(p=>({...p,addQty,calcQty:newQty,calcAvg:Math.round(newAvg*100)/100}));}} style={{...S.inp,fontSize:"13px",padding:"8px 10px"}}/>
                <input type="number" placeholder="추가매수 단가" value={editForm.addPrice||""} onChange={e=>{const addPrice=e.target.value;const addQty=editForm.addQty||0;const curQty=+editForm.quantity||0;const curAvg=+editForm.avgPrice||0;const newQty=curQty+(+addQty||0);const newAvg=newQty>0?((curQty*curAvg)+((+addQty||0)*(+addPrice||0)))/newQty:curAvg;setEditForm(p=>({...p,addPrice,calcQty:newQty,calcAvg:Math.round(newAvg*100)/100}));}} style={{...S.inp,fontSize:"13px",padding:"8px 10px"}}/>
              </div>
              {editForm.addQty&&editForm.addPrice&&(
                <div style={{background:"rgba(0,0,0,0.25)",borderRadius:"8px",padding:"12px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                  <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>총 수량</div><div style={{fontSize:"16px",fontWeight:800,color:"#34d399"}}>{editForm.calcQty?.toLocaleString()}주</div></div>
                  <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>새 평단가</div><div style={{fontSize:"16px",fontWeight:800,color:"#34d399"}}>{editForm.calcAvg?.toLocaleString()}</div></div>
                  <div style={{gridColumn:"1/-1"}}><button onClick={()=>setEditForm(p=>({...p,quantity:String(p.calcQty),avgPrice:String(p.calcAvg),addQty:"",addPrice:"",calcQty:undefined,calcAvg:undefined}))} style={S.btn("#10b981",{fontSize:"13px",padding:"6px 14px",width:"100%"})}>↑ 위 값으로 적용하기</button></div>
                </div>
              )}
            </div>
            <div style={{display:"flex",gap:"8px"}}>
              <button onClick={saveEdit} style={S.btn("#6366f1",{fontSize:"13px",padding:"7px 16px"})}>✓ 저장</button>
              <button onClick={()=>setEditingId(null)} style={S.btn("#475569",{fontSize:"13px",padding:"7px 16px"})}>취소</button>
            </div>
          </div>
        </td>
      </tr>
    )}
    </>
  );

  // 모바일 카드 렌더러
  const renderMobileCard = (h) => (
    <div key={h.id} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"10px",padding:"12px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"8px"}}>
        <div style={{display:"flex",alignItems:"center",gap:"8px",cursor:"pointer"}} onClick={()=>setSelectedStock(h)} onTouchStart={()=>{if(!_chartCache[h.ticker]){fetchHistory(h.ticker,h.market).then(d=>{_chartCache[h.ticker]=d});fetchStockInfo(h.ticker,h.market).then(d=>{_infoCache[h.ticker]=d});}}}>
          <div style={{width:"8px",height:"8px",borderRadius:"2px",background:MARKET_COLOR[h.market],flexShrink:0}}/>
          <div>
            <div style={{fontWeight:800,fontSize:"15px",letterSpacing:"-0.03em",color:"#a5b4fc"}}>{h.ticker} <span style={{fontSize:"11px",color:"#6366f1"}}>상세보기 ›</span></div>
            <div style={{fontSize:"12px",color:"#cbd5e1",fontWeight:500}}>{h.name||MARKET_LABEL[h.market]}</div>
            {h.broker&&<div style={{fontSize:"10px",color:"#6366f1",background:"rgba(99,102,241,0.12)",display:"inline-block",padding:"1px 5px",borderRadius:"4px",fontWeight:700,marginTop:"2px"}}>{h.broker}</div>}
          </div>
        </div>
        <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
          <button onClick={()=>editingId===h.id?setEditingId(null):startEdit(h)} style={{background:"none",border:"1px solid rgba(99,102,241,0.4)",color:"#a5b4fc",cursor:"pointer",fontSize:"11px",padding:"2px 8px",borderRadius:"6px",fontWeight:700}}>수정</button>
          <button onClick={()=>setHoldings(p=>p.filter(x=>x.id!==h.id))} style={{background:"none",border:"none",color:"#475569",cursor:"pointer",fontSize:"16px"}}>✕</button>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"6px"}}>
        <div style={{background:"rgba(0,0,0,0.2)",borderRadius:"6px",padding:"6px 8px"}}><div style={{fontSize:"10px",color:"#64748b",marginBottom:"2px"}}>현재가</div><div style={{fontSize:"13px",fontWeight:700}}>{fmtPrice(h.price,h.cur)}</div>{!h.hasLive&&<div style={{fontSize:"10px",color:"#475569"}}>매수가기준</div>}</div>
        <div style={{background:"rgba(0,0,0,0.2)",borderRadius:"6px",padding:"6px 8px"}}><div style={{fontSize:"10px",color:"#64748b",marginBottom:"2px"}}>일변동</div><div style={{fontSize:"13px",fontWeight:700,color:h.chgPct>=0?"#34d399":"#f87171"}}>{fmtPct(h.chgPct)}</div></div>
        <div style={{background:"rgba(0,0,0,0.2)",borderRadius:"6px",padding:"6px 8px"}}><div style={{fontSize:"10px",color:"#64748b",marginBottom:"2px"}}>손익률</div><div style={{fontSize:"13px",fontWeight:700,color:h.pnlPct>=0?"#34d399":"#f87171"}}>{fmtPct(h.pnlPct)}</div></div>
        <div style={{background:"rgba(0,0,0,0.2)",borderRadius:"6px",padding:"6px 8px"}}><div style={{fontSize:"10px",color:"#64748b",marginBottom:"2px"}}>수량</div><div style={{fontSize:"13px",fontWeight:700}}>{h.quantity.toLocaleString()}</div></div>
        <div style={{background:"rgba(0,0,0,0.2)",borderRadius:"6px",padding:"6px 8px",gridColumn:"2/-1"}}><div style={{fontSize:"10px",color:"#64748b",marginBottom:"2px"}}>평가금액</div><div style={{fontSize:"13px",fontWeight:700}}>{currMode==="KRW"?fmtKRW(toKRWLive(h.value,h.cur)):fmtPrice(h.value,h.cur)}</div></div>
      </div>
      {editingId===h.id&&(
        <div style={{background:"rgba(99,102,241,0.08)",border:"1px solid rgba(99,102,241,0.3)",borderRadius:"10px",padding:"12px",marginTop:"10px"}}>
          <div style={{fontSize:"13px",color:"#a5b4fc",fontWeight:700,marginBottom:"10px"}}>✏️ {h.ticker} 수정</div>
          <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
            <input placeholder="종목명" value={editForm.name} onChange={e=>setEditForm(p=>({...p,name:e.target.value}))} style={{...S.inp,fontSize:"14px",padding:"8px 10px"}}/>
            <select value={editForm.market} onChange={e=>setEditForm(p=>({...p,market:e.target.value}))} style={{...S.inp,appearance:"none",fontSize:"14px",padding:"8px 10px"}}><option value="KR">한국주식</option><option value="ISA">한국주식(ISA)</option><option value="US">미국주식</option><option value="ETF">ETF</option><option value="CRYPTO">암호화폐</option><option value="GOLD">금현물</option></select>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
              <input placeholder="수량" type="number" value={editForm.quantity} onChange={e=>setEditForm(p=>({...p,quantity:e.target.value}))} style={{...S.inp,fontSize:"14px",padding:"8px 10px"}}/>
              <input placeholder="평단가" type="number" value={editForm.avgPrice} onChange={e=>setEditForm(p=>({...p,avgPrice:e.target.value}))} style={{...S.inp,fontSize:"14px",padding:"8px 10px"}}/>
            </div>
            <select value={editForm.broker||""} onChange={e=>setEditForm(p=>({...p,broker:e.target.value}))} style={{...S.inp,appearance:"none",fontSize:"14px",padding:"8px 10px"}}>
              <option value="">증권사 선택</option>
              <option value="미래에셋증권">미래에셋증권</option><option value="신한금융투자">신한금융투자</option>
              <option value="토스증권">토스증권</option><option value="카카오페이증권">카카오페이증권</option>
              <option value="메리츠증권">메리츠증권</option><option value="키움증권">키움증권</option><option value="업비트">업비트</option>
            </select>
            <div style={{display:"flex",gap:"8px"}}>
              <button onClick={saveEdit} style={S.btn("#6366f1",{fontSize:"13px",padding:"8px",flex:1})}>✓ 저장</button>
              <button onClick={()=>setEditingId(null)} style={S.btn("#475569",{fontSize:"13px",padding:"8px",flex:1})}>취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const saveContrib = (newLimits, newAmounts) => {
    setContribLimits(newLimits);
    setContribAmounts(newAmounts);
    try {
      localStorage.setItem("pm_contrib_limits",  JSON.stringify(newLimits));
      localStorage.setItem("pm_contrib_amounts", JSON.stringify(newAmounts));
    } catch {}
    setShowContrib(false);
  };

  const FONT = "'Pretendard','Apple SD Gothic Neo','Noto Sans KR',system-ui,sans-serif";
  const tabs = [["overview","🏠 전체현황"],["portfolio","📊 포트폴리오"],["charts","📈 차트"],["trades","📝 매매일지"],["watchlist","⭐ 관심종목"],["alerts","🔔 알람"]];
  const TT = { contentStyle:{ background:"#1e293b", border:"1px solid rgba(255,255,255,0.12)", borderRadius:"10px", fontSize:"13px", fontFamily:FONT } };

  // 포트폴리오2 계산
  const portfolio2 = holdings2.map(h => {
    const p   = prices[h.ticker] || (h.market==="GOLD" ? prices["GOLD"] : null);
    const cur = h.market === "US" ? "USD"
      : h.market === "ETF" ? (p?.currency || (h.ticker.includes(".KS")||h.ticker.includes(".KQ") ? "KRW" : "USD"))
      : "KRW";
    const price = p?.price ?? h.avgPrice;
    const value = price * h.quantity;
    const cost  = h.avgPrice * h.quantity;
    const pnl   = value - cost;
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
    return { ...h, price, value, cost, pnl, pnlPct, cur, chgPct: p?.changePercent ?? 0, hasLive: !!p };
  });
  const total2Cost = portfolio2.reduce((s,h) => s + toKRWLive(h.cost,  h.cur), 0);
  const total2Val  = portfolio2.reduce((s,h) => s + toKRWLive(h.value, h.cur), 0);
  const total2PnL  = total2Val - total2Cost;
  const total2Ret  = total2Cost > 0 ? (total2PnL / total2Cost) * 100 : 0;

  return (
    <div style={{ background:"linear-gradient(135deg,#0f172a 0%,#1e1b4b 100%)", color:"#e2e8f0", minHeight:"100vh", fontFamily:FONT, fontSize:"15px", lineHeight:"1.6", letterSpacing:"-0.01em" }}>
      <div style={{ background:"rgba(15,23,42,0.88)", backdropFilter:"blur(14px)", borderBottom:"1px solid rgba(255,255,255,0.08)", padding:isMobile?"10px 14px":"14px 22px", position:"sticky", top:0, zIndex:50 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"8px" }}>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:isMobile?"16px":"19px", fontWeight:800, letterSpacing:"-0.04em", color:"#f8fafc" }}>내 투자 포트폴리오</div>
            <div style={{ display:"flex", alignItems:"center", gap:"6px", marginTop:"2px", flexWrap:"wrap" }}>
              {(lastUpdated || priceAge > 0) && (
                <span style={{ fontSize:"11px", color:"#475569" }}>
                  {lastUpdated || new Date(priceAge).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})}
                  {(Date.now() - priceAge) < 300000
                    ? <span style={{ color:"#34d399", marginLeft:"4px", fontWeight:700 }} title="5분 이내 최신">●</span>
                    : <span style={{ color:"#f59e0b", marginLeft:"4px", fontWeight:700 }} title="캐시 데이터">↻</span>}
                </span>
              )}
              <span style={{ background:"rgba(99,102,241,0.2)", color:"#a5b4fc", padding:"1px 8px", borderRadius:"20px", fontSize:"11px", fontWeight:700 }}>🔑 {syncKey}</span>
            </div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:"6px", flexShrink:0 }}>
            <div style={{ display:"flex", gap:"6px" }}>
              <button onClick={fetchPrices} disabled={loading} style={S.btn(loading?"#334155":"#6366f1", { display:"flex", alignItems:"center", gap:"4px", opacity:loading?0.7:1, fontSize:"12px", padding:"6px 10px" })}>
                <span style={{ display:"inline-block", animation:loading?"spin 1s linear infinite":"none" }}>↻</span>
                {isMobile?(loading?"…":"새로고침"):(loading?"조회 중...":"새로고침")}
              </button>
              <button onClick={onLogout} style={S.btn("#334155", { fontSize:"12px", padding:"6px 10px" })}>로그아웃</button>
            </div>
            {!isMobile && <InfoWidget />}
          </div>
        </div>
        {isMobile && <div style={{ marginTop:"8px" }}><InfoWidget /></div>}
        {/* 포트폴리오 선택 탭 */}
        <div style={{ display:"flex", gap:"4px", marginTop:"10px", marginBottom:"6px" }}>
          {[["p1","📊 포트폴리오1 (주식·코인)"],["p2","🏦 포트폴리오2 (절세계좌)"]].map(([id,label])=>(
            <button key={id} onClick={()=>{setMainTab(id);setTab("portfolio");}} style={{ background:mainTab===id?"rgba(99,102,241,0.3)":"rgba(255,255,255,0.04)", border:mainTab===id?"1px solid rgba(99,102,241,0.55)":"1px solid rgba(255,255,255,0.08)", color:mainTab===id?"#c7d2fe":"#64748b", padding:isMobile?"5px 10px":"6px 16px", borderRadius:"8px", cursor:"pointer", fontSize:isMobile?"11px":"13px", fontWeight:mainTab===id?800:500, letterSpacing:"-0.01em", fontFamily:FONT }}>
              {isMobile?(id==="p1"?"P1 주식":"P2 절세"):label}
            </button>
          ))}
        </div>
        {/* 서브 탭 */}
        <div style={{ display:"flex", gap:"4px", flexWrap:"wrap" }}>
          {(mainTab==="p1"?tabs:[["overview","🏠 전체현황"],["portfolio","📊 보유종목"],["trades","📝 매매일지"]]).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{ background:tab===id?"rgba(99,102,241,0.2)":"transparent", border:tab===id?"1px solid rgba(99,102,241,0.4)":"1px solid transparent", color:tab===id?"#a5b4fc":"#475569", padding:isMobile?"5px 10px":"6px 14px", borderRadius:"8px", cursor:"pointer", fontSize:isMobile?"11px":"13px", fontWeight:tab===id?700:500, letterSpacing:"-0.01em", fontFamily:FONT }}>
              {isMobile ? label.split(" ")[1]||label : label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding:isMobile?"12px":"22px", maxWidth:"1200px", margin:"0 auto" }}>

        {/* ── OVERVIEW ── */}
        {tab === "overview" && (
          <OverviewPanel
            portfolio={portfolio}
            portfolio2={portfolio2}
            holdings={holdings}
            holdings2={holdings2}
            prices={prices}
            snapshots={snapshots}
            liveUsdKrw={liveUsdKrw}
            isMobile={isMobile}
            onSelectAccount={setSelectedAccount}
            setSelectedStock={setSelectedStock}
          />
        )}

        {/* ── PORTFOLIO ── */}
        {tab === "portfolio" && mainTab === "p1" && (<>

          {/* ── 뷰 선택 탭 ── */}
          <div style={{display:"flex",gap:"4px",marginBottom:"14px",flexWrap:"wrap"}}>
            {[["all","🗂 전체"],["account","🏦 계좌별"],["broker","🏢 증권사별"],["market","🌍 국내·해외별"]].map(([id,label])=>(
              <button key={id} onClick={()=>setOverviewTab(id)} style={{
                background:overviewTab===id?"rgba(99,102,241,0.3)":"rgba(255,255,255,0.04)",
                border:overviewTab===id?"1px solid rgba(99,102,241,0.5)":"1px solid rgba(255,255,255,0.08)",
                color:overviewTab===id?"#c7d2fe":"#64748b",
                padding:isMobile?"5px 10px":"6px 16px", borderRadius:"8px", cursor:"pointer",
                fontSize:isMobile?"12px":"13px", fontWeight:overviewTab===id?800:500, letterSpacing:"-0.01em",
              }}>{isMobile?label.split(" ")[1]:label}</button>
            ))}
          </div>

          {/* ── 계좌별 뷰 ── */}
          {overviewTab==="account" && (
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:"12px",marginBottom:"16px"}}>
              <OverviewCard title="포트폴리오1" subtitle="국내·미국주식·코인" items={holdings} prices={prices} liveUsdKrw={liveUsdKrw} color="99,102,241" onClick={()=>setSelectedAccount({title:"포트폴리오1",items:holdings})} isMobile={isMobile}/>
              {TAX_ACCOUNTS.map(acc=>(
                <OverviewCard key={acc} title={acc.replace("(신한금융투자)","").replace("(미래에셋증권)","")} subtitle={acc.includes("(")?acc.split("(")[1]?.replace(")",""):""} items={holdings2.filter(h=>h.taxAccount===acc)} prices={prices} liveUsdKrw={liveUsdKrw} color="234,179,8" onClick={()=>setSelectedAccount({title:acc,items:holdings2.filter(h=>h.taxAccount===acc)})} isMobile={isMobile}/>
              ))}
            </div>
          )}

          {/* ── 증권사별 뷰 ── */}
          {overviewTab==="broker" && (()=>{
            const allHoldings = [...holdings, ...holdings2];
            const brokers = [...new Set(allHoldings.map(h=>h.broker||"미지정"))].sort();
            return (
              <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:"12px",marginBottom:"16px"}}>
                {brokers.map(broker=>{
                  const items = allHoldings.filter(h=>(h.broker||"미지정")===broker);
                  const colors = {"미래에셋증권":"59,130,246","신한금융투자":"239,68,68","토스증권":"99,102,241","카카오페이증권":"234,179,8","메리츠증권":"168,85,247","키움증권":"16,185,129","업비트":"234,88,12","미지정":"100,116,139"};
                  const c = colors[broker]||"99,102,241";
                  return <OverviewCard key={broker} title={broker} subtitle={items.length+"종목"} items={items} prices={prices} liveUsdKrw={liveUsdKrw} color={c} onClick={()=>setSelectedAccount({title:broker,items})} isMobile={isMobile}/>;
                })}
              </div>
            );
          })()}

          {/* ── 국내·해외별 뷰 ── */}
          {overviewTab==="market" && (()=>{
            const allHoldings = [...holdings, ...holdings2];
            const groups = [
              { title:"국내주식", subtitle:"KR·ISA", items:allHoldings.filter(h=>h.market==="KR"||h.market==="ISA"), color:"99,102,241" },
              { title:"미국주식", subtitle:"US·ETF(해외)", items:allHoldings.filter(h=>h.market==="US"||(h.market==="ETF"&&!h.ticker.includes(".KS"))), color:"16,185,129" },
              { title:"암호화폐", subtitle:"CRYPTO", items:allHoldings.filter(h=>h.market==="CRYPTO"), color:"168,85,247" },
              { title:"ETF (국내)", subtitle:"KOSPI·KOSDAQ ETF", items:allHoldings.filter(h=>h.market==="ETF"&&(h.ticker.includes(".KS")||h.ticker.includes(".KQ"))), color:"245,158,11" },
              { title:"금현물", subtitle:"GOLD", items:allHoldings.filter(h=>h.market==="GOLD"), color:"234,179,8" },
            ];
            return (
              <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:"12px",marginBottom:"16px"}}>
                {groups.filter(g=>g.items.length>0).map(g=>(
                  <OverviewCard key={g.title} title={g.title} subtitle={g.subtitle} items={g.items} prices={prices} liveUsdKrw={liveUsdKrw} color={g.color} onClick={()=>setSelectedAccount({title:g.title,items:g.items})} isMobile={isMobile}/>
                ))}
              </div>
            );
          })()}

          {/* 통화 전환 버튼 (전체 뷰일 때만) */}
          {overviewTab==="all" && (<div>{/* 통화 전환 버튼 */}
          <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:"8px" }}>
            <div style={{ display:"flex", background:"rgba(255,255,255,0.06)", borderRadius:"10px", padding:"3px", gap:"2px" }}>
              <button
                onClick={()=>setCurrMode("KRW")}
                style={{ padding:"5px 14px", borderRadius:"8px", border:"none", cursor:"pointer", fontSize:"13px", fontWeight:700, background:currMode==="KRW"?"rgba(99,102,241,0.5)":"transparent", color:currMode==="KRW"?"#c7d2fe":"#64748b" }}>
                ₩ 원화
              </button>
              <button
                onClick={()=>setCurrMode("USD")}
                style={{ padding:"5px 14px", borderRadius:"8px", border:"none", cursor:"pointer", fontSize:"13px", fontWeight:700, background:currMode==="USD"?"rgba(16,185,129,0.4)":"transparent", color:currMode==="USD"?"#6ee7b7":"#64748b" }}>
                $ 달러
              </button>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:isMobile?"8px":"12px", marginBottom:isMobile?"14px":"20px" }}>
            <div style={{ ...S.card, background:"rgba(99,102,241,0.09)", borderColor:"rgba(99,102,241,0.22)" }}>
              <div style={{ fontSize:"12px", color:"#64748b", marginBottom:"6px", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em" }}>총 평가금액</div>
              <div style={{ fontSize:isMobile?"15px":"22px", fontWeight:800, color:"#f8fafc", letterSpacing:"-0.04em" }}>
                {currMode==="KRW" ? fmtKRW(totalVal) : "$"+(totalVal/liveUsdKrw).toLocaleString("en-US",{minimumFractionDigits:0,maximumFractionDigits:0})}
              </div>
              {currMode==="USD"&&<div style={{ fontSize:"10px", color:"#475569", marginTop:"3px" }}>환율 {liveUsdKrw.toLocaleString()}₩ 기준</div>}
            </div>
            <div style={{ ...S.card, background:"rgba(99,102,241,0.09)", borderColor:"rgba(99,102,241,0.22)" }}>
              <div style={{ fontSize:"12px", color:"#64748b", marginBottom:"6px", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em" }}>평가 손익</div>
              <div style={{ fontSize:isMobile?"15px":"22px", fontWeight:800, color:totalPnL>=0?"#34d399":"#f87171", letterSpacing:"-0.04em" }}>
                {currMode==="KRW"
                  ? (totalPnL>=0?"+":"")+fmtKRW(totalPnL)
                  : (totalPnL>=0?"+":"-")+"$"+Math.abs(totalPnL/liveUsdKrw).toLocaleString("en-US",{minimumFractionDigits:0,maximumFractionDigits:0})}
              </div>
            </div>
            <div style={{ ...S.card, background:"rgba(99,102,241,0.09)", borderColor:"rgba(99,102,241,0.22)" }}>
              <div style={{ fontSize:"12px", color:"#64748b", marginBottom:"6px", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em" }}>총 수익률</div>
              <div style={{ fontSize:isMobile?"15px":"22px", fontWeight:800, color:totalRet>=0?"#34d399":"#f87171", letterSpacing:"-0.04em" }}>{fmtPct(totalRet)}</div>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:(!isMobile&&portfolio.length>0)?"1fr 250px":"1fr", gap:"12px" }}>
            <div style={{...S.card, padding:"14px"}}>
              {/* 헤더 + 컨트롤 */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"12px", gap:"8px", flexWrap:"wrap" }}>
                <div>
                  <div style={{ fontSize:"17px", fontWeight:800, letterSpacing:"-0.03em" }}>보유 종목
                    <span style={{ fontSize:"13px", fontWeight:500, color:"#64748b", marginLeft:"8px" }}>{portfolio.length}종목</span>
                  </div>
                  <div style={{ fontSize:"11px", color:"#475569", marginTop:"4px" }}>KOSPI: 005930 → 자동 .KS | KOSDAQ: 035720.KQ</div>
                </div>
                <div style={{ display:"flex", gap:"6px", alignItems:"center", flexWrap:"wrap" }}>
                  <button onClick={()=>setSelectedAccount({title:"포트폴리오1 전체", items:holdings})} style={{background:"rgba(99,102,241,0.15)",border:"1px solid rgba(99,102,241,0.35)",color:"#a5b4fc",padding:"6px 12px",borderRadius:"8px",cursor:"pointer",fontSize:"12px",fontWeight:700}}>📊 전체 상세</button>
                  {/* 그룹핑 토글 */}
                  <button onClick={()=>setGroupBy(g=>g==="none"?"broker":"none")} style={{ ...S.btn(groupBy==="broker"?"#6366f1":"#334155", { fontSize:"12px", padding:"5px 10px" }) }}>
                    {groupBy==="broker"?"🏦 그룹 해제":"🏦 증권사별"}
                  </button>
                  {/* 정렬 */}
                  <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{ ...S.inp, width:"auto", fontSize:"12px", padding:"5px 10px", appearance:"none" }}>
                    <option value="default">기본순</option>
                    <option value="pnl_desc">수익률 높은순</option>
                    <option value="pnl_asc">수익률 낮은순</option>
                    <option value="value_desc">평가금액 높은순</option>
                  </select>
                  <button onClick={() => setShowForm(showForm==="h"?null:"h")} style={S.btn("#6366f1", { flexShrink:0, fontSize:"13px" })}>+ 추가</button>
                </div>
              </div>

              {/* 요약 통계 */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"6px", marginBottom:"12px" }}>
                {[
                  ["수익 종목", portfolio.filter(h=>h.pnlPct>0).length+"개", "#34d399"],
                  ["손실 종목", portfolio.filter(h=>h.pnlPct<0).length+"개", "#f87171"],
                  ["최고 수익", portfolio.length ? (()=>{const m=portfolio.reduce((a,b)=>b.pnlPct>a.pnlPct?b:a,portfolio[0]); return m.ticker+" "+fmtPct(m.pnlPct);})() : "-", "#34d399"],
                  ["최대 손실", portfolio.length ? (()=>{const m=portfolio.reduce((a,b)=>b.pnlPct<a.pnlPct?b:a,portfolio[0]); return m.ticker+" "+fmtPct(m.pnlPct);})() : "-", "#f87171"],
                ].map(([l,v,c])=>(
                  <div key={l} style={{ background:"rgba(255,255,255,0.03)", borderRadius:"8px", padding:"7px 10px" }}>
                    <div style={{ fontSize:"10px", color:"#64748b", marginBottom:"3px", fontWeight:700 }}>{l}</div>
                    <div style={{ fontSize:"13px", fontWeight:800, color:c, letterSpacing:"-0.02em" }}>{v}</div>
                  </div>
                ))}
              </div>

              {showForm==="h" && (
                <div style={{ background:"rgba(0,0,0,0.35)", borderRadius:"12px", padding:"18px", marginBottom:"18px", border:"1px solid rgba(99,102,241,0.35)" }}>
                  <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:"8px" }}>
                    <input placeholder="티커 (예: 005930, AAPL, BTC)" value={hForm.ticker} onChange={e=>setHForm(p=>({...p,ticker:e.target.value.toUpperCase()}))} style={S.inp}/>
                    <input placeholder="종목명" value={hForm.name} onChange={e=>setHForm(p=>({...p,name:e.target.value}))} style={S.inp}/>
                    <select value={hForm.market} onChange={e=>setHForm(p=>({...p,market:e.target.value}))} style={{...S.inp,appearance:"none"}}>
                      <option value="KR">한국주식</option><option value="ISA">한국주식(ISA)</option><option value="US">미국주식</option><option value="ETF">ETF</option><option value="CRYPTO">암호화폐</option><option value="GOLD">금현물</option>
                    </select>
                    <input placeholder="수량" type="number" value={hForm.quantity} onChange={e=>setHForm(p=>({...p,quantity:e.target.value}))} style={S.inp}/>
                    <input placeholder="평균 매수가" type="number" value={hForm.avgPrice} onChange={e=>setHForm(p=>({...p,avgPrice:e.target.value}))} style={{...S.inp,gridColumn:"1/-1"}}/>
                    <select value={hForm.broker} onChange={e=>setHForm(p=>({...p,broker:e.target.value}))} style={{...S.inp,appearance:"none",gridColumn:"1/-1"}}>
                      <option value="">증권사 선택 (선택사항)</option>
                      <option value="미래에셋증권">미래에셋증권</option><option value="신한금융투자">신한금융투자</option>
                      <option value="토스증권">토스증권</option><option value="카카오페이증권">카카오페이증권</option>
                      <option value="메리츠증권">메리츠증권</option><option value="키움증권">키움증권</option><option value="업비트">업비트</option>
                    </select>
                  </div>
                  <div style={{display:"flex",gap:"8px",marginTop:"12px"}}>
                    <button onClick={addH} style={S.btn("#10b981")}>✓ 추가</button>
                    <button onClick={()=>setShowForm(null)} style={S.btn("#475569")}>취소</button>
                  </div>
                </div>
              )}

              {/* 종목 목록 — 고정 높이 + 내부 스크롤 */}
              {portfolio.length===0 ? (
                <div style={{textAlign:"center",padding:"44px",color:"#475569"}}>
                  <div style={{fontSize:"36px",marginBottom:"12px"}}>📋</div>
                  <div>종목을 추가하면 실시간 시세를 조회합니다</div>
                </div>
              ) : isMobile ? (
                <div style={{display:"flex",flexDirection:"column",gap:"8px",maxHeight:"60vh",overflowY:"auto"}}>
                  {(()=>{
                    let sorted = [...portfolio];
                    if(sortBy==="pnl_desc") sorted.sort((a,b)=>b.pnlPct-a.pnlPct);
                    else if(sortBy==="pnl_asc") sorted.sort((a,b)=>a.pnlPct-b.pnlPct);
                    else if(sortBy==="value_desc") sorted.sort((a,b)=>toKRWLive(b.value,b.cur)-toKRWLive(a.value,a.cur));
                    if(groupBy==="broker"){
                      const groups = {};
                      sorted.forEach(h=>{ const k=h.broker||"증권사 미지정"; if(!groups[k]) groups[k]=[]; groups[k].push(h); });
                      return Object.entries(groups).map(([broker, items])=>(
                        <div key={broker}>
                          <div style={{fontSize:"12px",fontWeight:700,color:"#6366f1",padding:"6px 4px",borderBottom:"1px solid rgba(99,102,241,0.2)",marginBottom:"6px"}}>🏦 {broker} ({items.length})</div>
                          {items.map(h=>renderMobileCard(h))}
                        </div>
                      ));
                    }
                    return sorted.map(h=>renderMobileCard(h));
                  })()}
                  <div style={{fontSize:"11px",color:"#334155",textAlign:"right",marginTop:"4px"}}>* USD 환산: 1달러 = {liveUsdKrw.toLocaleString()}원 기준 (실시간)</div>
                </div>
              ) : (
                <div style={{overflowY:"auto", maxHeight:"480px"}}>
                  {(()=>{
                    let sorted = [...portfolio];
                    if(sortBy==="pnl_desc") sorted.sort((a,b)=>b.pnlPct-a.pnlPct);
                    else if(sortBy==="pnl_asc") sorted.sort((a,b)=>a.pnlPct-b.pnlPct);
                    else if(sortBy==="value_desc") sorted.sort((a,b)=>toKRWLive(b.value,b.cur)-toKRWLive(a.value,a.cur));

                    if(groupBy==="broker"){
                      const groups = {};
                      sorted.forEach(h=>{ const k=h.broker||"증권사 미지정"; if(!groups[k]) groups[k]=[]; groups[k].push(h); });
                      return Object.entries(groups).map(([broker, items])=>(
                        <div key={broker} style={{marginBottom:"12px"}}>
                          <div style={{fontSize:"12px",fontWeight:700,color:"#6366f1",padding:"6px 12px",background:"rgba(99,102,241,0.08)",borderRadius:"6px",marginBottom:"4px",display:"flex",justifyContent:"space-between"}}>
                            <span>🏦 {broker}</span>
                            <span style={{color:"#64748b"}}>{items.length}종목 · {fmtKRW(items.reduce((s,h)=>s+toKRWLive(h.value,h.cur),0))}</span>
                          </div>
                          <table style={{width:"100%",borderCollapse:"collapse"}}>
                            <thead><tr>{["종목","현재가","일변동","수량","평가금액","손익률",""].map(h=><th key={h} style={S.TH}>{h}</th>)}</tr></thead>
                            <tbody>{items.map(h=>renderTableRow(h))}</tbody>
                          </table>
                        </div>
                      ));
                    }
                    return (
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr>{["종목","현재가","일변동","수량","평가금액","손익률",""].map(h=><th key={h} style={S.TH}>{h}</th>)}</tr></thead>
                        <tbody>{sorted.map(h=>renderTableRow(h))}</tbody>
                      </table>
                    );
                  })()}
                  <div style={{fontSize:"12px",color:"#334155",textAlign:"right",marginTop:"10px"}}>* USD 환산: 1달러 = {liveUsdKrw.toLocaleString()}원 기준 (실시간)</div>
                </div>
              )}
            </div>
            {portfolio.length>0&&!isMobile&&(
              <div style={{...S.card, display:"flex", flexDirection:"column", padding:"16px", minWidth:0}}>
                <div style={{fontSize:"15px", fontWeight:800, marginBottom:"14px", letterSpacing:"-0.03em"}}>자산 배분</div>

                {/* 전체 비중 스택 바 */}
                <div style={{marginBottom:"14px"}}>
                  <div style={{fontSize:"11px", color:"#64748b", marginBottom:"6px", fontWeight:700}}>포트폴리오 비중</div>
                  <div style={{display:"flex", height:"14px", borderRadius:"7px", overflow:"hidden", gap:"2px"}}>
                    {pieData.map(d=>(
                      <div key={d.name} title={`${d.name}: ${((d.value/pieData.reduce((s,x)=>s+x.value,0))*100).toFixed(0)}%`}
                        style={{flex:d.value, background:d.color, cursor:"default", transition:"opacity 0.15s"}}/>
                    ))}
                  </div>
                  <div style={{display:"flex", flexWrap:"wrap", gap:"6px", marginTop:"8px"}}>
                    {pieData.map(d=>{
                      const total=pieData.reduce((s,x)=>s+x.value,0);
                      return(
                        <span key={d.name} style={{display:"flex",alignItems:"center",gap:"4px",fontSize:"11px",color:"#94a3b8"}}>
                          <span style={{width:"8px",height:"8px",borderRadius:"2px",background:d.color,flexShrink:0}}/>
                          {d.name} <span style={{fontWeight:700,color:"#e2e8f0"}}>{((d.value/total)*100).toFixed(0)}%</span>
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* 구분선 */}
                <div style={{borderTop:"1px solid rgba(255,255,255,0.07)", marginBottom:"12px"}}/>

                {/* 시장별 수익률 바 */}
                <div style={{fontSize:"11px", color:"#64748b", marginBottom:"8px", fontWeight:700}}>시장별 수익률</div>
                <div style={{display:"flex", flexDirection:"column", gap:"9px"}}>
                  {(()=>{
                    const maxAbs = Math.max(...Object.keys(MARKET_LABEL).map(k=>{
                      const items = portfolio.filter(h=>h.market===k);
                      if(!items.length) return 0;
                      const val  = items.reduce((s,h)=>s+toKRWLive(h.value,h.cur),0);
                      const cost = items.reduce((s,h)=>s+toKRWLive(h.cost,h.cur),0);
                      return Math.abs(cost>0?((val-cost)/cost)*100:0);
                    }), 0.1);
                    return Object.entries(MARKET_LABEL).map(([k,label])=>{
                      const items = portfolio.filter(h=>h.market===k);
                      if(!items.length) return null;
                      const val  = items.reduce((s,h)=>s+toKRWLive(h.value,h.cur),0);
                      const cost = items.reduce((s,h)=>s+toKRWLive(h.cost,h.cur),0);
                      const ret  = cost>0?((val-cost)/cost)*100:0;
                      const barW = (Math.abs(ret)/Math.max(maxAbs,1))*100;
                      const isUp = ret>=0;
                      return(
                        <div key={k} style={{display:"grid",gridTemplateColumns:"58px 1fr 46px",alignItems:"center",gap:"8px"}}>
                          <div style={{display:"flex",alignItems:"center",gap:"5px"}}>
                            <div style={{width:"7px",height:"7px",borderRadius:"2px",background:MARKET_COLOR[k],flexShrink:0}}/>
                            <span style={{fontSize:"11px",color:"#94a3b8",fontWeight:600,whiteSpace:"nowrap"}}>{label}</span>
                          </div>
                          <div style={{background:"rgba(255,255,255,0.05)",borderRadius:"4px",height:"8px",overflow:"hidden"}}>
                            <div style={{
                              width:barW+"%", height:"100%",
                              background:isUp?"#34d399":"#f87171",
                              borderRadius:"4px",
                              marginLeft:isUp?"0":`${100-barW}%`
                            }}/>
                          </div>
                          <span style={{fontSize:"12px",fontWeight:800,color:isUp?"#34d399":"#f87171",textAlign:"right",letterSpacing:"-0.02em"}}>
                            {isUp?"+":""}{ret.toFixed(1)}%
                          </span>
                        </div>
                      );
                    }).filter(Boolean);
                  })()}
                </div>

                {/* 총 자산 요약 */}
                <div style={{borderTop:"1px solid rgba(255,255,255,0.07)",marginTop:"14px",paddingTop:"12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:"11px",color:"#64748b",fontWeight:700}}>총 평가금액</span>
                  <span style={{fontSize:"14px",fontWeight:800,color:"#f8fafc",letterSpacing:"-0.03em"}}>{fmtKRW(totalVal)}</span>
                </div>
              </div>
            )}
          </div>
        </div>)}

        {/* ── PORTFOLIO 2 (절세계좌) ── */}
        {tab === "portfolio" && mainTab === "p2" && (
          <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
            {/* P2 요약 카드 */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"12px"}}>
              {[["총 평가금액",fmtKRW(total2Val),"#f8fafc"],["평가 손익",(total2PnL>=0?"+":"")+fmtKRW(total2PnL),total2PnL>=0?"#34d399":"#f87171"],["총 수익률",(total2Ret>=0?"+":"")+total2Ret.toFixed(2)+"%",total2Ret>=0?"#34d399":"#f87171"]].map(([title,val,color])=>(
                <div key={title} style={{...S.card,background:"rgba(234,179,8,0.08)",borderColor:"rgba(234,179,8,0.2)"}}>
                  <div style={{fontSize:"12px",color:"#64748b",marginBottom:"6px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em"}}>{title}</div>
                  <div style={{fontSize:isMobile?"15px":"20px",fontWeight:800,color,letterSpacing:"-0.04em"}}>{val}</div>
                </div>
              ))}
            </div>

            {/* ISA 납입 현황 + 납입 설정 버튼 */}
            <ContribProgressBar
              taxAccounts={TAX_ACCOUNTS}
              holdings2={holdings2}
              prices={prices}
              liveUsdKrw={liveUsdKrw}
              contribLimits={contribLimits}
              contribAmounts={contribAmounts}
              onOpenSettings={()=>setShowContrib(true)}
              isMobile={isMobile}
            />

            {/* 계좌별 그룹 */}
            {TAX_ACCOUNTS.map(account => {
              const items = portfolio2.filter(h=>h.taxAccount===account);
              const accVal  = items.reduce((s,h)=>s+toKRWLive(h.value,h.cur),0);
              const accCost = items.reduce((s,h)=>s+toKRWLive(h.cost, h.cur),0);
              const accRet  = accCost>0?((accVal-accCost)/accCost)*100:0;
              return (
                <div key={account} style={S.card}>
                  {/* 계좌 헤더 */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px",flexWrap:"wrap",gap:"8px"}}>
                    <div>
                      <div style={{display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap"}}>
                        <span style={{fontSize:"16px",fontWeight:800,letterSpacing:"-0.03em"}}>{account}</span>
                        <span style={{fontSize:"11px",background:"rgba(234,179,8,0.15)",color:"#eab308",padding:"2px 8px",borderRadius:"20px",fontWeight:700}}>절세계좌</span>
                      </div>
                      <div style={{fontSize:"13px",color:"#64748b",marginTop:"4px"}}>
                        {fmtKRW(accVal)} · {accRet>=0?"+":""}{accRet.toFixed(2)}% · {items.length}종목
                      </div>
                    </div>
                    <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
                      <button onClick={()=>setSelectedAccount({title:account, items})} style={{background:"rgba(99,102,241,0.15)",border:"1px solid rgba(99,102,241,0.35)",color:"#a5b4fc",padding:"6px 12px",borderRadius:"8px",cursor:"pointer",fontSize:"12px",fontWeight:700}}>📊 상세보기</button>
                      <button onClick={()=>setShowForm(showForm===account?null:account)} style={S.btn("#6366f1",{fontSize:"13px"})}>+ 추가</button>
                    </div>
                  </div>

                  {/* 종목 추가 폼 */}
                  {showForm===account && (
                    <div style={{background:"rgba(0,0,0,0.35)",borderRadius:"12px",padding:"16px",marginBottom:"14px",border:"1px solid rgba(99,102,241,0.35)"}}>
                      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:"8px"}}>
                        <input placeholder="티커 (예: 005930, AAPL, BTC)" value={hForm2.ticker} onChange={e=>setHForm2(p=>({...p,ticker:e.target.value.toUpperCase()}))} style={S.inp}/>
                        <input placeholder="종목명" value={hForm2.name} onChange={e=>setHForm2(p=>({...p,name:e.target.value}))} style={S.inp}/>
                        <select value={hForm2.market} onChange={e=>setHForm2(p=>({...p,market:e.target.value}))} style={{...S.inp,appearance:"none"}}>
                          <option value="KR">한국주식</option><option value="ISA">한국주식(ISA)</option><option value="US">미국주식</option><option value="ETF">ETF</option><option value="CRYPTO">암호화폐</option><option value="GOLD">금현물</option>
                        </select>
                        <input placeholder="수량 (금현물: 그램)" type="number" value={hForm2.quantity} onChange={e=>setHForm2(p=>({...p,quantity:e.target.value}))} style={S.inp}/>
                        <input placeholder="평균 매수가 (금현물: 원/g)" type="number" value={hForm2.avgPrice} onChange={e=>setHForm2(p=>({...p,avgPrice:e.target.value}))} style={{...S.inp,gridColumn:"1/-1"}}/>
                      </div>
                      <div style={{display:"flex",gap:"8px",marginTop:"10px"}}>
                        <button onClick={()=>{
                          if(!hForm2.ticker||!hForm2.quantity||!hForm2.avgPrice) return;
                          setHoldings2(p=>[...p,{id:Date.now(),...hForm2,taxAccount:account,quantity:+hForm2.quantity,avgPrice:+hForm2.avgPrice}]);
                          setHForm2({ticker:"",name:"",market:"KR",quantity:"",avgPrice:"",taxAccount:account,broker:""});
                          setShowForm(null);
                        }} style={S.btn("#10b981")}>✓ 추가</button>
                        <button onClick={()=>setShowForm(null)} style={S.btn("#475569")}>취소</button>
                      </div>
                    </div>
                  )}

                  {/* 종목 목록 */}
                  {items.length===0 ? (
                    <div style={{textAlign:"center",padding:"24px",color:"#475569",fontSize:"14px"}}>종목을 추가해주세요</div>
                  ) : isMobile ? (
                    <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                      {items.map(h=>(
                        <div key={h.id} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"10px",padding:"12px"}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
                            <div>
                              <div style={{fontWeight:800,fontSize:"15px",color:"#a5b4fc"}}>{h.ticker}</div>
                              <div style={{fontSize:"12px",color:"#cbd5e1"}}>{h.name||MARKET_LABEL[h.market]}</div>
                            </div>
                            <div style={{display:"flex",gap:"6px"}}>
                              <span style={{fontSize:"15px",fontWeight:800,color:h.pnlPct>=0?"#34d399":"#f87171"}}>{(h.pnlPct>=0?"+":"")+h.pnlPct.toFixed(2)}%</span>
                              <button onClick={()=>setHoldings2(p=>p.filter(x=>x.id!==h.id))} style={{background:"none",border:"none",color:"#475569",cursor:"pointer",fontSize:"16px"}}>✕</button>
                            </div>
                          </div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"6px"}}>
                            {[["현재가",h.market==="GOLD"?Math.round(h.price).toLocaleString("ko-KR")+"₩/g":fmtPrice(h.price,h.cur)],["수량",h.market==="GOLD"?h.quantity.toLocaleString()+"g":h.quantity.toLocaleString()+"주"],["평가금액",fmtKRW(toKRWLive(h.value,h.cur))]].map(([l,v])=>(
                              <div key={l} style={{background:"rgba(0,0,0,0.2)",borderRadius:"6px",padding:"6px 8px"}}>
                                <div style={{fontSize:"10px",color:"#64748b",marginBottom:"2px"}}>{l}</div>
                                <div style={{fontSize:"12px",fontWeight:700}}>{v}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{overflowX:"auto"}}>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr>{["종목","현재가","일변동","수량","평가금액","손익률",""].map(h=><th key={h} style={S.TH}>{h}</th>)}</tr></thead>
                        <tbody>
                          {items.map(h=>(
                            <tr key={h.id}>
                              <td style={S.TD}>
                                <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                                  <div style={{width:"8px",height:"8px",borderRadius:"2px",background:MARKET_COLOR[h.market]||"#eab308",flexShrink:0}}/>
                                  <div>
                                    <div style={{fontWeight:800,fontSize:"14px",letterSpacing:"-0.02em"}}>{h.ticker}</div>
                                    <div style={{fontSize:"11px",color:"#cbd5e1"}}>{h.name||MARKET_LABEL[h.market]}</div>
                                  </div>
                                </div>
                              </td>
                              <td style={S.TD}>{h.market==="GOLD"?Math.round(h.price).toLocaleString("ko-KR")+"₩/g":fmtPrice(h.price,h.cur)}{!h.hasLive&&<div style={{fontSize:"10px",color:"#475569"}}>매수가기준</div>}</td>
                              <td style={{...S.TD,color:h.chgPct>=0?"#34d399":"#f87171",fontWeight:700}}>{(h.chgPct>=0?"+":"")+h.chgPct.toFixed(2)}%</td>
                              <td style={S.TD}>{h.market==="GOLD"?h.quantity.toLocaleString()+"g":h.quantity.toLocaleString()+"주"}</td>
                              <td style={{...S.TD,fontWeight:700}}>{fmtKRW(toKRWLive(h.value,h.cur))}</td>
                              <td style={{...S.TD,color:h.pnlPct>=0?"#34d399":"#f87171",fontWeight:800}}>{(h.pnlPct>=0?"+":"")+h.pnlPct.toFixed(2)}%</td>
                              <td style={S.TD}><button onClick={()=>setHoldings2(p=>p.filter(x=>x.id!==h.id))} style={{background:"none",border:"none",color:"#475569",cursor:"pointer",fontSize:"16px"}}>✕</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          </>}
        )}

        {/* ── CHARTS ── */}
        {tab === "charts" && (
          <div style={{display:"flex",flexDirection:"column",gap:"20px"}}>

            <div style={S.card}>
              <div style={{fontSize:"17px",fontWeight:800,marginBottom:"4px",letterSpacing:"-0.03em"}}>📈 수익률 변화</div>
              <div style={{fontSize:"13px",color:"#475569",marginBottom:"18px"}}>새로고침할 때마다 자동 기록 (최근 30회)</div>
              {snapshotList.length<2 ? (
                <div style={{textAlign:"center",padding:"40px",color:"#475569"}}>
                  <div style={{fontSize:"28px",marginBottom:"10px"}}>📊</div>
                  <div>종목 추가 후 새로고침을 2번 이상 누르면 그래프가 그려집니다</div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={snapshotList} margin={{top:5,right:10,left:0,bottom:5}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)"/>
                    <XAxis dataKey="label" tick={{fill:"#64748b",fontSize:11}} interval="preserveStartEnd"/>
                    <YAxis tick={{fill:"#64748b",fontSize:11}} tickFormatter={v=>v.toFixed(1)+"%"}/>
                    <Tooltip {...TT} formatter={v=>[v.toFixed(2)+"%","수익률"]}/>
                    <Line type="monotone" dataKey="returnRate" stroke="#6366f1" strokeWidth={2.5} dot={false} activeDot={{r:5,fill:"#6366f1"}}/>
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            <div style={S.card}>
              <div style={{fontSize:"17px",fontWeight:800,marginBottom:"4px",letterSpacing:"-0.03em"}}>💰 자산 총액 변화</div>
              <div style={{fontSize:"13px",color:"#475569",marginBottom:"18px"}}>KRW 환산 기준 (최근 30회)</div>
              {snapshotList.length<2 ? (
                <div style={{textAlign:"center",padding:"40px",color:"#475569"}}>
                  <div style={{fontSize:"28px",marginBottom:"10px"}}>💰</div>
                  <div>종목 추가 후 새로고침을 2번 이상 누르면 그래프가 그려집니다</div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={snapshotList} margin={{top:5,right:10,left:0,bottom:5}}>
                    <defs>
                      <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)"/>
                    <XAxis dataKey="label" tick={{fill:"#64748b",fontSize:11}} interval="preserveStartEnd"/>
                    <YAxis tick={{fill:"#64748b",fontSize:11}} tickFormatter={v=>(v/10000).toFixed(0)+"만"}/>
                    <Tooltip {...TT} formatter={v=>[fmtKRW(v),"총 자산"]}/>
                    <Area type="monotone" dataKey="totalValue" stroke="#10b981" strokeWidth={2.5} fill="url(#ag)" dot={false} activeDot={{r:5,fill:"#10b981"}}/>
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            <div style={S.card}>
              <div style={{fontSize:"17px",fontWeight:800,marginBottom:"4px",letterSpacing:"-0.03em"}}>📋 매매 수익/손실</div>
              <div style={{fontSize:"13px",color:"#475569",marginBottom:"18px"}}>매수: 투자금액(−) / 매도: 회수금액(+)</div>
              {tradePnLData.length===0 ? (
                <div style={{textAlign:"center",padding:"40px",color:"#475569"}}>
                  <div style={{fontSize:"28px",marginBottom:"10px"}}>📝</div>
                  <div>매매일지를 추가하면 차트가 그려집니다</div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={tradePnLData} margin={{top:5,right:10,left:0,bottom:40}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)"/>
                    <XAxis dataKey="ticker" tick={{fill:"#64748b",fontSize:11}} angle={-30} textAnchor="end"/>
                    <YAxis tick={{fill:"#64748b",fontSize:11}} tickFormatter={v=>(v/10000).toFixed(0)+"만"}/>
                    <Tooltip {...TT} formatter={v=>[fmtKRW(Math.abs(v)),v>=0?"매도 회수":"매수 투자"]}/>
                    <Bar dataKey="pnl" radius={[4,4,0,0]}>
                      {tradePnLData.map((e,i)=><Cell key={i} fill={e.pnl>=0?"#10b981":"#6366f1"}/>)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
              <div style={{display:"flex",gap:"16px",marginTop:"14px",fontSize:"13px",color:"#64748b"}}>
                <div style={{display:"flex",alignItems:"center",gap:"6px"}}><div style={{width:"10px",height:"10px",borderRadius:"2px",background:"#10b981"}}/> 매도 (회수)</div>
                <div style={{display:"flex",alignItems:"center",gap:"6px"}}><div style={{width:"10px",height:"10px",borderRadius:"2px",background:"#6366f1"}}/> 매수 (투자)</div>
              </div>
            </div>
          </div>
        )}

        {/* ── TRADES ── */}
        {tab==="trades"&&(
          <div style={S.card}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:isMobile?"14px":"20px",flexWrap:"wrap",gap:"10px"}}>
              <div><div style={{fontSize:"17px",fontWeight:800,letterSpacing:"-0.03em"}}>매매 일지</div><div style={{fontSize:"13px",color:"#475569",marginTop:"4px"}}>총 {trades.length}건</div></div>
              <button onClick={()=>setShowForm(showForm==="t"?null:"t")} style={S.btn()}>+ 기록 추가</button>
            </div>
            {showForm==="t"&&(
              <div style={{background:"rgba(0,0,0,0.35)",borderRadius:"12px",padding:"18px",marginBottom:"18px",border:"1px solid rgba(99,102,241,0.35)"}}>
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:"8px"}}>
                  <input type="date" value={tForm.date} onChange={e=>setTForm(p=>({...p,date:e.target.value}))} style={S.inp}/>
                  <input placeholder="티커" value={tForm.ticker} onChange={e=>setTForm(p=>({...p,ticker:e.target.value.toUpperCase()}))} style={S.inp}/>
                  <select value={tForm.type} onChange={e=>setTForm(p=>({...p,type:e.target.value}))} style={{...S.inp,appearance:"none"}}><option value="buy">매수</option><option value="sell">매도</option></select>
                  <input placeholder="수량" type="number" value={tForm.quantity} onChange={e=>setTForm(p=>({...p,quantity:e.target.value}))} style={S.inp}/>
                  <input placeholder="체결가" type="number" value={tForm.price} onChange={e=>setTForm(p=>({...p,price:e.target.value}))} style={S.inp}/>
                  <input placeholder="수수료 (선택)" type="number" value={tForm.fee} onChange={e=>setTForm(p=>({...p,fee:e.target.value}))} style={S.inp}/>
                  <input placeholder="메모 (선택)" value={tForm.note} onChange={e=>setTForm(p=>({...p,note:e.target.value}))} style={{...S.inp,gridColumn:"1/-1"}}/>
                </div>
                <div style={{display:"flex",gap:"8px",marginTop:"12px"}}><button onClick={addT} style={S.btn("#10b981")}>✓ 저장</button><button onClick={()=>setShowForm(null)} style={S.btn("#475569")}>취소</button></div>
              </div>
            )}
            {trades.length===0?(
              <div style={{textAlign:"center",padding:"44px",color:"#475569"}}><div style={{fontSize:"36px",marginBottom:"12px"}}>📝</div><div>매매 기록을 추가해주세요</div></div>
            ):(
              [...trades].reverse().map(t=>(
                <div key={t.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"18px 0",borderBottom:"1px solid rgba(255,255,255,0.06)",gap:"12px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"14px",minWidth:0}}>
                    <div style={{background:t.type==="buy"?"rgba(99,102,241,0.2)":"rgba(239,68,68,0.2)",border:`1px solid ${t.type==="buy"?"rgba(99,102,241,0.45)":"rgba(239,68,68,0.45)"}`,color:t.type==="buy"?"#c7d2fe":"#fca5a5",padding:"5px 14px",borderRadius:"20px",fontSize:"14px",fontWeight:800,flexShrink:0}}>{t.type==="buy"?"매수":"매도"}</div>
                    <div><div style={{fontWeight:800,fontSize:"16px",letterSpacing:"-0.03em"}}>{t.ticker} <span style={{color:"#475569",fontWeight:500,fontSize:"13px"}}>{t.date}</span></div>{t.note&&<div style={{fontSize:"14px",color:"#64748b",marginTop:"4px"}}>{t.note}</div>}</div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontSize:"15px",fontWeight:700}}>{t.quantity.toLocaleString()}주 × {Number(t.price).toLocaleString()}</div>
                    <div style={{fontSize:"13px",color:"#64748b",marginTop:"3px"}}>합계 {Math.round(t.quantity*t.price).toLocaleString()} {t.fee>0?`| 수수료 ${t.fee.toLocaleString()}`:""}</div>
                  </div>
                  <button onClick={()=>setTrades(p=>p.filter(x=>x.id!==t.id))} style={{background:"none",border:"none",color:"#475569",cursor:"pointer",fontSize:"18px",flexShrink:0}}>✕</button>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── WATCHLIST ── */}
        {tab==="watchlist"&&(
          <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
            {/* 헤더 */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:"10px"}}>
              <div>
                <div style={{fontSize:"17px",fontWeight:800,letterSpacing:"-0.03em"}}>⭐ 관심종목</div>
                <div style={{fontSize:"13px",color:"#475569",marginTop:"4px"}}>{watchlist.length}종목 관심 등록 · 현재가와 목표가 비교</div>
              </div>
              <button onClick={()=>setShowForm(showForm==="wl"?null:"wl")} style={S.btn("#6366f1")}>+ 종목 추가</button>
            </div>

            {/* 추가 폼 */}
            {showForm==="wl"&&(
              <div style={{...S.card,border:"1px solid rgba(99,102,241,0.35)"}}>
                <div style={{fontSize:"13px",color:"#a5b4fc",fontWeight:700,marginBottom:"12px"}}>⭐ 관심종목 추가</div>
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:"8px"}}>
                  <input placeholder="티커 (예: 005930, AAPL, BTC)" value={wForm.ticker} onChange={e=>setWForm(p=>({...p,ticker:e.target.value.toUpperCase()}))} style={S.inp}/>
                  <input placeholder="종목명" value={wForm.name} onChange={e=>setWForm(p=>({...p,name:e.target.value}))} style={S.inp}/>
                  <select value={wForm.market} onChange={e=>setWForm(p=>({...p,market:e.target.value}))} style={{...S.inp,appearance:"none"}}>
                    <option value="KR">한국주식</option><option value="ISA">한국주식(ISA)</option><option value="US">미국주식</option><option value="ETF">ETF</option><option value="CRYPTO">암호화폐</option><option value="GOLD">금현물</option>
                  </select>
                  <input placeholder="목표 매수가 (선택)" type="number" value={wForm.targetBuy} onChange={e=>setWForm(p=>({...p,targetBuy:e.target.value}))} style={S.inp}/>
                  <input placeholder="목표 매도가 (선택)" type="number" value={wForm.targetSell} onChange={e=>setWForm(p=>({...p,targetSell:e.target.value}))} style={S.inp}/>
                  <input placeholder="메모 (선택)" value={wForm.memo} onChange={e=>setWForm(p=>({...p,memo:e.target.value}))} style={{...S.inp,gridColumn:isMobile?"1":"1/-1"}}/>
                </div>
                <div style={{display:"flex",gap:"8px",marginTop:"12px"}}>
                  <button onClick={addW} style={S.btn("#10b981")}>✓ 추가</button>
                  <button onClick={()=>setShowForm(null)} style={S.btn("#475569")}>취소</button>
                </div>
              </div>
            )}

            {/* 종목 리스트 */}
            {watchlist.length===0 ? (
              <div style={{...S.card,textAlign:"center",padding:"44px",color:"#475569"}}>
                <div style={{fontSize:"32px",marginBottom:"12px"}}>⭐</div>
                <div style={{fontSize:"15px"}}>관심 종목을 추가하면 현재가와 목표가를 한눈에 비교할 수 있습니다</div>
              </div>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
                {watchlist.map(w => {
                  const p = prices[w.ticker];
                  const cur = w.market==="US"?"USD":w.market==="ETF"&&!w.ticker.includes(".KS")&&!w.ticker.includes(".KQ")?"USD":"KRW";
                  const currentPrice = p?.price;
                  const chg = p?.changePercent ?? 0;
                  const hitBuy  = w.targetBuy  && currentPrice && currentPrice <= +w.targetBuy;
                  const hitSell = w.targetSell && currentPrice && currentPrice >= +w.targetSell;
                  const borderColor = hitBuy ? "rgba(52,211,153,0.5)" : hitSell ? "rgba(248,113,113,0.5)" : "rgba(255,255,255,0.08)";
                  return (
                    <div key={w.id} style={{background:"rgba(255,255,255,0.04)",border:`1px solid ${borderColor}`,borderRadius:"12px",padding:"16px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"12px",gap:"10px",flexWrap:"wrap"}}>
                        <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                          <div style={{width:"10px",height:"10px",borderRadius:"3px",background:MARKET_COLOR[w.market]||"#6366f1",flexShrink:0}}/>
                          <div>
                            <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                              <span style={{fontWeight:800,fontSize:"16px",letterSpacing:"-0.03em",cursor:"pointer",color:"#a5b4fc"}} onClick={()=>setSelectedStock({...w,avgPrice:currentPrice||0,quantity:0})}>{w.ticker}</span>
                              {hitBuy  && <span style={{fontSize:"11px",background:"rgba(52,211,153,0.2)",color:"#34d399",padding:"2px 8px",borderRadius:"20px",fontWeight:700}}>🎯 매수 타이밍!</span>}
                              {hitSell && <span style={{fontSize:"11px",background:"rgba(248,113,113,0.2)",color:"#f87171",padding:"2px 8px",borderRadius:"20px",fontWeight:700}}>🎯 매도 타이밍!</span>}
                            </div>
                            <div style={{fontSize:"12px",color:"#cbd5e1",marginTop:"2px"}}>{w.name||MARKET_LABEL[w.market]}</div>
                            {w.memo&&<div style={{fontSize:"12px",color:"#64748b",marginTop:"3px"}}>📝 {w.memo}</div>}
                          </div>
                        </div>
                        <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
                          <button onClick={()=>setWatchlist(p=>p.filter(x=>x.id!==w.id))} style={{background:"none",border:"none",color:"#475569",cursor:"pointer",fontSize:"16px"}}>✕</button>
                        </div>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"6px"}}>
                        <div style={{background:"rgba(0,0,0,0.2)",borderRadius:"8px",padding:"8px 10px"}}>
                          <div style={{fontSize:"10px",color:"#64748b",marginBottom:"3px",fontWeight:700}}>현재가</div>
                          <div style={{fontSize:"14px",fontWeight:800,color:"#f8fafc"}}>
                            {currentPrice ? (cur==="KRW"?Math.round(currentPrice).toLocaleString("ko-KR")+"₩":"$"+currentPrice.toFixed(2)) : "-"}
                          </div>
                        </div>
                        <div style={{background:"rgba(0,0,0,0.2)",borderRadius:"8px",padding:"8px 10px"}}>
                          <div style={{fontSize:"10px",color:"#64748b",marginBottom:"3px",fontWeight:700}}>일변동</div>
                          <div style={{fontSize:"14px",fontWeight:800,color:chg>=0?"#34d399":"#f87171"}}>{chg>=0?"+":""}{chg.toFixed(2)}%</div>
                        </div>
                        <div style={{background:hitBuy?"rgba(52,211,153,0.1)":"rgba(0,0,0,0.2)",borderRadius:"8px",padding:"8px 10px",border:hitBuy?"1px solid rgba(52,211,153,0.3)":"none"}}>
                          <div style={{fontSize:"10px",color:"#64748b",marginBottom:"3px",fontWeight:700}}>목표 매수가</div>
                          <div style={{fontSize:"13px",fontWeight:700,color:hitBuy?"#34d399":"#94a3b8"}}>
                            {w.targetBuy ? (cur==="KRW"?Math.round(+w.targetBuy).toLocaleString("ko-KR")+"₩":"$"+w.targetBuy) : "-"}
                          </div>
                          {w.targetBuy&&currentPrice&&(
                            <div style={{fontSize:"10px",color:"#64748b",marginTop:"2px"}}>
                              {currentPrice<=+w.targetBuy?"✓ 도달":"까지 "+Math.abs(((currentPrice-+w.targetBuy)/+w.targetBuy)*100).toFixed(1)+"%"}
                            </div>
                          )}
                        </div>
                        <div style={{background:hitSell?"rgba(248,113,113,0.1)":"rgba(0,0,0,0.2)",borderRadius:"8px",padding:"8px 10px",border:hitSell?"1px solid rgba(248,113,113,0.3)":"none"}}>
                          <div style={{fontSize:"10px",color:"#64748b",marginBottom:"3px",fontWeight:700}}>목표 매도가</div>
                          <div style={{fontSize:"13px",fontWeight:700,color:hitSell?"#f87171":"#94a3b8"}}>
                            {w.targetSell ? (cur==="KRW"?Math.round(+w.targetSell).toLocaleString("ko-KR")+"₩":"$"+w.targetSell) : "-"}
                          </div>
                          {w.targetSell&&currentPrice&&(
                            <div style={{fontSize:"10px",color:"#64748b",marginTop:"2px"}}>
                              {currentPrice>=+w.targetSell?"✓ 도달":"까지 "+Math.abs(((+w.targetSell-currentPrice)/currentPrice)*100).toFixed(1)+"%"}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── ALERTS ── */}
        {tab==="alerts"&&(
          <div style={S.card}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"8px",flexWrap:"wrap",gap:"10px"}}>
              <div><div style={{fontSize:"17px",fontWeight:800,letterSpacing:"-0.03em"}}>알람 설정</div><div style={{fontSize:"13px",color:"#475569",marginTop:"5px"}}>일일 변동폭 기준 · 60초마다 자동 체크</div></div>
              <button onClick={()=>setShowForm(showForm==="a"?null:"a")} style={S.btn()}>+ 알람 추가</button>
            </div>
            {showForm==="a"&&(
              <div style={{background:"rgba(0,0,0,0.35)",borderRadius:"12px",padding:"18px",margin:"16px 0",border:"1px solid rgba(99,102,241,0.35)"}}>
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:"8px"}}>
                  <input placeholder="티커" value={aForm.ticker} onChange={e=>setAForm(p=>({...p,ticker:e.target.value.toUpperCase()}))} style={S.inp}/>
                  <select value={aForm.direction} onChange={e=>setAForm(p=>({...p,direction:e.target.value}))} style={{...S.inp,appearance:"none"}}><option value="down">하락 시 알람</option><option value="up">상승 시 알람</option></select>
                  <input placeholder="기준 변동폭 % (예: 3)" type="number" value={aForm.threshold} onChange={e=>setAForm(p=>({...p,threshold:e.target.value}))} style={{...S.inp,gridColumn:"1/-1"}}/>
                </div>
                <div style={{display:"flex",gap:"8px",marginTop:"12px"}}><button onClick={addA} style={S.btn("#10b981")}>✓ 저장</button><button onClick={()=>setShowForm(null)} style={S.btn("#475569")}>취소</button></div>
              </div>
            )}
            {alerts.length===0?(
              <div style={{textAlign:"center",padding:"44px",color:"#475569"}}><div style={{fontSize:"36px",marginBottom:"12px"}}>🔔</div><div>알람을 설정하면 기준 변동폭 초과 시 알림을 받습니다</div></div>
            ):(
              alerts.map(a=>(
                <div key={a.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"18px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"14px"}}>
                    <div style={{fontSize:"24px"}}>{a.direction==="down"?"📉":"📈"}</div>
                    <div><div style={{fontWeight:800,fontSize:"17px",letterSpacing:"-0.03em"}}>{a.ticker}</div><div style={{fontSize:"14px",color:"#94a3b8",marginTop:"4px"}}>{a.direction==="down"?`-${a.threshold}%`:`+${a.threshold}%`} {a.direction==="down"?"이상 하락":"이상 상승"} 시 알람</div></div>
                  </div>
                  <div style={{display:"flex",gap:"10px",alignItems:"center"}}>
                    <button onClick={()=>setAlerts(p=>p.map(x=>x.id===a.id?{...x,enabled:!x.enabled}:x))} style={{...S.btn(a.enabled?"#10b981":"#334155"),padding:"7px 18px"}}>{a.enabled?"ON":"OFF"}</button>
                    <button onClick={()=>setAlerts(p=>p.filter(x=>x.id!==a.id))} style={{background:"none",border:"1px solid rgba(239,68,68,0.35)",color:"#f87171",padding:"7px 16px",borderRadius:"10px",cursor:"pointer",fontSize:"14px",fontWeight:700}}>삭제</button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {selectedStock && <StockDetail holding={selectedStock} price={prices[selectedStock.ticker]} onClose={()=>setSelectedStock(null)} isMobile={isMobile} />}
      {selectedAccount && (
        <AccountDetail
          title={selectedAccount.title}
          items={selectedAccount.items}
          prices={prices}
          snapshots={snapshots}
          onClose={()=>setSelectedAccount(null)}
          isMobile={isMobile}
          liveUsdKrw={liveUsdKrw}
        />
      )}
      {showContrib && (
        <ContribModal
          limits={contribLimits}
          amounts={contribAmounts}
          onSave={saveContrib}
          onClose={()=>setShowContrib(false)}
          isMobile={isMobile}
        />
      )}

      <div style={{position:"fixed",bottom:"22px",right:"22px",display:"flex",flexDirection:"column-reverse",gap:"10px",zIndex:999}}>
        {toasts.map(t=>(
          <div key={t.id} style={{background:t.type==="up"?"rgba(16,185,129,0.18)":t.type==="down"?"rgba(239,68,68,0.18)":"rgba(30,41,59,0.96)",backdropFilter:"blur(14px)",border:`1px solid ${t.type==="up"?"rgba(16,185,129,0.45)":t.type==="down"?"rgba(239,68,68,0.45)":"rgba(255,255,255,0.12)"}`,padding:"14px 20px",borderRadius:"12px",fontSize:"15px",fontWeight:700,maxWidth:"320px",letterSpacing:"-0.01em"}}>
            {t.msg}
          </div>
        ))}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} select option{background:#1e293b} *{-webkit-font-smoothing:antialiased}`}</style>
    </div>
  );
}

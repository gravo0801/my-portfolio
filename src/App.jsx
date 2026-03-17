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

// Vercel API Route 사용 가능 여부 체크
let _useVercelApi = true;

async function fetchViaVercel(tickers) {
  // tickers: string[] → { ticker: result } 반환
  const syms = tickers.join(',');
  const r = await fetch(`/api/quote?symbols=${encodeURIComponent(syms)}`, {
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  });
  if (!r.ok) throw new Error('Vercel API failed: ' + r.status);
  const d = await r.json();
  return d.results || {};
}

async function fetchYahoo(ticker) {
  // 1순위: Vercel API Route (서버사이드, 캐시 없음)
  if (_useVercelApi) {
    try {
      const results = await fetchViaVercel([ticker]);
      if (results[ticker]) return results[ticker];
    } catch (e) {
      // Vercel API 실패 시 폴백으로 전환
      console.warn('[fetchYahoo] Vercel API 실패, 2분 후 재시도:', e.message);
      _useVercelApi = false;
      setTimeout(() => { _useVercelApi = true; }, 120000);
    }
  }

  // 2순위: 기존 프록시 폴백
  const isKR = ticker.endsWith(".KS") || ticker.endsWith(".KQ");
  const fields = "regularMarketPrice,regularMarketPreviousClose,regularMarketChangePercent,preMarketPrice,preMarketChangePercent,postMarketPrice,postMarketChangePercent,currency,marketState";
  const _t = Date.now();
  const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`;
  const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}&fields=${fields}`;

  const proxies = isKR ? [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(chartUrl+"&_="+_t)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(chartUrl.replace("query1","query2")+"&_="+_t)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(chartUrl)}`,
  ] : [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(quoteUrl+"&_="+_t)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(quoteUrl.replace("query1","query2")+"&_="+_t)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(quoteUrl)}`,
  ];

  for (const url of proxies) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const d = await r.json();
      const chartMeta = d?.chart?.result?.[0]?.meta;
      const quoteRes  = d?.quoteResponse?.result?.[0];

      if (chartMeta?.regularMarketPrice) {
        const price = chartMeta.regularMarketPrice;
        const prev  = chartMeta.previousClose || chartMeta.chartPreviousClose || price;
        return { price, changePercent: prev>0?((price-prev)/prev)*100:0, currency: chartMeta.currency||(isKR?"KRW":"USD"), marketState:"REGULAR" };
      } else if (quoteRes?.regularMarketPrice) {
        const price  = quoteRes.regularMarketPrice;
        const prev   = quoteRes.regularMarketPreviousClose || price;
        const state  = quoteRes.marketState || "REGULAR";
        const dPrice = state==="PRE" && quoteRes.preMarketPrice ? quoteRes.preMarketPrice
                     : state==="POST"&& quoteRes.postMarketPrice? quoteRes.postMarketPrice : price;
        const dChg   = state==="PRE" && quoteRes.preMarketPrice
                     ? (quoteRes.preMarketChangePercent??((quoteRes.preMarketPrice-prev)/prev*100))
                     : state==="POST"&& quoteRes.postMarketPrice
                     ? (quoteRes.postMarketChangePercent??((quoteRes.postMarketPrice-prev)/prev*100))
                     : (quoteRes.regularMarketChangePercent??((price-prev)/prev*100));
        return { price:dPrice, regularPrice:price, changePercent:dChg, currency:quoteRes.currency||"USD", marketState:state };
      }
    } catch { continue; }
  }
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
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent("https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1d&range=1d")}`,
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

// 미국 서머타임(EDT) 여부 - 날짜 기반 (브라우저 timezone 무관)
function isUSDST() {
  const now = new Date();
  const y = now.getUTCFullYear();
  // 3월 두번째 일요일 계산
  const dstStart = new Date(Date.UTC(y, 2, 1)); // Mar 1
  dstStart.setUTCDate(1 + (7 - dstStart.getUTCDay()) % 7 + 7); // 2nd Sunday
  dstStart.setUTCHours(7, 0, 0, 0); // 02:00 ET = 07:00 UTC
  // 11월 첫번째 일요일 계산
  const dstEnd = new Date(Date.UTC(y, 10, 1)); // Nov 1
  dstEnd.setUTCDate(1 + (7 - dstEnd.getUTCDay()) % 7); // 1st Sunday
  dstEnd.setUTCHours(6, 0, 0, 0); // 02:00 ET = 06:00 UTC
  return now >= dstStart && now < dstEnd;
}

async function fetchKospiFutures() {
  // 코스피200 야간선물 - Naver Finance SERVICE_ITEM 코드
  // 근월물 코드: 101S06(6월물), 101S09(9월물), 101S12(12월물), 101S03(3월물)
  const now = new Date();
  const m = now.getMonth() + 1;
  const expMonth = m <= 3 ? '03' : m <= 6 ? '06' : m <= 9 ? '09' : '12';
  const futureCode = `101S${expMonth}`;

  // Naver Finance polling API (Vercel API Route 경유)
  const sources = [
    // 1순위: Vercel API Route로 서버사이드 요청
    async () => {
      const r = await fetch(`/api/futures?code=${futureCode}`, { signal: AbortSignal.timeout(6000), cache: 'no-store' });
      if (!r.ok) throw new Error('Vercel futures API failed');
      return await r.json();
    },
    // 2순위: allorigins 프록시
    async () => {
      const naverUrl = `https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${futureCode}`;
      const proxy = `https://api.allorigins.win/raw?url=${encodeURIComponent(naverUrl)}&_=${Date.now()}`;
      const r = await fetch(proxy, { signal: AbortSignal.timeout(7000) });
      const d = await r.json();
      const item = d?.result?.areas?.[0]?.datas?.[0];
      if (!item?.nv) throw new Error('no data');
      const price = parseFloat(item.nv);
      const rf    = String(item.rf || '');
      const crAbs = parseFloat(item.cr || 0);
      const cvAbs = parseFloat(item.cv || 0);
      const sign  = rf === '5' ? -1 : 1;
      return { price, chg: sign * crAbs, chgAmt: sign * cvAbs, label: `코스피200 야간선물(${expMonth}월)` };
    },
  ];

  for (const src of sources) {
    try {
      const res = await src();
      if (res?.price > 0) return res;
    } catch { continue; }
  }
  return null;
}

async function fetchHistory(ticker, market) {
  const isKR = market === "KR" || market === "ISA";
  const isETFKR = market === "ETF" && /^[0-9]/.test(ticker);
  const isCrypto = market === "CRYPTO";
  const isGold = market === "GOLD";

  if (isCrypto) {
    try {
      const id = CRYPTO_IDS[ticker.toUpperCase()] || ticker.toLowerCase();
      const r = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=30&interval=daily`, { signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      return (d.prices||[]).map(([ts, price]) => ({
        date: new Date(ts).toLocaleDateString("ko-KR",{month:"numeric",day:"numeric"}),
        price: Math.round(price*100)/100,
      }));
    } catch { return []; }
  }

  if (isGold) {
    // 금 현물 3개월 차트: GC=F (금 선물 근월물)
    ticker = "GC%3DF";
  }

  // 티커 정규화
  let tk = ticker;
  if ((isKR || isETFKR) && !tk.includes(".")) tk += ".KS";

  const url1 = `https://query1.finance.yahoo.com/v8/finance/chart/${tk}?interval=1d&range=3mo`;
  const url2 = `https://query2.finance.yahoo.com/v8/finance/chart/${tk}?interval=1d&range=3mo`;

  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url1)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url2)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url1)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url2)}`,
  ];

  for (const url of proxies) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) continue;
      const d = await r.json();
      const result = d?.chart?.result?.[0];
      if (!result?.timestamp?.length) continue;
      const timestamps = result.timestamp;
      const closes = result.indicators?.quote?.[0]?.close || [];
      const data = timestamps.map((ts, i) => ({
        date: new Date(ts * 1000).toLocaleDateString("ko-KR",{month:"numeric",day:"numeric"}),
        price: closes[i] ? Math.round(closes[i]*100)/100 : null,
      })).filter(d => d.price !== null);
      if (data.length > 0) return data;
    } catch { continue; }
  }
  return [];
}

async function fetchStockInfo(ticker, market) {
  if (market === "CRYPTO") {
    try {
      const id = CRYPTO_IDS[ticker.toUpperCase()] || ticker.toLowerCase();
      const r = await fetch(`https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false`, { signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      return {
        marketCap: d.market_data?.market_cap?.usd,
        high24h: d.market_data?.high_24h?.usd,
        low24h: d.market_data?.low_24h?.usd,
        ath: d.market_data?.ath?.usd,
        supply: d.market_data?.circulating_supply,
      };
    } catch { return {}; }
  }

  if (market === "GOLD") return {};

  const isKR = market === "KR" || market === "ISA";
  const isETFKR = market === "ETF" && /^[0-9]/.test(ticker);
  let tk = ticker;
  if ((isKR || isETFKR) && !tk.includes(".")) tk += ".KS";

  const url1 = `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${tk}?modules=summaryDetail,defaultKeyStatistics,assetProfile`;
  const url2 = `https://query2.finance.yahoo.com/v11/finance/quoteSummary/${tk}?modules=summaryDetail,defaultKeyStatistics,assetProfile`;

  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url1)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url2)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url1)}`,
  ];

  for (const url of proxies) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
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
  const [mode, setMode] = useState("weather"); // "weather" | "rate" | "rate2"
  const [weather, setWeather] = useState({ seoul:null, nyc:null, tokyo:null, custom:null });
  const [rates, setRates]     = useState({});
  const [wLoading, setWLoading] = useState(false);
  const [rLoading, setRLoading] = useState(false);
  const [customCity, setCustomCity] = useState("london"); // 사용자 선택 도시
  const [extraCurrency, setExtraCurrency] = useState("EUR"); // 추가 환율

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

  const CITIES = {
    london:   { label:"🇬🇧 런던",    lat:51.5074,  lon:-0.1278,  tz:"Europe/London" },
    paris:    { label:"🇫🇷 파리",    lat:48.8566,  lon:2.3522,   tz:"Europe/Paris" },
    shanghai: { label:"🇨🇳 상하이",  lat:31.2304,  lon:121.4737, tz:"Asia/Shanghai" },
    dubai:    { label:"🇦🇪 두바이",  lat:25.2048,  lon:55.2708,  tz:"Asia/Dubai" },
    sydney:   { label:"🇦🇺 시드니",  lat:-33.8688, lon:151.2093, tz:"Australia/Sydney" },
    singapore:{ label:"🇸🇬 싱가포르",lat:1.3521,   lon:103.8198, tz:"Asia/Singapore" },
    frankfurt:{ label:"🇩🇪 프랑크푸르트",lat:50.1109,lon:8.6821, tz:"Europe/Berlin" },
    hongkong: { label:"🇭🇰 홍콩",    lat:22.3193,  lon:114.1694, tz:"Asia/Hong_Kong" },
  };

  const CURRENCIES = {
    EUR:{ label:"🇪🇺 EUR", flag:"€" },
    CNY:{ label:"🇨🇳 CNY", flag:"¥" },
    GBP:{ label:"🇬🇧 GBP", flag:"£" },
    AUD:{ label:"🇦🇺 AUD", flag:"A$" },
    SGD:{ label:"🇸🇬 SGD", flag:"S$" },
    HKD:{ label:"🇭🇰 HKD", flag:"HK$" },
    CHF:{ label:"🇨🇭 CHF", flag:"Fr" },
    CAD:{ label:"🇨🇦 CAD", flag:"C$" },
  };

  const fetchWeather = async () => {
    setWLoading(true);
    try {
      const city = CITIES[customCity];
      const urls = [
        `https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.9780&current=temperature_2m,weathercode&timezone=Asia/Seoul`,
        `https://api.open-meteo.com/v1/forecast?latitude=40.7128&longitude=-74.0060&current=temperature_2m,weathercode&timezone=America/New_York`,
        `https://api.open-meteo.com/v1/forecast?latitude=35.6762&longitude=139.6503&current=temperature_2m,weathercode&timezone=Asia/Tokyo`,
        `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current=temperature_2m,weathercode&timezone=${encodeURIComponent(city.tz)}`,
      ];
      const results = await Promise.all(urls.map(u => fetch(u).then(r=>r.json()).catch(()=>null)));
      setWeather({
        seoul:  results[0] ? { temp: Math.round(results[0].current.temperature_2m), code: results[0].current.weathercode } : null,
        nyc:    results[1] ? { temp: Math.round(results[1].current.temperature_2m), code: results[1].current.weathercode } : null,
        tokyo:  results[2] ? { temp: Math.round(results[2].current.temperature_2m), code: results[2].current.weathercode } : null,
        custom: results[3] ? { temp: Math.round(results[3].current.temperature_2m), code: results[3].current.weathercode } : null,
      });
    } catch {}
    setWLoading(false);
  };

  const fetchRates = async () => {
    setRLoading(true);

    // 1순위: Yahoo Finance 실시간 환율 (장중 실시간 반영)
    const yahooSymbols = ["KRW=X","JPY=X","EURUSD=X","CNY=X","GBPUSD=X","AUDUSD=X","SGD=X","HKD=X","CHF=X","CAD=X"];
    const yahooUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${yahooSymbols.join(",")}&fields=regularMarketPrice,currency`;
    const proxies = [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl.replace("query1","query2"))}`,
    ];

    for (const proxy of proxies) {
      try {
        const r = await fetch(proxy, { signal: AbortSignal.timeout(7000) });
        if (!r.ok) continue;
        const d = await r.json();
        const quotes = d?.quoteResponse?.result || [];
        if (!quotes.length) continue;

        const built = {};
        quotes.forEach(q => {
          const p = q.regularMarketPrice;
          if (!p) return;
          // Yahoo FX: KRW=X → USD→KRW / JPYX → USD→JPY / EURUSDX → EUR per 1 USD
          if (q.symbol === "KRW=X")    built.KRW = p;
          if (q.symbol === "JPY=X")    built.JPY = p;
          // EURUSD=X = USD per EUR → invert to get EUR per USD (Frankfurter 형식과 통일)
          if (q.symbol === "EURUSD=X") built.EUR = p > 0 ? 1/p : null;
          if (q.symbol === "CNY=X")    built.CNY = p;
          if (q.symbol === "GBPUSD=X") built.GBP = p > 0 ? 1/p : null;
          if (q.symbol === "AUDUSD=X") built.AUD = p > 0 ? 1/p : null;
          if (q.symbol === "SGD=X")    built.SGD = p;
          if (q.symbol === "HKD=X")    built.HKD = p;
          if (q.symbol === "CHF=X")    built.CHF = p;
          if (q.symbol === "CAD=X")    built.CAD = p;
        });

        if (built.KRW && built.KRW > 900) {
          setRates(built);
          setRLoading(false);
          return;
        }
      } catch { continue; }
    }

    // 2순위: ExchangeRate-API (일일 기준, 폴백)
    try {
      const r = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(6000) });
      const d = await r.json();
      if (d?.rates?.KRW > 900) { setRates(d.rates); setRLoading(false); return; }
    } catch {}

    // 3순위: Frankfurter (일일 기준, 폴백)
    try {
      const targets = ["KRW","JPY","EUR","CNY","GBP","AUD","SGD","HKD","CHF","CAD"];
      const r = await fetch(`https://api.frankfurter.app/latest?from=USD&to=${targets.join(",")}`, { signal: AbortSignal.timeout(6000) });
      const d = await r.json();
      if (d?.rates?.KRW > 900) { setRates(d.rates); setRLoading(false); return; }
    } catch {}

    setRLoading(false);
  };

  useEffect(() => { fetchWeather(); fetchRates(); }, []);
  useEffect(() => { fetchWeather(); }, [customCity]);
  useEffect(() => {
    const w = setInterval(fetchWeather, 600000);
    // FX: 평일 30초, 주말 5분
    const getFxInterval = () => {
      const day = new Date().getDay();
      return (day === 0 || day === 6) ? 300000 : 30000;
    };
    let rTimer;
    const scheduleRate = () => {
      rTimer = setTimeout(() => { fetchRates(); scheduleRate(); }, getFxInterval());
    };
    scheduleRate();
    return () => { clearInterval(w); clearTimeout(rTimer); };
  }, []);

  const btnStyle = (active) => ({
    background: active ? "rgba(99,102,241,0.35)" : "transparent",
    border: active ? "1px solid rgba(99,102,241,0.5)" : "1px solid rgba(255,255,255,0.1)",
    color: active ? "#c7d2fe" : "#64748b",
    padding: "3px 10px", borderRadius: "6px", cursor: "pointer",
    fontSize: "11px", fontWeight: 700,
  });

  const cardStyle = {
    background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)",
    borderRadius:"10px", padding:"7px 12px", textAlign:"center", minWidth:"72px",
  };

  const krwPer = (cur) => {
    if (!rates?.KRW || !rates?.[cur]) return null;
    return Math.round(rates.KRW / rates[cur]);
  };

  const [collapsed, setCollapsed] = useState(true); // 기본 접힘

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:"4px" }}>
      {/* 접기/펼치기 + 탭 */}
      <div style={{ display:"flex", gap:"4px", alignItems:"center" }}>
        {!collapsed && <>
          <button style={btnStyle(mode==="weather")} onClick={()=>setMode("weather")}>🌤️ 날씨</button>
          <button style={btnStyle(mode==="rate")}    onClick={()=>setMode("rate")}>💱 환율</button>
          <button style={btnStyle(mode==="rate2")}   onClick={()=>{setMode("rate2");if(!Object.keys(rates).length)fetchRates();}}>🌐 통화</button>
        </>}
        <button onClick={()=>setCollapsed(c=>!c)}
          style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", color:"#64748b", padding:"3px 8px", borderRadius:"6px", cursor:"pointer", fontSize:"11px", fontWeight:700 }}>
          {collapsed
            ? `🌤️ ${weather.seoul ? weather.seoul.temp+"°" : "--"} 💱 ${rates?.KRW ? Math.round(rates.KRW).toLocaleString()+"₩" : "--"} ▾`
            : "▴ 접기"
          }
        </button>
      </div>

      {/* 펼쳐진 상태에서만 표시 */}
      {!collapsed && <>
      {/* 날씨 */}
      {mode === "weather" && (
        <div style={{ display:"flex", gap:"6px", alignItems:"flex-start" }}>
          {wLoading ? <span style={{fontSize:"11px",color:"#475569"}}>불러오는 중...</span> : (<>
            {[
              ["🇰🇷 서울", weather.seoul],
              ["🇺🇸 뉴욕",  weather.nyc],
              ["🇯🇵 도쿄", weather.tokyo],
              [CITIES[customCity]?.label, weather.custom],
            ].map(([label, w]) => w ? (
              <div key={label} style={cardStyle}>
                <div style={{ fontSize:"10px", color:"#64748b", marginBottom:"3px", fontWeight:700, whiteSpace:"nowrap" }}>{label}</div>
                <div style={{ fontSize:"22px", lineHeight:1 }}>{WX_ICON[w.code]??'🌡️'}</div>
                <div style={{ fontSize:"16px", fontWeight:800, color:"#f1f5f9", marginTop:"3px" }}>{w.temp}°C</div>
                <div style={{ fontSize:"10px", color:"#64748b", marginTop:"2px" }}>{WX_CODE[w.code]??""}</div>
              </div>
            ) : null)}
            {/* 도시 선택 */}
            <div style={{ display:"flex", flexDirection:"column", justifyContent:"center" }}>
              <select value={customCity} onChange={e=>setCustomCity(e.target.value)}
                style={{ background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.1)", color:"#94a3b8", padding:"3px 6px", borderRadius:"6px", fontSize:"10px", cursor:"pointer", appearance:"none", outline:"none" }}>
                {Object.entries(CITIES).map(([k,v]) => <option key={k} value={k} style={{background:"#1e293b"}}>{v.label}</option>)}
              </select>
            </div>
          </>)}
        </div>
      )}

      {/* 주요 환율 (USD·JPY) */}
      {mode === "rate" && (
        <div style={{ display:"flex", gap:"6px" }}>
          {rLoading ? <span style={{fontSize:"11px",color:"#475569"}}>불러오는 중...</span> : (<>
            {rates?.KRW && (
              <div style={cardStyle}>
                <div style={{ fontSize:"10px", color:"#64748b", marginBottom:"3px", fontWeight:700 }}>🇺🇸 USD</div>
                <div style={{ fontSize:"16px", fontWeight:800, color:"#34d399" }}>{Math.round(rates.KRW).toLocaleString()}₩</div>
                <div style={{ fontSize:"10px", color:"#64748b" }}>1달러</div>
              </div>
            )}
            {rates?.JPY && rates?.KRW && (
              <div style={cardStyle}>
                <div style={{ fontSize:"10px", color:"#64748b", marginBottom:"3px", fontWeight:700 }}>🇯🇵 JPY</div>
                <div style={{ fontSize:"16px", fontWeight:800, color:"#f59e0b" }}>{Math.round(rates.KRW/rates.JPY*100).toLocaleString()}₩</div>
                <div style={{ fontSize:"10px", color:"#64748b" }}>100엔</div>
              </div>
            )}
            {/* 추가 통화 선택 */}
            {rates?.KRW && (
              <div style={cardStyle}>
                <div style={{ fontSize:"10px", color:"#64748b", marginBottom:"3px", fontWeight:700 }}>{CURRENCIES[extraCurrency]?.label}</div>
                <div style={{ fontSize:"16px", fontWeight:800, color:"#a5b4fc" }}>{krwPer(extraCurrency)?.toLocaleString()}₩</div>
                <div style={{ fontSize:"10px", color:"#64748b" }}>1{CURRENCIES[extraCurrency]?.flag}</div>
              </div>
            )}
            <div style={{ display:"flex", flexDirection:"column", justifyContent:"center" }}>
              <select value={extraCurrency} onChange={e=>setExtraCurrency(e.target.value)}
                style={{ background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.1)", color:"#94a3b8", padding:"3px 6px", borderRadius:"6px", fontSize:"10px", cursor:"pointer", appearance:"none", outline:"none" }}>
                {Object.entries(CURRENCIES).map(([k,v]) => <option key={k} value={k} style={{background:"#1e293b"}}>{v.label}</option>)}
              </select>
            </div>
          </>)}
        </div>
      )}

      {/* 전체 환율 보기 */}
      {mode === "rate2" && (
        <div style={{ display:"flex", gap:"6px", flexWrap:"wrap", maxWidth:"400px", justifyContent:"flex-end" }}>
          {rLoading ? <span style={{fontSize:"11px",color:"#475569"}}>불러오는 중...</span> : (
            rates?.KRW ? (
              [
                ["USD","🇺🇸","#34d399","1달러"],
                ["JPY","🇯🇵","#f59e0b","100엔"],
                ["EUR","🇪🇺","#60a5fa","1유로"],
                ["CNY","🇨🇳","#f87171","1위안"],
                ["GBP","🇬🇧","#c084fc","1파운드"],
                ["AUD","🇦🇺","#34d399","1호주달러"],
                ["SGD","🇸🇬","#fb923c","1싱가포르달러"],
                ["HKD","🇭🇰","#f59e0b","1홍콩달러"],
              ].map(([cur, flag, color, label]) => {
                const krw = cur==="JPY"
                  ? Math.round(rates.KRW/rates.JPY*100)
                  : krwPer(cur);
                if (!krw) return null;
                return (
                  <div key={cur} style={{...cardStyle, minWidth:"64px", padding:"5px 8px"}}>
                    <div style={{ fontSize:"10px", color:"#64748b", marginBottom:"2px", fontWeight:700 }}>{flag} {cur}</div>
                    <div style={{ fontSize:"14px", fontWeight:800, color }}>{krw.toLocaleString()}₩</div>
                    <div style={{ fontSize:"9px", color:"#475569" }}>{label}</div>
                  </div>
                );
              })
            ) : <span style={{fontSize:"11px",color:"#f87171",cursor:"pointer"}} onClick={fetchRates}>⟳ 다시 시도</span>
          )}
        </div>
      )}
      </>}
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
  const W = isMobile ? window.innerWidth - 80 : 520;
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
  const toKRWL = (v, cur) => { try { return cur === "KRW" ? (v||0) : (v||0) * (liveUsdKrw||1380); } catch { return 0; } };
  const fmtK   = (v) => {
    const n = Math.abs(Math.round(v));
    if (n >= 100000000) return (Math.round(v/100000000*10)/10).toLocaleString("ko-KR") + "억₩";
    if (n >= 10000)     return (Math.round(v/10000)).toLocaleString("ko-KR") + "만₩";
    return Math.round(v).toLocaleString("ko-KR") + "₩";
  };

  const safeP = prices || {};
  const portfolio = items.map(h => {
    const p   = safeP[h.ticker];
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

  if (!items || items.length === 0) return null;
  if (!liveUsdKrw) return null;

  return (
    <div onClick={onClick} style={{
      background: `${color}12`,
      border: `1px solid ${color}44`,
      borderRadius:"14px", padding:"16px",
      cursor: onClick ? "pointer" : "default",
      transition:"all 0.15s",
    }}
    onMouseEnter={e=>{ if(onClick) e.currentTarget.style.background=`${color}22`; }}
    onMouseLeave={e=>{ if(onClick) e.currentTarget.style.background=`${color}12`; }}>
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
          const p2=safeP[h.ticker]; const cur=h.market==="US"?"USD":"KRW";
          const v=((p2?.price??h.avgPrice)*h.quantity); const c=h.avgPrice*h.quantity;
          return v>c;
        }).length}</span>
        <span style={{color:"#f87171"}}>▼{portfolio.filter(h=>{
          const p2=safeP[h.ticker]; const cur=h.market==="US"?"USD":"KRW";
          const v=((p2?.price??h.avgPrice)*h.quantity); const c=h.avgPrice*h.quantity;
          return v<c;
        }).length}</span>
        {onClick&&<span style={{color:color,fontWeight:700}}>상세 →</span>}
      </div>
    </div>
  );
}

// ── 전체 현황 Overview ────────────────────────────────────────────────────────
function OverviewPanel({ portfolio, portfolio2, holdings, holdings2, prices: rawPrices, snapshots, liveUsdKrw, isMobile, onSelectAccount, setSelectedStock }) {
  const prices = rawPrices || {};
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
              items={g.items}
              prices={prices}
              liveUsdKrw={liveUsdKrw}
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
                      <div style={{fontSize:"13px",fontWeight:800,color:"#f1f5f9"}}>{h.name||h.ticker}</div>
                      <div style={{fontSize:"11px",color:"#a5b4fc",marginTop:"1px"}}>{h.name?h.ticker:""}</div>
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
    const p   = prices[h.ticker] || prices[h.ticker+".KS"] || prices[h.ticker+".KQ"] || null;
    const cur = h.market === "US" ? "USD"
      : h.market === "ETF" && !h.ticker.includes(".KS") && !h.ticker.includes(".KQ") ? "USD"
      : "KRW";
    const price  = p?.price ?? h.avgPrice;
    const value  = price * h.quantity;
    const cost   = h.avgPrice * h.quantity;
    const pnl    = value - cost;
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
    // API에서 직접 받은 변동금액 사용 (계산 오차 없음)
    const chgAmt = p?.changeAmount ?? 0;
    return { ...h, price, value, cost, pnl, pnlPct, cur, chgPct: p?.changePercent ?? 0, chgAmt, hasLive: !!p, marketState: p?.marketState };
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
                  <div style={{fontWeight:700,fontSize:"14px",color:"#f1f5f9"}}>{h.name||h.ticker}</div>
                  <div style={{fontSize:"11px",color:"#a5b4fc",marginTop:"1px"}}>{h.ticker}</div>
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


// ── 애니메이션 숫자 컴포넌트 ─────────────────────────────────────────────────
function AnimatedNumber({ value, format, color, fontSize, duration=800 }) {
  const [display, setDisplay] = useState(value);
  const [isRolling, setIsRolling] = useState(false);
  const prevRef = useRef(value);
  const frameRef = useRef(null);

  useEffect(() => {
    if (prevRef.current === value) return;
    const startVal = prevRef.current;
    const endVal   = value;
    const startTime = performance.now();
    setIsRolling(true);

    // easeOutExpo
    const ease = (t) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t);

    const animate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = ease(progress);
      const current = startVal + (endVal - startVal) * eased;
      setDisplay(current);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        setDisplay(endVal);
        setIsRolling(false);
        prevRef.current = endVal;
      }
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [value]);

  return (
    <span style={{
      color,
      fontSize,
      fontWeight:800,
      letterSpacing:"-0.04em",
      display:"inline-block",
      transition:"color 0.3s",
      filter: isRolling ? "blur(0.4px)" : "none",
      animation: isRolling ? "rollUp 0.1s ease-out" : "none",
    }}>
      {format(display)}
    </span>
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
    try {
      const c   = localStorage.getItem("pm_prices_cache");
      const age = parseInt(localStorage.getItem("pm_prices_age") || "0");
      if (!c) return {};
      const parsed = JSON.parse(c);
      const isNewDay = new Date(age).toDateString() !== new Date().toDateString();
      // 새 날짜면 변동률 0으로 초기화
      if (isNewDay) {
        const cleaned = {};
        Object.entries(parsed).forEach(([k,v]) => { cleaned[k] = {...v, changePercent:0}; });
        return cleaned;
      }
      return Date.now() - age < 1800000 ? parsed : {};
    } catch { return {}; }
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
  const [compactMode, setCompactMode] = useState(false);
  const [kospiFutures, setKospiFutures] = useState(null);
  const [bgTheme, setBgTheme] = useState(() => {
    try { return localStorage.getItem("pm_bg_theme") || "default"; } catch { return "default"; }
  });
  const [bgImage, setBgImage] = useState(() => {
    try { return localStorage.getItem("pm_bg_image") || ""; } catch { return ""; }
  });
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
  // 배당 관련 state
  const [divInfo, setDivInfo]     = useState({}); // { ticker: { perShare, cycle, month, currency } }
  const [divRecords, setDivRecords] = useState([]); // [{ id, date, ticker, name, amount, currency }]
  const [divForm, setDivForm]     = useState({ date:"", ticker:"", name:"", amount:"", currency:"KRW" });
  const [divEditTicker, setDivEditTicker] = useState(null);
  const [divInfoForm, setDivInfoForm]     = useState({ perShare:"", months:[], currency:"KRW" });
  const [hForm2, setHForm2] = useState({ ticker:"", name:"", market:"KR", quantity:"", avgPrice:"", taxAccount:"연금저축1(신한금융투자)", broker:"" });
  const isMobile = useIsMobile();
  const saving = useRef({});
  const fbLoadedRef = useRef({});

  const [hForm, setHForm] = useState({ ticker:"", name:"", market:"KR", stockType:"일반주식", quantity:"", avgPrice:"", broker:"" });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ ticker:"", name:"", market:"KR", quantity:"", avgPrice:"", broker:"" });
  const [tForm, setTForm] = useState({ date:today(), ticker:"", type:"buy", quantity:"", price:"", fee:"", note:"" });
  const [aForm, setAForm] = useState({ ticker:"", direction:"down", threshold:"" });

  useEffect(() => {
    const unsubs = [];
    const attach = (path, setter, key) => {
      const u = dbOn(`users/${syncKey}/${path}`, val => {
        if (saving.current[key]) return;
        fbLoadedRef.current[key] = true;
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
    attach("watchlist",    setWatchlist,   "wl");
    // divInfo는 객체 형태로 저장 - 별도 처리
    const uDi = dbOn(`users/${syncKey}/divInfo`, val => {
      if (saving.current["di"]) return;
      fbLoadedRef.current["di"] = true;
      setDivInfo(val && typeof val === "object" && !Array.isArray(val) ? val : {});
      setLoaded(true);
    });
    unsubs.push(uDi);
    // contribLimits / contribAmounts - 객체 형태
    const uCl = dbOn(`users/${syncKey}/contribLimits`, val => {
      if (saving.current["cl"]) return;
      fbLoadedRef.current["cl"] = true;
      if (val && typeof val === "object" && !Array.isArray(val)) setContribLimits(val);
      setLoaded(true);
    });
    unsubs.push(uCl);
    const uCa = dbOn(`users/${syncKey}/contribAmounts`, val => {
      if (saving.current["ca"]) return;
      fbLoadedRef.current["ca"] = true;
      if (val && typeof val === "object" && !Array.isArray(val)) setContribAmounts(val);
      setLoaded(true);
    });
    unsubs.push(uCa);
    attach("divRecords",   setDivRecords,  "dr");
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
        const ageMs  = Date.now() - age;
        // 오늘 날짜 vs 캐시 날짜 비교 (새 거래일이면 캐시 무효)
        const cacheDate = new Date(age).toDateString();
        const todayDate = new Date().toDateString();
        const isNewDay  = cacheDate !== todayDate;
        // 30분 이내 + 같은 날이면 캐시 사용, 아니면 무시 (빠른 첫 화면용)
        if (!isNewDay && ageMs < 1800000) {
          setPrices(parsed);
          setPriceAge(age);
        } else {
          // 날짜 바뀌었으면 캐시의 changePercent는 틀림 → 가격만 유지, 변동률 제거
          if (isNewDay && parsed && typeof parsed === 'object') {
            const priceOnly = {};
            Object.entries(parsed).forEach(([k,v]) => {
              priceOnly[k] = { ...v, changePercent: 0, chgAmt: 0 };
            });
            setPrices(priceOnly);
          }
        }
      }
    } catch {}
  }, []);

  // 실시간 환율 가져오기
  useEffect(() => {
    // 캐시된 환율 즉시 적용
    try {
      const cached = localStorage.getItem("pm_usd_krw");
      if (cached) setLiveUsdKrw(parseInt(cached));
    } catch {}

    const fetchRate = async () => {
      const apis = [
        async () => { const r = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(6000) }); return (await r.json()).rates?.KRW; },
        async () => { const r = await fetch("https://api.frankfurter.app/latest?from=USD&to=KRW", { signal: AbortSignal.timeout(6000) }); return (await r.json()).rates?.KRW; },
        async () => {
          const url = `https://api.allorigins.win/raw?url=${encodeURIComponent("https://query1.finance.yahoo.com/v8/finance/chart/KRW%3DX?interval=1d&range=1d")}`;
          const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
          return (await r.json())?.chart?.result?.[0]?.meta?.regularMarketPrice;
        },
      ];
      for (const apiFn of apis) {
        try {
          const rate = await apiFn();
          if (rate && rate > 900 && rate < 2000) {
            const rounded = Math.round(rate);
            setLiveUsdKrw(rounded);
            try { localStorage.setItem("pm_usd_krw", String(rounded)); } catch {}
            return;
          }
        } catch { continue; }
      }
    };

    fetchRate();
    const id = setInterval(fetchRate, 300000);
    return () => clearInterval(id);
  }, []);

  // 코스피 야간선물 15초 갱신
  useEffect(() => {
    const load = () => fetchKospiFutures().then(d => { if (d) setKospiFutures(d); });
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  const saveData = useCallback((path, data, key) => {
    if (!loaded) return;
    if (!fbLoadedRef.current[key]) return; // Firebase에서 한 번도 안 읽어온 키는 저장 안 함
    saving.current[key] = true;
    dbSet(`users/${syncKey}/${path}`, data).finally(() => setTimeout(() => { saving.current[key] = false; }, 500));
  }, [syncKey, loaded]);

  useEffect(() => { if (loaded) saveData("holdings",  holdings.length  ? holdings  : [], "h");  }, [holdings,  loaded]);
  useEffect(() => { if (loaded) saveData("holdings2", holdings2.length ? holdings2 : [], "h2"); }, [holdings2, loaded]);
  useEffect(() => { if (loaded) saveData("watchlist",   watchlist.length   ? watchlist   : [],  "wl"); }, [watchlist,  loaded]);
  useEffect(() => { if (loaded) saveData("divInfo",        Object.keys(divInfo).length ? divInfo : {},          "di"); }, [divInfo,        loaded]);
  useEffect(() => { if (loaded) saveData("contribLimits",  Object.keys(contribLimits).length ? contribLimits : {}, "cl"); }, [contribLimits,  loaded]);
  useEffect(() => { if (loaded) saveData("contribAmounts", Object.keys(contribAmounts).length ? contribAmounts: {}, "ca"); }, [contribAmounts, loaded]);
  useEffect(() => { if (loaded) saveData("divRecords",  divRecords.length  ? divRecords  : [],  "dr"); }, [divRecords, loaded]);
  useEffect(() => { if (loaded) saveData("trades",   trades.length   ? trades   : [], "t"); }, [trades,   loaded]);
  useEffect(() => { if (loaded) saveData("alerts",   alerts.length   ? alerts   : [], "a"); }, [alerts,   loaded]);

  const toast = useCallback((msg, type="info") => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(x => x.id !== id)), 7000);
  }, []);

  const fetchPrices = useCallback(async () => {
    if (!holdings.length && !holdings2.length) return;
    setLoading(true);
    const next = {};
    const allItems = [...holdings, ...holdings2, ...watchlist];

    // ── 1. 암호화폐 병렬 처리 ──────────────────────────────────────
    const cryptoItems = allItems.filter(h => h.market === "CRYPTO");
    const goldItems   = allItems.filter(h => h.market === "GOLD");
    const stockItems  = allItems.filter(h => h.market !== "CRYPTO" && h.market !== "GOLD");

    // 코인
    await Promise.all(cryptoItems.map(async h => {
      const raw = await fetchCrypto(h.ticker);
      if (raw) next[h.ticker] = { price: Math.round(raw.price * liveUsdKrw), changePercent: raw.changePercent, currency: "KRW" };
    }));

    // 금현물
    if (goldItems.length > 0) {
      const g = await fetchGold(liveUsdKrw);
      if (g) goldItems.forEach(h => { next[h.ticker] = g; next["GOLD"] = g; });
    }

    // ── 2. 주식/ETF 묶음 조회 (Yahoo Finance batch) ────────────────
    if (stockItems.length > 0) {
      const tickers = [...new Set(stockItems.map(h => {
        let tk = h.ticker;
        // KR/ISA: 항상 .KS (이미 .KQ 있으면 유지)
        if ((h.market === "KR" || h.market === "ISA") && !tk.includes(".")) tk += ".KS";
        // ETF: 숫자로 시작하면 한국 ETF → .KS 추가
        if (h.market === "ETF" && /^\d/.test(tk) && !tk.includes(".")) tk += ".KS";
        return tk;
      }))];

      // 20개씩 묶어서 요청 (Yahoo 한도)
      const chunks = [];
      for (let i = 0; i < tickers.length; i += 20) chunks.push(tickers.slice(i, i + 20));

      const krTickers = tickers.filter(t => t.endsWith(".KS") || t.endsWith(".KQ"));
      const usTickers = tickers.filter(t => !t.endsWith(".KS") && !t.endsWith(".KQ"));

      // 1순위: Vercel API 배치 조회 (서버사이드, 캐시 없음, 빠름)
      if (_useVercelApi && tickers.length > 0) {
        try {
          const batchRes = await fetchViaVercel(tickers);
          let hit = 0;
          tickers.forEach(tk => {
            if (batchRes[tk]) {
              next[tk] = batchRes[tk];
              if (tk.endsWith(".KS")) next[tk.replace(".KS","")] = batchRes[tk];
              if (tk.endsWith(".KQ")) next[tk.replace(".KQ","")] = batchRes[tk];
              hit++;
            }
          });
          console.log(`[시세] Vercel API ${hit}/${tickers.length}개 성공`);
          chunks.length = 0; // 배치 성공 → 아래 fallback 루프 스킵
        } catch(e) {
          console.warn('[시세] Vercel API 실패 → 2분 후 재시도:', e.message);
          _useVercelApi = false;
          setTimeout(() => { _useVercelApi = true; }, 120000);
        }
      }

      // 2순위: Vercel 실패 시 개별 병렬 조회
      if (!_useVercelApi) {
        await Promise.all(krTickers.map(async tk => {
          const r = await fetchYahoo(tk);
          if (r) { next[tk] = r; next[tk.replace(".KS","").replace(".KQ","")] = r; }
        }));
        await Promise.all(usTickers.map(async tk => {
          const r = await fetchYahoo(tk);
          if (r) next[tk] = r;
        }));
        chunks.length = 0;
      }

      for (const chunk of chunks) {
        if (!chunk.length) continue;
        const syms = chunk.join(",");
        let fetched = false;
        for (const proxyFn of proxies) {
          try {
            const r = await fetch(proxyFn(syms), { signal: AbortSignal.timeout(8000) });
            if (!r.ok) continue;
            const d = await r.json();
            const quotes = d?.quoteResponse?.result || d?.quoteSummary?.result || [];
            if (!quotes.length) continue;
            quotes.forEach(q => {
              const sym = q.symbol;
              const price = q.regularMarketPrice;
              const prev  = q.regularMarketPreviousClose || price;
              if (!price) return;
              const state = q.marketState || "REGULAR";
              // 프리/애프터 가격 반영
              const displayPrice = state==="PRE"  && q.preMarketPrice  ? q.preMarketPrice
                                 : state==="POST" && q.postMarketPrice ? q.postMarketPrice
                                 : price;
              // 변동률: 프리/애프터는 전일 종가 대비, 정규장은 Yahoo 제공값 사용
              const displayChg = state==="PRE"  && q.preMarketPrice
                               ? (q.preMarketChangePercent ?? ((q.preMarketPrice-prev)/prev)*100)
                               : state==="POST" && q.postMarketPrice
                               ? (q.postMarketChangePercent ?? ((q.postMarketPrice-prev)/prev)*100)
                               : (q.regularMarketChangePercent ?? ((price-prev)/prev)*100);
              next[sym] = {
                price: displayPrice,
                regularPrice: price,
                changePercent: displayChg,
                regularChangePercent: q.regularMarketChangePercent ?? ((price-prev)/prev)*100,
                currency: q.currency || "KRW",
                marketState: state,
              };
              // .KS 티커 → 원래 티커도 매핑
              if (sym.endsWith(".KS")) next[sym.replace(".KS", "")] = next[sym];
              if (sym.endsWith(".KQ")) next[sym.replace(".KQ", "")] = next[sym];
            });
            fetched = true;
            break;
          } catch { continue; }
        }
        // 묶음 실패 or 일부 누락 시 개별 fallback
        const missingTickers = chunk.filter(tk => !next[tk]);
        if (!fetched || missingTickers.length > 0) {
          const toFetch = !fetched ? chunk : missingTickers;
          await Promise.all(toFetch.map(async tk => {
            // v7/quote 먼저 시도
            let r = await fetchYahoo(tk);
            // 실패 시 v8/chart로 재시도
            if (!r) {
              try {
                const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${tk}?interval=1d&range=1d`;
                const proxied = `https://api.allorigins.win/raw?url=${encodeURIComponent(chartUrl)}`;
                const resp = await fetch(proxied, { signal: AbortSignal.timeout(7000) });
                if (resp.ok) {
                  const d = await resp.json();
                  const m = d?.chart?.result?.[0]?.meta;
                  if (m?.regularMarketPrice) {
                    const price = m.regularMarketPrice;
                    const prev  = m.previousClose || m.chartPreviousClose || price;
                    r = { price, changePercent: prev>0?((price-prev)/prev)*100:0, currency: m.currency||"USD", marketState:"REGULAR" };
                  }
                }
              } catch {}
            }
            if (r) {
              next[tk] = r;
              if (tk.endsWith(".KS")) next[tk.replace(".KS","")] = r;
              if (tk.endsWith(".KQ")) next[tk.replace(".KQ","")] = r;
            }
          }));
        }
      }
    }

    // ── 3. 결과 저장 + 알람 체크 ──────────────────────────────────
    // 성공/실패 현황
    const allTickers = [...holdings,...holdings2,...watchlist].map(h=>h.ticker);
    const succeeded = allTickers.filter(t => next[t] || next[t+".KS"] || next[t+".KQ"]).length;
    const failed = allTickers.length - succeeded;

    setPrices(prev => {
      const merged = { ...prev, ...next };
      try {
        // 캐시에는 가격/통화만 저장 (변동률은 항상 fresh fetch 필요)
        const cacheOnly = {};
        Object.entries(merged).forEach(([k,v]) => {
          cacheOnly[k] = { price: v.price, regularPrice: v.regularPrice, currency: v.currency };
        });
        localStorage.setItem("pm_prices_cache", JSON.stringify(cacheOnly));
        localStorage.setItem("pm_prices_age", String(Date.now()));
      } catch {}
      return merged;
    });
    if (failed > 0) console.warn(`[시세] ${succeeded}/${allTickers.length} 성공, ${failed}개 실패:`, allTickers.filter(t=>!next[t]&&!next[t+".KS"]&&!next[t+".KQ"]));
    const now = new Date();
    setLastUpdated(now.toLocaleTimeString("ko-KR", { hour:"2-digit", minute:"2-digit", second:"2-digit" }));
    setPriceAge(now.getTime());

    // 관심종목 목표가 알림
    watchlist.forEach(w => {
      const p = next[w.ticker]; if (!p) return;
      const price = p.price;
      if (w.targetBuy  && price <= +w.targetBuy)  toast(`🎯 ${w.ticker} 목표 매수가 ${Math.round(+w.targetBuy).toLocaleString()}₩ 도달!`, "up");
      if (w.targetSell && price >= +w.targetSell) toast(`🎯 ${w.ticker} 목표 매도가 ${Math.round(+w.targetSell).toLocaleString()}₩ 도달!`, "down");
    });
    // 가격 알람
    alerts.filter(a => a.enabled).forEach(a => {
      const p = next[a.ticker]; if (!p) return;
      if (a.direction === "down" && p.changePercent <= -(+a.threshold)) toast(`📉 ${a.ticker} ${a.threshold}% 이상 하락!`, "down");
      if (a.direction === "up"   && p.changePercent >= +(+a.threshold)) toast(`📈 ${a.ticker} ${a.threshold}% 이상 상승!`, "up");
    });
    setLoading(false);
  }, [holdings, holdings2, watchlist, alerts, toast, syncKey, liveUsdKrw]);

  useEffect(() => {
    if (!loaded || (!holdings.length && !holdings2.length)) return;
    // 항상 즉시 새로고침 (캐시는 첫 화면에만 사용)
    fetchPrices();

    // 장 중 감지 (KST 기준)
    const getInterval = () => {
      const kst = new Date(Date.now() + 9*3600000);
      const mins = kst.getUTCHours()*60+kst.getUTCMinutes();
      const isDST = isUSDST();
      const kospi  = mins>=9*60 && mins<15*60+35;
      const nyseReg  = mins>=(isDST?22*60+30:23*60+30) || mins<(isDST?5*60:6*60);
      const nysePre  = mins>=(isDST?17*60+30:18*60) && mins<(isDST?22*60+30:23*60+30);
      const nyseAfter= mins>=(isDST?5*60:6*60) && mins<(isDST?9*60:10*60);
      if (kospi || nyseReg)        return 5000;   // 정규장(국내/미국): 5초
      if (nysePre || nyseAfter)    return 10000;  // 프리/애프터: 10초
      return 60000;
    };

    let interval;
    const schedule = () => {
      interval = setTimeout(() => {
        fetchPrices();
        schedule();
      }, getInterval());
    };
    schedule();
    return () => clearTimeout(interval);
  }, [loaded, holdings.length, holdings2.length]);

  const marketCur = (market) => (market === "US" || market === "ETF") ? "USD" : "KRW";
  const portfolio = holdings.map(h => {
    const p   = prices[h.ticker] || prices[h.ticker+".KS"] || prices[h.ticker+".KQ"] || null;
    const cur = h.market === "US" ? "USD"
      : h.market === "ETF" ? (p?.currency || (h.ticker.includes(".KS")||h.ticker.includes(".KQ") ? "KRW" : "USD"))
      : "KRW"; // KR, ISA, CRYPTO, GOLD, GOLD 모두 원화
    const price = p?.price ?? h.avgPrice;
    const value = price * h.quantity;
    const cost  = h.avgPrice * h.quantity;
    const pnl   = value - cost;
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
    // API에서 직접 받은 변동금액 사용 (계산 오차 없음)
    const chgAmt = p?.changeAmount ?? 0;
    return { ...h, price, value, cost, pnl, pnlPct, cur, chgPct: p?.changePercent ?? 0, chgAmt, hasLive: !!p, marketState: p?.marketState };
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
    setHForm({ ticker:"", name:"", market:"KR", stockType:"일반주식", quantity:"", avgPrice:"", broker:"" }); setShowForm(null);
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
  const renderTableRow = (h, compact=false) => (
    <>
    <tr key={h.id}>
      <td style={{...S.TD,cursor:"pointer",padding:compact?"4px 8px":"8px 12px"}} onClick={()=>setSelectedStock(h)} onMouseEnter={()=>{if(!_chartCache[h.ticker]){fetchHistory(h.ticker,h.market).then(d=>{_chartCache[h.ticker]=d});fetchStockInfo(h.ticker,h.market).then(d=>{_infoCache[h.ticker]=d});} }}>
        <div style={{display:"flex",alignItems:"center",gap:compact?"6px":"10px"}}>
          <div style={{width:compact?"7px":"10px",height:compact?"7px":"10px",borderRadius:"2px",background:MARKET_COLOR[h.market],flexShrink:0}}/>
          <div>
            <div style={{fontWeight:700,fontSize:compact?"12px":"15px",letterSpacing:"-0.02em",color:"#f1f5f9"}}>{h.name||MARKET_LABEL[h.market]}</div>
            <div style={{fontSize:"10px",color:"#a5b4fc",fontWeight:600,marginTop:"1px",textDecoration:"underline",textDecorationStyle:"dotted",textUnderlineOffset:"2px"}}>{h.ticker}</div>
            {h.market==="ISA"&&<div style={{fontSize:"10px",color:"#06b6d4",background:"rgba(6,182,212,0.12)",border:"1px solid rgba(6,182,212,0.3)",display:"inline-block",padding:"1px 7px",borderRadius:"4px",fontWeight:800,marginTop:"3px",letterSpacing:"0.05em"}}>ISA</div>}
                                {h.broker&&<div style={{fontSize:"11px",color:"#6366f1",background:"rgba(99,102,241,0.12)",display:"inline-block",padding:"1px 6px",borderRadius:"4px",fontWeight:700,marginTop:"2px"}}>{h.broker}</div>}
          </div>
        </div>
      </td>
      <td style={S.TD}>
        <div style={{fontWeight:700}}>{fmtPrice(h.price,h.cur)}</div>
        {h.marketState==="PRE"  && <div style={{fontSize:"9px",color:"#fbbf24",fontWeight:700,marginTop:"2px"}}>🌅 프리장</div>}
        {h.marketState==="POST" && <div style={{fontSize:"9px",color:"#a78bfa",fontWeight:700,marginTop:"2px"}}>🌙 애프터</div>}
        {!h.hasLive&&<div style={{fontSize:"11px",color:"#475569"}}>매수가 기준</div>}
      </td>
      <td style={{...S.TD,color:h.chgPct>=0?"#34d399":"#f87171",fontWeight:700}}>
        <div style={{fontWeight:800}}>
          {h.chgAmt ? (h.chgAmt>=0?"+":"")+( h.cur==="USD"
            ? "$"+Math.abs(h.chgAmt).toFixed(2)
            : Math.round(Math.abs(h.chgAmt)).toLocaleString()+"₩"
          ) : "—"}
        </div>
        <div style={{fontSize:"11px",opacity:0.85}}>({fmtPct(h.chgPct)})</div>
        {h.marketState==="PRE"  && <div style={{fontSize:"9px",color:"#fbbf24",fontWeight:700,lineHeight:1.2}}>🌅프리</div>}
        {h.marketState==="POST" && <div style={{fontSize:"9px",color:"#c084fc",fontWeight:700,lineHeight:1.2}}>🌙애프터</div>}
      </td>
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
  const renderMobileCard = (h, compact=false) => (
    <div key={h.id} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:compact?"7px":"10px",padding:compact?"7px 10px":"12px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"8px"}}>
        <div style={{display:"flex",alignItems:"center",gap:"8px",cursor:"pointer"}} onClick={()=>setSelectedStock(h)} onTouchStart={()=>{if(!_chartCache[h.ticker]){fetchHistory(h.ticker,h.market).then(d=>{_chartCache[h.ticker]=d});fetchStockInfo(h.ticker,h.market).then(d=>{_infoCache[h.ticker]=d});}}}>
          <div style={{width:"8px",height:"8px",borderRadius:"2px",background:MARKET_COLOR[h.market],flexShrink:0}}/>
          <div>
            <div style={{fontWeight:800,fontSize:"15px",letterSpacing:"-0.02em",color:"#f1f5f9"}}>{h.name||MARKET_LABEL[h.market]}</div>
            <div style={{fontSize:"11px",color:"#a5b4fc",fontWeight:600,marginTop:"2px"}}>{h.ticker} <span style={{color:"#6366f1",fontSize:"10px"}}>상세보기 ›</span></div>
            {h.stockType&&h.stockType!=="일반주식"&&<div style={{fontSize:"10px",color:"#f59e0b",background:"rgba(245,158,11,0.1)",display:"inline-block",padding:"1px 5px",borderRadius:"4px",fontWeight:700,marginTop:"2px"}}>{h.stockType}</div>}
            {h.broker&&<div style={{fontSize:"10px",color:"#6366f1",background:"rgba(99,102,241,0.12)",display:"inline-block",padding:"1px 5px",borderRadius:"4px",fontWeight:700,marginTop:"2px"}}>{h.broker}</div>}
          </div>
        </div>
        <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
          <button onClick={()=>editingId===h.id?setEditingId(null):startEdit(h)} style={{background:"none",border:"1px solid rgba(99,102,241,0.4)",color:"#a5b4fc",cursor:"pointer",fontSize:"11px",padding:"2px 8px",borderRadius:"6px",fontWeight:700}}>수정</button>
          <button onClick={()=>setHoldings(p=>p.filter(x=>x.id!==h.id))} style={{background:"none",border:"none",color:"#475569",cursor:"pointer",fontSize:"16px"}}>✕</button>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:compact?"3px":"6px"}}>
        <div style={{background:"rgba(0,0,0,0.2)",borderRadius:"6px",padding:"6px 8px"}}><div style={{fontSize:"10px",color:"#64748b",marginBottom:"2px"}}>현재가</div><div style={{fontSize:"13px",fontWeight:700}}>{fmtPrice(h.price,h.cur)}</div>{!h.hasLive&&<div style={{fontSize:"10px",color:"#475569"}}>매수가기준</div>}</div>
        <div style={{background:"rgba(0,0,0,0.2)",borderRadius:"6px",padding:"6px 8px"}}><div style={{fontSize:"10px",color:"#64748b",marginBottom:"2px"}}>일변동</div><div style={{color:h.chgPct>=0?"#34d399":"#f87171"}}>
                    <span style={{fontSize:"13px",fontWeight:800}}>
                      {h.chgAmt ? (h.chgAmt>=0?"+":"-")+(h.cur==="USD"
                        ? "$"+Math.abs(h.chgAmt).toFixed(2)
                        : Math.round(Math.abs(h.chgAmt)).toLocaleString()+"₩"
                      ) : "—"}
                    </span>
                    <span style={{fontSize:"11px",marginLeft:"3px",opacity:0.85}}>({fmtPct(h.chgPct)})</span>
                    {h.marketState==="PRE"  && <span style={{fontSize:"9px",background:"rgba(251,191,36,0.2)",color:"#fbbf24",padding:"1px 5px",borderRadius:"4px",marginLeft:"4px",fontWeight:700}}>프리</span>}
                    {h.marketState==="POST" && <span style={{fontSize:"9px",background:"rgba(167,139,250,0.2)",color:"#a78bfa",padding:"1px 5px",borderRadius:"4px",marginLeft:"4px",fontWeight:700}}>애프터</span>}
                  </div></div>
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
    setShowContrib(false);
  };

  const FONT = "'Pretendard','Apple SD Gothic Neo','Noto Sans KR',system-ui,sans-serif";
  const tabs = [["overview","🏠 전체현황"],["portfolio","📊 포트폴리오"],["charts","📈 차트"],["trades","📝 매매일지"],["dividend","💰 배당"],["watchlist","⭐ 관심종목"],["alerts","🔔 알람"]];
  const TT = { contentStyle:{ background:"#1e293b", border:"1px solid rgba(255,255,255,0.12)", borderRadius:"10px", fontSize:"13px", fontFamily:FONT } };

  // 포트폴리오2 계산
  const portfolio2 = holdings2.map(h => {
    const p   = prices[h.ticker] || prices[h.ticker+".KS"] || prices[h.ticker+".KQ"] || (h.market==="GOLD" ? prices["GOLD"] : null);
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
    <div style={{
      background: bgImage
        ? `url(${bgImage}) center/cover fixed`
        : bgTheme==="ocean"   ? "linear-gradient(135deg,#0c1445 0%,#0f3460 50%,#16213e 100%)"
        : bgTheme==="forest"  ? "linear-gradient(135deg,#0a1f0f 0%,#0d2b1a 50%,#0f1b0d 100%)"
        : bgTheme==="sunset"  ? "linear-gradient(135deg,#1a0a2e 0%,#2d1b4e 40%,#3d1518 100%)"
        : bgTheme==="midnight"? "linear-gradient(135deg,#000000 0%,#0a0a1a 50%,#050510 100%)"
        : bgTheme==="navy"    ? "linear-gradient(135deg,#0a0f2c 0%,#0d1b3e 50%,#091428 100%)"
        : "linear-gradient(135deg,#0f172a 0%,#1e1b4b 100%)",
      color:"#e2e8f0", minHeight:"100vh", fontFamily:FONT, fontSize:"15px", lineHeight:"1.6", letterSpacing:"-0.01em",
    }}>
      {/* 배경 이미지 오버레이 */}
      {bgImage && <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:0,pointerEvents:"none"}}/>}
      {/* ── 장 상태 최상단 바 ── */}
      <div style={{ background:"rgba(6,9,20,0.98)", borderBottom:"1px solid rgba(255,255,255,0.07)", padding:"6px 18px", position:"sticky", top:0, zIndex:51, display:"flex", alignItems:"center", gap:"20px", flexWrap:"wrap" }}>
        {(()=>{
          const kst  = new Date(Date.now()+9*3600000);
          const mins = kst.getUTCHours()*60+kst.getUTCMinutes();
          const isDST = isUSDST();

          // 국내장 시간대 (KST)
          // KRX: 정규 09:00~15:30 / 시간외단일가 16:00~18:00
          // NXT(대체거래소): 프리 08:00~08:50 / 정규 09:00~15:20 / 애프터 15:40~20:00
          const krPre     = mins>=8*60    && mins<9*60;         // 08:00~09:00 프리 (NXT)
          const krRegular = mins>=9*60    && mins<15*60+30;     // 09:00~15:30 정규
          const krAfter   = mins>=15*60+30&& mins<20*60;        // 15:30~20:00 애프터 (NXT 포함)
          const krClosed  = !krPre && !krRegular && !krAfter;

          // 미국장 시간대 (섬머타임 자동 반영)
          const usPreStart  = isDST?17*60+30:18*60;
          const usRegStart  = isDST?22*60+30:23*60+30;
          const usRegEnd    = isDST?5*60:6*60;
          const usAfterEnd  = isDST?9*60:10*60;
          const usRegular = mins>=usRegStart || mins<usRegEnd;
          const usPre     = !usRegular && mins>=usPreStart && mins<usRegStart;
          const usAfter   = !usRegular && mins>=usRegEnd   && mins<usAfterEnd;

          const MarketItem = ({flag, name, regular, pre, after}) => {
            let dotColor, label, labelColor;
            if      (regular) { dotColor="#22c55e"; label="정규장"; labelColor="#4ade80"; }
            else if (pre)     { dotColor="#f59e0b"; label="프리장"; labelColor="#fbbf24"; }
            else if (after)   { dotColor="#a78bfa"; label="애프터"; labelColor="#c4b5fd"; }
            else              { dotColor="#374151"; label="장마감"; labelColor="#6b7280"; }
            return (
              <div style={{display:"flex",alignItems:"center",gap:"7px",lineHeight:1}}>
                <span style={{
                  width:"9px",height:"9px",borderRadius:"50%",background:dotColor,
                  display:"inline-block",flexShrink:0,
                  boxShadow:regular?"0 0 7px "+dotColor:pre?"0 0 5px "+dotColor:after?"0 0 5px "+dotColor:"none"
                }}/>
                <span style={{fontSize:"11px",color:"#94a3b8",fontWeight:500,letterSpacing:"0.02em"}}>{flag} {name}</span>
                <span style={{fontSize:"12px",fontWeight:700,color:labelColor,letterSpacing:"-0.01em"}}>{label}</span>
                {(regular||pre||after)&&<span style={{fontSize:"9px",background:dotColor+"25",color:dotColor,padding:"1px 6px",borderRadius:"20px",fontWeight:700,letterSpacing:"0.04em"}}>LIVE</span>}
              </div>
            );
          };

          return (<>
            <MarketItem flag="🇰🇷" name="국내" regular={krRegular} pre={krPre} after={krAfter}/>
            <span style={{color:"rgba(255,255,255,0.08)",fontSize:"16px",userSelect:"none"}}>|</span>
            <MarketItem flag="🇺🇸" name="미국" regular={usRegular} pre={usPre} after={usAfter}/>
            {/* 코스피 야간선물 */}
            {kospiFutures && (()=>{
              const kst = new Date(Date.now()+9*3600000);
              const mins = kst.getUTCHours()*60+kst.getUTCMinutes();
              const isNight = mins>=15*60+30 || mins<9*60; // 정규장 외 시간
              if (!isNight) return null;
              const { price, chg } = kospiFutures;
              const isUp = chg >= 0;
              return (
                <div style={{display:"flex",alignItems:"center",gap:"6px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"8px",padding:"3px 10px"}}>
                  <span style={{fontSize:"10px",color:"#64748b",fontWeight:600}}>🌙 {kospiFutures.label||"코스피200선물"}</span>
                  <span style={{fontSize:"12px",fontWeight:700,color:"#f1f5f9"}}>{typeof price==="number"?price.toLocaleString():price}</span>
                  <span style={{fontSize:"11px",fontWeight:700,color:isUp?"#34d399":"#f87171"}}>
                    {isUp?"+":""}{kospiFutures.chgAmt ? kospiFutures.chgAmt.toFixed(2) : chg.toFixed(2)}pt
                    <span style={{fontSize:"9px",opacity:0.8,marginLeft:"3px"}}>({isUp?"+":""}{chg.toFixed(2)}%)</span>
                  </span>
                </div>
              );
            })()}
            <span style={{marginLeft:"auto",fontSize:"10px",color:"#374151",display:"flex",alignItems:"center",gap:"6px"}}>
              {loading&&<span style={{color:"#6366f1",fontWeight:600}}>↻ 조회중</span>}
              {!loading&&(lastUpdated||priceAge>0)&&<span style={{color:"#4b5563"}}>{lastUpdated||new Date(priceAge).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</span>}
            </span>
          </>);
        })()}
      </div>

      <div style={{ background:"rgba(15,23,42,0.88)", backdropFilter:"blur(14px)", borderBottom:"1px solid rgba(255,255,255,0.08)", padding:isMobile?"7px 12px":"8px 18px", position:"sticky", top:"31px", zIndex:50 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"8px", flexWrap:"wrap" }}>
          {/* 좌: 타이틀 + 상태 */}
          <div style={{ display:"flex", alignItems:"center", gap:"10px", minWidth:0, flexWrap:"wrap" }}>
            <div style={{ fontSize:isMobile?"16px":"20px", fontWeight:800, letterSpacing:"-0.04em", color:"#f8fafc", whiteSpace:"nowrap" }}>📈 내 투자 포트폴리오</div>
            {(lastUpdated || priceAge > 0) && (
              <span style={{ fontSize:"10px", color:"#475569", display:"flex", alignItems:"center", gap:"4px" }}>

                <span style={{color:"#475569"}}>{lastUpdated || new Date(priceAge).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</span>
                {loading && <span style={{color:"#6366f1",fontWeight:700}}>↻</span>}
              </span>
            )}
            <span style={{ background:"rgba(99,102,241,0.15)", color:"#a5b4fc", padding:"1px 7px", borderRadius:"20px", fontSize:"10px", fontWeight:700 }}>🔑 {syncKey}</span>
          </div>
          {/* 우: 버튼 + 위젯 */}
          <div style={{ display:"flex", alignItems:"center", gap:"6px", flexShrink:0 }}>
            {!isMobile && <InfoWidget />}
            <button onClick={fetchPrices} disabled={loading} style={S.btn(loading?"#334155":"#6366f1", { display:"flex", alignItems:"center", gap:"3px", opacity:loading?0.7:1, fontSize:"11px", padding:"5px 9px" })}>
              <span style={{ display:"inline-block", animation:loading?"spin 1s linear infinite":"none" }}>↻</span>
              {loading?"…":"새로고침"}
            </button>
            <button onClick={()=>setShowForm(showForm==="theme"?null:"theme")} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#94a3b8",padding:"5px 9px",borderRadius:"8px",cursor:"pointer",fontSize:"11px",fontWeight:600}} title="배경 테마">🎨</button>
            <button onClick={onLogout} style={S.btn("#334155", { fontSize:"11px", padding:"5px 9px" })}>로그아웃</button>
          </div>
        </div>
        {isMobile && <div style={{ marginTop:"4px" }}><InfoWidget /></div>}

        {/* 테마 선택 패널 */}
        {showForm==="theme" && (
          <div style={{background:"rgba(8,12,28,0.98)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"12px",padding:"16px",marginTop:"8px",zIndex:100}}>
            <div style={{fontSize:"13px",fontWeight:700,color:"#e2e8f0",marginBottom:"12px"}}>🎨 배경 테마</div>
            {/* 프리셋 색상 */}
            <div style={{display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"14px"}}>
              {[
                ["default","기본","#0f172a"],["navy","네이비","#0a0f2c"],["ocean","오션","#0c1445"],
                ["forest","포레스트","#0a1f0f"],["sunset","선셋","#1a0a2e"],["midnight","미드나잇","#000000"],
              ].map(([key,label,color])=>(
                <button key={key} onClick={()=>{setBgTheme(key);setBgImage("");try{localStorage.setItem("pm_bg_theme",key);localStorage.removeItem("pm_bg_image");}catch{};setShowForm(null);}}
                  style={{display:"flex",alignItems:"center",gap:"6px",background:bgTheme===key?"rgba(99,102,241,0.3)":"rgba(255,255,255,0.05)",border:bgTheme===key?"1px solid rgba(99,102,241,0.5)":"1px solid rgba(255,255,255,0.1)",color:bgTheme===key?"#c7d2fe":"#94a3b8",padding:"6px 12px",borderRadius:"8px",cursor:"pointer",fontSize:"12px",fontWeight:bgTheme===key?700:500}}>
                  <span style={{width:"14px",height:"14px",borderRadius:"3px",background:color,border:"1px solid rgba(255,255,255,0.2)",flexShrink:0}}/>
                  {label}
                </button>
              ))}
            </div>
            {/* 배경 이미지 업로드 */}
            <div style={{borderTop:"1px solid rgba(255,255,255,0.07)",paddingTop:"12px"}}>
              <div style={{fontSize:"12px",color:"#64748b",marginBottom:"8px"}}>📷 배경 이미지 (JPG/PNG)</div>
              <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
                <label style={{background:"rgba(99,102,241,0.2)",border:"1px solid rgba(99,102,241,0.35)",color:"#a5b4fc",padding:"6px 14px",borderRadius:"8px",cursor:"pointer",fontSize:"12px",fontWeight:700}}>
                  이미지 선택
                  <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      const dataUrl = ev.target.result;
                      setBgImage(dataUrl);
                      setBgTheme("default");
                      try { localStorage.setItem("pm_bg_image", dataUrl); } catch {}
                      setShowForm(null);
                    };
                    reader.readAsDataURL(file);
                  }}/>
                </label>
                {bgImage && (
                  <button onClick={()=>{setBgImage("");try{localStorage.removeItem("pm_bg_image");}catch{};}} style={{background:"none",border:"1px solid rgba(248,113,113,0.35)",color:"#f87171",padding:"6px 10px",borderRadius:"8px",cursor:"pointer",fontSize:"12px"}}>
                    이미지 제거
                  </button>
                )}
                {bgImage && <span style={{fontSize:"11px",color:"#34d399"}}>✓ 적용됨</span>}
              </div>
              <div style={{fontSize:"10px",color:"#475569",marginTop:"6px"}}>※ 이미지는 브라우저에만 저장됩니다</div>
            </div>
          </div>
        )}
        {/* 포트폴리오 선택 탭 */}
        <div style={{ display:"flex", gap:"4px", marginTop:"6px", marginBottom:"4px" }}>
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

      <div style={{ padding:isMobile?"10px 12px":"14px 20px", maxWidth:"1200px", margin:"0 auto", paddingTop:isMobile?"10px":"14px" }}>

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
        {tab === "portfolio" && mainTab === "p1" && (
          <div style={{display:"flex",flexDirection:"column",gap:"0"}}>

          {/* ── 뷰 선택 탭 ── */}
          <div style={{display:"flex",gap:"4px",marginBottom:"14px",flexWrap:"wrap"}}>
            {[["all","🗂 전체"],["broker","🏢 증권사별"],["market","🌍 국내·해외별"]].map(([id,label])=>(
              <button key={id} onClick={()=>setOverviewTab(id)} style={{
                background:overviewTab===id?"rgba(99,102,241,0.3)":"rgba(255,255,255,0.04)",
                border:overviewTab===id?"1px solid rgba(99,102,241,0.5)":"1px solid rgba(255,255,255,0.08)",
                color:overviewTab===id?"#c7d2fe":"#64748b",
                padding:isMobile?"5px 10px":"6px 16px", borderRadius:"8px", cursor:"pointer",
                fontSize:isMobile?"12px":"13px", fontWeight:overviewTab===id?800:500, letterSpacing:"-0.01em",
              }}>{isMobile?label.split(" ")[1]:label}</button>
            ))}
          </div>

          {/* ── 증권사별 / 국내해외별 테이블 뷰 ── */}
          {(overviewTab==="broker"||overviewTab==="market") && (()=>{
            const allP = [...portfolio, ...portfolio2];

            // 그룹 정의
            const getGroups = () => {
              if (overviewTab==="broker") {
                const map = {};
                allP.forEach(h=>{ const k=h.broker||h.taxAccount||"미지정"; if(!map[k])map[k]=[]; map[k].push(h); });
                return Object.entries(map).sort().map(([k,items])=>({ key:k, label:"🏦 "+k, sub:"", color:"#818cf8", items }));
              }
              // market
              return [
                { key:"domestic", label:"🇰🇷 국내 주식", sub:"KR · ISA · 금현물", color:"#6366f1", items: allP.filter(h=>h.market==="KR"||h.market==="ISA"||h.market==="GOLD") },
                { key:"overseas", label:"🌎 해외 주식", sub:"미국 · ETF", color:"#10b981", items: allP.filter(h=>h.market==="US"||h.market==="ETF") },
                { key:"crypto",   label:"🪙 암호화폐", sub:"BTC · ETH 등", color:"#a855f7", items: allP.filter(h=>h.market==="CRYPTO") },
              ].filter(g=>g.items.length>0);
            };

            return (
              <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
                {getGroups().map(g => {
                  const gVal  = g.items.reduce((s,h)=>s+toKRWLive(h.value,h.cur),0);
                  const gCost = g.items.reduce((s,h)=>s+toKRWLive(h.cost, h.cur),0);
                  const gRet  = gCost>0?((gVal-gCost)/gCost)*100:0;
                  const gPnL  = gVal-gCost;
                  return (
                    <div key={g.key} style={{...S.card,padding:isMobile?"10px":"14px",borderTop:`3px solid ${g.color}`}}>
                      {/* 그룹 헤더 */}
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px",flexWrap:"wrap",gap:"8px"}}>
                        <div>
                          <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                            <span style={{fontSize:"15px",fontWeight:800,color:"#f1f5f9",letterSpacing:"-0.02em"}}>{g.label}</span>
                            {g.sub&&<span style={{fontSize:"11px",color:"#64748b"}}>{g.sub}</span>}
                            <span style={{fontSize:"11px",color:"#475569",background:"rgba(255,255,255,0.06)",padding:"1px 7px",borderRadius:"20px"}}>{g.items.length}종목</span>
                          </div>
                          <div style={{display:"flex",gap:"12px",marginTop:"4px",flexWrap:"wrap"}}>
                            <span style={{fontSize:"13px",fontWeight:700,color:"#e2e8f0"}}>{fmtKRW(gVal)}</span>
                            <span style={{fontSize:"13px",fontWeight:700,color:gRet>=0?"#34d399":"#f87171"}}>{gRet>=0?"+":""}{gRet.toFixed(2)}%</span>
                            <span style={{fontSize:"12px",color:"#64748b"}}>{gPnL>=0?"+":""}{fmtKRW(gPnL)}</span>
                          </div>
                        </div>
                        <button onClick={()=>setSelectedAccount({title:g.label,items:g.items.map(h=>({...h,id:h.id||Math.random()}))})}
                          style={{background:"rgba(99,102,241,0.15)",border:"1px solid rgba(99,102,241,0.35)",color:"#a5b4fc",padding:"4px 10px",borderRadius:"8px",cursor:"pointer",fontSize:"11px",fontWeight:700}}>
                          📊 상세보기
                        </button>
                      </div>
                      {/* 종목 테이블 */}
                      {isMobile ? (
                        <div style={{display:"flex",flexDirection:"column",gap:compactMode?"4px":"7px",maxHeight:"50vh",overflowY:"auto"}}>
                          {g.items.map(h=>renderMobileCard(h,compactMode))}
                        </div>
                      ) : (
                        <div style={{overflowY:"auto",maxHeight:compactMode?"400px":"320px"}}>
                          <table style={{width:"100%",borderCollapse:"collapse"}}>
                            <thead><tr>{["종목","현재가","일변동(금액/%)","수량","평가금액","손익률",""].map(th=><th key={th} style={S.TH}>{th}</th>)}</tr></thead>
                            <tbody>{g.items.map(h=>renderTableRow(h,compactMode))}</tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* ── 전체 뷰 (기존 포트폴리오 화면) ── */}
          {overviewTab==="all" && (
            <div>
            {/* 통화 전환 버튼 */}
            <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:"8px" }}>
              <div style={{ display:"flex", background:"rgba(255,255,255,0.06)", borderRadius:"10px", padding:"3px", gap:"2px" }}>
                <button onClick={()=>setCurrMode("KRW")} style={{ padding:"5px 14px", borderRadius:"8px", border:"none", cursor:"pointer", fontSize:"13px", fontWeight:700, background:currMode==="KRW"?"rgba(99,102,241,0.5)":"transparent", color:currMode==="KRW"?"#c7d2fe":"#64748b" }}>₩ 원화</button>
                <button onClick={()=>setCurrMode("USD")} style={{ padding:"5px 14px", borderRadius:"8px", border:"none", cursor:"pointer", fontSize:"13px", fontWeight:700, background:currMode==="USD"?"rgba(16,185,129,0.4)":"transparent", color:currMode==="USD"?"#6ee7b7":"#64748b" }}>$ 달러</button>
              </div>
            </div>
            {/* 요약 카드 */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:isMobile?"8px":"12px", marginBottom:isMobile?"14px":"20px" }}>
              <div style={{ ...S.card, background:"rgba(99,102,241,0.09)", borderColor:"rgba(99,102,241,0.22)" }}>
                <div style={{ fontSize:"12px", color:"#64748b", marginBottom:"6px", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em" }}>총 평가금액</div>
                <AnimatedNumber
                  value={currMode==="KRW" ? totalVal : totalVal/liveUsdKrw}
                  format={v => currMode==="KRW"
                    ? fmtKRW(v)
                    : "$"+(Math.round(v)).toLocaleString("en-US")}
                  color="#f8fafc"
                  fontSize={isMobile?"15px":"22px"}
                />
                {currMode==="USD"&&<div style={{ fontSize:"10px", color:"#475569", marginTop:"3px" }}>환율 {liveUsdKrw.toLocaleString()}₩ 기준</div>}
              </div>
              <div style={{ ...S.card, background:"rgba(99,102,241,0.09)", borderColor:"rgba(99,102,241,0.22)" }}>
                <div style={{ fontSize:"12px", color:"#64748b", marginBottom:"6px", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em" }}>평가 손익</div>
                <AnimatedNumber
                  value={currMode==="KRW" ? totalPnL : totalPnL/liveUsdKrw}
                  format={v => {
                    const sign = v >= 0 ? "+" : "";
                    return currMode==="KRW"
                      ? sign + fmtKRW(v)
                      : (v>=0?"+":"-") + "$" + Math.abs(Math.round(v)).toLocaleString("en-US");
                  }}
                  color={totalPnL>=0?"#34d399":"#f87171"}
                  fontSize={isMobile?"15px":"22px"}
                />
              </div>
              <div style={{ ...S.card, background:"rgba(99,102,241,0.09)", borderColor:"rgba(99,102,241,0.22)" }}>
                <div style={{ fontSize:"12px", color:"#64748b", marginBottom:"6px", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em" }}>총 수익률</div>
                <AnimatedNumber
                  value={totalRet}
                  format={v => (v>=0?"+":"") + v.toFixed(2) + "%"}
                  color={totalRet>=0?"#34d399":"#f87171"}
                  fontSize={isMobile?"15px":"22px"}
                />
              </div>
            </div>
            {/* 보유종목 + 자산배분 그리드 */}
            {/* ── 아이디어2: 자산배분 상단 요약 바 ── */}
            {portfolio.length>0&&(
              <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"12px",padding:isMobile?"10px 12px":"10px 16px",marginBottom:"8px"}}>
                {/* 비중 스택 바 */}
                <div style={{display:"flex",height:"10px",borderRadius:"5px",overflow:"hidden",gap:"2px",marginBottom:"8px"}}>
                  {pieData.map(d=>(
                    <div key={d.name} title={d.name} style={{flex:d.value,background:d.color,minWidth:"2px"}}/>
                  ))}
                </div>
                {/* 시장별 레이블 + 수익률 */}
                <div style={{display:"flex",gap:isMobile?"8px":"16px",flexWrap:"wrap",alignItems:"center",justifyContent:"space-between"}}>
                  <div style={{display:"flex",gap:isMobile?"6px":"12px",flexWrap:"wrap"}}>
                    {pieData.map(d=>{
                      const tot=pieData.reduce((s,x)=>s+x.value,0);
                      return(
                        <span key={d.name} style={{display:"flex",alignItems:"center",gap:"4px",fontSize:"11px",color:"#94a3b8"}}>
                          <span style={{width:"7px",height:"7px",borderRadius:"2px",background:d.color,flexShrink:0,display:"inline-block"}}/>
                          {d.name} <span style={{fontWeight:700,color:"#e2e8f0"}}>{((d.value/tot)*100).toFixed(0)}%</span>
                        </span>
                      );
                    })}
                  </div>
                  {/* 시장별 수익률 인라인 */}
                  <div style={{display:"flex",gap:isMobile?"8px":"14px",flexWrap:"wrap"}}>
                    {Object.entries(MARKET_LABEL).map(([k,label])=>{
                      const items=portfolio.filter(h=>h.market===k);
                      if(!items.length) return null;
                      const val=items.reduce((s,h)=>s+toKRWLive(h.value,h.cur),0);
                      const cost=items.reduce((s,h)=>s+toKRWLive(h.cost,h.cur),0);
                      const ret=cost>0?((val-cost)/cost)*100:0;
                      return(
                        <span key={k} style={{fontSize:"11px",display:"flex",alignItems:"center",gap:"3px"}}>
                          <span style={{color:"#64748b"}}>{label}</span>
                          <span style={{fontWeight:700,color:ret>=0?"#34d399":"#f87171"}}>{ret>=0?"+":""}{ret.toFixed(1)}%</span>
                        </span>
                      );
                    }).filter(Boolean)}
                  </div>
                </div>
              </div>
            )}

            {/* ── 아이디어2: 전체 너비 테이블 + 아이디어3: 컴팩트 모드 ── */}
            <div style={{...S.card, padding:isMobile?"10px":"14px"}}>
              {/* 헤더 + 컨트롤 */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"10px", gap:"6px", flexWrap:"wrap" }}>
                <div>
                  <div style={{ fontSize:"15px", fontWeight:800, letterSpacing:"-0.03em" }}>보유 종목
                    <span style={{ fontSize:"12px", fontWeight:500, color:"#64748b", marginLeft:"8px" }}>{portfolio.length}종목</span>
                  </div>
                  {!isMobile&&<div style={{ fontSize:"10px", color:"#475569", marginTop:"2px" }}>KOSPI: 005930 → 자동 .KS | KOSDAQ: 035720.KQ</div>}
                </div>
                <div style={{ display:"flex", gap:"5px", alignItems:"center", flexWrap:"wrap" }}>
                  <button onClick={()=>setSelectedAccount({title:"포트폴리오1 전체", items:holdings})} style={{background:"rgba(99,102,241,0.15)",border:"1px solid rgba(99,102,241,0.35)",color:"#a5b4fc",padding:"4px 10px",borderRadius:"8px",cursor:"pointer",fontSize:"11px",fontWeight:700}}>📊 상세</button>
                  <button onClick={()=>setCompactMode(c=>!c)} style={{background:compactMode?"rgba(99,102,241,0.3)":"rgba(255,255,255,0.05)",border:compactMode?"1px solid rgba(99,102,241,0.5)":"1px solid rgba(255,255,255,0.1)",color:compactMode?"#c7d2fe":"#64748b",padding:"4px 10px",borderRadius:"8px",cursor:"pointer",fontSize:"11px",fontWeight:700}}>
                    {compactMode?"□ 기본":"▣ 컴팩트"}
                  </button>
                  <button onClick={()=>setGroupBy(g=>g==="none"?"broker":"none")} style={{ ...S.btn(groupBy==="broker"?"#6366f1":"#334155", { fontSize:"11px", padding:"4px 10px" }) }}>
                    {groupBy==="broker"?"그룹 해제":"🏦 증권사"}
                  </button>
                  <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{ ...S.inp, width:"auto", fontSize:"11px", padding:"4px 8px", appearance:"none" }}>
                    <option value="default">기본순</option>
                    <option value="pnl_desc">수익률↑</option>
                    <option value="pnl_asc">수익률↓</option>
                    <option value="value_desc">평가금액↑</option>
                  </select>
                  <button onClick={() => setShowForm(showForm==="h"?null:"h")} style={S.btn("#6366f1", { flexShrink:0, fontSize:"11px", padding:"4px 10px" })}>+ 추가</button>
                </div>
              </div>

              {/* 요약 통계 (컴팩트 모드에서 숨김) */}
              {!compactMode&&(
                <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"repeat(4,1fr)", gap:"5px", marginBottom:"10px" }}>
                  {[
                    ["수익 종목", portfolio.filter(h=>h.pnlPct>0).length+"개", "#34d399"],
                    ["손실 종목", portfolio.filter(h=>h.pnlPct<0).length+"개", "#f87171"],
                    ["최고 수익", portfolio.length?(()=>{const m=portfolio.reduce((a,b)=>b.pnlPct>a.pnlPct?b:a,portfolio[0]);return m.ticker+" "+fmtPct(m.pnlPct);})():"-","#34d399"],
                    ["최대 손실", portfolio.length?(()=>{const m=portfolio.reduce((a,b)=>b.pnlPct<a.pnlPct?b:a,portfolio[0]);return m.ticker+" "+fmtPct(m.pnlPct);})():"-","#f87171"],
                  ].map(([l,v,c])=>(
                    <div key={l} style={{ background:"rgba(255,255,255,0.03)", borderRadius:"7px", padding:"6px 9px" }}>
                      <div style={{ fontSize:"10px", color:"#64748b", marginBottom:"2px", fontWeight:700 }}>{l}</div>
                      <div style={{ fontSize:"12px", fontWeight:800, color:c }}>{v}</div>
                    </div>
                  ))}
                </div>
              )}

              {showForm==="h" && (
                <div style={{ background:"rgba(0,0,0,0.35)", borderRadius:"12px", padding:"14px", marginBottom:"14px", border:"1px solid rgba(99,102,241,0.35)" }}>
                  <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:"8px" }}>
                    <input placeholder="티커 (예: 005930, AAPL, BTC)" value={hForm.ticker} onChange={e=>setHForm(p=>({...p,ticker:e.target.value.toUpperCase()}))} style={S.inp}/>
                    <input placeholder="종목명" value={hForm.name} onChange={e=>setHForm(p=>({...p,name:e.target.value}))} style={S.inp}/>
                    <select value={hForm.market} onChange={e=>setHForm(p=>({...p,market:e.target.value}))} style={{...S.inp,appearance:"none"}}>
                      <option value="KR">한국주식</option><option value="ISA">한국주식(ISA)</option><option value="US">미국주식</option><option value="ETF">ETF</option><option value="CRYPTO">암호화폐</option><option value="GOLD">금현물</option>
                    </select>
                    <select value={hForm.stockType||"일반주식"} onChange={e=>setHForm(p=>({...p,stockType:e.target.value}))} style={{...S.inp,appearance:"none"}}>
                      <option value="일반주식">일반주식</option><option value="ETF">ETF</option><option value="리츠">리츠(REITs)</option><option value="우선주">우선주</option>
                    </select>
                    <input placeholder="수량" type="number" value={hForm.quantity} onChange={e=>setHForm(p=>({...p,quantity:e.target.value}))} style={S.inp}/>
                    <input placeholder="평균 매수가" type="number" value={hForm.avgPrice} onChange={e=>setHForm(p=>({...p,avgPrice:e.target.value}))} style={S.inp}/>
                    <select value={hForm.broker} onChange={e=>setHForm(p=>({...p,broker:e.target.value}))} style={{...S.inp,appearance:"none",gridColumn:"1/-1"}}>
                      <option value="">증권사 선택 (선택사항)</option>
                      <option value="미래에셋증권">미래에셋증권</option><option value="신한금융투자">신한금융투자</option>
                      <option value="토스증권">토스증권</option><option value="카카오페이증권">카카오페이증권</option>
                      <option value="메리츠증권">메리츠증권</option><option value="키움증권">키움증권</option><option value="업비트">업비트</option>
                    </select>
                  </div>
                  <div style={{display:"flex",gap:"8px",marginTop:"10px"}}>
                    <button onClick={addH} style={S.btn("#10b981")}>✓ 추가</button>
                    <button onClick={()=>setShowForm(null)} style={S.btn("#475569")}>취소</button>
                  </div>
                </div>
              )}

              {portfolio.length===0 ? (
                <div style={{textAlign:"center",padding:"44px",color:"#475569"}}>
                  <div style={{fontSize:"36px",marginBottom:"12px"}}>📋</div>
                  <div>종목을 추가하면 실시간 시세를 조회합니다</div>
                </div>
              ) : isMobile ? (
                <div style={{display:"flex",flexDirection:"column",gap:compactMode?"4px":"8px",maxHeight:"65vh",overflowY:"auto",paddingRight:"2px"}}>
                  {(()=>{
                    let sorted=[...portfolio];
                    if(sortBy==="pnl_desc") sorted.sort((a,b)=>b.pnlPct-a.pnlPct);
                    else if(sortBy==="pnl_asc") sorted.sort((a,b)=>a.pnlPct-b.pnlPct);
                    else if(sortBy==="value_desc") sorted.sort((a,b)=>toKRWLive(b.value,b.cur)-toKRWLive(a.value,a.cur));
                    if(groupBy==="broker"){
                      const groups={};
                      sorted.forEach(h=>{ const k=h.broker||"증권사 미지정";if(!groups[k])groups[k]=[];groups[k].push(h); });
                      return Object.entries(groups).map(([broker,items])=>(
                        <div key={broker}>
                          <div style={{fontSize:"11px",fontWeight:700,color:"#6366f1",padding:"5px 4px",borderBottom:"1px solid rgba(99,102,241,0.2)",marginBottom:"4px"}}>🏦 {broker} ({items.length})</div>
                          {items.map(h=>renderMobileCard(h,compactMode))}
                        </div>
                      ));
                    }
                    return sorted.map(h=>renderMobileCard(h,compactMode));
                  })()}
                  <div style={{fontSize:"10px",color:"#334155",textAlign:"right",marginTop:"4px",paddingBottom:"4px"}}>* USD 1달러 = {liveUsdKrw.toLocaleString()}원 (실시간)</div>
                </div>
              ) : (
                <div style={{overflowY:"auto",maxHeight:compactMode?"600px":"480px"}}>
                  {(()=>{
                    let sorted=[...portfolio];
                    if(sortBy==="pnl_desc") sorted.sort((a,b)=>b.pnlPct-a.pnlPct);
                    else if(sortBy==="pnl_asc") sorted.sort((a,b)=>a.pnlPct-b.pnlPct);
                    else if(sortBy==="value_desc") sorted.sort((a,b)=>toKRWLive(b.value,b.cur)-toKRWLive(a.value,a.cur));
                    if(groupBy==="broker"){
                      const groups={};
                      sorted.forEach(h=>{ const k=h.broker||"증권사 미지정";if(!groups[k])groups[k]=[];groups[k].push(h); });
                      return Object.entries(groups).map(([broker,items])=>(
                        <div key={broker} style={{marginBottom:"10px"}}>
                          <div style={{fontSize:"11px",fontWeight:700,color:"#6366f1",padding:"5px 10px",background:"rgba(99,102,241,0.08)",borderRadius:"5px",marginBottom:"3px",display:"flex",justifyContent:"space-between"}}>
                            <span>🏦 {broker}</span>
                            <span style={{color:"#64748b"}}>{items.length}종목 · {fmtKRW(items.reduce((s,h)=>s+toKRWLive(h.value,h.cur),0))}</span>
                          </div>
                          <table style={{width:"100%",borderCollapse:"collapse"}}>
                            <thead><tr>{["종목","현재가","일변동","수량","평가금액","손익률",""].map(h=><th key={h} style={S.TH}>{h}</th>)}</tr></thead>
                            <tbody>{items.map(h=>renderTableRow(h,compactMode))}</tbody>
                          </table>
                        </div>
                      ));
                    }
                    return (
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr>{["종목","현재가","일변동","수량","평가금액","손익률",""].map(h=><th key={h} style={S.TH}>{h}</th>)}</tr></thead>
                        <tbody>{sorted.map(h=>renderTableRow(h,compactMode))}</tbody>
                      </table>
                    );
                  })()}
                  <div style={{fontSize:"11px",color:"#334155",textAlign:"right",marginTop:"8px"}}>* USD 1달러 = {liveUsdKrw.toLocaleString()}원 기준 (실시간)</div>
                </div>
              )}
            </div>
            </div>
          )}

          </div>
        )}

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
                                    <div style={{fontWeight:800,fontSize:"14px",letterSpacing:"-0.02em",color:"#f1f5f9"}}>{h.name||MARKET_LABEL[h.market]}</div>
                                    <div style={{fontSize:"11px",color:"#a5b4fc",fontWeight:600,marginTop:"1px"}}>{h.ticker}</div>
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

        {/* ── DIVIDEND ── */}
        {tab==="dividend"&&(
          <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>

            {/* ── 요약 카드 ── */}
            {(()=>{
              const now = new Date();
              const curYear = now.getFullYear();
              const curMonth = now.getMonth()+1;
              const allHoldings = [...holdings, ...holdings2];

              // 예상 연간 배당금 계산
              let expectedAnnual = 0;
              allHoldings.forEach(h => {
                const di = divInfo[h.ticker];
                if (!di || !di.perShare) return;
                const ps = +di.perShare;
                const qty = +h.quantity;
                const isUSD = di.currency === "USD";
                const rawM = di.months||[];
                const divMonths = Array.isArray(rawM) ? rawM : Object.values(rawM);
                const annualRaw = ps*(divMonths.length||1);
                expectedAnnual += (isUSD ? annualRaw*liveUsdKrw : annualRaw) * qty;
              });

              // 올해 실수령 배당금
              const thisYearDiv = divRecords.filter(r=>new Date(r.date).getFullYear()===curYear)
                .reduce((s,r)=>{
                  const amt = +r.amount;
                  return s + (r.currency==="USD"?amt*liveUsdKrw:amt);
                },0);

              // 이번달 배당금
              const thisMonthDiv = divRecords.filter(r=>{
                const d=new Date(r.date);
                return d.getFullYear()===curYear && d.getMonth()+1===curMonth;
              }).reduce((s,r)=>s+(r.currency==="USD"?+r.amount*liveUsdKrw:+r.amount),0);

              return (
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"12px"}}>
                  {[
                    ["예상 연간 배당", Math.round(expectedAnnual).toLocaleString("ko-KR")+"₩", "#f59e0b"],
                    ["예상 월 평균",   Math.round(expectedAnnual/12).toLocaleString("ko-KR")+"₩", "#34d399"],
                    ["올해 수령액",    Math.round(thisYearDiv).toLocaleString("ko-KR")+"₩", "#a5b4fc"],
                  ].map(([label,val,color])=>(
                    <div key={label} style={{...S.card,background:"rgba(245,158,11,0.07)",borderColor:"rgba(245,158,11,0.2)"}}>
                      <div style={{fontSize:"11px",color:"#64748b",marginBottom:"6px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>{label}</div>
                      <div style={{fontSize:isMobile?"16px":"22px",fontWeight:800,color,letterSpacing:"-0.04em"}}>{val}</div>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* ── 월별 배당금 바 차트 ── */}
            {(()=>{
              const now = new Date();
              const curYear = now.getFullYear();
              const months = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
              const allHoldings = [...holdings,...holdings2];

              // 실수령 월별
              const actualByMonth = Array(12).fill(0);
              divRecords.filter(r=>new Date(r.date).getFullYear()===curYear).forEach(r=>{
                const m = new Date(r.date).getMonth();
                actualByMonth[m] += r.currency==="USD"?+r.amount*liveUsdKrw:+r.amount;
              });

              // 예상 월별
              const expectedByMonth = Array(12).fill(0);
              allHoldings.forEach(h=>{
                const di = divInfo[h.ticker];
                if(!di||!di.perShare) return;
                const ps=+di.perShare, qty=+h.quantity;
                const isUSD=di.currency==="USD";
                const raw=ps*qty*(isUSD?liveUsdKrw:1);
                const rawMonths=di.months||[];
                const months=Array.isArray(rawMonths)?rawMonths:Object.values(rawMonths);
                months.forEach(m=>{ expectedByMonth[m-1]+=raw; });
              });

              const maxVal = Math.max(...actualByMonth, ...expectedByMonth, 1);
              const curM = now.getMonth();

              return (
                <div style={S.card}>
                  <div style={{fontSize:"15px",fontWeight:800,marginBottom:"16px",letterSpacing:"-0.02em"}}>📅 월별 배당금 현황 ({curYear}년)</div>
                  <div style={{display:"flex",gap:"4px",alignItems:"flex-end",height:"140px",marginBottom:"8px"}}>
                    {months.map((m,i)=>{
                      const actual = actualByMonth[i];
                      const expected = expectedByMonth[i];
                      const actH = Math.round((actual/maxVal)*120);
                      const expH = Math.round((expected/maxVal)*120);
                      const isCur = i===curM;
                      return (
                        <div key={m} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:"2px"}}>
                          <div style={{width:"100%",display:"flex",flexDirection:"column",justifyContent:"flex-end",height:"120px",gap:"2px",position:"relative"}}>
                            {/* 예상 바 (연한) */}
                            {expH>0&&<div style={{position:"absolute",bottom:0,left:0,right:0,height:expH+"px",background:"rgba(245,158,11,0.2)",borderRadius:"3px 3px 0 0",border:"1px dashed rgba(245,158,11,0.4)"}}/>}
                            {/* 실수령 바 */}
                            {actH>0&&<div style={{position:"absolute",bottom:0,left:"15%",right:"15%",height:actH+"px",background:isCur?"#f59e0b":"rgba(245,158,11,0.7)",borderRadius:"3px 3px 0 0"}}/>}
                          </div>
                          <div style={{fontSize:"9px",color:isCur?"#f59e0b":"#475569",fontWeight:isCur?700:400,textAlign:"center"}}>{m}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{display:"flex",gap:"16px",fontSize:"11px",color:"#64748b"}}>
                    <span style={{display:"flex",alignItems:"center",gap:"4px"}}><span style={{width:"10px",height:"10px",borderRadius:"2px",background:"rgba(245,158,11,0.7)",display:"inline-block"}}/>실수령</span>
                    <span style={{display:"flex",alignItems:"center",gap:"4px"}}><span style={{width:"10px",height:"10px",borderRadius:"2px",border:"1px dashed rgba(245,158,11,0.6)",display:"inline-block"}}/>예상</span>
                  </div>
                </div>
              );
            })()}

            {/* ── 종목별 배당 정보 ── */}
            <div style={S.card}>
              <div style={{fontSize:"15px",fontWeight:800,marginBottom:"14px",letterSpacing:"-0.02em"}}>🏷️ 종목별 배당 정보</div>
              <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                {[...holdings,...holdings2].filter(h=>h.market!=="CRYPTO").map(h=>{
                  const di = divInfo[h.ticker]||{};
                  const isEditing = divEditTicker===h.ticker;
                  const rawCM=di.months||[]; const cm=Array.isArray(rawCM)?rawCM:Object.values(rawCM);
                  const cycleLabel = cm.length ? cm.join("·")+"월 ("+cm.length+"회/년)" : "";
                  const ps=+di.perShare||0, qty=+h.quantity;
                  const isUSD=di.currency==="USD";
                  const rawDivM=di.months||[];
              const months=Array.isArray(rawDivM)?rawDivM:Object.values(rawDivM);
              const annual=ps*(months.length||1);
                  const annualKRW=annual*(isUSD?liveUsdKrw:1)*qty;
                  const yieldPct = h.avgPrice>0&&annual>0 ? (annual/(isUSD?h.avgPrice*liveUsdKrw:h.avgPrice))*100 : 0;
                  return (
                    <div key={h.ticker} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"10px",padding:"12px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:isEditing?"12px":"0",flexWrap:"wrap",gap:"8px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                          <div style={{width:"8px",height:"8px",borderRadius:"2px",background:MARKET_COLOR[h.market]||"#64748b",flexShrink:0}}/>
                          <div>
                            <div style={{fontWeight:700,fontSize:"14px",color:"#f1f5f9"}}>{h.name||h.ticker}</div>
                            <div style={{fontSize:"11px",color:"#64748b"}}>{h.ticker} · {h.quantity}주</div>
                          </div>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap"}}>
                          {ps>0&&(
                            <div style={{textAlign:"right"}}>
                              <div style={{fontSize:"13px",fontWeight:700,color:"#f59e0b"}}>{Math.round(annualKRW).toLocaleString()}₩/년</div>
                              <div style={{fontSize:"11px",color:"#64748b"}}>{cycleLabel} · 수익률 {yieldPct.toFixed(2)}%</div>
                            </div>
                          )}
                          <button onClick={()=>{
                            if(isEditing){setDivEditTicker(null);}
                            else{
                              setDivEditTicker(h.ticker);
                              const rawEM=di.months||[]; setDivInfoForm({perShare:di.perShare||"",months:Array.isArray(rawEM)?rawEM:Object.values(rawEM),currency:di.currency||"KRW"});
                            }
                          }} style={{background:"none",border:"1px solid rgba(99,102,241,0.4)",color:"#a5b4fc",padding:"4px 10px",borderRadius:"6px",cursor:"pointer",fontSize:"12px",fontWeight:700}}>
                            {isEditing?"✕ 닫기":"✏️ 편집"}
                          </button>
                        </div>
                      </div>
                      {isEditing&&(
                        <div style={{display:"flex",flexDirection:"column",gap:"10px",marginTop:"4px"}}>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                            <div>
                              <div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>주당 배당금 (1회 지급액)</div>
                              <input type="number" placeholder="예: 500 (₩) 또는 0.25 ($)" value={divInfoForm.perShare} onChange={e=>setDivInfoForm(p=>({...p,perShare:e.target.value}))} style={{...S.inp,fontSize:"13px",padding:"7px 10px"}}/>
                            </div>
                            <div>
                              <div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>통화</div>
                              <select value={divInfoForm.currency} onChange={e=>setDivInfoForm(p=>({...p,currency:e.target.value}))} style={{...S.inp,fontSize:"13px",padding:"7px 10px",appearance:"none"}}>
                                <option value="KRW">₩ 원화</option>
                                <option value="USD">$ 달러</option>
                              </select>
                            </div>
                          </div>
                          <div>
                            <div style={{fontSize:"11px",color:"#64748b",marginBottom:"6px"}}>배당 지급 월 <span style={{color:"#475569"}}>(해당되는 월을 모두 선택)</span></div>
                            <div style={{display:"flex",flexWrap:"wrap",gap:"6px"}}>
                              {[1,2,3,4,5,6,7,8,9,10,11,12].map(m=>{
                                const selected=(divInfoForm.months||[]).includes(m);
                                return (
                                  <button key={m} onClick={()=>setDivInfoForm(p=>{
                                    const cur=p.months||[];
                                    return {...p,months:selected?cur.filter(x=>x!==m):[...cur,m].sort((a,b)=>a-b)};
                                  })} style={{
                                    width:"40px",height:"36px",borderRadius:"8px",cursor:"pointer",
                                    fontSize:"13px",fontWeight:selected?800:500,
                                    background:selected?"rgba(245,158,11,0.3)":"rgba(255,255,255,0.05)",
                                    border:selected?"1px solid rgba(245,158,11,0.6)":"1px solid rgba(255,255,255,0.1)",
                                    color:selected?"#fbbf24":"#64748b",
                                  }}>{m}월</button>
                                );
                              })}
                            </div>
                            <div style={{display:"flex",gap:"8px",marginTop:"8px",flexWrap:"wrap"}}>
                              {[["월배당",[1,2,3,4,5,6,7,8,9,10,11,12]],["분기(1,4,7,10)",[1,4,7,10]],["분기(2,5,8,11)",[2,5,8,11]],["분기(3,6,9,12)",[3,6,9,12]],["반기(상)",[3,9]],["반기(하)",[6,12]],["연(12월)",[12]]].map(([label,ms])=>(
                                <button key={label} onClick={()=>setDivInfoForm(p=>({...p,months:ms}))} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#94a3b8",padding:"3px 9px",borderRadius:"20px",cursor:"pointer",fontSize:"11px",fontWeight:500}}>
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                          {divInfoForm.perShare&&(divInfoForm.months||[]).length>0&&(
                            <div style={{background:"rgba(245,158,11,0.08)",borderRadius:"8px",padding:"8px 12px",fontSize:"12px",color:"#94a3b8"}}>
                              연간 예상: <span style={{color:"#fbbf24",fontWeight:700}}>
                                {divInfoForm.currency==="USD"
                                  ? "$"+(+divInfoForm.perShare*(divInfoForm.months||[]).length*+h.quantity).toFixed(2)
                                  : Math.round(+divInfoForm.perShare*(divInfoForm.months||[]).length*+h.quantity).toLocaleString("ko-KR")+"₩"}
                              </span>
                              <span style={{marginLeft:"10px"}}>({(divInfoForm.months||[]).length}회/년)</span>
                            </div>
                          )}
                          <button onClick={()=>{
                            setDivInfo(p=>({...p,[h.ticker]:{...divInfoForm}}));
                            setDivEditTicker(null);
                          }} style={S.btn("#f59e0b",{fontSize:"13px"})}>💾 저장</button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {[...holdings,...holdings2].filter(h=>h.market!=="CRYPTO").length===0&&(
                  <div style={{textAlign:"center",padding:"32px",color:"#475569"}}>보유종목을 먼저 추가해주세요</div>
                )}
              </div>
            </div>

            {/* ── 배당금 수령 일지 ── */}
            <div style={S.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px",flexWrap:"wrap",gap:"8px"}}>
                <div style={{fontSize:"15px",fontWeight:800,letterSpacing:"-0.02em"}}>📖 배당금 수령 일지</div>
                <button onClick={()=>setShowForm(showForm==="div"?null:"div")} style={S.btn("#f59e0b",{fontSize:"13px"})}>+ 수령 기록</button>
              </div>
              {showForm==="div"&&(
                <div style={{background:"rgba(0,0,0,0.3)",borderRadius:"12px",padding:"16px",marginBottom:"14px",border:"1px solid rgba(245,158,11,0.3)"}}>
                  <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"1fr 1fr 1fr 1fr",gap:"8px"}}>
                    <div>
                      <div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>수령일</div>
                      <input type="date" value={divForm.date} onChange={e=>setDivForm(p=>({...p,date:e.target.value}))} style={{...S.inp,fontSize:"13px",padding:"7px 10px"}}/>
                    </div>
                    <div>
                      <div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>종목</div>
                      <select value={divForm.ticker} onChange={e=>{
                        const h=[...holdings,...holdings2].find(x=>x.ticker===e.target.value);
                        setDivForm(p=>({...p,ticker:e.target.value,name:h?.name||""}));
                      }} style={{...S.inp,fontSize:"13px",padding:"7px 10px",appearance:"none"}}>
                        <option value="">종목 선택</option>
                        {[...new Map([...holdings,...holdings2].filter(h=>h.market!=="CRYPTO").map(h=>[h.ticker,h])).values()].map(h=>(
                          <option key={h.ticker} value={h.ticker}>{h.name||h.ticker}</option>
                        ))}
                        <option value="기타">기타</option>
                      </select>
                    </div>
                    <div>
                      <div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>수령액</div>
                      <input type="number" placeholder="배당금 총액" value={divForm.amount} onChange={e=>setDivForm(p=>({...p,amount:e.target.value}))} style={{...S.inp,fontSize:"13px",padding:"7px 10px"}}/>
                    </div>
                    <div>
                      <div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>통화</div>
                      <select value={divForm.currency} onChange={e=>setDivForm(p=>({...p,currency:e.target.value}))} style={{...S.inp,fontSize:"13px",padding:"7px 10px",appearance:"none"}}>
                        <option value="KRW">₩ 원화</option>
                        <option value="USD">$ 달러</option>
                      </select>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:"8px",marginTop:"10px"}}>
                    <button onClick={()=>{
                      if(!divForm.date||!divForm.amount) return;
                      setDivRecords(p=>[...p,{id:Date.now(),...divForm,amount:+divForm.amount}]);
                      setDivForm({date:"",ticker:"",name:"",amount:"",currency:"KRW"});
                      setShowForm(null);
                    }} style={S.btn("#f59e0b")}>✓ 저장</button>
                    <button onClick={()=>setShowForm(null)} style={S.btn("#475569")}>취소</button>
                  </div>
                </div>
              )}
              {divRecords.length===0?(
                <div style={{textAlign:"center",padding:"32px",color:"#475569"}}>
                  <div style={{fontSize:"28px",marginBottom:"8px"}}>💰</div>
                  <div>수령한 배당금을 기록해보세요</div>
                </div>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:"0"}}>
                  {[...divRecords].sort((a,b)=>b.date.localeCompare(a.date)).map(r=>(
                    <div key={r.id} style={{display:"grid",gridTemplateColumns:"90px 1fr auto auto",alignItems:"center",gap:"12px",padding:"10px 4px",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                      <div style={{fontSize:"12px",color:"#64748b"}}>{r.date}</div>
                      <div>
                        <div style={{fontSize:"13px",fontWeight:700,color:"#f1f5f9"}}>{r.name||r.ticker||"기타"}</div>
                        {r.name&&r.ticker&&<div style={{fontSize:"11px",color:"#64748b"}}>{r.ticker}</div>}
                      </div>
                      <div style={{fontSize:"14px",fontWeight:800,color:"#f59e0b",textAlign:"right"}}>
                        {r.currency==="USD"?"$"+Number(r.amount).toLocaleString("en-US",{minimumFractionDigits:2}):Math.round(r.amount).toLocaleString("ko-KR")+"₩"}
                      </div>
                      <button onClick={()=>setDivRecords(p=>p.filter(x=>x.id!==r.id))} style={{background:"none",border:"none",color:"#475569",cursor:"pointer",fontSize:"15px"}}>✕</button>
                    </div>
                  ))}
                  <div style={{display:"flex",justifyContent:"flex-end",marginTop:"10px",fontSize:"13px",color:"#94a3b8"}}>
                    총 {divRecords.length}건 ·&nbsp;<span style={{color:"#f59e0b",fontWeight:700}}>
                      {Math.round(divRecords.reduce((s,r)=>s+(r.currency==="USD"?+r.amount*liveUsdKrw:+r.amount),0)).toLocaleString("ko-KR")}₩
                    </span>
                  </div>
                </div>
              )}
            </div>

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
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes rollUp{0%{transform:translateY(8px);opacity:0.3}100%{transform:translateY(0);opacity:1}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.6}} select option{background:#1e293b} *{-webkit-font-smoothing:antialiased}`}</style>
    </div>
  );
}

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

// 현재 시간 기준 실시간 장 상태 계산 (캐시된 marketState 무시)
function getLiveMarketState(market, fallback) {
  const kst = new Date(Date.now() + 9*3600000);
  const mins = kst.getUTCHours()*60 + kst.getUTCMinutes();
  if (market === 'KR' || market === 'ISA') {
    if (mins >= 8*60 && mins < 9*60) return 'PRE';
    if (mins >= 9*60 && mins < 15*60+30) return 'REGULAR';
    if (mins >= 15*60+30 && mins < 20*60) return 'POST';
    return 'CLOSED';
  }
  // US: DST 반영
  const isDST = isUSDST();
  const preStart  = isDST ? 17*60 : 18*60;
  const regStart  = isDST ? 22*60+30 : 23*60+30;
  const regEnd    = isDST ? 5*60 : 6*60;
  const afterEnd  = isDST ? 9*60 : 10*60;
  const isReg     = mins >= regStart || mins < regEnd;
  const isPre     = !isReg && mins >= preStart && mins < regStart;
  const isAfter   = !isReg && mins >= regEnd && mins < afterEnd;
  if (isReg)   return 'REGULAR';
  if (isPre)   return 'PRE';
  if (isAfter) return 'POST';
  return 'CLOSED';
}

// 국내주식 전용: 브라우저에서 allorigins → 네이버 직접 호출
async function fetchKRStock(ticker) {
  const ticker6 = ticker.replace('.KS','').replace('.KQ','').padStart(6,'0');
  const _t = Date.now();

  const proxies = [
    `https://api.allorigins.win/raw?url=`,
    `https://api.codetabs.com/v1/proxy?quest=`,
  ];

  // 1순위: 프록시 → 네이버 polling API (실시간 동시호가 포함)
  const naverUrl = `https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${ticker6}`;
  for (const proxy of proxies) {
    try {
      const url = proxy.includes('allorigins')
        ? `${proxy}${encodeURIComponent(naverUrl)}&_=${_t}`
        : `${proxy}${encodeURIComponent(naverUrl)}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const text = await r.text();
      // allorigins가 가끔 HTML 반환 - JSON인지 확인
      if (!text.startsWith('{')) continue;
      const d = JSON.parse(text);
      const item = d?.result?.areas?.[0]?.datas?.[0];
      if (item?.nv) {
        const price = parseFloat(item.nv);
        const sign  = String(item.rf) === '5' ? -1 : 1;
        const chgPct = sign * parseFloat(item.cr||0);
        const chgAmt = sign * Math.round(parseFloat(item.cv||0));
        if (price > 0) {
          return { price, regularPrice: price, closePrice: price,
            changePercent: chgPct, changeAmount: chgAmt,
            regularChangePercent: chgPct, regularChangeAmount: chgAmt,
            currency: 'KRW', marketState: 'REGULAR' };
        }
      }
    } catch { continue; }
  }

  // 2순위: 프록시 → 네이버 모바일 API
  const naverMobileUrl = `https://m.stock.naver.com/api/stock/${ticker6}/basic`;
  for (const proxy of proxies) {
    try {
      const url = proxy.includes('allorigins')
        ? `${proxy}${encodeURIComponent(naverMobileUrl)}&_=${_t}`
        : `${proxy}${encodeURIComponent(naverMobileUrl)}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const text = await r.text();
      if (!text.startsWith('{')) continue;
      const d = JSON.parse(text);
      const price  = parseFloat((d.closePrice||'').replace(/,/g,'') || 0);
      const chgAmt = parseFloat((d.compareToPreviousClosePrice||'').replace(/[+,]/g,'') || 0);
      const chgPct = parseFloat(d.fluctuationsRatio || 0);
      if (price > 0) {
        return { price, regularPrice: price, closePrice: price,
          changePercent: chgPct, changeAmount: Math.round(chgAmt),
          regularChangePercent: chgPct, regularChangeAmount: Math.round(chgAmt),
          currency: 'KRW', marketState: 'REGULAR' };
      }
    } catch { continue; }
  }

  // 3순위: Yahoo v8/chart includePrePost (프리/애프터 포함)
  try {
    const _t2 = Date.now();
    for (const host of ['query1', 'query2']) {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d&includePrePost=true`;
      const proxied = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}&_=${_t2}`;
      try {
        const r = await fetch(proxied, { signal: AbortSignal.timeout(9000) });
        if (!r.ok) continue;
        const text = await r.text();
        if (!text.startsWith('{')) continue;
        const d = JSON.parse(text);
        const result = d?.chart?.result?.[0];
        const meta = result?.meta;
        if (!meta?.regularMarketPrice) continue;
        const regularPrice = meta.regularMarketPrice;
        const prevClose = meta.previousClose || meta.chartPreviousClose || regularPrice;
        const timestamps = result.timestamp || [];
        const closes = result.indicators?.quote?.[0]?.close || [];
        const kstM = (new Date(Date.now()+9*3600000)).getUTCHours()*60+(new Date(Date.now()+9*3600000)).getUTCMinutes();
        const isPreKR=kstM>=8*60&&kstM<9*60, isPostKR=kstM>=15*60+30&&kstM<20*60;
        let lastPrice=regularPrice, lastTs=0;
        for(let i=closes.length-1;i>=0;i--){ if(closes[i]!=null){lastPrice=closes[i];lastTs=timestamps[i]*1000;break;} }
        const useExt=(isPreKR||isPostKR)&&lastTs>Date.now()-3600000;
        const dPrice=useExt?lastPrice:regularPrice;
        const dChg=prevClose>0?((dPrice-prevClose)/prevClose)*100:0;
        const dAmt=Math.round(dPrice-prevClose);
        const regChg=prevClose>0?((regularPrice-prevClose)/prevClose)*100:0;
        return { price:dPrice, regularPrice, closePrice:regularPrice,
          changePercent:dChg, changeAmount:dAmt,
          regularChangePercent:regChg, regularChangeAmount:Math.round(regularPrice-prevClose),
          currency:'KRW', marketState:isPreKR?'PRE':isPostKR?'POST':'REGULAR' };
      } catch { continue; }
    }
  } catch {}
  return await fetchYahoo(ticker);
}

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

  const ts2 = Date.now();
  const proxies = isKR ? [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(chartUrl+"&_="+ts2)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(chartUrl.replace("query1","query2")+"&_="+ts2)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(chartUrl+"&_="+ts2)}`,
  ] : [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(quoteUrl+"&_="+ts2)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(quoteUrl.replace("query1","query2")+"&_="+ts2)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(quoteUrl+"&_="+ts2)}`,
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
        const chartChgAmt = price - prev;
        const chartChgPct = prev>0?((price-prev)/prev)*100:0;
        return {
          price, regularPrice: price, closePrice: price,
          changePercent: chartChgPct, changeAmount: isKR ? Math.round(chartChgAmt) : Math.round(chartChgAmt*100)/100,
          regularChangePercent: chartChgPct, regularChangeAmount: isKR ? Math.round(chartChgAmt) : Math.round(chartChgAmt*100)/100,
          currency: chartMeta.currency||(isKR?"KRW":"USD"), marketState:"REGULAR",
        };
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
        const chgAmtCalc = state==="PRE" && quoteRes.preMarketChange ? quoteRes.preMarketChange
                        : state==="POST" && quoteRes.postMarketChange ? quoteRes.postMarketChange
                        : (quoteRes.regularMarketChange ?? (dPrice - (quoteRes.regularMarketPreviousClose||dPrice)));
      return {
        price: dPrice,
        regularPrice: price,
        changePercent: dChg,
        changeAmount: Math.round(chgAmtCalc*100)/100,
        currency: quoteRes.currency||"USD",
        marketState: state,
        closePrice: price,
        preMarketPrice: quoteRes.preMarketPrice ?? null,
        preMarketChange: quoteRes.preMarketChange ?? null,
        preMarketChangePercent: quoteRes.preMarketChangePercent ?? null,
        postMarketPrice: quoteRes.postMarketPrice ?? null,
        postMarketChange: quoteRes.postMarketChange ?? null,
        postMarketChangePercent: quoteRes.postMarketChangePercent ?? null,
      };
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

// ── 한국 공휴일 체크 (KST 기준) ─────────────────────────────────────────
function isKRHoliday(kstDate) {
  const y = kstDate.getUTCFullYear();
  const m = kstDate.getUTCMonth()+1; // 1~12
  const d = kstDate.getUTCDate();
  const dow = kstDate.getUTCDay(); // 0=일,6=토
  // 주말
  if (dow === 0 || dow === 6) return true;
  // 고정 공휴일
  const fixed = [[1,1],[3,1],[5,5],[6,6],[8,15],[10,3],[10,9],[12,25]];
  if (fixed.some(([hm,hd])=>m===hm&&d===hd)) return true;
  // 설날/추석/어린이날 대체 등은 정확한 음력계산이 필요해 간략화:
  // 음력 명절 근처 며칠은 야후/네이버 API의 marketState로 이미 반영됨
  return false;
}

// ── 미국 공휴일 체크 (ET 기준, KST로 입력받아 ET 변환) ──────────────────
function isUSHoliday(kstDate) {
  const dst = isUSDST();
  // KST → ET: KST는 UTC+9, ET는 UTC-4(DST)/UTC-5(표준)
  const etOffset = dst ? -(9+4)*3600000 : -(9+5)*3600000;
  const et = new Date(kstDate.getTime() + etOffset);
  const y  = et.getUTCFullYear();
  const m  = et.getUTCMonth()+1;
  const d  = et.getUTCDate();
  const dow = et.getUTCDay();
  // 주말
  if (dow === 0 || dow === 6) return true;
  // 고정 공휴일
  if (m===1 && d===1)  return true; // 신정
  if (m===6 && d===19) return true; // Juneteenth
  if (m===7 && d===4)  return true; // 독립기념일
  if (m===11 && d===11) return true; // Veterans Day
  if (m===12 && d===25) return true; // 크리스마스
  // MLK Day: 1월 셋째 월요일
  if (m===1 && dow===1 && d>=15 && d<=21) return true;
  // Presidents Day: 2월 셋째 월요일
  if (m===2 && dow===1 && d>=15 && d<=21) return true;
  // Memorial Day: 5월 마지막 월요일
  if (m===5 && dow===1 && d>=25) return true;
  // Labor Day: 9월 첫째 월요일
  if (m===9 && dow===1 && d<=7) return true;
  // Thanksgiving: 11월 넷째 목요일
  if (m===11 && dow===4 && d>=22 && d<=28) return true;
  // Good Friday: Easter 2일 전 (간단히: 3~4월 중 야후 API로 커버)
  // 현충일 날짜 계산 (5월 마지막 월요일과 겹치지 않는 특이케이스 제외)
  return false;
}


async function fetchKospiFutures() {
  const now = new Date();
  const m = now.getMonth() + 1; // 1~12
  const d = now.getDate();
  // 각 분기 만기: 3/6/9/12월 두번째 목요일 (보통 8~14일)
  // 만기 이후엔 다음 분기물로 전환 (15일 기준으로 단순화)
  let expMonth;
  if ((m === 3 && d > 15) || m === 4 || m === 5 || (m === 6 && d <= 15)) expMonth = '06';
  else if ((m === 6 && d > 15) || m === 7 || m === 8 || (m === 9 && d <= 15)) expMonth = '09';
  else if ((m === 9 && d > 15) || m === 10 || m === 11 || (m === 12 && d <= 15)) expMonth = '12';
  else expMonth = '03';
  const futureCode = `101S${expMonth}`;
  const _t = Date.now();

  const sources = [
    // 1순위: allorigins 프록시 (CORS 우회, 가장 안정적)
    async () => {
      const naverUrl = `https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${futureCode}`;
      const proxy = `https://api.allorigins.win/raw?url=${encodeURIComponent(naverUrl)}&_=${_t}`;
      const r = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      const item = d?.result?.areas?.[0]?.datas?.[0];
      if (!item?.nv) throw new Error('no data');
      const price = parseFloat(item.nv);
      if (price < 100 || price > 1000) throw new Error('invalid price: ' + price);
      const sign = String(item.rf) === '5' ? -1 : 1;
      return { price, chg: sign * parseFloat(item.cr||0), chgAmt: sign * parseFloat(item.cv||0), label: `코스피200 야간선물(${expMonth}월)` };
    },
    // 2순위: Vercel API
    async () => {
      const r = await fetch(`/api/futures?code=${futureCode}`, { signal: AbortSignal.timeout(6000), cache: 'no-store' });
      if (!r.ok) throw new Error('vercel failed');
      const d = await r.json();
      if (!d.price || d.price < 100 || d.price > 1000) throw new Error('invalid: ' + d.price);
      return d;
    },
  ];

  for (const src of sources) {
    try {
      const res = await src();
      if (res?.price > 100) return res;
    } catch { continue; }
  }
  return null;
}

async function fetchHistory(ticker, market, range="3mo") {
  const isKR = market === "KR" || market === "ISA";
  const isETFKR = market === "ETF" && /^[0-9]/.test(ticker);
  const isCrypto = market === "CRYPTO";
  const isGold = market === "GOLD";

  // range → interval 매핑
  const intervalMap = { "1d":"5m", "1wk":"15m", "1mo":"1d", "3mo":"1d", "6mo":"1d", "1y":"1wk" };
  const interval = intervalMap[range] || "1d";

  if (isCrypto) {
    try {
      const id = CRYPTO_IDS[ticker.toUpperCase()] || ticker.toLowerCase();
      const days = range==="1d"?"1":range==="1wk"?"7":range==="1mo"?"30":range==="6mo"?"180":range==="1y"?"365":"90";
      const r = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`);
      const d = await r.json();
      return (d.prices||[]).map(([ts, price]) => ({
        date: new Date(ts).toLocaleDateString("ko-KR",{month:"numeric",day:"numeric"}),
        price: Math.round(price*100)/100,
      }));
    } catch { return []; }
  }

  if (isGold) ticker = "GC%3DF";

  let tk = ticker;
  if ((isKR || isETFKR) && !tk.includes(".")) tk += ".KS";

  // 1순위: Vercel API (/api/history)
  try {
    const r = await fetch(`/api/history?symbol=${encodeURIComponent(tk)}&range=${range}&interval=${interval}`, {
      signal: AbortSignal.timeout(10000), cache: "no-store",
    });
    if (r.ok) {
      const d = await r.json();
      if (d?.data?.length >= 2) return d.data;
    }
  } catch {}

  // 2순위: 프록시 fallback
  const url1 = `https://query1.finance.yahoo.com/v8/finance/chart/${tk}?interval=${interval}&range=${range}`;
  const url2 = `https://query2.finance.yahoo.com/v8/finance/chart/${tk}?interval=${interval}&range=${range}`;
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url1+"&_="+Date.now())}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url2+"&_="+Date.now())}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url1)}`,
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
      if (data.length >= 2) return data;
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
      ];
      const results = await Promise.all(urls.map(u => fetch(u).then(r=>r.json()).catch(()=>null)));
      setWeather({
        seoul:  results[0] ? { temp: Math.round(results[0].current.temperature_2m), code: results[0].current.weathercode } : null,
        nyc: null, tokyo: null, custom: null,
      });
    } catch {}
    setWLoading(false);
  };

  const fetchRates = async () => {
    setRLoading(true);

    // 1순위: Yahoo Finance 실시간 환율 (장중 실시간 반영)
    const yahooSymbols = ["KRW=X","JPY=X","EURUSD=X","CNY=X","GBPUSD=X","AUDUSD=X","SGD=X","HKD=X","CHF=X","CAD=X"];
    const yahooUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${yahooSymbols.join(",")}&fields=regularMarketPrice,currency`;
    // allorigins 캐시 방지를 위해 timestamp 추가
    const _t = Date.now();
    const proxies = [
      `/api/rates`,  // Vercel API (1순위, 캐시 없음)
      `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl+"&_="+_t)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl.replace("query1","query2")+"&_="+_t)}`,
    ];

    for (const proxy of proxies) {
      try {
        const r = await fetch(proxy, { signal: AbortSignal.timeout(7000), cache: 'no-store' });
        if (!r.ok) continue;
        const d = await r.json();
        // Vercel /api/rates 는 { rates: {KRW, JPY, ...} } 형식으로 직접 반환
        if (d?.rates?.KRW > 900) {
          setRates(d.rates);
          setRLoading(false);
          return;
        }
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
        </>}
        <button onClick={()=>setCollapsed(c=>!c)}
          style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", color:"#64748b", padding:"3px 8px", borderRadius:"6px", cursor:"pointer", fontSize:"11px", fontWeight:700 }}>
          {collapsed
            ? `🌤️ ${weather.seoul ? weather.seoul.temp+"°" : "--"} | $${rates?.KRW ? Math.round(rates.KRW).toLocaleString() : "--"}₩ | ¥100=${rates?.JPY&&rates?.KRW ? Math.round(rates.KRW/rates.JPY*100).toLocaleString() : "--"}₩ ▾`
            : "▴ 접기"
          }
        </button>
      </div>

      {/* 펼쳐진 상태에서만 표시 */}
      {!collapsed && <>
      {/* 날씨 */}
      {mode === "weather" && (
        <div style={{ display:"flex", gap:"6px", alignItems:"flex-start" }}>
          {wLoading ? <span style={{fontSize:"11px",color:"#475569"}}>조회중...</span> : weather.seoul ? (
            <div style={cardStyle}>
              <div style={{ fontSize:"10px", color:"#64748b", marginBottom:"3px", fontWeight:700 }}>🇰🇷 서울</div>
              <div style={{ fontSize:"22px", lineHeight:1 }}>{WX_ICON[weather.seoul.code]??'🌡️'}</div>
              <div style={{ fontSize:"16px", fontWeight:800, color:"#f1f5f9", marginTop:"3px" }}>{weather.seoul.temp}°C</div>
              <div style={{ fontSize:"10px", color:"#64748b", marginTop:"2px" }}>{WX_CODE[weather.seoul.code]??""}</div>
            </div>
          ) : null}
        </div>
      )}

      {/* 주요 환율 (USD·JPY) */}
      {mode === "rate" && (
        <div style={{ display:"flex", gap:"6px" }}>
          {rLoading ? <span style={{fontSize:"11px",color:"#475569"}}>조회중...</span> : (<>
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
          </>)}
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
  const [chartRange, setChartRange] = useState("3mo");

  useEffect(() => {
    const key = holding.ticker + "_" + chartRange;
    if (_chartCache[key]) {
      setHistory(_chartCache[key]);
      setLoading(false);
    } else {
      setLoading(true);
      fetchHistory(holding.ticker, holding.market, chartRange).then(h => {
        _chartCache[key] = h;
        setHistory(h);
        setLoading(false);
      });
    }
  }, [holding.ticker, chartRange]);

  useEffect(() => {
    const key = holding.ticker;
    if (_infoCache[key]) { setInfo(_infoCache[key]); return; }
    fetchStockInfo(holding.ticker, holding.market).then(i => {
      _infoCache[key] = i;
      setInfo(i);
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
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px"}}>
            <div style={{fontSize:"13px",fontWeight:700,color:"#94a3b8"}}>📈 주가 추이</div>
            <div style={{display:"flex",gap:"4px"}}>
              {[["1d","1일"],["1wk","1주"],["1mo","1개월"],["3mo","3개월"],["6mo","6개월"],["1y","1년"]].map(([r,l])=>(
                <button key={r} onClick={()=>setChartRange(r)}
                  style={{background:chartRange===r?"rgba(99,102,241,0.3)":"rgba(255,255,255,0.05)",border:chartRange===r?"1px solid rgba(99,102,241,0.5)":"1px solid rgba(255,255,255,0.08)",color:chartRange===r?"#a5b4fc":"#64748b",padding:"3px 7px",borderRadius:"5px",cursor:"pointer",fontSize:"10px",fontWeight:700}}>
                  {l}
                </button>
              ))}
            </div>
          </div>
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
      : h.market === "ETF" && !h.ticker.includes(".KS") && !h.ticker.includes(".KQ") && !/^[0-9]/.test(h.ticker) ? "USD"
      : "KRW"; // 한국 ETF (숫자 티커) → KRW
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
      {/* 일일 변동폭 */}
      {(()=>{
        let dayChgKRW=0;
        portfolio.forEach(h=>{
          const p2=safeP[h.ticker];
          if(!p2) return;
          // 주당 등락액: changeAmount 우선, 없으면 price * changePercent/100
          const pct = p2.regularChangePercent??p2.changePercent??0;
          const px  = p2.price??0;
          const rawAmt = p2.regularChangeAmount??p2.changeAmount??(px*pct/100);
          const inKRW = h.cur==="USD" ? rawAmt*(liveUsdKrw||1380) : rawAmt;
          dayChgKRW += inKRW * h.quantity;
        });
        if(Math.abs(dayChgKRW)<1) return null;
        const dayPct=totalVal>0?(dayChgKRW/totalVal)*100:0;
        const up=dayChgKRW>=0;
        return(
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"rgba(0,0,0,0.18)",borderRadius:"7px",padding:"5px 10px",marginBottom:"8px"}}>
            <span style={{fontSize:"10px",color:"#64748b",fontWeight:600}}>오늘 변동</span>
            <div>
              <span style={{fontSize:"13px",fontWeight:800,color:up?"#34d399":"#f87171"}}>{up?"+":""}{Math.round(Math.abs(dayChgKRW)).toLocaleString()}₩</span>
              <span style={{fontSize:"11px",fontWeight:700,color:up?"#34d399":"#f87171",marginLeft:"6px"}}>({up?"+":""}{dayPct.toFixed(2)}%)</span>
            </div>
          </div>
        );
      })()}
      {/* 비중 바 */}
      <div style={{background:"rgba(255,255,255,0.08)",borderRadius:"4px",height:"6px",overflow:"hidden",marginBottom:"10px"}}>
        <div style={{width:Math.min(Math.abs(pnlPct)*2+50,100)+"%",height:"100%",background:isUp?"#34d399":"#f87171",borderRadius:"4px"}}/>
      </div>
      {/* 종목 수 + 수익 종목 */}
      <div style={{display:"flex",justifyContent:"space-between",fontSize:"12px",color:"#64748b"}}>
        <span>{items.length}종목</span>
        <span style={{color:"#34d399"}}>▲{portfolio.filter(h=>{
          const p2=safeP[h.ticker];
          const v=((p2?.price??h.avgPrice)*h.quantity); const c=h.avgPrice*h.quantity;
          return v>c;
        }).length}</span>
        <span style={{color:"#f87171"}}>▼{portfolio.filter(h=>{
          const p2=safeP[h.ticker];
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
  const [ovCurrMode, setOvCurrMode] = useState("KRW");
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

  // 계좌별 그룹 - 일반종합계좌 / ISA / 절세계좌
  const isa_items   = portfolio.filter(h => h.market === "ISA");
  const gen_items   = portfolio.filter(h => h.market !== "ISA");
  const ACCOUNT_GROUPS = [
    { key:"일반종합계좌", title:"일반종합계좌", subtitle:"주식·코인·금현물", color:"#6366f1", items: gen_items },
    { key:"ISA계좌", title:"ISA 계좌", subtitle:"중개형 ISA", color:"#06b6d4", items: isa_items },
    { key:"연금저축1(신한금융투자)", title:"연금저축1", subtitle:"신한금융투자", color:"#10b981",
      items: portfolio2.filter(h=>h.taxAccount==="연금저축1(신한금융투자)") },
    { key:"연금저축2(미래에셋증권)", title:"연금저축2", subtitle:"미래에셋증권", color:"#f59e0b",
      items: portfolio2.filter(h=>h.taxAccount==="연금저축2(미래에셋증권)") },
    { key:"IRP(미래에셋증권)", title:"IRP", subtitle:"미래에셋증권", color:"#a855f7",
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
            <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"4px"}}>
              <div style={{fontSize:isMobile?"24px":"30px",fontWeight:800,color:"#f8fafc",letterSpacing:"-0.05em"}}>
                <AnimatedNumber
                  value={ovCurrMode==="USD" ? totalVal/liveUsdKrw : totalVal}
                  format={v=>ovCurrMode==="USD"
                    ? "$"+(Math.round(v)).toLocaleString("en-US")
                    : Math.round(v).toLocaleString("ko-KR")+"₩"}
                  color="#f8fafc" fontSize={isMobile?"24px":"30px"}/>
              </div>
              <div style={{display:"flex",background:"rgba(255,255,255,0.08)",borderRadius:"8px",padding:"2px",gap:"2px"}}>
                <button onClick={()=>setOvCurrMode("KRW")} style={{padding:"3px 8px",borderRadius:"6px",border:"none",cursor:"pointer",fontSize:"11px",fontWeight:700,background:ovCurrMode==="KRW"?"rgba(99,102,241,0.5)":"transparent",color:ovCurrMode==="KRW"?"#c7d2fe":"#64748b"}}>₩</button>
                <button onClick={()=>setOvCurrMode("USD")} style={{padding:"3px 8px",borderRadius:"6px",border:"none",cursor:"pointer",fontSize:"11px",fontWeight:700,background:ovCurrMode==="USD"?"rgba(16,185,129,0.4)":"transparent",color:ovCurrMode==="USD"?"#6ee7b7":"#64748b"}}>$</button>
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:"10px",marginTop:"2px",flexWrap:"wrap"}}>
              <span style={{fontSize:"15px",fontWeight:700,color:totalRet>=0?"#34d399":"#f87171"}}>{fmtP(totalRet)}</span>
              <span style={{fontSize:"13px",color:totalPnL>=0?"#34d399":"#f87171"}}>{totalPnL>=0?"+":""}{fmtK(Math.abs(totalPnL))}</span>
              <span style={{fontSize:"12px",color:"#475569"}}>{allItems.length}종목</span>
            </div>
            {(()=>{
              let dayKRW=0;
              allItems.forEach(h=>{
                const p2=prices[h.ticker];
                if(!p2) return;
                const pct = p2.regularChangePercent??p2.changePercent??0;
                const px  = p2.price??0;
                const rawAmt = p2.regularChangeAmount??p2.changeAmount??(px*pct/100);
                const inKRW = h.cur==="USD" ? rawAmt*(liveUsdKrw||1380) : rawAmt;
                dayKRW += inKRW * h.quantity;
              });
              if(Math.abs(dayKRW)<1) return null;
              const dayPct=totalVal>0?(dayKRW/totalVal)*100:0;
              const up=dayKRW>=0;
              return(
                <div style={{display:"flex",alignItems:"center",gap:"8px",marginTop:"6px",padding:"5px 10px",background:"rgba(0,0,0,0.2)",borderRadius:"8px",flexWrap:"wrap"}}>
                  <span style={{fontSize:"11px",color:"#64748b",fontWeight:600}}>오늘 변동</span>
                  <span style={{fontSize:"14px",fontWeight:800,color:up?"#34d399":"#f87171"}}>{up?"+":""}{fmtK(Math.abs(dayKRW))}</span>
                  <span style={{fontSize:"13px",fontWeight:700,color:up?"#34d399":"#f87171"}}>({up?"+":""}{dayPct.toFixed(2)}%)</span>
                </div>
              );
            })()}
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
function AccountDetail({ title, items, prices, snapshots, onClose, isMobile, liveUsdKrw, isISA, onEdit }) {
  const toKRWL = (v, cur) => cur === "KRW" ? v : v * liveUsdKrw;
  const fmtK = (v) => Math.round(v).toLocaleString("ko-KR") + "₩";
  const fmtP = (n) => (n >= 0 ? "+" : "") + Number(n).toFixed(2) + "%";

  const portfolio = items.map(h => {
    const p   = prices[h.ticker] || prices[h.ticker+".KS"] || prices[h.ticker+".KQ"] || null;
    const cur = h.market === "US" ? "USD"
      : h.market === "ETF" && !h.ticker.includes(".KS") && !h.ticker.includes(".KQ") && !/^[0-9]/.test(h.ticker) ? "USD"
      : "KRW"; // 한국 ETF (숫자 티커) → KRW
    const price  = p?.price ?? h.avgPrice;
    const value  = price * h.quantity;
    const cost   = h.avgPrice * h.quantity;
    const pnl    = value - cost;
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
    // API에서 직접 받은 변동금액 사용 (계산 오차 없음)
    // changeAmount: API 직접값 우선, 없으면 가격·변동률로 계산
    const chgAmt = p?.changeAmount
      ? p.changeAmount
      : (p?.price && p?.changePercent
          ? (cur==="KRW"
              ? Math.round(p.price / (1 + p.changePercent/100) * (p.changePercent/100))
              : Math.round(p.price / (1 + p.changePercent/100) * (p.changePercent/100) * 100) / 100)
          : 0);
    return { ...h, price, value, cost, pnl, pnlPct, cur, chgPct: p?.changePercent ?? 0, chgAmt, hasLive: !!p, marketState: getLiveMarketState("KR", p?.marketState) };
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
      <div onClick={e=>e.stopPropagation()} style={{background:"#0f172a",border:"1px solid rgba(255,255,255,0.12)",borderRadius:isMobile?"16px 16px 0 0":"16px",width:isMobile?"100%":"min(900px, 96vw)",maxHeight:isMobile?"95vh":"90vh",overflowY:"auto",padding:isMobile?"16px":"24px"}}>

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
        {/* 종목별 일일 등락 - 토스 스타일 */}
        <div style={{background:"rgba(255,255,255,0.03)",borderRadius:"12px",padding:"14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px"}}>
            <div style={{fontSize:"13px",fontWeight:700,color:"#94a3b8"}}>📊 종목별 등락</div>
            <div style={{fontSize:"11px",color:"#475569"}}>당일 기준</div>
          </div>
          {(()=>{
            const totalChgKRW = portfolio.reduce((s,h) => {
              const amt = h.chgAmt != null && h.chgAmt !== 0 ? h.chgAmt : h.chgPct ? (h.chgPct/100 * h.price) : 0;
              return s + (h.cur==="KRW" ? amt * h.quantity : amt * h.quantity * liveUsdKrw);
            }, 0);
            const isUpTotal = totalChgKRW >= 0;
            return (
              <div style={{background:"rgba(255,255,255,0.05)",borderRadius:"10px",padding:"11px 14px",marginBottom:"12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontSize:"12px",color:"#64748b",fontWeight:600}}>당일 총 손익</div>
                <div style={{fontSize:"18px",fontWeight:800,color:isUpTotal?"#34d399":"#f87171",letterSpacing:"-0.03em"}}>
                  {isUpTotal?"+":""}{Math.round(totalChgKRW).toLocaleString()}₩
                </div>
              </div>
            );
          })()}
          <div style={{display:"flex",flexDirection:"column",gap:"2px"}}>
            {[...portfolio].sort((a,b)=>Math.abs(b.chgPct)-Math.abs(a.chgPct)).map(h => {
              const isUp = h.chgPct >= 0;
              const c = isUp ? "#34d399" : "#f87171";
              const raw = h.chgAmt != null && h.chgAmt !== 0 ? h.chgAmt : h.chgPct ? (h.chgPct/100 * h.price) : 0;
              const amtStr = h.cur==="USD"
                ? (raw>=0?"+":"-")+"$"+Math.abs(raw).toFixed(2)
                : (raw>=0?"+":"-")+Math.round(Math.abs(raw)).toLocaleString()+"₩";
              return (
                <div key={h.id} style={{display:"flex",alignItems:"center",gap:"12px",padding:"10px 6px",borderBottom:"1px solid rgba(255,255,255,0.05)",borderRadius:"6px"}}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.04)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <TickerLogo ticker={h.ticker} name={h.name} size={42}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:700,fontSize:"14px",color:"#f1f5f9",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{h.name||h.ticker}</div>
                    <div style={{fontSize:"11px",color:"#475569",marginTop:"1px"}}>{h.ticker} · {h.quantity.toLocaleString()}주 · {h.cur==="USD"?"$"+h.price.toFixed(2):Math.round(h.price).toLocaleString()+"₩"}</div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontSize:"17px",fontWeight:800,color:c,letterSpacing:"-0.02em"}}>{amtStr}</div>
                    <div style={{fontSize:"11px",color:c,opacity:0.8,marginTop:"2px"}}>{isUp?"+":""}{h.chgPct.toFixed(2)}%</div>
                  </div>
                </div>
              );
            })}
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


// ── 종목 로고 ────────────────────────────────────────────────────────────────
// 티커 → 도메인 매핑 (Clearbit Logo API용)
const TICKER_DOMAIN = {
  // 미국 주요주
  AAPL:"apple.com", MSFT:"microsoft.com", NVDA:"nvidia.com",
  GOOGL:"google.com", GOOG:"google.com", META:"meta.com",
  AMZN:"amazon.com", TSLA:"tesla.com", ORCL:"oracle.com",
  AVGO:"broadcom.com", PLTR:"palantir.com", OKLO:"oklo.com",
  VOO:"vanguard.com", SPY:"ssga.com", QQQ:"invesco.com",
  SPYM:"proshares.com", SCHD:"schwab.com", SOXL:"direxion.com",
  NFLX:"netflix.com", UBER:"uber.com", COIN:"coinbase.com",
  AMD:"amd.com", INTC:"intel.com", QCOM:"qualcomm.com",
  JPM:"jpmorganchase.com", BAC:"bankofamerica.com",
  V:"visa.com", MA:"mastercard.com", WMT:"walmart.com",
  DIS:"disney.com", COST:"costco.com", PG:"pg.com",
  PYPL:"paypal.com", SHOP:"shopify.com", SNOW:"snowflake.com",
  PANW:"paloaltonetworks.com", CRWD:"crowdstrike.com",
  ASML:"asml.com", TSM:"tsmc.com", BABA:"alibaba.com",
  // 국내 주요주 (티커 숫자)
  "005930":"samsung.com",       // 삼성전자
  "000660":"skhynix.com",       // SK하이닉스
  "035420":"navercorp.com",     // NAVER
  "035720":"kakao.com",         // 카카오
  "051910":"lgchem.com",        // LG화학
  "005380":"hyundai.com",       // 현대차
  "000270":"kia.com",           // 기아
  "012330":"mobis.co.kr",       // 현대모비스
  "017670":"sktelecom.com",     // SK텔레콤
  "030200":"kt.com",            // KT
  "003550":"lg.com",            // LG
  "086790":"hanagroup.com",     // 하나금융
  "105560":"kbfg.com",          // KB금융
  "055550":"shinhangroup.com",  // 신한지주
  "066570":"lge.com",           // LG전자
  "003490":"koreanair.com",     // 대한항공
  "018260":"samsung.com",       // 삼성SDS
  "096770":"skoil.com",         // SK이노베이션
  "207940":"samsung.com",       // 삼성바이오로직스
  "068270":"celltrion.com",     // 셀트리온
  // 한국 ETF (삼성/미래에셋 운용사)
  "069500":"samsungasset.com",  // KODEX 200
  "229200":"samsungasset.com",  // KODEX 코스닥150
  "360750":"mirae-asset.com",   // TIGER 미국S&P500
  "133690":"mirae-asset.com",   // TIGER 미국나스닥100
  "102110":"samsungasset.com",  // TIGER 200
};


// ── 미니 스파크라인 (순수 SVG, props로 받은 data 렌더링) ──────────────────
function MiniSparkline({ data, pnlPct=0, width=60, height=24 }) {
  if (!data || data.length < 2) {
    // 데이터 없을 때: pnlPct 기반 간단 바
    const up = pnlPct >= 0;
    const c  = up ? "#34d399" : "#f87171";
    const mid = height / 2;
    const barH = Math.min(Math.abs(pnlPct) * 1.5, mid - 3);
    return (
      <svg viewBox={`0 0 ${width} ${height}`} style={{width:width+"px",height:height+"px",flexShrink:0,opacity:0.5}}>
        <line x1="2" y1={mid} x2={width-2} y2={mid} stroke="rgba(255,255,255,0.1)" strokeWidth="1"/>
        <rect x={4} y={up?mid-barH:mid} width={width-8} height={Math.max(1,barH)} fill={c} opacity="0.5" rx="1"/>
      </svg>
    );
  }
  const prices = data.map(d=>d.price).filter(v=>typeof v==="number"&&isFinite(v));
  if (prices.length < 2) return null;
  const mn=Math.min(...prices), mx=Math.max(...prices), range=mx-mn||1;
  const pad={t:2,b:2,l:2,r:2};
  const pts = prices.map((p,i)=>{
    const x=(pad.l+(i/(prices.length-1))*(width-pad.l-pad.r)).toFixed(1);
    const y=(pad.t+(1-(p-mn)/range)*(height-pad.t-pad.b)).toFixed(1);
    return x+","+y;
  }).join(" ");
  const up = prices[prices.length-1] >= prices[0];
  const c  = up ? "#34d399" : "#f87171";
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{width:width+"px",height:height+"px",flexShrink:0,opacity:0.85}}>
      <polyline points={pts} fill="none" stroke={c} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
      {(()=>{
        const lp=prices[prices.length-1];
        const lx=(pad.l+(width-pad.l-pad.r)).toFixed(1);
        const ly=(pad.t+(1-(lp-mn)/range)*(height-pad.t-pad.b)).toFixed(1);
        return <circle cx={lx} cy={ly} r="2" fill={c}/>;
      })()}
    </svg>
  );
}

function TickerLogo({ ticker, name, size=40 }) {
  const [imgFailed, setImgFailed] = useState(false);
  const clean = (ticker||"").replace(".KS","").replace(".KQ","");
  const domain = TICKER_DOMAIN[clean?.toUpperCase()] || TICKER_DOMAIN[clean];
  const logoUrl = domain ? `https://logo.clearbit.com/${domain}?size=${size*2}` : null;

  // 이니셜 fallback 색상
  const defaultBg = clean?.length <= 5 && /^[A-Z]/i.test(clean||"")
    ? "#10b981" : "#6366f1";
  const initials = (name||ticker||"?").slice(0,2).toUpperCase();

  const [googleFailed, setGoogleFailed] = useState(false);
  // Google Favicon API as secondary fallback
  const googleUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : null;

  if (logoUrl && !imgFailed) {
    return (
      <div style={{width:size,height:size,borderRadius:"50%",overflow:"hidden",flexShrink:0,background:"rgba(255,255,255,0.95)",display:"flex",alignItems:"center",justifyContent:"center"}}>
        <img
          src={logoUrl}
          alt={ticker}
          width={size} height={size}
          style={{objectFit:"contain",padding:"3px",borderRadius:"50%"}}
          onError={()=>setImgFailed(true)}
        />
      </div>
    );
  }
  // Google favicon fallback
  if (googleUrl && !googleFailed) {
    return (
      <div style={{width:size,height:size,borderRadius:"50%",overflow:"hidden",flexShrink:0,background:"rgba(255,255,255,0.1)",display:"flex",alignItems:"center",justifyContent:"center"}}>
        <img
          src={googleUrl}
          alt={ticker}
          width={size*0.6} height={size*0.6}
          style={{objectFit:"contain"}}
          onError={()=>setGoogleFailed(true)}
        />
      </div>
    );
  }
  return (
    <div style={{width:size,height:size,borderRadius:"50%",background:defaultBg,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*0.36+"px",fontWeight:700,flexShrink:0,letterSpacing:"-0.02em"}}>
      {initials}
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
    try {
      const c   = localStorage.getItem("pm_prices_cache");
      const age = parseInt(localStorage.getItem("pm_prices_age") || "0");
      if (!c) return {};
      const parsed = JSON.parse(c);
      const isNewDay = new Date(age).toDateString() !== new Date().toDateString();
      if (isNewDay) {
        // 새 날: 종가로 설정, changePercent=0 (오늘 아직 장 안 열림)
        // 단, regularChangePercent는 유지 (전일 종가 기준 등락 표시)
        const cleaned = {};
        Object.entries(parsed).forEach(([k,v]) => {
          cleaned[k] = {
            ...v,
            price: v.closePrice || v.regularPrice || v.price,
            changePercent: 0,
            changeAmount: 0,
            // 전일 등락폭은 유지 (일변동 컬럼에 표시)
            regularChangePercent: v.regularChangePercent ?? v.changePercent ?? 0,
            regularChangeAmount: v.regularChangeAmount ?? v.changeAmount ?? 0,
          };
        });
        return cleaned;
      }
      // 같은 날 - 캐시 그대로
      return parsed;
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
  const [mainTab, setMainTab]   = useState("overview"); // "overview" | "p1" | "p2" | "p3"
  const [overviewTab, setOverviewTab] = useState("all"); // "all"|"account"|"broker"|"market"
  const [currMode, setCurrMode] = useState("KRW");
  const [liveUsdKrw, setLiveUsdKrw] = useState(USD_KRW);
  const [selectedStock, setSelectedStock] = useState(null);
  const [sortBy, setSortBy]   = useState("default");
  const [compactMode, setCompactMode] = useState(false);
  const [hideAmt, setHideAmt] = useState(false);

  const [chartPeriod, setChartPeriod] = useState("all");
  const [bgTheme, setBgTheme] = useState(() => {
    try { return localStorage.getItem("pm_bg_theme") || "default"; } catch { return "default"; }
  });
  const [bgImage, setBgImage] = useState(() => {
    try { return localStorage.getItem("pm_bg_image") || ""; } catch { return ""; }
  });
  const [groupBy, setGroupBy] = useState("none");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [taxYear, setTaxYear] = useState(()=>String(new Date().getFullYear()));
  const [editingTradeId, setEditingTradeId] = useState(null);
  const [editTradeForm, setEditTradeForm] = useState({});
  const [tradeFilterPeriod, setTradeFilterPeriod] = useState("all");
  const [tradePage, setTradePage] = useState(1);
  const TRADE_PAGE_SIZE = 10;
  const [sparklineData, setSparklineData] = useState({});
  const [calSelectedDate, setCalSelectedDate] = useState(null);
  const [calStockTicker, setCalStockTicker] = useState(null);
  const [calShowSelector, setCalShowSelector] = useState(false);
  const [stockHistory, setStockHistory] = useState({});
  const [liveIndices, setLiveIndices] = useState(null); // {kospi,sp500,nasdaq,futures}
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
  const [isaContribLimit, setIsaContribLimit] = useState(() => {
    try { return parseInt(localStorage.getItem("pm_isa_limit")||"20000000"); } catch { return 20000000; }
  });
  const [isaContribAmount, setIsaContribAmount] = useState(() => {
    try { return parseInt(localStorage.getItem("pm_isa_amount")||"0"); } catch { return 0; }
  });
  const [wForm, setWForm] = useState({ ticker:"", name:"", market:"KR", targetBuy:"", targetSell:"", memo:"" });
  // 배당 관련 state
  const [divInfo, setDivInfo]     = useState({}); // { ticker: { perShare, cycle, month, currency } }
  const [divRecords, setDivRecords] = useState([]); // [{ id, date, ticker, name, amount, currency }]
  const [divForm, setDivForm]     = useState({ date:"", ticker:"", name:"", amount:"", currency:"KRW" });
  const [divEditTicker, setDivEditTicker] = useState(null);
  const [divInfoForm, setDivInfoForm]     = useState({ perShare:"", months:[], currency:"KRW" });
  const [editingId2, setEditingId2] = useState(null);
  const [editForm2, setEditForm2]   = useState({});
  const [hForm2, setHForm2] = useState({ ticker:"", name:"", market:"KR", quantity:"", avgPrice:"", taxAccount:"연금저축1(신한금융투자)", broker:"" });
  const isMobile = useIsMobile();
  const saving = useRef({});
  const fbLoadedRef = useRef({});
  const tradesLoadedFromFB = useRef(false); // Firebase에서 trades를 한 번이라도 수신했는지

  const [hForm, setHForm] = useState({ ticker:"", name:"", market:"KR", stockType:"일반주식", quantity:"", avgPrice:"", broker:"" });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ ticker:"", name:"", market:"KR", quantity:"", avgPrice:"", broker:"" });
  const [tForm, setTForm] = useState({ date:today(), ticker:"", type:"buy", quantity:"", price:"", fee:"", note:"", taxAccount:"" });
  const [aForm, setAForm] = useState({ ticker:"", direction:"down", threshold:"" });

  useEffect(() => {
    const unsubs = [];
    const attach = (path, setter, key) => {
      const u = dbOn(`users/${syncKey}/${path}`, val => {
        if (saving.current[key]) return;
        fbLoadedRef.current[key] = true;
        if (val) {
          setter(Array.isArray(val) ? val : Object.values(val));
        } else {
          // Firebase 데이터 없음 → localStorage 백업에서 복구 시도
          try {
            const bk = localStorage.getItem("pm_bk_" + key);
            if (bk) {
              const { data, ts } = JSON.parse(bk);
              const ageMin = (Date.now() - ts) / 60000;
              if (data && ageMin < 43200) { // 30일 이내 백업만 사용
                console.warn(`[복구] ${key} Firebase 없음 → 로컬 백업 사용 (${Math.round(ageMin)}분 전)`);
                setter(Array.isArray(data) ? data : Object.values(data));
              }
            }
          } catch {}
        }
        setLoaded(true);
      });
      unsubs.push(u);
    };
    attach("holdings",  setHoldings,  "h");
    {
      const u = dbOn(`users/${syncKey}/trades`, val => {
        if (saving.current["t"]) return;
        tradesLoadedFromFB.current = true;
        fbLoadedRef.current["t"] = true;
        if (val) {
          setTrades(Array.isArray(val) ? val : Object.values(val));
        } else {
          // Firebase 데이터 없음 → localStorage 백업 복구
          try {
            const bk = localStorage.getItem("pm_bk_t");
            if (bk) {
              const { data, ts } = JSON.parse(bk);
              const ageMin = (Date.now() - ts) / 60000;
              if (data && data.length > 0 && ageMin < 43200) {
                console.warn(`[복구] trades Firebase 없음 → 로컬 백업 사용 (${Math.round(ageMin)}분 전, ${data.length}건)`);
                setTrades(data);
              }
            }
          } catch {}
        }
        setLoaded(true);
      });
      unsubs.push(u);
    }
    attach("alerts",    setAlerts,    "a");
    attach("snapshots", setSnapshots, "s");
    attach("holdings2",  setHoldings2, "h2");
    attach("watchlist",    setWatchlist,   "wl");
    // divInfo는 객체 형태로 저장 - 별도 처리
    const uDi = dbOn(`users/${syncKey}/divInfo`, val => {
      if (saving.current["di"]) return;
      fbLoadedRef.current["di"] = true;
      if (val && typeof val === "object" && !Array.isArray(val) && Object.keys(val).length > 0) {
        setDivInfo(val);
      } else {
        // Firebase 없음 → localStorage 백업 복구 시도
        try {
          const bk = localStorage.getItem("pm_bk_di");
          if (bk) {
            const { data, ts } = JSON.parse(bk);
            const ageMin = (Date.now()-ts)/60000;
            if (data && Object.keys(data).length > 0 && ageMin < 43200) {
              console.warn("[복구] divInfo 로컬 백업 사용 (" + Math.round(ageMin) + "분 전)");
              setDivInfo(data);
            }
          }
        } catch {}
      }
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
    // 로컬 백업 현황 로깅
    try {
      const keys = ["h","h2","t","dr","di","wl","a","cl","ca"];
      const bkSummary = keys.map(k => {
        const bk = localStorage.getItem("pm_bk_" + k);
        if (!bk) return null;
        try {
          const { data, ts } = JSON.parse(bk);
          const cnt = Array.isArray(data) ? data.length : Object.keys(data).length;
          const ageMin = Math.round((Date.now()-ts)/60000);
          return `${k}:${cnt}건(${ageMin}분전)`;
        } catch { return null; }
      }).filter(Boolean).join(", ");
      if (bkSummary) console.info("[로컬백업 현황]", bkSummary);
    } catch {}
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
          // 새 날: 종가 기준으로 표시, 변동률 0
          if (isNewDay && parsed && typeof parsed === 'object') {
            const dayStart = {};
            Object.entries(parsed).forEach(([k,v]) => {
              dayStart[k] = {
                ...v,
                price: v.closePrice || v.regularPrice || v.price,
                changePercent: 0,
                changeAmount: 0,
                regularChangePercent: v.regularChangePercent ?? v.changePercent ?? 0,
                regularChangeAmount: v.regularChangeAmount ?? v.changeAmount ?? 0,
              };
            });
            setPrices(dayStart);
            setPriceAge(age);
          } else if (!isNewDay && parsed) {
            setPrices(parsed);
            setPriceAge(age);
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
        async () => { const r = await fetch("/api/rates", { signal: AbortSignal.timeout(6000), cache:"no-store" }); const d = await r.json(); return d?.rates?.KRW; },
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



  const saveData = useCallback((path, data, key) => {
    if (!loaded) return;
    if (!fbLoadedRef.current[key]) return; // Firebase에서 한 번도 안 읽어온 키는 저장 안 함
    saving.current[key] = true;
    dbSet(`users/${syncKey}/${path}`, data).finally(() => setTimeout(() => { saving.current[key] = false; }, 500));
  }, [syncKey, loaded]);

  useEffect(() => { if (loaded) saveData("holdings",  holdings.length  ? holdings  : [], "h");  }, [holdings,  loaded]);
  useEffect(() => { if (loaded) saveData("holdings2", holdings2.length ? holdings2 : [], "h2"); }, [holdings2, loaded]);
  useEffect(() => { if (loaded) saveData("watchlist",   watchlist.length   ? watchlist   : [],  "wl"); }, [watchlist,  loaded]);
  useEffect(() => {
    if(!loaded||!fbLoadedRef.current["di"]) return;
    if(Object.keys(divInfo).length===0) return; // 빈 객체 저장 금지
    try{localStorage.setItem("pm_bk_di",JSON.stringify({data:divInfo,ts:Date.now()}));}catch{}
    saveData("divInfo", divInfo, "di");
  }, [divInfo, loaded]);
  useEffect(() => { if (loaded) saveData("contribLimits",  Object.keys(contribLimits).length ? contribLimits : {}, "cl"); }, [contribLimits,  loaded]);
  useEffect(() => { if (loaded) saveData("contribAmounts", Object.keys(contribAmounts).length ? contribAmounts: {}, "ca"); }, [contribAmounts, loaded]);
  useEffect(() => {
    if(!loaded||!fbLoadedRef.current["dr"]) return;
    if(divRecords.length===0) return; // 빈 배열 저장 금지
    try{localStorage.setItem("pm_bk_dr",JSON.stringify({data:divRecords,ts:Date.now()}));}catch{}
    saveData("divRecords", divRecords, "dr");
  }, [divRecords, loaded]);
  useEffect(() => {
    if (!loaded) return;
    if (!tradesLoadedFromFB.current) return; // Firebase에서 아직 안 읽어옴 → 저장 금지
    if (trades.length === 0) return; // 빈 배열은 절대 저장 안함 (실수 삭제 방지)
    saveData("trades", trades, "t");
  }, [trades, loaded]);
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
          // KR 종목 중 데이터 없는 것 → 별도로 allorigins 직접 호출
          const missingKR = krTickers.filter(tk => !batchRes[tk]);
          if (missingKR.length > 0) {
            await Promise.all(missingKR.map(async tk => {
              const r = await fetchKRStock(tk);
              if (r) { next[tk] = r; next[tk.replace(".KS","").replace(".KQ","")] = r; }
            }));
          }
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
          const r = await fetchKRStock(tk);
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
        // 캐시에 가격+당일 등락폭 저장 (장마감 후에도 표시 유지)
        const cacheOnly = {};
        Object.entries(merged).forEach(([k,v]) => {
          cacheOnly[k] = {
            price: v.price,
            regularPrice: v.regularPrice,
            currency: v.currency,
            changePercent: v.changePercent ?? 0,
            changeAmount: v.changeAmount ?? 0,
            regularChangePercent: v.regularChangePercent ?? v.changePercent ?? 0,
            regularChangeAmount: v.regularChangeAmount ?? v.changeAmount ?? 0,
            closePrice: v.closePrice || v.regularPrice || v.price,
            marketState: v.marketState || 'REGULAR',
            preMarketPrice: v.preMarketPrice ?? null,
            preMarketChange: v.preMarketChange ?? null,
            preMarketChangePercent: v.preMarketChangePercent ?? null,
            postMarketPrice: v.postMarketPrice ?? null,
            postMarketChange: v.postMarketChange ?? null,
            postMarketChangePercent: v.postMarketChangePercent ?? null,
          };
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

  // 스냅샷 저장: 가격 갱신 후 30초 간격으로 기록
  const snapshotsRef = useRef(snapshots);
  useEffect(() => { snapshotsRef.current = snapshots; }, [snapshots]);

  useEffect(() => {
    if (!loaded || totalVal <= 0) return;
    const now2 = Date.now();
    const lastSnap = snapshotsRef.current.length
      ? Math.max(...snapshotsRef.current.map(s=>s.id||0)) : 0;
    if (now2 - lastSnap < 30000) return; // 30초 이내 중복 방지
    const snap = {
      id: now2,
      label: new Date(now2+9*3600000).toISOString().slice(5,16).replace('T',' '),
      returnRate: Math.round(totalRet*100)/100,
      totalValue: Math.round(totalVal),
    };
    const newSnaps = [...snapshotsRef.current, snap]
      .sort((a,b)=>(a.id||0)-(b.id||0)).slice(-200);
    setSnapshots(newSnaps);
    dbSet(`users/${syncKey}/snapshots`, newSnaps);
  }, [priceAge]); // priceAge가 바뀔때마다(=가격갱신마다) 체크

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
      if (kospi || nyseReg)        return 5000;   // 정규장: 5초
      if (nysePre || nyseAfter)    return 15000;  // 프리/애프터: 15초 (Finnhub rate limit 고려)
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
  // P1: ISA 제외 (P3 탭으로 분리)
  const holdingsP1 = holdings.filter(h => h.market !== "ISA");
  const portfolio = holdingsP1.map(h => {
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
    // changeAmount: API 직접값 우선, 없으면 가격·변동률로 계산
    const chgAmt = p?.changeAmount
      ? p.changeAmount
      : (p?.price && p?.changePercent
          ? (cur==="KRW"
              ? Math.round(p.price / (1 + p.changePercent/100) * (p.changePercent/100))
              : Math.round(p.price / (1 + p.changePercent/100) * (p.changePercent/100) * 100) / 100)
          : 0);
    const regPrice  = p?.regularPrice ?? price;
    const regChgPct = p?.regularChangePercent ?? 0;
    const regChgAmt = p?.regularChangeAmount ?? 0;
    // preMarket/postMarket - 현재 장 상태 기준으로만 유효
    const liveState = getLiveMarketState(h.market, p?.marketState);
    const preMarketPrice = liveState==='PRE'  ? (p?.preMarketPrice  ?? null) : null;
    const preMarketChangePercent = liveState==='PRE'  ? (p?.preMarketChangePercent  ?? null) : null;
    const postMarketPrice = liveState==='POST' ? (p?.postMarketPrice ?? null) : null;
    const postMarketChangePercent = liveState==='POST' ? (p?.postMarketChangePercent ?? null) : null;
    return { ...h, price, value, cost, pnl, pnlPct, cur, chgPct: p?.changePercent ?? 0, chgAmt, hasLive: !!p,
      marketState: liveState, regPrice, regChgPct, regChgAmt,
      preMarketPrice, preMarketChangePercent, postMarketPrice, postMarketChangePercent };
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

  const snapshotList = [...snapshots].sort((a,b) => (a.id||0)-(b.id||0));
  const filteredSnaps = (() => {
    const msMap = {"1h":3600000,"1d":86400000,"7d":7*86400000,"30d":30*86400000,"180d":180*86400000,"365d":365*86400000,"1095d":1095*86400000};
    if (chartPeriod === "all" || !msMap[chartPeriod]) return snapshotList;
    const cutoff = Date.now() - msMap[chartPeriod];
    return snapshotList.filter(s => (s.id||0) >= cutoff);
  })();
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
    const qty = +editForm.quantity;
    const avg = +editForm.avgPrice;
    if (!qty || isNaN(qty) || !avg || isNaN(avg)) return;
    // 임시 계산 필드(addQty/addPrice/calcQty/calcAvg) 제거 후 저장
    const { addQty:_a, addPrice:_b, calcQty:_c, calcAvg:_d, _mode:_e, ...cleanForm } = editForm;
    setHoldings(p => p.map(x => x.id === editingId
      ? { ...x, ...cleanForm, quantity: qty, avgPrice: avg }
      : x
    ));
    setEditingId(null);
  };
  const startEdit2 = (h) => {
    setEditForm2({ name:h.name||"", market:h.market, quantity:String(h.quantity), avgPrice:String(h.avgPrice), taxAccount:h.taxAccount||"연금저축1(신한금융투자)", broker:h.broker||"" });
    setEditingId2(h.id);
  };
  const saveEdit2 = () => {
    const qty = +editForm2.quantity;
    const avg = +editForm2.avgPrice;
    if (!qty || isNaN(qty) || !avg || isNaN(avg)) return;
    // addQty/addPrice/calcQty2/calcAvg2 등 임시 계산 필드 제거 후 저장
    const { addQty:_a, addPrice:_b, calcQty2:_c, calcAvg2:_d, ...cleanForm } = editForm2;
    setHoldings2(p => p.map(x => x.id === editingId2
      ? { ...x, ...cleanForm, quantity: qty, avgPrice: avg }
      : x
    ));
    setEditingId2(null);
  };


  // ── 지수 실시간 폴링 (코스피/S&P500/나스닥/야간선물) ────────────────
  // 미국 정규장(한국시간 23:30~6:00 표준, 22:30~5:00 서머타임): 5초
  // 그 외: 30초
  useEffect(() => {
    let cancelled = false;
    let timer = null;
    const getInterval = () => {
      const dst = isUSDST();
      const kst = new Date(Date.now()+9*3600000);
      const mins = kst.getUTCHours()*60+kst.getUTCMinutes();
      const usStart = dst?22*60+30:23*60+30;
      const usEnd   = dst?5*60:6*60;
      const usActive = mins>=usStart || mins<usEnd;
      const krActive = mins>=9*60 && mins<15*60+35;
      return (usActive||krActive) ? 5000 : 30000;
    };
    const fetchAll = async () => {
      try {
        const [kospiRes, sp500Res, nasdaqRes, futRes] = await Promise.allSettled([
          fetchYahoo("^KS11"),
          fetchYahoo("^GSPC"),
          fetchYahoo("^IXIC"),
          fetchKospiFutures(),
        ]);
        if (cancelled) return;
        setLiveIndices({
          kospi:   kospiRes.status  === "fulfilled" ? kospiRes.value  : null,
          sp500:   sp500Res.status  === "fulfilled" ? sp500Res.value  : null,
          nasdaq:  nasdaqRes.status === "fulfilled" ? nasdaqRes.value : null,
          futures: futRes.status    === "fulfilled" ? futRes.value    : null,
        });
      } catch {}
      if (!cancelled) {
        timer = setTimeout(fetchAll, getInterval());
      }
    };
    fetchAll();
    return () => { cancelled = true; if(timer) clearTimeout(timer); };
  }, []);


  // ── 스파크라인: 보유종목 변경 시 순차 지연 로딩 ─────────────────────────
  useEffect(() => {
    const allTickers = [
      ...holdings.map(h=>({ticker:h.ticker, market:h.market})),
      ...holdings2.map(h=>({ticker:h.ticker, market:h.market})),
    ].filter((v,i,arr)=>arr.findIndex(x=>x.ticker===v.ticker)===i); // 중복 제거
    let cancelled = false;
    const load = async () => {
      for (let i=0; i<allTickers.length; i++) {
        if (cancelled) break;
        const {ticker, market} = allTickers[i];
        const key = ticker+"_"+market;
        if (_chartCache[key]) {
          setSparklineData(p=>({...p,[ticker]:_chartCache[key]}));
          continue;
        }
        // 종목당 400ms 간격으로 순차 로딩 (동시 요청 방지)
        await new Promise(r=>setTimeout(r, i===0?100:400));
        if (cancelled) break;
        try {
          const data = await fetchHistory(ticker, market, "1mo");
          if (data && data.length >= 2) {
            _chartCache[key] = data;
            if (!cancelled) setSparklineData(p=>({...p,[ticker]:data}));
          }
        } catch {}
      }
    };
    load();
    return () => { cancelled = true; };
  }, [holdings.length, holdings2.length]); // 종목 수 바뀔 때만 재로딩

  const addT = () => {
    if (!tForm.ticker || !tForm.quantity || !tForm.price) return;
    setTrades(p => [...p, { id: Date.now(), ...tForm, portfolio:"p1", quantity: +tForm.quantity, price: +tForm.price, fee: +(tForm.fee||0) }]);
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
  const renderTableRow = (h, compact=false, hide=false) => (
    <>
    <tr key={h.id}>
      <td style={{...S.TD,cursor:"pointer",padding:compact?"4px 8px":"8px 12px"}} onClick={()=>setSelectedStock(h)} onMouseEnter={()=>{if(!_chartCache[h.ticker]){fetchHistory(h.ticker,h.market).then(d=>{_chartCache[h.ticker]=d});fetchStockInfo(h.ticker,h.market).then(d=>{_infoCache[h.ticker]=d});} }}>
        <div style={{display:"flex",alignItems:"center",gap:compact?"6px":"10px",minWidth:0}}>
          <div style={{width:compact?"7px":"10px",height:compact?"7px":"10px",borderRadius:"2px",background:MARKET_COLOR[h.market],flexShrink:0}}/>
          <div style={{minWidth:0,flex:"1 1 auto"}}>
            <div style={{fontWeight:700,fontSize:compact?"12px":"15px",letterSpacing:"-0.02em",color:"#f1f5f9",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.name||MARKET_LABEL[h.market]}</div>
            <div style={{fontSize:"10px",color:"#a5b4fc",fontWeight:600,marginTop:"1px",textDecoration:"underline",textDecorationStyle:"dotted",textUnderlineOffset:"2px"}}>{h.ticker}</div>
            {h.market==="ISA"&&<div style={{fontSize:"10px",color:"#06b6d4",background:"rgba(6,182,212,0.12)",border:"1px solid rgba(6,182,212,0.3)",display:"inline-block",padding:"1px 7px",borderRadius:"4px",fontWeight:800,marginTop:"3px",letterSpacing:"0.05em"}}>ISA</div>}
            {h.broker&&<div style={{fontSize:"11px",color:"#6366f1",background:"rgba(99,102,241,0.12)",display:"inline-block",padding:"1px 6px",borderRadius:"4px",fontWeight:700,marginTop:"2px"}}>{h.broker}</div>}
          </div>
          {!compact&&<div style={{flexShrink:0,marginLeft:"8px",borderLeft:"1px solid rgba(255,255,255,0.07)",paddingLeft:"10px"}}>
            <MiniSparkline data={sparklineData[h.ticker]} pnlPct={h.pnlPct||0} width={64} height={24}/>
          </div>}
        </div>
      </td>
      <td style={S.TD}>
        {/* 현재가: PRE/POST면 종가 + 별도 표시 */}
        <div style={{fontWeight:700}}>
          {h.marketState==="PRE"||h.marketState==="POST" ? fmtPrice(h.regPrice||h.price,h.cur) : fmtPrice(h.price,h.cur)}
        </div>
        {h.marketState==="PRE" && h.preMarketPrice && (
          <div style={{fontSize:"10px",color:"#fbbf24",marginTop:"2px",fontWeight:700}}>
            🌅 {fmtPrice(h.preMarketPrice,h.cur)}
            <span style={{color:(h.preMarketChangePercent??0)>=0?"#34d399":"#f87171",marginLeft:"3px"}}>
              {h.preMarketChangePercent!=null?(h.preMarketChangePercent>=0?"+":"")+h.preMarketChangePercent.toFixed(2)+"%":""}
            </span>
          </div>
        )}
        {h.marketState==="POST" && h.postMarketPrice && (
          <div style={{fontSize:"10px",color:"#a78bfa",marginTop:"2px",fontWeight:700}}>
            🌙 {fmtPrice(h.postMarketPrice,h.cur)}
            <span style={{color:(h.postMarketChangePercent??0)>=0?"#34d399":"#f87171",marginLeft:"3px"}}>
              {h.postMarketChangePercent!=null?(h.postMarketChangePercent>=0?"+":"")+h.postMarketChangePercent.toFixed(2)+"%":""}
            </span>
          </div>
        )}
        {!h.hasLive&&<div style={{fontSize:"11px",color:"#475569"}}>매수가 기준</div>}
      </td>
      <td style={{...S.TD,fontWeight:700}}>
        {/* 일변동: 정규장 종가 기준 등락 */}
        <div style={{fontWeight:800,color:( h.regChgPct??h.chgPct)>=0?"#34d399":"#f87171"}}>
          {(()=>{
            const amt = h.regChgAmt||h.chgAmt;
            const pct = h.regChgPct??h.chgPct;
            const amtStr = amt
              ? (amt>=0?"+":"-")+(h.cur==="USD" ? "$"+Math.abs(amt).toFixed(2) : Math.round(Math.abs(amt)).toLocaleString()+"₩")
              : pct ? (pct>=0?"+":"-")+(h.cur==="USD" ? "$"+(Math.abs(pct)/100*( h.regPrice||h.price)).toFixed(2) : Math.round(Math.abs(pct)/100*(h.regPrice||h.price)).toLocaleString()+"₩") : "—";
            return amtStr;
          })()}
        </div>
        <div style={{fontSize:"11px",opacity:0.85,color:(h.regChgPct??h.chgPct)>=0?"#34d399":"#f87171"}}>({fmtPct(h.regChgPct??h.chgPct)})</div>
        {/* 프리/애프터: 별도 변동 표시 */}
        {h.marketState==="PRE" && h.preMarketChangePercent!=null && (
          <div style={{fontSize:"9px",color:"#fbbf24",fontWeight:700,lineHeight:1.4}}>🌅{h.preMarketChangePercent>=0?"+":""}{h.preMarketChangePercent.toFixed(2)}%</div>
        )}
        {h.marketState==="POST" && h.postMarketChangePercent!=null && (
          <div style={{fontSize:"9px",color:"#c084fc",fontWeight:700,lineHeight:1.4}}>🌙{h.postMarketChangePercent>=0?"+":""}{h.postMarketChangePercent.toFixed(2)}%</div>
        )}
      </td>
      <td style={S.TD}>{h.quantity.toLocaleString()}</td>
      <td style={{...S.TD,fontWeight:700}}>{hide ? <span style={{color:"#334155",letterSpacing:"0.05em"}}>●●●</span> : currMode==="KRW"?fmtKRW(toKRWLive(h.value,h.cur)):fmtPrice(h.value,h.cur)}</td>
      <td style={{...S.TD,color:h.pnlPct>=0?"#34d399":"#f87171",fontWeight:800}}>{hide ? <span style={{color:"#334155"}}>--%</span> : fmtPct(h.pnlPct)}</td>
      <td style={S.TD}>
        <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
          <button onClick={()=>editingId===h.id?setEditingId(null):startEdit(h)} style={{background:"none",border:"1px solid rgba(99,102,241,0.4)",color:"#a5b4fc",cursor:"pointer",fontSize:"12px",padding:"3px 10px",borderRadius:"6px",fontWeight:700}}>수정</button>
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
                  <div style={{gridColumn:"1/-1"}}><button onClick={()=>setEditForm(p=>{if(!p.calcQty||!p.calcAvg)return p;return{...p,quantity:String(p.calcQty),avgPrice:String(p.calcAvg),addQty:"",addPrice:"",calcQty:undefined,calcAvg:undefined};})} style={S.btn("#10b981",{fontSize:"13px",padding:"6px 14px",width:"100%"})}>↑ 위 값으로 적용하기</button></div>
                </div>
              )}
            </div>
            <div style={{display:"flex",gap:"8px",justifyContent:"space-between",alignItems:"center"}}>
              <button onClick={()=>{if(window.confirm(`"${h.name||h.ticker}" 종목을 삭제할까요?`)){setHoldings(p=>p.filter(x=>x.id!==h.id));setEditingId(null);}}} style={S.btn("#dc2626",{fontSize:"13px",padding:"7px 14px"})}>🗑️ 삭제</button>
              <div style={{display:"flex",gap:"8px"}}>
                <button onClick={()=>setEditingId(null)} style={S.btn("#475569",{fontSize:"13px",padding:"7px 14px"})}>취소</button>
                <button onClick={saveEdit} style={S.btn("#6366f1",{fontSize:"13px",padding:"7px 16px"})}>✓ 저장</button>
              </div>
            </div>
          </div>
        </td>
      </tr>
    )}
    </>
  );

  // 모바일 카드 렌더러
  const renderMobileCard = (h, compact=false, hide=false) => (
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
          <div style={{borderLeft:"1px solid rgba(255,255,255,0.08)",paddingLeft:"8px",marginRight:"4px"}}>
            <MiniSparkline data={sparklineData[h.ticker]} pnlPct={h.pnlPct||0} width={56} height={22}/>
          </div>
          <button onClick={()=>editingId===h.id?setEditingId(null):startEdit(h)} style={{background:"none",border:"1px solid rgba(99,102,241,0.4)",color:"#a5b4fc",cursor:"pointer",fontSize:"11px",padding:"2px 8px",borderRadius:"6px",fontWeight:700}}>수정</button>
          <button onClick={()=>setHoldings(p=>p.filter(x=>x.id!==h.id))} style={{background:"none",border:"none",color:"#475569",cursor:"pointer",fontSize:"16px"}}>✕</button>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:compact?"3px":"6px"}}>
        <div style={{background:"rgba(0,0,0,0.2)",borderRadius:"6px",padding:"6px 8px"}}>
                <div style={{fontSize:"10px",color:"#64748b",marginBottom:"2px"}}>
                  {h.marketState==="PRE"?"종가":"현재가"}
                </div>
                <div style={{fontSize:"13px",fontWeight:700}}>
                  {h.marketState==="PRE"||h.marketState==="POST" ? fmtPrice(h.regPrice||h.price,h.cur) : fmtPrice(h.price,h.cur)}
                </div>
                {h.marketState==="PRE" && h.preMarketPrice && (
                  <div style={{fontSize:"10px",color:"#fbbf24",fontWeight:700,marginTop:"2px"}}>
                    🌅{fmtPrice(h.preMarketPrice,h.cur)} {h.preMarketChangePercent!=null?(h.preMarketChangePercent>=0?"+":"")+h.preMarketChangePercent.toFixed(2)+"%":""}
                  </div>
                )}
                {h.marketState==="POST" && h.postMarketPrice && (
                  <div style={{fontSize:"10px",color:"#a78bfa",fontWeight:700,marginTop:"2px"}}>
                    🌙{fmtPrice(h.postMarketPrice,h.cur)} {h.postMarketChangePercent!=null?(h.postMarketChangePercent>=0?"+":"")+h.postMarketChangePercent.toFixed(2)+"%":""}
                  </div>
                )}
                {!h.hasLive&&<div style={{fontSize:"10px",color:"#475569"}}>매수가기준</div>}
              </div>
        <div style={{background:"rgba(0,0,0,0.2)",borderRadius:"6px",padding:"6px 8px"}}>
                <div style={{fontSize:"10px",color:"#64748b",marginBottom:"2px"}}>일변동(종가기준)</div>
                <div style={{color:(h.regChgPct??h.chgPct)>=0?"#34d399":"#f87171"}}>
                  <span style={{fontSize:"13px",fontWeight:800}}>
                    {(()=>{
                      const amt=h.regChgAmt||h.chgAmt;
                      const pct=h.regChgPct??h.chgPct;
                      if(amt) return (amt>=0?"+":"-")+(h.cur==="USD"?"$"+Math.abs(amt).toFixed(2):Math.round(Math.abs(amt)).toLocaleString()+"₩");
                      if(pct) return (pct>=0?"+":"-")+(h.cur==="USD"?"$"+(Math.abs(pct)/100*(h.regPrice||h.price)).toFixed(2):Math.round(Math.abs(pct)/100*(h.regPrice||h.price)).toLocaleString()+"₩");
                      return "—";
                    })()}
                  </span>
                  <span style={{fontSize:"11px",marginLeft:"3px",opacity:0.85}}>({fmtPct(h.regChgPct??h.chgPct)})</span>
                  {h.marketState==="PRE"  && h.preMarketChangePercent!=null  && <span style={{fontSize:"9px",background:"rgba(251,191,36,0.2)",color:"#fbbf24",padding:"1px 5px",borderRadius:"4px",marginLeft:"4px",fontWeight:700}}>🌅{(h.preMarketChangePercent>=0?"+":"")+h.preMarketChangePercent.toFixed(2)}%</span>}
                  {h.marketState==="POST" && h.postMarketChangePercent!=null && <span style={{fontSize:"9px",background:"rgba(167,139,250,0.2)",color:"#a78bfa",padding:"1px 5px",borderRadius:"4px",marginLeft:"4px",fontWeight:700}}>🌙{(h.postMarketChangePercent>=0?"+":"")+h.postMarketChangePercent.toFixed(2)}%</span>}
                </div>
              </div>
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
            <div style={{display:"flex",gap:"8px",justifyContent:"space-between"}}>
              <button onClick={()=>{if(window.confirm("삭제?"))setHoldings(p=>p.filter(x=>x.id!==h.id));setEditingId(null);}} style={S.btn("#dc2626",{fontSize:"13px",padding:"8px",minWidth:"56px"})}>🗑️</button>
              <div style={{display:"flex",gap:"8px"}}>
                <button onClick={()=>setEditingId(null)} style={S.btn("#475569",{fontSize:"13px",padding:"8px"})}>취소</button>
                <button onClick={saveEdit} style={S.btn("#6366f1",{fontSize:"13px",padding:"8px"})}>✓ 저장</button>
              </div>
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
  const tabs = [["portfolio","📊 포트폴리오"],["charts","📈 차트"],["trades","📝 매매일지"],["dividend","💰 배당"],["watchlist","⭐ 관심종목"],["alerts","🔔 알람"]];
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
    const regChgPct2 = p?.regularChangePercent ?? 0;
    const regChgAmt2 = p?.regularChangeAmount ?? 0;
    const chgAmt2 = p?.changeAmount ?? 0;
    return { ...h, price, value, cost, pnl, pnlPct, cur, chgPct: p?.changePercent??0, chgAmt:chgAmt2, regChgPct:regChgPct2, regChgAmt:regChgAmt2, hasLive:!!p, marketState:p?.marketState };
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
      <div style={{ background:"rgba(6,9,20,0.98)", borderBottom:"1px solid rgba(255,255,255,0.07)", padding:isMobile?"4px 8px":"5px 14px", position:"sticky", top:0, zIndex:51, minHeight:isMobile?"32px":"38px", display:"flex", alignItems:"center", gap:isMobile?"6px":"12px", flexWrap:"wrap", overflowX:"auto" }}>
        {(()=>{
          const kst  = new Date(Date.now()+9*3600000);
          const mins = kst.getUTCHours()*60+kst.getUTCMinutes();
          const isDST = isUSDST();

          // ── 공휴일 체크
          const krHoliday = isKRHoliday(kst);
          const usHoliday = isUSHoliday(kst);

          // 국내장 시간대 (KST) - 공휴일/주말이면 전부 휴장
          const krPre     = !krHoliday && mins>=8*60    && mins<9*60;
          const krRegular = !krHoliday && mins>=9*60    && mins<15*60+30;
          const krAfter   = !krHoliday && mins>=15*60+30&& mins<20*60;
          const krClosed  = !krPre && !krRegular && !krAfter;

          // 미국장 시간대 (섬머타임 자동 반영) - 공휴일/주말이면 전부 휴장
          const usPreStart  = isDST?17*60+30:18*60;
          const usRegStart  = isDST?22*60+30:23*60+30;
          const usRegEnd    = isDST?5*60:6*60;
          const usAfterEnd  = isDST?9*60:10*60;
          const usRegular = !usHoliday && (mins>=usRegStart || mins<usRegEnd);
          const usPre     = !usHoliday && !usRegular && mins>=usPreStart && mins<usRegStart;
          const usAfter   = !usHoliday && !usRegular && mins>=usRegEnd   && mins<usAfterEnd;

          const MarketItem = ({flag, name, regular, pre, after, holiday=false}) => {
            let dotColor, label, labelColor;
            if      (holiday) { dotColor="#374151"; label="휴장일"; labelColor="#4b5563"; }
            else if (regular) { dotColor="#22c55e"; label="정규장"; labelColor="#4ade80"; }
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
            <MarketItem flag="🇰🇷" name="국내" regular={krRegular} pre={krPre} after={krAfter} holiday={krHoliday&&!krPre&&!krRegular&&!krAfter}/>
            <span style={{color:"rgba(255,255,255,0.08)",fontSize:"16px",userSelect:"none"}}>|</span>
            <MarketItem flag="🇺🇸" name="미국" regular={usRegular} pre={usPre} after={usAfter} holiday={usHoliday&&!usPre&&!usRegular&&!usAfter}/>
            {/* 코스피/S&P500/나스닥/야간선물 실시간 지수 */}
            {liveIndices && (()=>{
              const Idx = ({label, data, isKR=false}) => {
                if (!data?.price) return null;
                const chg = data.changePercent ?? 0;
                const chgAmt = data.changeAmount ?? 0;
                const up = chg >= 0;
                const c = up ? "#34d399" : "#f87171";
                const priceStr = isKR
                  ? Math.round(data.price).toLocaleString("ko-KR")
                  : data.price >= 10000
                    ? Math.round(data.price).toLocaleString("en-US")
                    : data.price.toFixed(2);
                return (
                  <div style={{display:"flex",alignItems:"center",gap:"5px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"7px",padding:isMobile?"2px 7px":"3px 10px",flexShrink:0}}>
                    <span style={{fontSize:"10px",color:"#6b7280",fontWeight:600,whiteSpace:"nowrap"}}>{label}</span>
                    {!isMobile&&<span style={{fontSize:"11px",fontWeight:700,color:"#e2e8f0",whiteSpace:"nowrap"}}>{priceStr}</span>}
                    <span style={{fontSize:isMobile?"11px":"12px",fontWeight:800,color:c,whiteSpace:"nowrap"}}>{up?"+":""}{chg.toFixed(2)}%</span>
                  </div>
                );
              };
              const Fut = ({data}) => {
                if (!data?.price) return null;
                const chg = data.chg ?? data.changePercent ?? 0;
                const up = chg >= 0;
                const c = up ? "#34d399" : "#f87171";
                return (
                  <div style={{display:"flex",alignItems:"center",gap:"5px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"7px",padding:isMobile?"2px 7px":"3px 10px",flexShrink:0}}>
                    <span style={{fontSize:"10px",color:"#6b7280",fontWeight:600,whiteSpace:"nowrap"}}>K200야간선물</span>
                    <span style={{fontSize:isMobile?"11px":"12px",fontWeight:800,color:c,whiteSpace:"nowrap"}}>{up?"+":""}{chg.toFixed(2)}%</span>
                    {!isMobile&&<span style={{fontSize:"10px",color:c,whiteSpace:"nowrap"}}>({data.price?.toFixed(2)})</span>}
                  </div>
                );
              };
              return (<>
                <span style={{color:"rgba(255,255,255,0.08)",fontSize:"14px",userSelect:"none",flexShrink:0}}>|</span>
                <Idx label="KOSPI" data={liveIndices.kospi} isKR={true}/>
                <Idx label="S&P500" data={liveIndices.sp500}/>
                <Idx label="NASDAQ" data={liveIndices.nasdaq}/>
                <Fut data={liveIndices.futures}/>
              </>);
            })()}
            <span style={{marginLeft:"auto",fontSize:"10px",color:"#374151",display:"flex",alignItems:"center",gap:"6px"}}>
              {loading&&<span style={{color:"#6366f1",fontWeight:600}}>↻ 조회중</span>}
              {!loading&&(lastUpdated||priceAge>0)&&<span style={{color:"#4b5563"}}>{lastUpdated||new Date(priceAge).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</span>}
            </span>
          </>);
        })()}
      </div>

      <div style={{ background:"rgba(15,23,42,0.88)", backdropFilter:"blur(14px)", borderBottom:"1px solid rgba(255,255,255,0.08)", padding:isMobile?"5px 10px":"8px 18px", position:"sticky", top:"31px", zIndex:50, minHeight:isMobile?"44px":"auto" }}>
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
            {isMobile && <InfoWidget />}
             <button onClick={fetchPrices} disabled={loading} style={S.btn(loading?"#334155":"#6366f1", { display:"flex", alignItems:"center", justifyContent:"center", gap:"3px", opacity:loading?0.7:1, fontSize:"11px", padding:"5px 0", width:"76px", minWidth:"76px" })}>
               <span style={{ display:"inline-block", animation:loading?"spin 1s linear infinite":"none", flexShrink:0 }}>↻</span>
               <span style={{ display:"inline-block", minWidth:"38px", textAlign:"left" }}>{loading?"조회중":"새로고침"}</span>
             </button>
            <button onClick={()=>setShowForm(showForm==="theme"?null:"theme")} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#94a3b8",padding:"5px 9px",borderRadius:"8px",cursor:"pointer",fontSize:"11px",fontWeight:600}} title="배경 테마">🎨</button>
            <button onClick={onLogout} style={S.btn("#334155", { fontSize:"11px", padding:"5px 9px" })}>로그아웃</button>
          </div>
        </div>
        {/* InfoWidget: 모바일에서는 날씨/환율 탭 접기 버튼만 표시 */}

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
        <div style={{ display:"flex", gap:"4px", marginTop:isMobile?"3px":"6px", marginBottom:isMobile?"2px":"4px" }}>
          {[["overview","🏠 전체현황"],["p1","📊 포트폴리오1"],["p2","🏦 포트폴리오2"],["p3","💧 포트폴리오3"],["tax","💰 양도세"],["calendar","📅 캘린더"]].map(([id,label])=>(
            <button key={id} onClick={()=>{setMainTab(id);setTab("portfolio");}} style={{ background:mainTab===id?"rgba(99,102,241,0.3)":"rgba(255,255,255,0.04)", border:mainTab===id?"1px solid rgba(99,102,241,0.55)":"1px solid rgba(255,255,255,0.08)", color:mainTab===id?"#c7d2fe":"#64748b", padding:isMobile?"5px 10px":"6px 16px", borderRadius:"8px", cursor:"pointer", fontSize:isMobile?"11px":"13px", fontWeight:mainTab===id?800:500, letterSpacing:"-0.01em", fontFamily:FONT }}>
              {isMobile?(id==="overview"?"전체현황":id==="p1"?"P1":id==="p2"?"P2":id==="p3"?"P3":id==="tax"?"양도세":"캘린더"):label}
            </button>
          ))}
        </div>
        {(mainTab !== "overview" && mainTab !== "tax" && mainTab !== "calendar") && (
          <div style={{ display:"flex", gap:"3px", flexWrap:"wrap" }}>
            {tabs.map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} style={{ background:tab===id?"rgba(99,102,241,0.2)":"transparent", border:tab===id?"1px solid rgba(99,102,241,0.4)":"1px solid transparent", color:tab===id?"#a5b4fc":"#475569", padding:isMobile?"4px 9px":"5px 12px", borderRadius:"7px", cursor:"pointer", fontSize:isMobile?"11px":"12px", fontWeight:tab===id?700:500, letterSpacing:"-0.01em", fontFamily:FONT }}>
                {isMobile ? label.split(" ")[1]||label : label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding:isMobile?"6px 10px":"14px 20px", maxWidth:"1200px", margin:"0 auto" }}>

        {/* ── OVERVIEW ── */}
        {mainTab === "overview" && (
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

          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px",flexWrap:"wrap",gap:"6px"}}>
            <div style={{display:"flex",gap:"3px"}}>{[["all","🗂 전체"],["broker","🏢 증권사별"],["market","🌍 국내·해외별"]].map(([id,label])=>(<button key={id} onClick={()=>setOverviewTab(id)} style={{background:overviewTab===id?"rgba(99,102,241,0.3)":"rgba(255,255,255,0.04)",border:overviewTab===id?"1px solid rgba(99,102,241,0.5)":"1px solid rgba(255,255,255,0.08)",color:overviewTab===id?"#c7d2fe":"#64748b",padding:isMobile?"4px 9px":"5px 13px",borderRadius:"7px",cursor:"pointer",fontSize:isMobile?"11px":"12px",fontWeight:overviewTab===id?800:500}}>{isMobile?label.split(" ")[1]:label}</button>))}</div>
            <div style={{display:"flex",gap:"5px",alignItems:"center"}}>
              {overviewTab==="all"&&<div style={{display:"flex",background:"rgba(255,255,255,0.06)",borderRadius:"8px",padding:"2px",gap:"2px"}}><button onClick={()=>setCurrMode("KRW")} style={{padding:"3px 10px",borderRadius:"6px",border:"none",cursor:"pointer",fontSize:"11px",fontWeight:700,background:currMode==="KRW"?"rgba(99,102,241,0.5)":"transparent",color:currMode==="KRW"?"#c7d2fe":"#64748b"}}>₩</button><button onClick={()=>setCurrMode("USD")} style={{padding:"3px 10px",borderRadius:"6px",border:"none",cursor:"pointer",fontSize:"11px",fontWeight:700,background:currMode==="USD"?"rgba(16,185,129,0.4)":"transparent",color:currMode==="USD"?"#6ee7b7":"#64748b"}}>$</button></div>}
              <button onClick={()=>setSummaryOpen(v=>!v)} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:"#64748b",padding:"3px 9px",borderRadius:"7px",cursor:"pointer",fontSize:"11px",fontWeight:700}}>{summaryOpen?"▴ 접기":"▾ 요약"}</button>
            </div>
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
              // market (국내ETF = 숫자 티커, 해외ETF = 영문 티커)
              const isKrETF = h => h.market==="ETF" && /^[0-9]/.test(h.ticker);
              const isUsETF = h => h.market==="ETF" && !/^[0-9]/.test(h.ticker);
              // 해외주식: 같은 티커 통합 (여러 계좌에 분산된 경우)
              const rawOverseas = allP.filter(h => h.market==="US" || isUsETF(h));
              const tickerMap = {};
              rawOverseas.forEach(h => {
                if (!tickerMap[h.ticker]) {
                  tickerMap[h.ticker] = { ...h, _ids: [h.id] };
                } else {
                  const m = tickerMap[h.ticker];
                  const totalQty  = m.quantity + h.quantity;
                  const totalCost = m.avgPrice * m.quantity + h.avgPrice * h.quantity;
                  const newAvg    = totalCost / totalQty;
                  // 통합된 종목의 평가금액/손익 재계산
                  const price     = m.price; // 시세는 동일
                  tickerMap[h.ticker] = {
                    ...m,
                    quantity: totalQty,
                    avgPrice: Math.round(newAvg * 100) / 100,
                    value: price * totalQty,
                    cost: totalCost,
                    pnl: price * totalQty - totalCost,
                    pnlPct: totalCost > 0 ? ((price * totalQty - totalCost) / totalCost) * 100 : 0,
                    _ids: [...(m._ids||[h.id]), h.id],
                    _merged: true,
                  };
                }
              });
              const overseasMerged = Object.values(tickerMap);
              return [
                { key:"domestic", label:"🇰🇷 국내 주식", sub:"KR · ISA · 국내ETF · 금현물", color:"#6366f1", items: allP.filter(h=>h.market==="KR"||h.market==="ISA"||h.market==="GOLD"||isKrETF(h)) },
                { key:"overseas", label:"🌎 해외 주식", sub:"미국 · 해외ETF", color:"#10b981", items: overseasMerged },
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
                          <div style={{display:"flex",gap:"12px",marginTop:"4px",flexWrap:"wrap",alignItems:"center"}}>
                            <span style={{fontSize:"13px",fontWeight:700,color:"#e2e8f0"}}>{fmtKRW(gVal)}</span>
                            <span style={{fontSize:"13px",fontWeight:700,color:gRet>=0?"#34d399":"#f87171"}}>{gRet>=0?"+":""}{gRet.toFixed(2)}%</span>
                            <span style={{fontSize:"12px",color:"#64748b"}}>{gPnL>=0?"+":""}{fmtKRW(gPnL)}</span>
                            {(()=>{
                              let dayKRW=0;
                              g.items.forEach(h=>{
                                const p2=prices[h.ticker];
                                if(!p2) return;
                                const pct = p2.regularChangePercent??p2.changePercent??0;
                                const px  = p2.price??0;
                                const rawAmt = p2.regularChangeAmount??p2.changeAmount??(px*pct/100);
                                const inKRW = h.cur==="USD" ? rawAmt*(liveUsdKrw||1380) : rawAmt;
                                dayKRW += inKRW * h.quantity;
                              });
                              if(Math.abs(dayKRW)<1) return null;
                              const dayPct=gVal>0?(dayKRW/gVal)*100:0;
                              const up=dayKRW>=0;
                              return(
                                <span style={{background:"rgba(0,0,0,0.2)",borderRadius:"6px",padding:"2px 8px",fontSize:"12px",fontWeight:700,color:up?"#34d399":"#f87171"}}>
                                  오늘 {up?"+":""}{fmtKRW(Math.abs(dayKRW))} ({up?"+":""}{dayPct.toFixed(2)}%)
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                        <button onClick={()=>setSelectedAccount({title:g.label,items:g.items.map(h=>({...h,id:h.id||Math.random()}))})}
                          style={{background:"rgba(99,102,241,0.15)",border:"1px solid rgba(99,102,241,0.35)",color:"#a5b4fc",padding:"4px 10px",borderRadius:"8px",cursor:"pointer",fontSize:"11px",fontWeight:700}}>
                          📊 상세보기
                        </button>
                      </div>
                      {/* 종목 테이블 */}
                      {/* 토스 스타일 등락폭 카드 리스트 */}
                      <div style={{display:"flex",flexDirection:"column",gap:"2px",maxHeight:isMobile?"55vh":"360px",overflowY:"auto"}}>
                        {g.items.map(h => {
                          const isUp = h.chgPct >= 0;
                          const chgColor = isUp ? "#34d399" : "#f87171";
                          const chgAmtVal = h.chgAmt != null && h.chgAmt !== 0 ? h.chgAmt : h.chgPct ? (h.chgPct/100 * h.price) : 0;
                          const amtStr = chgAmtVal ? (chgAmtVal>=0?"+":"-")+(h.cur==="USD" ? "$"+Math.abs(chgAmtVal).toFixed(2) : Math.round(Math.abs(chgAmtVal)).toLocaleString()+"₩") : null;
                          return (
                            <div key={h.id}
                              style={{display:"flex",alignItems:"center",gap:"12px",padding:"9px 6px",borderBottom:"1px solid rgba(255,255,255,0.05)",borderRadius:"6px",transition:"background 0.15s"}}
                              onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.04)"}
                              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                              <div onClick={()=>setSelectedStock(h)} style={{cursor:"pointer",flexShrink:0}}>
                                <TickerLogo ticker={h.ticker} name={h.name} size={isMobile?38:42}/>
                              </div>
                              {!isMobile&&<div style={{flexShrink:0,borderLeft:"1px solid rgba(255,255,255,0.07)",paddingLeft:"8px",marginLeft:"4px"}}><MiniSparkline data={sparklineData[h.ticker]} pnlPct={h.pnlPct||0} width={52} height={22}/></div>}
                              <div onClick={()=>setSelectedStock(h)} style={{flex:1,minWidth:0,cursor:"pointer"}}>
                                <div style={{fontWeight:700,fontSize:isMobile?"13px":"14px",color:"#f1f5f9",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{h.name||h.ticker}</div>
                                <div style={{fontSize:"11px",color:"#475569",marginTop:"1px"}}>{h.ticker} · {h.quantity.toLocaleString()}주{h._merged&&<span style={{marginLeft:"4px",fontSize:"9px",background:"rgba(99,102,241,0.2)",color:"#a5b4fc",padding:"1px 5px",borderRadius:"3px",fontWeight:700}}>통합</span>}</div>
                              </div>
                              <div style={{textAlign:"right",flexShrink:0}}>
                                {amtStr && <div style={{fontSize:isMobile?"15px":"16px",fontWeight:800,color:chgColor,letterSpacing:"-0.02em"}}>{amtStr}</div>}
                                <div style={{fontSize:"11px",color:chgColor,opacity:0.85,marginTop:"2px"}}>{isUp?"+":""}{h.chgPct.toFixed(2)}%</div>
                                <div style={{fontSize:"10px",color:"#64748b",marginTop:"1px"}}>{fmtPrice(h.price,h.cur)}</div>
                              </div>
                              {!h._merged && h.id && (
                                <button onClick={e=>{e.stopPropagation();startEdit(holdings.find(x=>x.id===h.id)||h);setTab("portfolio");setOverviewTab("all");}}
                                  style={{background:"none",border:"1px solid rgba(99,102,241,0.4)",color:"#a5b4fc",cursor:"pointer",fontSize:"10px",padding:"2px 7px",borderRadius:"5px",fontWeight:700,flexShrink:0}}>
                                  수정
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {overviewTab==="all" && (
            <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
            {summaryOpen && (<>
            {/* 요약 카드 */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:isMobile?"5px":"12px", marginBottom:isMobile?"8px":"20px" }}>
              {/* 총 평가금액 */}
              <div style={{ ...S.card, background:"rgba(99,102,241,0.09)", borderColor:"rgba(99,102,241,0.22)", cursor:"pointer", userSelect:"none" }}
                onClick={()=>setHideAmt(h=>!h)}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"6px" }}>
                  <div style={{ fontSize:"12px", color:"#64748b", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em" }}>총 평가금액</div>
                  <span style={{ fontSize:"11px", color:"#475569" }}>{hideAmt?"👁":"🔒"}</span>
                </div>
                {hideAmt
                  ? <div style={{ fontSize:isMobile?"15px":"22px", fontWeight:800, color:"#475569", letterSpacing:"0.1em" }}>●●●●●</div>
                  : <AnimatedNumber
                      value={currMode==="KRW" ? totalVal : totalVal/liveUsdKrw}
                      format={v => currMode==="KRW" ? fmtKRW(v) : "$"+(Math.round(v)).toLocaleString("en-US")}
                      color="#f8fafc"
                      fontSize={isMobile?"15px":"22px"}
                    />
                }
                {!hideAmt && currMode==="USD" && <div style={{ fontSize:"10px", color:"#475569", marginTop:"3px" }}>환율 {liveUsdKrw.toLocaleString()}₩ 기준</div>}
              </div>
              {/* 평가 손익 */}
              <div style={{ ...S.card, background:"rgba(99,102,241,0.09)", borderColor:"rgba(99,102,241,0.22)", cursor:"pointer", userSelect:"none" }}
                onClick={()=>setHideAmt(h=>!h)}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"6px" }}>
                  <div style={{ fontSize:"12px", color:"#64748b", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em" }}>평가 손익</div>
                  <span style={{ fontSize:"11px", color:"#475569" }}>{hideAmt?"👁":"🔒"}</span>
                </div>
                {hideAmt
                  ? <div style={{ fontSize:isMobile?"15px":"22px", fontWeight:800, color:"#475569", letterSpacing:"0.1em" }}>●●●●●</div>
                  : <AnimatedNumber
                      value={currMode==="KRW" ? totalPnL : totalPnL/liveUsdKrw}
                      format={v => { const sign = v>=0?"+":""; return currMode==="KRW" ? sign+fmtKRW(v) : (v>=0?"+":"-")+"$"+Math.abs(Math.round(v)).toLocaleString("en-US"); }}
                      color={totalPnL>=0?"#34d399":"#f87171"}
                      fontSize={isMobile?"15px":"22px"}
                    />
                }
              </div>
              {/* 총 수익률 - 항상 표시 */}
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
              <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"10px",padding:isMobile?"6px 10px":"10px 16px",marginBottom:isMobile?"4px":"8px"}}>
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

            </>)}
            <div style={{...S.card,padding:isMobile?"8px":"12px",minHeight:isMobile?"calc(100vh - 200px)":"calc(100vh - 220px)"}}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"8px", gap:"6px", flexWrap:"wrap" }}>
                <div>
                  <div style={{ fontSize:"14px", fontWeight:800, letterSpacing:"-0.03em" }}>보유 종목
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
                <div style={{display:"flex",flexDirection:"column",gap:compactMode?"4px":"8px",paddingRight:"2px"}}>
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
                          {items.map(h=>renderMobileCard(h,compactMode,hideAmt))}
                        </div>
                      ));
                    }
                    return sorted.map(h=>renderMobileCard(h,compactMode,hideAmt));
                  })()}
                  <div style={{fontSize:"10px",color:"#334155",textAlign:"right",marginTop:"4px",paddingBottom:"4px"}}>* USD 1달러 = {liveUsdKrw.toLocaleString()}원 (실시간)</div>
                </div>
              ) : (
                <div style={{overflowY:"auto",maxHeight:compactMode?"calc(100vh - 270px)":"calc(100vh - 260px)"}}>
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
                            <tbody>{items.map(h=>renderTableRow(h,compactMode,hideAmt))}</tbody>
                          </table>
                        </div>
                      ));
                    }
                    return (
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr>{["종목","현재가","일변동","수량","평가금액","손익률",""].map(h=><th key={h} style={S.TH}>{h}</th>)}</tr></thead>
                        <tbody>{sorted.map(h=>renderTableRow(h,compactMode,hideAmt))}</tbody>
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


        {/* ── PORTFOLIO 3 (ISA계좌) ── */}
        {mainTab === "p3" && (() => {
          const isaHoldings = holdings.filter(h => h.market === "ISA");
          const isaPortfolio = isaHoldings.map(h => {
            const p = prices[h.ticker] || prices[h.ticker+".KS"] || prices[h.ticker+".KQ"] || null;
            const cur = "KRW";
            const price = p?.price ?? h.avgPrice;
            const value = price * h.quantity;
            const cost  = h.avgPrice * h.quantity;
            const pnl   = value - cost;
            const pnlPct = cost > 0 ? (pnl/cost)*100 : 0;
            const regChgPct = p?.regularChangePercent ?? 0;
            const regChgAmt = p?.regularChangeAmount ?? 0;
            const chgAmt = p?.changeAmount ?? 0;
            return { ...h, price, value, cost, pnl, pnlPct, cur, chgPct: p?.changePercent??0, chgAmt, regChgPct, regChgAmt, hasLive:!!p, marketState: p?.marketState };
          });
          const isaTotal    = isaPortfolio.reduce((s,h) => s+h.value, 0);
          const isaTotalCost= isaPortfolio.reduce((s,h) => s+h.cost,  0);
          const isaPnL      = isaTotal - isaTotalCost;
          const isaRet      = isaTotalCost > 0 ? (isaPnL/isaTotalCost)*100 : 0;

          return (<>


          {/* P3 보유종목 */}
          {tab === "portfolio" && (
            <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
            <div style={{display:"flex",justifyContent:"flex-end"}}><button onClick={()=>setSummaryOpen(v=>!v)} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:"#64748b",padding:"3px 9px",borderRadius:"7px",cursor:"pointer",fontSize:"11px",fontWeight:700}}>{summaryOpen?"▴ 접기":"▾ 요약"}</button></div>
            {summaryOpen && (<>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:isMobile?"4px":"8px"}}>{[["총 평가금액",Math.round(isaTotal).toLocaleString()+"₩","#f8fafc"],["평가 손익",(isaPnL>=0?"+":"")+Math.round(isaPnL).toLocaleString()+"₩",isaPnL>=0?"#34d399":"#f87171"],["총 수익률",(isaRet>=0?"+":"")+isaRet.toFixed(2)+"%",isaRet>=0?"#34d399":"#f87171"]].map(([l,v,c])=>(<div key={l} style={{...S.card,background:"rgba(6,182,212,0.09)",borderColor:"rgba(6,182,212,0.22)",padding:isMobile?"8px 10px":"10px 14px"}}><div style={{fontSize:"10px",color:"#64748b",marginBottom:"3px",fontWeight:700,textTransform:"uppercase"}}>{l}</div><div style={{fontSize:isMobile?"14px":"18px",fontWeight:800,color:c,letterSpacing:"-0.03em"}}>{v}</div></div>))}</div>
            {/* ISA 납입현황 */}
            {(()=>{
              const pct=isaContribLimit>0?Math.min((isaContribAmount/isaContribLimit)*100,100):0;
              const now2=new Date(); const yearPct=((now2.getMonth()*30+now2.getDate())/365*100);
              const isAhead=pct>=yearPct;
              return(
                <div style={{background:"rgba(6,182,212,0.06)",border:"1px solid rgba(6,182,212,0.2)",borderRadius:"14px",padding:"16px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px",flexWrap:"wrap",gap:"6px"}}>
                    <div>
                      <div style={{fontSize:"14px",fontWeight:800,color:"#06b6d4"}}>💧 ISA 연간 납입 현황</div>
                      <div style={{fontSize:"11px",color:"#64748b",marginTop:"2px"}}>올해 경과: {yearPct.toFixed(0)}% · 잔여: {Math.max(isaContribLimit-isaContribAmount,0).toLocaleString()}₩</div>
                    </div>
                    <button onClick={()=>setShowForm(showForm==="isa_c"?null:"isa_c")} style={{background:"rgba(6,182,212,0.15)",border:"1px solid rgba(6,182,212,0.35)",color:"#06b6d4",padding:"5px 12px",borderRadius:"8px",cursor:"pointer",fontSize:"12px",fontWeight:700}}>⚙️ 납입 설정</button>
                  </div>
                  {showForm==="isa_c"&&(
                    <div style={{background:"rgba(0,0,0,0.2)",borderRadius:"10px",padding:"12px",marginBottom:"10px"}}>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginBottom:"8px"}}>
                        <div><div style={{fontSize:"11px",color:"#06b6d4",marginBottom:"3px"}}>연간 한도 (원) — 정책변동시 수정가능</div>
                          <input type="number" value={isaContribLimit} onChange={e=>{setIsaContribLimit(+e.target.value);try{localStorage.setItem("pm_isa_limit",e.target.value);}catch{}}} style={{...S.inp,fontSize:"13px",padding:"7px 10px"}}/></div>
                        <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>올해 납입액 (원)</div>
                          <input type="number" value={isaContribAmount} onChange={e=>{setIsaContribAmount(+e.target.value);try{localStorage.setItem("pm_isa_amount",e.target.value);}catch{}}} style={{...S.inp,fontSize:"13px",padding:"7px 10px"}}/></div>
                      </div>
                      <div style={{fontSize:"11px",color:"#475569"}}>일반형 2,000만원 · 서민형 4,000만원/년 (정부 정책에 따라 변동)</div>
                    </div>
                  )}
                  <div style={{background:"rgba(255,255,255,0.07)",borderRadius:"6px",height:"14px",overflow:"hidden",position:"relative",marginBottom:"6px"}}>
                    <div style={{position:"absolute",left:Math.min(yearPct,99).toFixed(1)+"%",top:0,bottom:0,width:"2px",background:"rgba(255,255,255,0.35)",zIndex:2}}/>
                    <div style={{width:pct.toFixed(1)+"%",height:"100%",background:pct>=100?"#34d399":isAhead?"#34d399":"#f59e0b",borderRadius:"6px",transition:"width 0.4s"}}/>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <span style={{fontSize:"12px",fontWeight:700,color:isAhead?"#34d399":"#f59e0b"}}>{isaContribAmount.toLocaleString()}₩ / {isaContribLimit.toLocaleString()}₩ ({pct.toFixed(1)}%)</span>
                    <span style={{fontSize:"11px",color:isAhead?"#34d399":"#f59e0b",fontWeight:700}}>{isAhead?"✓ 목표 달성 중":"⚠ 목표 미달"}</span>
                  </div>
                </div>
              );
            })()}
            </>)}
            <div style={S.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px",flexWrap:"wrap",gap:"8px"}}>
                <div style={{fontSize:"15px",fontWeight:800}}>💧 ISA(신한금융투자) <span style={{fontSize:"12px",color:"#64748b",fontWeight:500}}>{isaPortfolio.length}종목</span></div>
                <button onClick={()=>setShowForm(showForm==="isa"?null:"isa")} style={S.btn("#06b6d4",{fontSize:"12px"})}>+ 추가</button>
              </div>
              {showForm==="isa"&&(
                <div style={{background:"rgba(0,0,0,0.3)",borderRadius:"12px",padding:"14px",marginBottom:"14px",border:"1px solid rgba(6,182,212,0.3)"}}>
                  <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:"8px"}}>
                    <input placeholder="티커 (예: 005930)" value={hForm.ticker} onChange={e=>setHForm(p=>({...p,ticker:e.target.value.toUpperCase()}))} style={S.inp}/>
                    <input placeholder="종목명" value={hForm.name} onChange={e=>setHForm(p=>({...p,name:e.target.value}))} style={S.inp}/>
                    <input placeholder="수량" type="number" value={hForm.quantity} onChange={e=>setHForm(p=>({...p,quantity:e.target.value}))} style={S.inp}/>
                    <input placeholder="평균 매수가" type="number" value={hForm.avgPrice} onChange={e=>setHForm(p=>({...p,avgPrice:e.target.value}))} style={S.inp}/>
                    <select value={hForm.broker} onChange={e=>setHForm(p=>({...p,broker:e.target.value}))} style={{...S.inp,appearance:"none",gridColumn:"1/-1"}}>
                      <option value="">증권사 선택</option>
                      <option value="미래에셋증권">미래에셋증권</option><option value="신한금융투자">신한금융투자</option>
                      <option value="토스증권">토스증권</option><option value="키움증권">키움증권</option>
                    </select>
                  </div>
                  <div style={{display:"flex",gap:"8px",marginTop:"10px"}}>
                    <button onClick={()=>{
                      if(!hForm.ticker||!hForm.quantity||!hForm.avgPrice) return;
                      setHoldings(p=>[...p,{id:Date.now(),...hForm,market:"ISA",quantity:+hForm.quantity,avgPrice:+hForm.avgPrice}]);
                      setHForm({ticker:"",name:"",market:"KR",stockType:"일반주식",quantity:"",avgPrice:"",broker:""});
                      setShowForm(null);
                    }} style={S.btn("#06b6d4")}>✓ 추가</button>
                    <button onClick={()=>setShowForm(null)} style={S.btn("#475569")}>취소</button>
                  </div>
                </div>
              )}
              {isaPortfolio.length===0 ? (
                <div style={{textAlign:"center",padding:"40px",color:"#475569"}}>ISA 종목을 추가해주세요</div>
              ) : isMobile ? (
                <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                  {isaPortfolio.map(h=>(
                    <div key={h.id} style={{background:"rgba(6,182,212,0.05)",border:"1px solid rgba(6,182,212,0.15)",borderRadius:"10px",padding:"12px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:"8px",cursor:"pointer"}} onClick={()=>setSelectedStock(h)}>
                          <div style={{width:"8px",height:"8px",borderRadius:"2px",background:"#06b6d4"}}/>
                          <div>
                            <div style={{fontWeight:800,fontSize:"15px",color:"#f1f5f9"}}>{h.name||h.ticker}</div>
                            <div style={{fontSize:"11px",color:"#06b6d4"}}>{h.ticker}</div>
                          </div>
                        </div>
                        <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
                          <div style={{borderLeft:"1px solid rgba(6,182,212,0.15)",paddingLeft:"8px",marginRight:"4px"}}>
                            <MiniSparkline data={sparklineData[h.ticker]} pnlPct={h.pnlPct||0} width={52} height={20}/>
                          </div>
                          <button onClick={()=>editingId===h.id?setEditingId(null):startEdit(h)} style={{background:"none",border:"1px solid rgba(6,182,212,0.4)",color:"#06b6d4",cursor:"pointer",fontSize:"11px",padding:"2px 8px",borderRadius:"6px",fontWeight:700}}>수정</button>
                          <button onClick={()=>setHoldings(p=>p.filter(x=>x.id!==h.id))} style={{background:"none",border:"none",color:"#475569",cursor:"pointer",fontSize:"16px"}}>✕</button>
                        </div>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"6px"}}>
                        {[["현재가",Math.round(h.price).toLocaleString()+"₩"],["수량",h.quantity.toLocaleString()+"주"],["평가금액",Math.round(h.value).toLocaleString()+"₩"],["일변동",(h.regChgAmt>=0?"+":"")+Math.round(h.regChgAmt).toLocaleString()+"₩"],["등락률",(h.pnlPct>=0?"+":"")+h.pnlPct.toFixed(2)+"%"]].map(([l,v])=>(
                          <div key={l} style={{background:"rgba(0,0,0,0.2)",borderRadius:"6px",padding:"6px 8px"}}>
                            <div style={{fontSize:"10px",color:"#64748b",marginBottom:"2px"}}>{l}</div>
                            <div style={{fontSize:"12px",fontWeight:700}}>{v}</div>
                          </div>
                        ))}
                      </div>
                      {editingId===h.id&&(
                        <div style={{marginTop:"10px",background:"rgba(6,182,212,0.07)",border:"1px solid rgba(6,182,212,0.3)",borderRadius:"10px",padding:"12px"}}>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                            <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>종목명</div><input value={editForm.name} onChange={e=>setEditForm(p=>({...p,name:e.target.value}))} style={{...S.inp,fontSize:"12px",padding:"6px 8px"}}/></div>
                            <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>수량</div><input type="number" value={editForm.quantity} onChange={e=>setEditForm(p=>({...p,quantity:e.target.value}))} style={{...S.inp,fontSize:"12px",padding:"6px 8px"}}/></div>
                            <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>평단가</div><input type="number" value={editForm.avgPrice} onChange={e=>setEditForm(p=>({...p,avgPrice:e.target.value}))} style={{...S.inp,fontSize:"12px",padding:"6px 8px"}}/></div>
                            <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>증권사</div><input value={editForm.broker||""} onChange={e=>setEditForm(p=>({...p,broker:e.target.value}))} style={{...S.inp,fontSize:"12px",padding:"6px 8px"}}/></div>
                          </div>
                          {/* ISA 추가매수 계산기 */}
                          <div style={{marginTop:"8px",background:"rgba(52,211,153,0.06)",border:"1px solid rgba(52,211,153,0.2)",borderRadius:"8px",padding:"10px"}}>
                            <div style={{fontSize:"12px",color:"#34d399",fontWeight:700,marginBottom:"8px"}}>➕ 추가매수 계산기</div>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                              <input type="number" placeholder="추가 수량" value={editForm.addQty||""} onChange={e=>{const addQty=e.target.value;const addPrice=editForm.addPrice||0;const curQty=+editForm.quantity||0;const curAvg=+editForm.avgPrice||0;const newQty=curQty+(+addQty||0);const newAvg=newQty>0?((curQty*curAvg)+((+addQty||0)*(+addPrice||0)))/newQty:curAvg;setEditForm(p=>({...p,addQty,calcQty:newQty,calcAvg:Math.round(newAvg*100)/100}));}} style={{...S.inp,fontSize:"12px",padding:"6px 8px"}}/>
                              <input type="number" placeholder="추가매수 단가" value={editForm.addPrice||""} onChange={e=>{const addPrice=e.target.value;const addQty=editForm.addQty||0;const curQty=+editForm.quantity||0;const curAvg=+editForm.avgPrice||0;const newQty=curQty+(+addQty||0);const newAvg=newQty>0?((curQty*curAvg)+((+addQty||0)*(+addPrice||0)))/newQty:curAvg;setEditForm(p=>({...p,addPrice,calcQty:newQty,calcAvg:Math.round(newAvg*100)/100}));}} style={{...S.inp,fontSize:"12px",padding:"6px 8px"}}/>
                            </div>
                            {editForm.addQty&&editForm.addPrice&&(
                              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginTop:"8px"}}>
                                <div style={{background:"rgba(0,0,0,0.2)",borderRadius:"6px",padding:"6px 8px"}}><div style={{fontSize:"10px",color:"#64748b",marginBottom:"2px"}}>총 수량</div><div style={{fontSize:"14px",fontWeight:800,color:"#34d399"}}>{editForm.calcQty?.toLocaleString()}주</div></div>
                                <div style={{background:"rgba(0,0,0,0.2)",borderRadius:"6px",padding:"6px 8px"}}><div style={{fontSize:"10px",color:"#64748b",marginBottom:"2px"}}>새 평단가</div><div style={{fontSize:"14px",fontWeight:800,color:"#34d399"}}>{editForm.calcAvg?.toLocaleString()}₩</div></div>
                              </div>
                            )}
                            {editForm.addQty&&editForm.addPrice&&(
                              <button onClick={()=>setEditForm(p=>{if(!p.calcQty||!p.calcAvg)return p;return{...p,quantity:String(p.calcQty),avgPrice:String(p.calcAvg),addQty:"",addPrice:"",calcQty:undefined,calcAvg:undefined};})} style={S.btn("#34d399",{fontSize:"11px",padding:"5px 12px",width:"100%",marginTop:"6px"})}>↑ 위 값으로 적용하기</button>
                            )}
                          </div>
                          <div style={{display:"flex",gap:"8px",marginTop:"8px"}}>
                            <button onClick={()=>{if(window.confirm("삭제?"))setHoldings(p=>p.filter(x=>x.id!==h.id));setEditingId(null);}} style={S.btn("#dc2626",{fontSize:"12px",padding:"6px 10px"})}>🗑️</button>
                            <div style={{display:"flex",gap:"6px",marginLeft:"auto"}}>
                              <button onClick={()=>setEditingId(null)} style={S.btn("#475569",{fontSize:"12px",padding:"6px 10px"})}>취소</button>
                              <button onClick={saveEdit} style={S.btn("#06b6d4",{fontSize:"12px",padding:"6px 14px"})}>✓ 저장</button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse"}}>
                    <thead><tr>{["종목","현재가","일변동","수량","평가금액","손익률",""].map(h=><th key={h} style={S.TH}>{h}</th>)}</tr></thead>
                    <tbody>
                      {isaPortfolio.map(h=>(
                        <>
                        <tr key={h.id}>
                          <td style={{...S.TD,cursor:"pointer"}} onClick={()=>setSelectedStock(h)}>
                            <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                              <div style={{width:"8px",height:"8px",borderRadius:"2px",background:"#06b6d4"}}/>
                              <div>
                                <div style={{fontWeight:700,fontSize:"14px",color:"#f1f5f9"}}>{h.name||h.ticker}</div>
                                <div style={{fontSize:"11px",color:"#06b6d4"}}>{h.ticker}</div>
                              </div>
                            </div>
                          </td>
                          <td style={S.TD}><div style={{fontWeight:700}}>{Math.round(h.price).toLocaleString()}₩</div>{!h.hasLive&&<div style={{fontSize:"10px",color:"#475569"}}>매수가기준</div>}</td>
                          <td style={{...S.TD,fontWeight:700,color:h.regChgPct>=0?"#34d399":"#f87171"}}>
                            <div>{(h.regChgAmt>=0?"+":"")+Math.round(h.regChgAmt).toLocaleString()}₩</div>
                            <div style={{fontSize:"11px",opacity:0.85}}>({(h.regChgPct>=0?"+":"")+h.regChgPct.toFixed(2)}%)</div>
                          </td>
                          <td style={S.TD}>{h.quantity.toLocaleString()}주</td>
                          <td style={{...S.TD,fontWeight:700}}>{Math.round(h.value).toLocaleString()}₩</td>
                          <td style={{...S.TD,fontWeight:800,color:h.pnlPct>=0?"#34d399":"#f87171"}}>{(h.pnlPct>=0?"+":"")+h.pnlPct.toFixed(2)}%</td>
                          <td style={S.TD}><button onClick={()=>editingId===h.id?setEditingId(null):startEdit(h)} style={{background:"none",border:"1px solid rgba(6,182,212,0.4)",color:"#06b6d4",cursor:"pointer",fontSize:"11px",padding:"3px 9px",borderRadius:"5px",fontWeight:700}}>수정</button></td>
                        </tr>
                        {editingId===h.id&&(
                          <tr key={h.id+"_e3"}><td colSpan={7} style={{padding:"0 0 12px"}}>
                            <div style={{background:"rgba(6,182,212,0.07)",border:"1px solid rgba(6,182,212,0.3)",borderRadius:"10px",padding:"14px",margin:"6px 10px"}}>
                              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:"8px"}}>
                                <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>종목명</div><input value={editForm.name} onChange={e=>setEditForm(p=>({...p,name:e.target.value}))} style={S.inp}/></div>
                                <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>수량</div><input type="number" value={editForm.quantity} onChange={e=>setEditForm(p=>({...p,quantity:e.target.value}))} style={S.inp}/></div>
                                <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>평단가</div><input type="number" value={editForm.avgPrice} onChange={e=>setEditForm(p=>({...p,avgPrice:e.target.value}))} style={S.inp}/></div>
                                <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>증권사</div><input value={editForm.broker||""} onChange={e=>setEditForm(p=>({...p,broker:e.target.value}))} style={S.inp}/></div>
                              </div>
                              <div style={{display:"flex",gap:"8px",marginTop:"10px"}}>
                                <button onClick={()=>{if(window.confirm(`"${h.name||h.ticker}" 삭제?`)){setHoldings(p=>p.filter(x=>x.id!==h.id));setEditingId(null);}}} style={S.btn("#dc2626",{fontSize:"12px",padding:"6px 14px"})}>🗑️ 삭제</button>
                                <div style={{display:"flex",gap:"8px",marginLeft:"auto"}}>
                                  <button onClick={()=>setEditingId(null)} style={S.btn("#475569",{fontSize:"12px",padding:"6px 14px"})}>취소</button>
                                  <button onClick={saveEdit} style={S.btn("#06b6d4",{fontSize:"12px",padding:"6px 14px"})}>✓ 저장</button>
                                </div>
                              </div>
                            </div>
                          </td></tr>
                        )}
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            </div>
          )}

          {/* P3 매매일지 */}
          {tab === "trades" && (
            <div style={S.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"16px",flexWrap:"wrap",gap:"8px"}}>
                <div><div style={{fontSize:"17px",fontWeight:800}}>ISA 매매일지</div>
                  <div style={{fontSize:"13px",color:"#475569",marginTop:"4px"}}>{trades.filter(t=>isaHoldings.some(h=>h.ticker===t.ticker)).length}건</div>
                </div>
                <button onClick={()=>setShowForm(showForm==="t3"?null:"t3")} style={S.btn("#06b6d4")}>+ 기록 추가</button>
              </div>
              {showForm==="t3"&&(
                <div style={{background:"rgba(0,0,0,0.3)",borderRadius:"12px",padding:"16px",marginBottom:"16px",border:"1px solid rgba(6,182,212,0.3)"}}>
                  {/* 모드 토글 */}
                  <div style={{display:"flex",gap:"3px",marginBottom:"12px",background:"rgba(255,255,255,0.05)",borderRadius:"8px",padding:"3px"}}>
                    <button onClick={()=>setTForm(p=>({...p,_mode:"select",ticker:""}))} style={{flex:1,padding:"5px",borderRadius:"6px",border:"none",cursor:"pointer",fontSize:"12px",fontWeight:700,background:(tForm._mode||"select")==="select"?"rgba(6,182,212,0.4)":"transparent",color:(tForm._mode||"select")==="select"?"#67e8f9":"#64748b"}}>📋 ISA 보유종목 선택</button>
                    <button onClick={()=>setTForm(p=>({...p,_mode:"new",ticker:""}))} style={{flex:1,padding:"5px",borderRadius:"6px",border:"none",cursor:"pointer",fontSize:"12px",fontWeight:700,background:(tForm._mode||"select")==="new"?"rgba(16,185,129,0.4)":"transparent",color:(tForm._mode||"select")==="new"?"#6ee7b7":"#64748b"}}>✏️ 신규 티커 입력</button>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:"8px"}}>
                    <input type="date" value={tForm.date} onChange={e=>setTForm(p=>({...p,date:e.target.value}))} style={S.inp}/>
                    {(tForm._mode||"select")==="select"?(
                      <select value={tForm.ticker} onChange={e=>setTForm(p=>({...p,ticker:e.target.value}))} style={{...S.inp,appearance:"none"}}>
                        <option value="">ISA 종목 선택</option>
                        {isaHoldings.map(h=><option key={h.ticker} value={h.ticker}>{h.name||h.ticker} ({h.ticker})</option>)}
                      </select>
                    ):(
                      <input placeholder="티커 직접 입력 (예: 005930, TIGER200)" value={tForm.ticker} onChange={e=>setTForm(p=>({...p,ticker:e.target.value.toUpperCase()}))} style={{...S.inp,borderColor:"rgba(16,185,129,0.4)"}}/>
                    )}
                    <select value={tForm.type} onChange={e=>setTForm(p=>({...p,type:e.target.value}))} style={{...S.inp,appearance:"none"}}><option value="buy">매수</option><option value="sell">매도</option></select>
                    <input placeholder="수량" type="number" value={tForm.quantity} onChange={e=>setTForm(p=>({...p,quantity:e.target.value}))} style={S.inp}/>
                    <input placeholder="체결가" type="number" value={tForm.price} onChange={e=>setTForm(p=>({...p,price:e.target.value}))} style={S.inp}/>
                    <input placeholder="수수료 (선택)" type="number" value={tForm.fee} onChange={e=>setTForm(p=>({...p,fee:e.target.value}))} style={S.inp}/>
                    <input placeholder="메모 (선택)" value={tForm.note} onChange={e=>setTForm(p=>({...p,note:e.target.value}))} style={{...S.inp,gridColumn:"1/-1"}}/>
                  </div>
                  <div style={{display:"flex",gap:"8px",marginTop:"10px"}}>
                    <button onClick={()=>setShowForm(null)} style={S.btn("#475569")}>취소</button>
                    <button onClick={()=>{if(!tForm.ticker||!tForm.quantity||!tForm.price)return;setTrades(p=>[...p,{id:Date.now(),...tForm,portfolio:"p3",quantity:+tForm.quantity,price:+tForm.price,fee:+(tForm.fee||0)}]);setTForm({date:today(),ticker:"",type:"buy",quantity:"",price:"",fee:"",note:"",_mode:tForm._mode||"select"});setShowForm(null);}} style={S.btn("#06b6d4")}>✓ 저장</button>
                  </div>
                </div>
              )}
              {(()=>{
                const raw=[...trades].filter(t=>t.portfolio==="p3"||(!t.portfolio&&isaHoldings.some(h=>h.ticker===t.ticker)));
                const pMs={"3d":3*864e5,"7d":7*864e5,"14d":14*864e5,"30d":30*864e5,"365d":365*864e5}[tradeFilterPeriod];
                const p3list=raw.filter(t=>!pMs||!t.date||(Date.now()-new Date(t.date).getTime()<=pMs)).sort((a,b)=>b.date>a.date?1:-1);
                if(!p3list.length) return <div style={{textAlign:"center",padding:"28px",color:"#475569"}}>매매 기록이 없습니다</div>;
                const totalP3=Math.ceil(p3list.length/TRADE_PAGE_SIZE),curP3=Math.min(tradePage,totalP3);
                const pagedP3=p3list.slice((curP3-1)*TRADE_PAGE_SIZE,curP3*TRADE_PAGE_SIZE); let lastD3="";
                return(<>
                  {pagedP3.map(t=>{
                    const hName=isaHoldings.find(x=>x.ticker===t.ticker)?.name||t.ticker;
                    const px=prices[t.ticker]||prices[t.ticker+".KS"]||prices[t.ticker+".KQ"];
                    const chgD=px&&t.price?px.price-t.price:null,chgP=chgD!==null&&t.price?chgD/t.price*100:null;
                    const showSep=t.date&&t.date!==lastD3; if(t.date)lastD3=t.date;
                    return(<div key={t.id}>
                      {showSep&&<div style={{display:"flex",alignItems:"center",gap:"8px",padding:"8px 0 4px"}}><span style={{background:"rgba(6,182,212,0.15)",color:"#67e8f9",padding:"2px 8px",borderRadius:"6px",fontSize:"11px",fontWeight:700}}>{t.date}</span><div style={{flex:1,height:"1px",background:"rgba(255,255,255,0.07)"}}/></div>}
                      <div style={{display:"flex",alignItems:"center",padding:"10px 0",borderBottom:editingTradeId===t.id?"none":"1px solid rgba(255,255,255,0.07)",gap:"10px",overflow:"hidden"}}>
                        <div style={{flexShrink:0,textAlign:"center"}}>
                          <div style={{background:t.type==="buy"?"rgba(6,182,212,0.25)":"rgba(239,68,68,0.25)",border:`1.5px solid ${t.type==="buy"?"rgba(6,182,212,0.6)":"rgba(239,68,68,0.6)"}`,color:t.type==="buy"?"#67e8f9":"#fca5a5",padding:"4px 11px",borderRadius:"12px",fontSize:"13px",fontWeight:800}}>{t.type==="buy"?"매수":"매도"}</div>
                          <div style={{fontSize:"10px",color:"#475569",marginTop:"3px",whiteSpace:"nowrap"}}>{t.date}</div>
                        </div>
                        <div style={{flex:"1 1 100px",minWidth:0}}>
                          <div style={{fontWeight:800,fontSize:"15px",color:"#f1f5f9",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{hName}</div>
                          <div style={{fontSize:"11px",color:"#64748b"}}>{t.ticker}</div>
                        </div>
                        {(()=>{const tHi=isaHoldings.find(x=>x.ticker===t.ticker);const tCi=tHi?.market==="US"||(tHi?.market==="ETF"&&!/^[0-9]/.test(t.ticker))?"USD":"KRW";const fmtI=v=>tCi==="USD"?"$"+Number(v).toFixed(2):Number(v).toLocaleString()+"₩";return(<div style={{flex:"0 0 auto",textAlign:"right",flexShrink:0}}><div style={{fontSize:"14px",fontWeight:800,color:"#e2e8f0",whiteSpace:"nowrap"}}>{t.quantity.toLocaleString()}주 × {fmtI(t.price)}</div><div style={{fontSize:"12px",color:"#94a3b8",fontWeight:600,whiteSpace:"nowrap"}}>총 {tCi==="USD"?"$"+Math.round(t.quantity*t.price).toLocaleString():Math.round(t.quantity*t.price).toLocaleString()+"₩"}</div></div>);})()}
                        {chgD!==null&&(
                          <div style={{flex:"0 0 auto",flexShrink:0,textAlign:"right",minWidth:"60px"}}>
                            <div style={{fontSize:"13px",fontWeight:800,color:chgD>=0?"#34d399":"#f87171",whiteSpace:"nowrap"}}>{chgD>=0?"▲":"▼"}{Math.abs(chgD)>=1?Math.round(Math.abs(chgD)).toLocaleString():Math.abs(chgD).toFixed(1)}₩</div>
                            <div style={{fontSize:"12px",fontWeight:700,color:chgD>=0?"#34d399":"#f87171",whiteSpace:"nowrap"}}>{chgD>=0?"+":""}{chgP.toFixed(1)}%</div>
                          </div>
                        )}
                        <div style={{display:"flex",flexDirection:"column",gap:"4px",flexShrink:0}}>
                          <button onClick={()=>{setEditingTradeId(editingTradeId===t.id?null:t.id);setEditTradeForm({date:t.date||"",ticker:t.ticker||"",type:t.type||"buy",quantity:String(t.quantity||""),price:String(t.price||""),fee:String(t.fee||""),note:t.note||"",taxAccount:""});}} style={{background:"none",border:"1px solid rgba(6,182,212,0.4)",color:"#67e8f9",cursor:"pointer",fontSize:"11px",padding:"3px 8px",borderRadius:"5px",fontWeight:700}}>✏️</button>
                          <button onClick={()=>setTrades(p=>p.filter(x=>x.id!==t.id))} style={{background:"none",border:"1px solid rgba(239,68,68,0.3)",color:"#f87171",cursor:"pointer",fontSize:"11px",padding:"3px 8px",borderRadius:"5px"}}>✕</button>
                        </div>
                      </div>
                      {editingTradeId===t.id&&(<div style={{background:"rgba(6,182,212,0.06)",border:"1px solid rgba(6,182,212,0.25)",borderRadius:"10px",padding:"12px",marginBottom:"8px"}}><div style={{fontSize:"11px",color:"#67e8f9",fontWeight:700,marginBottom:"8px"}}>✏️ ISA 수정</div><div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:"7px"}}><input type="date" value={editTradeForm.date} onChange={e=>setEditTradeForm(p=>({...p,date:e.target.value}))} style={S.inp}/><select value={editTradeForm.ticker} onChange={e=>setEditTradeForm(p=>({...p,ticker:e.target.value}))} style={{...S.inp,appearance:"none"}}><option value="">종목 선택</option>{isaHoldings.map(h=><option key={h.ticker} value={h.ticker}>{h.name||h.ticker}</option>)}</select><select value={editTradeForm.type} onChange={e=>setEditTradeForm(p=>({...p,type:e.target.value}))} style={{...S.inp,appearance:"none"}}><option value="buy">매수</option><option value="sell">매도</option></select><input placeholder="수량" type="number" value={editTradeForm.quantity} onChange={e=>setEditTradeForm(p=>({...p,quantity:e.target.value}))} style={S.inp}/><input placeholder="체결가" type="number" value={editTradeForm.price} onChange={e=>setEditTradeForm(p=>({...p,price:e.target.value}))} style={S.inp}/><input placeholder="수수료" type="number" value={editTradeForm.fee} onChange={e=>setEditTradeForm(p=>({...p,fee:e.target.value}))} style={S.inp}/></div><div style={{display:"flex",gap:"8px",marginTop:"8px"}}><button onClick={()=>setEditingTradeId(null)} style={S.btn("#475569",{fontSize:"12px"})}>취소</button><button onClick={()=>{if(!editTradeForm.ticker||!editTradeForm.quantity||!editTradeForm.price)return;setTrades(p=>p.map(x=>x.id===t.id?{...x,...editTradeForm,quantity:+editTradeForm.quantity,price:+editTradeForm.price,fee:+(editTradeForm.fee||0)}:x));setEditingTradeId(null);}} style={S.btn("#06b6d4",{fontSize:"12px"})}>✓ 저장</button></div></div>)}
                    </div>);
                  })}
                  {totalP3>1&&(<div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:"5px",marginTop:"12px",flexWrap:"wrap"}}><button onClick={()=>setTradePage(1)} disabled={curP3===1} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:curP3===1?"#334155":"#94a3b8",padding:"3px 9px",borderRadius:"6px",cursor:curP3===1?"not-allowed":"pointer",fontSize:"12px"}}>《</button><button onClick={()=>setTradePage(p=>Math.max(1,p-1))} disabled={curP3===1} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:curP3===1?"#334155":"#67e8f9",padding:"3px 9px",borderRadius:"6px",cursor:curP3===1?"not-allowed":"pointer",fontSize:"12px"}}>‹</button>{Array.from({length:Math.min(5,totalP3)},(_,i)=>{const s=Math.max(1,Math.min(curP3-2,totalP3-4));const pg=s+i;if(pg>totalP3)return null;return<button key={pg} onClick={()=>setTradePage(pg)} style={{background:pg===curP3?"rgba(6,182,212,0.4)":"rgba(255,255,255,0.05)",border:pg===curP3?"1px solid rgba(6,182,212,0.6)":"1px solid rgba(255,255,255,0.1)",color:pg===curP3?"#67e8f9":"#94a3b8",padding:"3px 9px",borderRadius:"6px",cursor:"pointer",fontSize:"12px",fontWeight:pg===curP3?700:400}}>{pg}</button>;})} <button onClick={()=>setTradePage(p=>Math.min(totalP3,p+1))} disabled={curP3===totalP3} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:curP3===totalP3?"#334155":"#67e8f9",padding:"3px 9px",borderRadius:"6px",cursor:curP3===totalP3?"not-allowed":"pointer",fontSize:"12px"}}>›</button><button onClick={()=>setTradePage(totalP3)} disabled={curP3===totalP3} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:curP3===totalP3?"#334155":"#94a3b8",padding:"3px 9px",borderRadius:"6px",cursor:curP3===totalP3?"not-allowed":"pointer",fontSize:"12px"}}>》</button><span style={{fontSize:"11px",color:"#475569"}}>{curP3}/{totalP3}p</span></div>)}
                </>);
              })()}
            </div>
          )}

          {/* P3 배당 */}
          {tab === "dividend" && (
            <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
              <div style={S.card}>
                {(()=>{
                  const isaAnnualDiv = isaHoldings.filter(h=>h.market!=="CRYPTO").reduce((s,h)=>{
                    const di=divInfo[h.ticker]||{};
                    const ps=+di.perShare||0, qty=+h.quantity;
                    const rawM=di.months||[], months=Array.isArray(rawM)?rawM:Object.values(rawM);
                    return s+ps*(months.length||1)*(di.currency==="USD"?liveUsdKrw:1)*qty;
                  },0);
                  return (
                    <div style={{background:"rgba(6,182,212,0.07)",border:"1px solid rgba(6,182,212,0.2)",borderRadius:"12px",padding:"14px",marginBottom:"16px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:"8px"}}>
                      <div>
                        <div style={{fontSize:"12px",color:"#06b6d4",fontWeight:700,marginBottom:"4px"}}>💧 ISA 예상 연간 배당</div>
                        <div style={{fontSize:"22px",fontWeight:800,color:"#06b6d4"}}>{Math.round(isaAnnualDiv).toLocaleString()}₩/년</div>
                        <div style={{fontSize:"11px",color:"#64748b",marginTop:"2px"}}>월평균 {Math.round(isaAnnualDiv/12).toLocaleString()}₩ · 비과세 한도 내</div>
                      </div>
                      <div style={{fontSize:"11px",color:"#475569",lineHeight:1.6,textAlign:"right"}}>ISA 비과세<br/>서민형 400만원/년<br/>일반형 200만원/년</div>
                    </div>
                  );
                })()}
                <div style={{fontSize:"14px",fontWeight:800,marginBottom:"12px"}}>🏷️ ISA 종목별 배당</div>
                <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                  {isaHoldings.map(h=>{
                    const di=divInfo[h.ticker]||{};
                    const isEditing3=divEditTicker===h.ticker;
                    const rawCM=di.months||[]; const cm=Array.isArray(rawCM)?rawCM:Object.values(rawCM);
                    const ps=+di.perShare||0, qty=+h.quantity;
                    const annual=ps*(cm.length||1);
                    const annualKRW=annual*(di.currency==="USD"?liveUsdKrw:1)*qty;
                    const yieldPct=h.avgPrice>0&&annual>0?(annual/h.avgPrice)*100:0;
                    return (
                      <div key={h.ticker} style={{background:"rgba(6,182,212,0.05)",border:"1px solid rgba(6,182,212,0.15)",borderRadius:"10px",padding:"12px"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:"8px"}}>
                          <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                            <div style={{width:"8px",height:"8px",borderRadius:"2px",background:"#06b6d4"}}/>
                            <div>
                              <div style={{fontWeight:700,fontSize:"14px",color:"#f1f5f9"}}>{h.name||h.ticker}</div>
                              <div style={{fontSize:"11px",color:"#64748b"}}>{h.ticker} · {h.quantity}주</div>
                            </div>
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                            {ps>0&&<div style={{textAlign:"right"}}><div style={{fontSize:"13px",fontWeight:700,color:"#06b6d4"}}>{Math.round(annualKRW).toLocaleString()}₩/년</div><div style={{fontSize:"11px",color:"#64748b"}}>{cm.join("·")}월 · {yieldPct.toFixed(2)}%</div></div>}
                            <button onClick={()=>{if(isEditing3){setDivEditTicker(null);}else{setDivEditTicker(h.ticker);const rawEM=di.months||[];setDivInfoForm({perShare:di.perShare||"",months:Array.isArray(rawEM)?rawEM:Object.values(rawEM),currency:di.currency||"KRW"});}}}
                              style={{background:"none",border:"1px solid rgba(6,182,212,0.4)",color:"#06b6d4",padding:"4px 10px",borderRadius:"6px",cursor:"pointer",fontSize:"12px",fontWeight:700}}>
                              {isEditing3?"✕ 닫기":"✏️ 편집"}
                            </button>
                          </div>
                        </div>
                        {isEditing3&&(
                          <div style={{marginTop:"12px",display:"flex",flexDirection:"column",gap:"10px"}}>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                              <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>주당 배당금 (1회)</div><input type="number" value={divInfoForm.perShare} onChange={e=>setDivInfoForm(p=>({...p,perShare:e.target.value}))} style={{...S.inp,fontSize:"13px",padding:"7px 10px"}}/></div>
                              <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>통화</div><select value={divInfoForm.currency} onChange={e=>setDivInfoForm(p=>({...p,currency:e.target.value}))} style={{...S.inp,fontSize:"13px",padding:"7px 10px",appearance:"none"}}><option value="KRW">₩ 원화</option><option value="USD">$ 달러</option></select></div>
                            </div>
                            <div style={{display:"flex",flexWrap:"wrap",gap:"6px"}}>
                              {[1,2,3,4,5,6,7,8,9,10,11,12].map(m=>{const sel=(divInfoForm.months||[]).includes(m);return(
                                <button key={m} onClick={()=>setDivInfoForm(p=>{const c=p.months||[];return{...p,months:sel?c.filter(x=>x!==m):[...c,m].sort((a,b)=>a-b)};})}
                                  style={{width:"38px",height:"34px",borderRadius:"8px",cursor:"pointer",fontSize:"12px",fontWeight:sel?800:500,background:sel?"rgba(6,182,212,0.3)":"rgba(255,255,255,0.05)",border:sel?"1px solid rgba(6,182,212,0.6)":"1px solid rgba(255,255,255,0.1)",color:sel?"#06b6d4":"#64748b"}}>{m}월</button>
                              );})}
                            </div>
                            <button onClick={()=>{setDivInfo(p=>({...p,[h.ticker]:{...divInfoForm}}));setDivEditTicker(null);}} style={S.btn("#06b6d4",{fontSize:"13px"})}>💾 저장</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {isaHoldings.length===0&&<div style={{textAlign:"center",padding:"32px",color:"#475569"}}>ISA 종목을 먼저 추가해주세요</div>}
                </div>
              </div>
            </div>
          )}

          </>);
        })()}

        {/* ── PORTFOLIO 2 (절세계좌) ── */}
                {tab === "portfolio" && mainTab === "p2" && (
          <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
            <div style={{display:"flex",justifyContent:"flex-end"}}><button onClick={()=>setSummaryOpen(v=>!v)} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:"#64748b",padding:"3px 9px",borderRadius:"7px",cursor:"pointer",fontSize:"11px",fontWeight:700}}>{summaryOpen?"▴ 접기":"▾ 요약"}</button></div>
            {summaryOpen && (<>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:isMobile?"4px":"8px"}}>{[["총 평가금액",Math.round(total2Val).toLocaleString()+"₩","#f8fafc"],["평가 손익",(total2PnL>=0?"+":"")+Math.round(total2PnL).toLocaleString()+"₩",total2PnL>=0?"#34d399":"#f87171"],["총 수익률",(total2Ret>=0?"+":"")+total2Ret.toFixed(2)+"%",total2Ret>=0?"#34d399":"#f87171"]].map(([l,v,c])=>(<div key={l} style={{...S.card,background:"rgba(234,179,8,0.09)",borderColor:"rgba(234,179,8,0.22)",padding:isMobile?"8px 10px":"10px 14px"}}><div style={{fontSize:"10px",color:"#64748b",marginBottom:"3px",fontWeight:700,textTransform:"uppercase"}}>{l}</div><div style={{fontSize:isMobile?"14px":"18px",fontWeight:800,color:c,letterSpacing:"-0.03em"}}>{v}</div></div>))}</div>
            <ContribProgressBar taxAccounts={TAX_ACCOUNTS} holdings2={holdings2} prices={prices} liveUsdKrw={liveUsdKrw} contribLimits={contribLimits} contribAmounts={contribAmounts} onOpenSettings={()=>setShowContrib(true)} isMobile={isMobile}/>
            </>)}
            {TAX_ACCOUNTS.map(account=>{
              const items=portfolio2.filter(h=>h.taxAccount===account);
              const accVal=items.reduce((s,h)=>s+toKRWLive(h.value,h.cur),0);
              const accCost=items.reduce((s,h)=>s+toKRWLive(h.cost,h.cur),0);
              const accRet=accCost>0?((accVal-accCost)/accCost)*100:0;
              const formKey="h2_"+account;
              return (
                <div key={account} style={S.card}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px",flexWrap:"wrap",gap:"6px"}}>
                    <div>
                      <span style={{fontSize:"14px",fontWeight:800,color:"#e2e8f0"}}>{account}</span>
                      <span style={{marginLeft:"8px",fontSize:"11px",background:"rgba(234,179,8,0.15)",color:"#eab308",padding:"1px 7px",borderRadius:"20px",fontWeight:700}}>절세</span>
                      {items.length>0&&<div style={{fontSize:"12px",color:"#64748b",marginTop:"3px"}}>{fmtKRW(accVal)} · {accRet>=0?"+":""}{accRet.toFixed(2)}% · {items.length}종목</div>}
                    </div>
                    <button onClick={()=>{setHForm2(p=>({...p,taxAccount:account}));setShowForm(showForm===formKey?null:formKey);}} style={S.btn("#f59e0b",{fontSize:"12px"})}>+ 추가</button>
                  </div>
                  {showForm===formKey&&(
                    <div style={{background:"rgba(0,0,0,0.25)",borderRadius:"10px",padding:"14px",marginBottom:"12px",border:"1px solid rgba(234,179,8,0.3)"}}>
                      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:"8px"}}>
                        <input placeholder="티커" value={hForm2.ticker} onChange={e=>setHForm2(p=>({...p,ticker:e.target.value.toUpperCase()}))} style={S.inp}/>
                        <input placeholder="종목명" value={hForm2.name} onChange={e=>setHForm2(p=>({...p,name:e.target.value}))} style={S.inp}/>
                        <select value={hForm2.market} onChange={e=>setHForm2(p=>({...p,market:e.target.value}))} style={{...S.inp,appearance:"none"}}><option value="KR">한국주식</option><option value="US">미국주식</option><option value="ETF">ETF</option></select>
                        <select value={hForm2.taxAccount} onChange={e=>setHForm2(p=>({...p,taxAccount:e.target.value}))} style={{...S.inp,appearance:"none"}}>{TAX_ACCOUNTS.map(a=><option key={a} value={a}>{a}</option>)}</select>
                        <input placeholder="수량" type="number" value={hForm2.quantity} onChange={e=>setHForm2(p=>({...p,quantity:e.target.value}))} style={S.inp}/>
                        <input placeholder="평균 매수가" type="number" value={hForm2.avgPrice} onChange={e=>setHForm2(p=>({...p,avgPrice:e.target.value}))} style={{...S.inp,gridColumn:"1/-1"}}/>
                      </div>
                      <div style={{display:"flex",gap:"8px",marginTop:"10px"}}>
                        <button onClick={()=>setShowForm(null)} style={S.btn("#475569")}>취소</button>
                        <button onClick={()=>{if(!hForm2.ticker||!hForm2.quantity||!hForm2.avgPrice)return;setHoldings2(p=>[...p,{id:Date.now(),...hForm2,quantity:+hForm2.quantity,avgPrice:+hForm2.avgPrice}]);setHForm2({ticker:"",name:"",market:"KR",quantity:"",avgPrice:"",taxAccount:TAX_ACCOUNTS[0],broker:""});setShowForm(null);}} style={S.btn("#f59e0b")}>✓ 추가</button>
                      </div>
                    </div>
                  )}
                  {isMobile?(
                    <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                      {items.map(h=>(
                        <div key={h.id} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"10px",padding:"10px"}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
                            <div style={{cursor:"pointer"}} onClick={()=>setSelectedStock(h)}>
                              <div style={{fontWeight:800,fontSize:"14px",color:"#f1f5f9"}}>{h.name||h.ticker}</div>
                              <div style={{fontSize:"11px",color:"#a5b4fc"}}>{h.ticker}</div>
                            </div>
                            <div style={{display:"flex",gap:"6px"}}>
                              <button onClick={()=>editingId2===h.id?setEditingId2(null):startEdit2(h)} style={{background:"none",border:"1px solid rgba(234,179,8,0.4)",color:"#fbbf24",cursor:"pointer",fontSize:"11px",padding:"2px 8px",borderRadius:"5px",fontWeight:700}}>수정</button>
                              <button onClick={()=>setHoldings2(p=>p.filter(x=>x.id!==h.id))} style={{background:"none",border:"none",color:"#475569",cursor:"pointer",fontSize:"16px"}}>✕</button>
                            </div>
                          </div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"5px"}}>
                            {[["현재가",h.cur==="USD"?"$"+h.price.toFixed(2):Math.round(h.price).toLocaleString()+"₩"],
                              ["일변동",(h.regChgAmt>=0?"+":h.regChgAmt<0?"-":"")+(h.cur==="USD"?"$"+Math.abs(h.regChgAmt).toFixed(2):Math.abs(Math.round(h.regChgAmt)).toLocaleString()+"₩")+" ("+((h.regChgPct>=0?"+":"")+h.regChgPct.toFixed(2))+"%)"],
                              ["수량",h.quantity.toLocaleString()+"주"],
                              ["평가금액",fmtKRW(toKRWLive(h.value,h.cur))],
                              ["손익률",(h.pnlPct>=0?"+":"")+h.pnlPct.toFixed(2)+"%"]
                            ].map(([l,v])=>(
                              <div key={l} style={{background:"rgba(0,0,0,0.2)",borderRadius:"6px",padding:"5px 7px"}}>
                                <div style={{fontSize:"9px",color:"#64748b",marginBottom:"1px"}}>{l}</div>
                                <div style={{fontSize:"11px",fontWeight:700,color:l==="손익률"?h.pnlPct>=0?"#34d399":"#f87171":l==="일변동"?h.regChgPct>=0?"#34d399":"#f87171":"#f1f5f9"}}>{v}</div>
                              </div>
                            ))}
                          </div>
                          {editingId2===h.id&&(
                            <div style={{marginTop:"10px",background:"rgba(234,179,8,0.06)",border:"1px solid rgba(234,179,8,0.3)",borderRadius:"10px",padding:"12px"}}>
                              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                                <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>종목명</div><input value={editForm2.name||""} onChange={e=>setEditForm2(p=>({...p,name:e.target.value}))} style={{...S.inp,fontSize:"12px",padding:"6px 8px"}}/></div>
                                <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>수량</div><input type="number" value={editForm2.quantity||""} onChange={e=>setEditForm2(p=>({...p,quantity:e.target.value}))} style={{...S.inp,fontSize:"12px",padding:"6px 8px"}}/></div>
                                <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>평단가</div><input type="number" value={editForm2.avgPrice||""} onChange={e=>setEditForm2(p=>({...p,avgPrice:e.target.value}))} style={{...S.inp,fontSize:"12px",padding:"6px 8px"}}/></div>
                                <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>계좌</div><select value={editForm2.taxAccount||""} onChange={e=>setEditForm2(p=>({...p,taxAccount:e.target.value}))} style={{...S.inp,fontSize:"12px",padding:"6px 8px",appearance:"none"}}>{TAX_ACCOUNTS.map(a=><option key={a} value={a} style={{background:"#1e293b"}}>{a}</option>)}</select></div>
                              </div>
                              {/* 추가매수 계산기 */}
                              <div style={{marginTop:"10px",background:"rgba(52,211,153,0.06)",border:"1px solid rgba(52,211,153,0.2)",borderRadius:"8px",padding:"10px"}}>
                                <div style={{fontSize:"12px",color:"#34d399",fontWeight:700,marginBottom:"8px"}}>➕ 추가매수 계산기</div>
                                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                                  <input type="number" placeholder="추가 수량" value={editForm2.addQty||""} onChange={e=>{const addQty=e.target.value;const addPrice=editForm2.addPrice||0;const curQty=+editForm2.quantity||0;const curAvg=+editForm2.avgPrice||0;const newQty=curQty+(+addQty||0);const newAvg=newQty>0?((curQty*curAvg)+((+addQty||0)*(+addPrice||0)))/newQty:curAvg;setEditForm2(p=>({...p,addQty,calcQty2:newQty,calcAvg2:Math.round(newAvg*100)/100}));}} style={{...S.inp,fontSize:"12px",padding:"6px 8px"}}/>
                                  <input type="number" placeholder="추가매수 단가" value={editForm2.addPrice||""} onChange={e=>{const addPrice=e.target.value;const addQty=editForm2.addQty||0;const curQty=+editForm2.quantity||0;const curAvg=+editForm2.avgPrice||0;const newQty=curQty+(+addQty||0);const newAvg=newQty>0?((curQty*curAvg)+((+addQty||0)*(+addPrice||0)))/newQty:curAvg;setEditForm2(p=>({...p,addPrice,calcQty2:newQty,calcAvg2:Math.round(newAvg*100)/100}));}} style={{...S.inp,fontSize:"12px",padding:"6px 8px"}}/>
                                </div>
                                {editForm2.addQty&&editForm2.addPrice&&(
                                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginTop:"8px"}}>
                                    <div style={{background:"rgba(0,0,0,0.2)",borderRadius:"6px",padding:"6px 8px"}}><div style={{fontSize:"10px",color:"#64748b",marginBottom:"2px"}}>총 수량</div><div style={{fontSize:"14px",fontWeight:800,color:"#34d399"}}>{editForm2.calcQty2?.toLocaleString()}주</div></div>
                                    <div style={{background:"rgba(0,0,0,0.2)",borderRadius:"6px",padding:"6px 8px"}}><div style={{fontSize:"10px",color:"#64748b",marginBottom:"2px"}}>새 평단가</div><div style={{fontSize:"14px",fontWeight:800,color:"#34d399"}}>{editForm2.calcAvg2?.toLocaleString()}₩</div></div>
                                  </div>
                                )}
                                {editForm2.addQty&&editForm2.addPrice&&(
                                  <button onClick={()=>setEditForm2(p=>{if(!p.calcQty2||!p.calcAvg2)return p;return{...p,quantity:String(p.calcQty2),avgPrice:String(p.calcAvg2),addQty:"",addPrice:"",calcQty2:undefined,calcAvg2:undefined};})} style={S.btn("#34d399",{fontSize:"11px",padding:"5px 12px",width:"100%",marginTop:"6px"})}>↑ 위 값으로 적용하기</button>
                                )}
                              </div>
                              <div style={{display:"flex",gap:"8px",marginTop:"10px"}}>
                                <button onClick={()=>{if(window.confirm("삭제?"))setHoldings2(p=>p.filter(x=>x.id!==h.id));setEditingId2(null);}} style={S.btn("#dc2626",{fontSize:"12px",padding:"6px"})}>🗑️</button>
                                <div style={{display:"flex",gap:"6px",marginLeft:"auto"}}>
                                  <button onClick={()=>setEditingId2(null)} style={S.btn("#475569",{fontSize:"12px",padding:"6px"})}>취소</button>
                                  <button onClick={saveEdit2} style={S.btn("#f59e0b",{fontSize:"12px",padding:"6px"})}>✓ 저장</button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ):(
                    <table style={{width:"100%",borderCollapse:"collapse"}}>
                      <thead><tr>{["종목","현재가","일변동","수량","평가금액","손익률",""].map(h=><th key={h} style={S.TH}>{h}</th>)}</tr></thead>
                      <tbody>
                        {items.map(h=>(
                          <>
                          <tr key={h.id}>
                            <td style={{...S.TD,cursor:"pointer"}} onClick={()=>setSelectedStock(h)}>
                              <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                                <div style={{width:"8px",height:"8px",borderRadius:"2px",background:MARKET_COLOR[h.market]||"#eab308"}}/>
                                <div>
                                  <div style={{fontWeight:700,fontSize:"14px",color:"#f1f5f9"}}>{h.name||h.ticker}</div>
                                  <div style={{fontSize:"11px",color:"#a5b4fc"}}>{h.ticker}</div>
                                </div>
                              </div>
                            </td>
                            <td style={S.TD}><div style={{fontWeight:700}}>{h.cur==="USD"?"$"+h.price.toFixed(2):Math.round(h.price).toLocaleString()+"₩"}</div></td>
                            <td style={{...S.TD,color:h.regChgPct>=0?"#34d399":"#f87171",fontWeight:700}}>
                              <div style={{fontWeight:800}}>{(h.regChgAmt>=0?"+":"-")+(h.cur==="USD"?"$"+Math.abs(h.regChgAmt).toFixed(2):Math.abs(Math.round(h.regChgAmt)).toLocaleString()+"₩")}</div>
                              <div style={{fontSize:"11px",opacity:0.85}}>({(h.regChgPct>=0?"+":"")+h.regChgPct.toFixed(2)}%)</div>
                            </td>
                            <td style={S.TD}>{h.quantity.toLocaleString()}</td>
                            <td style={{...S.TD,fontWeight:700}}>{fmtKRW(toKRWLive(h.value,h.cur))}</td>
                            <td style={{...S.TD,color:h.pnlPct>=0?"#34d399":"#f87171",fontWeight:800}}>{(h.pnlPct>=0?"+":"")+h.pnlPct.toFixed(2)}%</td>
                            <td style={S.TD}><button onClick={()=>editingId2===h.id?setEditingId2(null):startEdit2(h)} style={{background:"none",border:"1px solid rgba(234,179,8,0.4)",color:"#fbbf24",cursor:"pointer",fontSize:"11px",padding:"3px 9px",borderRadius:"5px",fontWeight:700}}>수정</button></td>
                          </tr>
                          {editingId2===h.id&&(
                            <tr key={h.id+"_e2"}><td colSpan={7} style={{padding:"0 0 10px"}}>
                              <div style={{background:"rgba(234,179,8,0.06)",border:"1px solid rgba(234,179,8,0.3)",borderRadius:"10px",padding:"14px",margin:"4px 10px"}}>
                                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:"8px"}}>
                                  <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>종목명</div><input value={editForm2.name||""} onChange={e=>setEditForm2(p=>({...p,name:e.target.value}))} style={S.inp}/></div>
                                  <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>수량</div><input type="number" value={editForm2.quantity||""} onChange={e=>setEditForm2(p=>({...p,quantity:e.target.value}))} style={S.inp}/></div>
                                  <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>평단가</div><input type="number" value={editForm2.avgPrice||""} onChange={e=>setEditForm2(p=>({...p,avgPrice:e.target.value}))} style={S.inp}/></div>
                                  <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>계좌</div><select value={editForm2.taxAccount||""} onChange={e=>setEditForm2(p=>({...p,taxAccount:e.target.value}))} style={{...S.inp,appearance:"none"}}>{TAX_ACCOUNTS.map(a=><option key={a} value={a} style={{background:"#1e293b"}}>{a}</option>)}</select></div>
                                  <input type="number" placeholder="추가 수량" value={editForm2.addQty||""} onChange={e=>{const addQty=e.target.value;const addPrice=editForm2.addPrice||0;const curQty=+editForm2.quantity||0;const curAvg=+editForm2.avgPrice||0;const newQty=curQty+(+addQty||0);const newAvg=newQty>0?((curQty*curAvg)+((+addQty||0)*(+addPrice||0)))/newQty:curAvg;setEditForm2(p=>({...p,addQty,calcQty2:newQty,calcAvg2:Math.round(newAvg*100)/100}));}} style={{...S.inp,borderColor:"rgba(52,211,153,0.4)"}} title="추가매수 수량"/>
                                  <input type="number" placeholder="추가매수 단가" value={editForm2.addPrice||""} onChange={e=>{const addPrice=e.target.value;const addQty=editForm2.addQty||0;const curQty=+editForm2.quantity||0;const curAvg=+editForm2.avgPrice||0;const newQty=curQty+(+addQty||0);const newAvg=newQty>0?((curQty*curAvg)+((+addQty||0)*(+addPrice||0)))/newQty:curAvg;setEditForm2(p=>({...p,addPrice,calcQty2:newQty,calcAvg2:Math.round(newAvg*100)/100}));}} style={{...S.inp,borderColor:"rgba(52,211,153,0.4)"}} title="추가매수 단가"/>
                                  {editForm2.addQty&&editForm2.addPrice&&<><div style={{background:"rgba(52,211,153,0.1)",borderRadius:"6px",padding:"6px 8px"}}><div style={{fontSize:"9px",color:"#64748b"}}>총 수량</div><div style={{fontWeight:800,color:"#34d399"}}>{editForm2.calcQty2?.toLocaleString()}주</div></div><div style={{background:"rgba(52,211,153,0.1)",borderRadius:"6px",padding:"6px 8px"}}><div style={{fontSize:"9px",color:"#64748b"}}>새 평단가</div><div style={{fontWeight:800,color:"#34d399"}}>{editForm2.calcAvg2?.toLocaleString()}₩</div></div></>}
                                </div>
                                {editForm2.addQty&&editForm2.addPrice&&<button onClick={()=>setEditForm2(p=>{if(!p.calcQty2||!p.calcAvg2)return p;return{...p,quantity:String(p.calcQty2),avgPrice:String(p.calcAvg2),addQty:"",addPrice:"",calcQty2:undefined,calcAvg2:undefined};})} style={S.btn("#34d399",{fontSize:"11px",padding:"5px",width:"100%",marginTop:"6px"})}>↑ 추가매수 적용하기</button>}
                                <div style={{display:"flex",gap:"8px",marginTop:"10px",justifyContent:"space-between"}}>
                                  <button onClick={()=>{if(window.confirm("삭제?"))setHoldings2(p=>p.filter(x=>x.id!==h.id));setEditingId2(null);}} style={S.btn("#dc2626",{fontSize:"12px",padding:"6px 14px"})}>🗑️ 삭제</button>
                                  <div style={{display:"flex",gap:"8px"}}>
                                    <button onClick={()=>setEditingId2(null)} style={S.btn("#475569",{fontSize:"12px",padding:"6px 14px"})}>취소</button>
                                    <button onClick={saveEdit2} style={S.btn("#f59e0b",{fontSize:"12px",padding:"6px 14px"})}>✓ 저장</button>
                                  </div>
                                </div>
                              </div>
                            </td></tr>
                          )}
                          </>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── CHARTS (P1/P2/P3 공통) ── */}
        {tab === "charts" && (mainTab==="p1"||mainTab==="p2"||mainTab==="p3") && (()=>{
          const n = filteredSnaps.length, hasData = n >= 2;
          // 기간에 따라 축 레이블 포맷 결정
          const showTime = chartPeriod==="1h" || chartPeriod==="1d";
          const tf = v => {
            if (!v) return "";
            const parts = v.split(" "); // "MM-DD HH:mm"
            return showTime ? (parts[1]||v) : (parts[0]||v);
          };
          const ti = hasData ? Math.max(1, Math.floor(n / (isMobile?3:6))) : 1;
          const rl = hasData ? filteredSnaps[0].label + " ~ " + filteredSnaps[n-1].label : null;
          const BTNS = [["1h","1시간"],["1d","1일"],["7d","1주"],["30d","1달"],["180d","6달"],["365d","1년"],["1095d","3년"],["all","전체"]];
          return (
          <div style={{display:"flex",flexDirection:"column",gap:"20px"}}>
            <div style={S.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"6px",flexWrap:"wrap",gap:"8px"}}>
                <div style={{fontSize:"17px",fontWeight:800,letterSpacing:"-0.03em"}}>📈 수익률 변화</div>
                <div style={{display:"flex",gap:"3px",flexWrap:"wrap"}}>
                  {BTNS.map(([k,l])=>(
                    <button key={k} onClick={()=>setChartPeriod(k)} style={{background:chartPeriod===k?"rgba(99,102,241,0.35)":"rgba(255,255,255,0.05)",border:chartPeriod===k?"1px solid rgba(99,102,241,0.6)":"1px solid rgba(255,255,255,0.08)",color:chartPeriod===k?"#c7d2fe":"#64748b",padding:"4px 9px",borderRadius:"6px",cursor:"pointer",fontSize:"12px",fontWeight:chartPeriod===k?800:500}}>{l}</button>
                  ))}
                </div>
              </div>
              <div style={{fontSize:"12px",color:"#475569",marginBottom:"12px",display:"flex",gap:"8px",flexWrap:"wrap"}}>
                <span>전체 {snapshotList.length}개</span>
                {rl && <span style={{color:"#64748b"}}>· {rl} ({n}개 표시)</span>}
                {!hasData && chartPeriod!=="all" && <span style={{color:"#f59e0b",fontWeight:700}}>⚠ 해당 기간 데이터 없음</span>}
              </div>
              {!hasData ? (
                <div style={{textAlign:"center",padding:"36px",color:"#475569"}}>
                  <div style={{fontSize:"28px",marginBottom:"10px"}}>📊</div>
                  <div>해당 기간 데이터 없음</div>
                  {snapshotList.length >= 2 && <button onClick={()=>setChartPeriod("all")} style={{marginTop:"12px",background:"rgba(99,102,241,0.2)",border:"1px solid rgba(99,102,241,0.4)",color:"#a5b4fc",padding:"6px 16px",borderRadius:"8px",cursor:"pointer",fontSize:"12px",fontWeight:700}}>전체 보기 ({snapshotList.length}개)</button>}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={filteredSnaps} margin={{top:5,right:10,left:0,bottom:5}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)"/>
                    <XAxis dataKey="label" tick={{fill:"#64748b",fontSize:10}} interval={ti} tickFormatter={tf} minTickGap={28}/>
                    <YAxis tick={{fill:"#64748b",fontSize:11}} tickFormatter={v=>v.toFixed(1)+"%"} domain={["auto","auto"]}/>
                    <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.12)",borderRadius:"10px",fontSize:"13px"}} formatter={v=>[v.toFixed(2)+"%","수익률"]} labelFormatter={v=>v}/>
                    <Line type="monotone" dataKey="returnRate" stroke="#6366f1" strokeWidth={2.5} dot={n<=50} activeDot={{r:5,fill:"#6366f1"}}/>
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
            <div style={S.card}>
              <div style={{fontSize:"17px",fontWeight:800,marginBottom:"4px",letterSpacing:"-0.03em"}}>💰 자산 총액 변화</div>
              <div style={{fontSize:"12px",color:"#475569",marginBottom:"12px"}}>KRW 환산 기준{rl?" · "+rl:""}</div>
              {!hasData ? (
                <div style={{textAlign:"center",padding:"40px",color:"#475569"}}><div style={{fontSize:"28px",marginBottom:"10px"}}>💰</div><div>해당 기간 데이터 없음</div></div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={filteredSnaps} margin={{top:5,right:10,left:0,bottom:5}}>
                    <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)"/>
                    <XAxis dataKey="label" tick={{fill:"#64748b",fontSize:10}} interval={ti} tickFormatter={tf} minTickGap={28}/>
                    <YAxis tick={{fill:"#64748b",fontSize:11}} tickFormatter={v=>(v/10000).toFixed(0)+"만"} domain={["auto","auto"]}/>
                    <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.12)",borderRadius:"10px",fontSize:"13px"}} formatter={v=>[Math.round(v).toLocaleString("ko-KR")+"₩","총 자산"]} labelFormatter={v=>v}/>
                    <Area type="monotone" dataKey="totalValue" stroke="#10b981" strokeWidth={2.5} fill="url(#ag)" dot={false} activeDot={{r:5,fill:"#10b981"}}/>
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          );
        })()}

        {/* ── TRADES (P1/P2) ── */}
        {tab==="trades"&&(mainTab==="p1"||mainTab==="p2")&&(
          <div style={S.card}>
            {/* 헤더 + 필터 */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"6px",flexWrap:"wrap",gap:"8px"}}>
              <div style={{fontSize:"17px",fontWeight:800,letterSpacing:"-0.03em"}}>
                매매 일지 <span style={{fontSize:"12px",color:"#475569",fontWeight:500}}>{mainTab==="p1"?"P1 일반":"P2 절세"}</span>
              </div>
              <button onClick={()=>{setShowForm(showForm==="t"?null:"t");setTradePage(1);}} style={S.btn()}>+ 추가</button>
            </div>
            {/* 기간 필터 */}
            <div style={{display:"flex",gap:"4px",flexWrap:"wrap",marginBottom:"10px"}}>
              {[["all","전체"],["3d","3일"],["7d","1주"],["14d","2주"],["30d","1달"],["365d","1년"]].map(([k,l])=>(
                <button key={k} onClick={()=>{setTradeFilterPeriod(k);setTradePage(1);}} style={{background:tradeFilterPeriod===k?"rgba(99,102,241,0.3)":"rgba(255,255,255,0.05)",border:tradeFilterPeriod===k?"1px solid rgba(99,102,241,0.5)":"1px solid rgba(255,255,255,0.08)",color:tradeFilterPeriod===k?"#a5b4fc":"#64748b",padding:"3px 9px",borderRadius:"6px",cursor:"pointer",fontSize:"11px",fontWeight:tradeFilterPeriod===k?700:500}}>{l}</button>
              ))}
            </div>
            {/* 입력 폼 */}
            {showForm==="t"&&(()=>{
              const availH = mainTab==="p1" ? holdings.filter(h=>h.market!=="ISA") : holdings2;
              const [inputMode, setInputMode] = [tForm._mode||"select", (m)=>setTForm(p=>({...p,_mode:m,ticker:""}))];
              return(
                <div style={{background:"rgba(0,0,0,0.35)",borderRadius:"12px",padding:"14px",marginBottom:"12px",border:"1px solid rgba(99,102,241,0.35)"}}>
                  {/* 모드 토글 */}
                  <div style={{display:"flex",gap:"3px",marginBottom:"12px",background:"rgba(255,255,255,0.05)",borderRadius:"8px",padding:"3px"}}>
                    <button onClick={()=>setInputMode("select")} style={{flex:1,padding:"5px",borderRadius:"6px",border:"none",cursor:"pointer",fontSize:"12px",fontWeight:700,background:inputMode==="select"?"rgba(99,102,241,0.45)":"transparent",color:inputMode==="select"?"#c7d2fe":"#64748b"}}>📋 보유종목 선택</button>
                    <button onClick={()=>setInputMode("new")} style={{flex:1,padding:"5px",borderRadius:"6px",border:"none",cursor:"pointer",fontSize:"12px",fontWeight:700,background:inputMode==="new"?"rgba(16,185,129,0.4)":"transparent",color:inputMode==="new"?"#6ee7b7":"#64748b"}}>✏️ 신규 티커 입력</button>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:"8px"}}>
                    <input type="date" value={tForm.date} onChange={e=>setTForm(p=>({...p,date:e.target.value}))} style={S.inp}/>
                    {inputMode==="select"?(
                      <select value={tForm.ticker} onChange={e=>setTForm(p=>({...p,ticker:e.target.value}))} style={{...S.inp,appearance:"none"}}>
                        <option value="">보유종목 선택</option>
                        {availH.map(h=><option key={h.id||h.ticker} value={h.ticker}>{h.name||h.ticker} ({h.ticker})</option>)}
                      </select>
                    ):(
                      <input placeholder="티커 직접 입력 (예: AAPL, 005930)" value={tForm.ticker} onChange={e=>setTForm(p=>({...p,ticker:e.target.value.toUpperCase()}))} style={{...S.inp,borderColor:"rgba(16,185,129,0.4)"}}/>
                    )}
                    <select value={tForm.type} onChange={e=>setTForm(p=>({...p,type:e.target.value}))} style={{...S.inp,appearance:"none"}}><option value="buy">매수</option><option value="sell">매도</option></select>
                    {mainTab==="p2"&&(
                      <select value={tForm.taxAccount||""} onChange={e=>setTForm(p=>({...p,taxAccount:e.target.value}))} style={{...S.inp,appearance:"none"}}>
                        <option value="">계좌 선택 (선택사항)</option>
                        {TAX_ACCOUNTS.map(a=><option key={a} value={a}>{a}</option>)}
                      </select>
                    )}
                    <input placeholder="수량" type="number" value={tForm.quantity} onChange={e=>setTForm(p=>({...p,quantity:e.target.value}))} style={S.inp}/>
                    <input placeholder="체결가" type="number" value={tForm.price} onChange={e=>setTForm(p=>({...p,price:e.target.value}))} style={S.inp}/>
                    <input placeholder="수수료" type="number" value={tForm.fee} onChange={e=>setTForm(p=>({...p,fee:e.target.value}))} style={S.inp}/>
                    <input placeholder="메모 (선택)" value={tForm.note} onChange={e=>setTForm(p=>({...p,note:e.target.value}))} style={{...S.inp,gridColumn:"1/-1"}}/>
                  </div>
                  <div style={{display:"flex",gap:"8px",marginTop:"10px"}}>
                    <button onClick={()=>setShowForm(null)} style={S.btn("#475569")}>취소</button>
                    <button onClick={()=>{
                      if(!tForm.ticker||!tForm.quantity||!tForm.price) return;
                      setTrades(p=>[...p,{id:Date.now(),...tForm,portfolio:mainTab==="p1"?"p1":"p2",quantity:+tForm.quantity,price:+tForm.price,fee:+(tForm.fee||0)}]);
                      setTForm({date:today(),ticker:"",type:"buy",quantity:"",price:"",fee:"",note:"",taxAccount:"",_mode:tForm._mode||"select"});
                      setShowForm(null);
                    }} style={S.btn(mainTab==="p2"?"#f59e0b":"#10b981")}>✓ 저장</button>
                  </div>
                </div>
              );
            })()}
            {/* 목록 */}
            {(()=>{
              const allH=[...holdings,...holdings2];
              const p1Tickers=new Set(holdingsP1.map(h=>h.ticker));
              const raw=[...trades].filter(t=>{
                if(mainTab==="p1") return (t.portfolio==="p1"&&p1Tickers.has(t.ticker))||((!t.portfolio||t.portfolio==="p1")&&p1Tickers.has(t.ticker));
                return t.portfolio==="p2"||(!t.portfolio&&holdings2.some(h=>h.ticker===t.ticker));
              });
              const pMs={"3d":3*864e5,"7d":7*864e5,"14d":14*864e5,"30d":30*864e5,"365d":365*864e5}[tradeFilterPeriod];
              const filtered=raw.filter(t=>!pMs||!t.date||(Date.now()-new Date(t.date).getTime()<=pMs)).sort((a,b)=>b.date>a.date?1:-1);
              if(!filtered.length) return <div style={{textAlign:"center",padding:"36px",color:"#475569"}}><div style={{fontSize:"32px",marginBottom:"8px"}}>📝</div><div>매매 기록이 없습니다</div></div>;
              const totalPg=Math.ceil(filtered.length/TRADE_PAGE_SIZE),curPg=Math.min(tradePage,totalPg);
              const paged=filtered.slice((curPg-1)*TRADE_PAGE_SIZE,curPg*TRADE_PAGE_SIZE);
              let lastDate2="";
              return(<>
                {paged.map(t=>{
                  const hName=allH.find(x=>x.ticker===t.ticker)?.name||t.ticker;
                  const px=prices[t.ticker]||prices[t.ticker+".KS"]||prices[t.ticker+".KQ"];
                  const chgD=px&&t.price?px.price-t.price:null;
                  const chgP=chgD!==null&&t.price?(chgD/t.price)*100:null;
                  const showSep=t.date&&t.date!==lastDate2; if(t.date)lastDate2=t.date;
                  const acct=t.portfolio==="p2"&&t.taxAccount?t.taxAccount.replace("연금저축","연금").replace("(신한금융투자)","신한").replace("(미래에셋증권)","미래"):null;
                  return(
                    <div key={t.id}>
                      {showSep&&(
                        <div style={{display:"flex",alignItems:"center",gap:"8px",padding:"8px 0 4px"}}>
                          <span style={{background:"rgba(99,102,241,0.15)",color:"#a5b4fc",padding:"2px 8px",borderRadius:"6px",fontSize:"11px",fontWeight:700}}>{t.date}</span>
                          <div style={{flex:1,height:"1px",background:"rgba(255,255,255,0.07)"}}/>
                        </div>
                      )}
                      {/* 한 줄 가로 배치 - 시안성 개선 */}
                      <div style={{display:"flex",alignItems:"center",padding:"10px 0",borderBottom:editingTradeId===t.id?"none":"1px solid rgba(255,255,255,0.07)",gap:"10px",overflow:"hidden"}}>
                        {/* 매수/매도 + 날짜 */}
                        <div style={{flexShrink:0,textAlign:"center"}}>
                          <div style={{background:t.type==="buy"?"rgba(99,102,241,0.25)":"rgba(239,68,68,0.25)",border:`1.5px solid ${t.type==="buy"?"rgba(99,102,241,0.6)":"rgba(239,68,68,0.6)"}`,color:t.type==="buy"?"#c7d2fe":"#fca5a5",padding:"4px 11px",borderRadius:"12px",fontSize:"13px",fontWeight:800,whiteSpace:"nowrap"}}>
                            {t.type==="buy"?"매수":"매도"}
                          </div>
                          <div style={{fontSize:"10px",color:"#475569",marginTop:"3px",whiteSpace:"nowrap"}}>{t.date}</div>
                        </div>
                        {/* 종목명 + 티커 + 계좌 */}
                        <div style={{flex:"1 1 100px",minWidth:0}}>
                          <div style={{fontWeight:800,fontSize:"15px",color:"#f1f5f9",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{hName}</div>
                          <div style={{fontSize:"11px",color:"#64748b",display:"flex",alignItems:"center",gap:"4px",flexWrap:"wrap"}}>
                            <span>{t.ticker}</span>
                            {acct&&<span style={{background:"rgba(234,179,8,0.15)",color:"#eab308",padding:"1px 5px",borderRadius:"3px",fontSize:"10px",fontWeight:700}}>{acct}</span>}
                          </div>
                        </div>
                        {/* 수량×가격 + 총액 */}
                        {(()=>{
                          const tH=allH.find(x=>x.ticker===t.ticker);
                          const isUSTicker=!/(\.KS|\.KQ)$/.test(t.ticker)&&!/^\d{5,6}$/.test(t.ticker)&&/^[A-Za-z]/.test(t.ticker);
                          const tCur=t.cur==="USD"?"USD":tH?.market==="US"?"USD":(tH?.market==="ETF"&&!/^[0-9]/.test(t.ticker))?"USD":(!tH&&isUSTicker)?"USD":"KRW";
                          const fmtTp=v=>tCur==="USD"?"$"+Number(v).toFixed(2):Number(v).toLocaleString()+"₩";
                          const totalKRW=tCur==="USD"?Math.round(t.quantity*t.price*liveUsdKrw):Math.round(t.quantity*t.price);
                          const totalStr=tCur==="USD"?"$"+Math.round(t.quantity*t.price).toLocaleString()+" ("+Math.round(t.quantity*t.price*liveUsdKrw).toLocaleString()+"₩)":Math.round(t.quantity*t.price).toLocaleString()+"₩";
                          return(
                            <div style={{flex:"0 0 auto",textAlign:"right",flexShrink:0}}>
                              <div style={{fontSize:"14px",fontWeight:800,color:"#e2e8f0",whiteSpace:"nowrap"}}>{t.quantity.toLocaleString()}주 × {fmtTp(t.price)}</div>
                              <div style={{fontSize:"12px",color:"#94a3b8",fontWeight:600,whiteSpace:"nowrap"}}>총 {totalStr}</div>
                            </div>
                          );
                        })()}
                        {/* 현재가 대비 등락 */}
                        {chgD!==null&&(
                          <div style={{flex:"0 0 auto",flexShrink:0,textAlign:"right",minWidth:"60px"}}>
                            <div style={{fontSize:"13px",fontWeight:800,color:chgD>=0?"#34d399":"#f87171",whiteSpace:"nowrap"}}>{chgD>=0?"▲":"▼"}{Math.abs(chgD)>=1?Math.round(Math.abs(chgD)).toLocaleString():Math.abs(chgD).toFixed(1)}₩</div>
                            <div style={{fontSize:"12px",fontWeight:700,color:chgD>=0?"#34d399":"#f87171",whiteSpace:"nowrap"}}>{chgD>=0?"+":""}{chgP.toFixed(1)}%</div>
                          </div>
                        )}
                        {/* 버튼 */}
                        <div style={{display:"flex",flexDirection:"column",gap:"4px",flexShrink:0}}>
                          <button onClick={()=>{setEditingTradeId(editingTradeId===t.id?null:t.id);setEditTradeForm({date:t.date||"",ticker:t.ticker||"",type:t.type||"buy",quantity:String(t.quantity||""),price:String(t.price||""),fee:String(t.fee||""),note:t.note||"",taxAccount:t.taxAccount||"",portfolio:t.portfolio||""});}} style={{background:"none",border:"1px solid rgba(99,102,241,0.4)",color:"#a5b4fc",cursor:"pointer",fontSize:"11px",padding:"3px 8px",borderRadius:"5px",fontWeight:700}}>✏️</button>
                          <button onClick={()=>setTrades(p=>p.filter(x=>x.id!==t.id))} style={{background:"none",border:"1px solid rgba(239,68,68,0.3)",color:"#f87171",cursor:"pointer",fontSize:"11px",padding:"3px 8px",borderRadius:"5px"}}>✕</button>
                        </div>
                      </div>
                      {/* 수정 폼 */}
                      {editingTradeId===t.id&&(
                        <div style={{background:"rgba(99,102,241,0.06)",border:"1px solid rgba(99,102,241,0.25)",borderRadius:"10px",padding:"12px",marginBottom:"8px"}}>
                          <div style={{fontSize:"11px",color:"#a5b4fc",fontWeight:700,marginBottom:"8px"}}>✏️ 매매일지 수정</div>
                          <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:"7px"}}>
                            <input type="date" value={editTradeForm.date} onChange={e=>setEditTradeForm(p=>({...p,date:e.target.value}))} style={S.inp}/>
                            <input placeholder="티커" value={editTradeForm.ticker} onChange={e=>setEditTradeForm(p=>({...p,ticker:e.target.value.toUpperCase()}))} style={S.inp}/>
                            <select value={editTradeForm.type} onChange={e=>setEditTradeForm(p=>({...p,type:e.target.value}))} style={{...S.inp,appearance:"none"}}>
                              <option value="buy">매수</option><option value="sell">매도</option>
                            </select>
                            {(t.portfolio==="p2"||mainTab==="p2")&&(
                              <select value={editTradeForm.taxAccount||""} onChange={e=>setEditTradeForm(p=>({...p,taxAccount:e.target.value}))} style={{...S.inp,appearance:"none"}}>
                                <option value="">계좌 선택 (연금/IRP)</option>
                                {TAX_ACCOUNTS.map(a=><option key={a} value={a}>{a}</option>)}
                              </select>
                            )}
                            <input placeholder="수량" type="number" value={editTradeForm.quantity} onChange={e=>setEditTradeForm(p=>({...p,quantity:e.target.value}))} style={S.inp}/>
                            <input placeholder="체결가" type="number" value={editTradeForm.price} onChange={e=>setEditTradeForm(p=>({...p,price:e.target.value}))} style={S.inp}/>
                            <input placeholder="수수료" type="number" value={editTradeForm.fee} onChange={e=>setEditTradeForm(p=>({...p,fee:e.target.value}))} style={S.inp}/>
                            <input placeholder="메모" value={editTradeForm.note} onChange={e=>setEditTradeForm(p=>({...p,note:e.target.value}))} style={{...S.inp,gridColumn:"1/-1"}}/>
                          </div>
                          <div style={{display:"flex",gap:"8px",marginTop:"8px"}}>
                            <button onClick={()=>setEditingTradeId(null)} style={S.btn("#475569",{fontSize:"12px"})}>취소</button>
                            <button onClick={()=>{
                              if(!editTradeForm.ticker||!editTradeForm.quantity||!editTradeForm.price) return;
                              setTrades(p=>p.map(x=>x.id===t.id?{...x,...editTradeForm,quantity:+editTradeForm.quantity,price:+editTradeForm.price,fee:+(editTradeForm.fee||0)}:x));
                              setEditingTradeId(null);
                            }} style={S.btn("#6366f1",{fontSize:"12px"})}>✓ 저장</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {totalPg>1&&(
                  <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:"5px",marginTop:"12px",flexWrap:"wrap"}}>
                    <button onClick={()=>setTradePage(1)} disabled={curPg===1} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:curPg===1?"#334155":"#94a3b8",padding:"3px 9px",borderRadius:"6px",cursor:curPg===1?"not-allowed":"pointer",fontSize:"12px"}}>《</button>
                    <button onClick={()=>setTradePage(p=>Math.max(1,p-1))} disabled={curPg===1} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:curPg===1?"#334155":"#94a3b8",padding:"3px 9px",borderRadius:"6px",cursor:curPg===1?"not-allowed":"pointer",fontSize:"12px"}}>‹</button>
                    {Array.from({length:Math.min(5,totalPg)},(_,i)=>{const s=Math.max(1,Math.min(curPg-2,totalPg-4));const pg=s+i;if(pg>totalPg)return null;return<button key={pg} onClick={()=>setTradePage(pg)} style={{background:pg===curPg?"rgba(99,102,241,0.4)":"rgba(255,255,255,0.05)",border:pg===curPg?"1px solid rgba(99,102,241,0.6)":"1px solid rgba(255,255,255,0.1)",color:pg===curPg?"#c7d2fe":"#94a3b8",padding:"3px 9px",borderRadius:"6px",cursor:"pointer",fontSize:"12px",fontWeight:pg===curPg?700:400}}>{pg}</button>;})}
                    <button onClick={()=>setTradePage(p=>Math.min(totalPg,p+1))} disabled={curPg===totalPg} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:curPg===totalPg?"#334155":"#94a3b8",padding:"3px 9px",borderRadius:"6px",cursor:curPg===totalPg?"not-allowed":"pointer",fontSize:"12px"}}>›</button>
                    <button onClick={()=>setTradePage(totalPg)} disabled={curPg===totalPg} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:curPg===totalPg?"#334155":"#94a3b8",padding:"3px 9px",borderRadius:"6px",cursor:curPg===totalPg?"not-allowed":"pointer",fontSize:"12px"}}>》</button>
                    <span style={{fontSize:"11px",color:"#475569"}}>{curPg}/{totalPg}p ({filtered.length}건)</span>
                  </div>
                )}
              </>);
            })()}
          </div>
        )}

        {/* ── DIVIDEND P1 ── */}
        {tab==="dividend"&&mainTab==="p1"&&(
          <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
            <div style={{background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.25)",borderRadius:"12px",padding:"12px 16px",display:"flex",alignItems:"center",gap:"10px"}}>
              <span style={{fontSize:"20px"}}>⚠️</span>
              <div>
                <div style={{fontSize:"13px",fontWeight:700,color:"#fca5a5"}}>금융종합소득 관리 (일반계좌 전용)</div>
                <div style={{fontSize:"11px",color:"#94a3b8",marginTop:"2px"}}>연간 금융소득 2,000만원 초과 시 종합소득세 대상</div>
              </div>
            </div>
            {(()=>{
              const now=new Date(),curYear=now.getFullYear(),curMonth=now.getMonth()+1;
              const genHoldings=holdings.filter(h=>h.market!=="ISA"&&h.market!=="CRYPTO");
              let expectedAnnual=0;
              genHoldings.forEach(h=>{
                const di=divInfo[h.ticker]||{};if(!di.perShare)return;
                const ps=+di.perShare,qty=+h.quantity,isUSD=di.currency==="USD";
                const rawM=di.months||[];const months=Array.isArray(rawM)?rawM:Object.values(rawM);
                expectedAnnual+=(ps*(months.length||1))*(isUSD?liveUsdKrw:1)*qty;
              });
              const thisYearDiv=divRecords.filter(r=>new Date(r.date).getFullYear()===curYear&&genHoldings.some(h=>h.ticker===r.ticker)).reduce((s,r)=>s+(r.currency==="USD"?+r.amount*liveUsdKrw:+r.amount),0);
              return(
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"12px"}}>
                  {[["예상 연간 배당",Math.round(expectedAnnual).toLocaleString()+"₩"+(expectedAnnual>=20000000?" ⚠️":""),expectedAnnual>=20000000?"#f87171":"#f59e0b"],["예상 월 평균",Math.round(expectedAnnual/12).toLocaleString()+"₩","#34d399"],["올해 수령액",Math.round(thisYearDiv).toLocaleString()+"₩","#a5b4fc"]].map(([l,v,c])=>(
                    <div key={l} style={{...S.card,background:"rgba(245,158,11,0.07)",borderColor:"rgba(245,158,11,0.2)"}}>
                      <div style={{fontSize:"11px",color:"#64748b",marginBottom:"6px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>{l}</div>
                      <div style={{fontSize:isMobile?"16px":"20px",fontWeight:800,color:c}}>{v}</div>
                    </div>
                  ))}
                </div>
              );
            })()}
            <div style={S.card}>
              <div style={{fontSize:"14px",fontWeight:800,marginBottom:"12px"}}>📁 일반계좌 종목 배당 정보</div>
              <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                {holdings.filter(h=>h.market!=="ISA"&&h.market!=="CRYPTO").map(h=>{
                  const di=divInfo[h.ticker]||{},isEditing=divEditTicker===h.ticker;
                  const rawCM=di.months||[];const cm=Array.isArray(rawCM)?rawCM:Object.values(rawCM);
                  const ps=+di.perShare||0,qty=+h.quantity,isUSD=di.currency==="USD";
                  const annualKRW=ps*(cm.length||1)*(isUSD?liveUsdKrw:1)*qty;
                  const yieldPct=h.avgPrice>0&&ps>0?(ps*(cm.length||1)/(isUSD?h.avgPrice*liveUsdKrw:h.avgPrice))*100:0;
                  return(
                    <div key={h.ticker} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"10px",padding:"12px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:"8px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                          <div style={{width:"8px",height:"8px",borderRadius:"2px",background:MARKET_COLOR[h.market]||"#64748b"}}/>
                          <div><div style={{fontWeight:700,fontSize:"14px"}}>{h.name||h.ticker}</div><div style={{fontSize:"11px",color:"#64748b"}}>{h.ticker} · {h.quantity}주</div></div>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                          {ps>0&&<div style={{textAlign:"right"}}><div style={{fontSize:"13px",fontWeight:700,color:"#f59e0b"}}>{Math.round(annualKRW).toLocaleString()}₩/년</div><div style={{fontSize:"11px",color:"#64748b"}}>{cm.join("·")}월 · {yieldPct.toFixed(2)}%</div></div>}
                          <button onClick={()=>{if(isEditing){setDivEditTicker(null);}else{setDivEditTicker(h.ticker);const rawEM=di.months||[];setDivInfoForm({perShare:di.perShare||"",months:Array.isArray(rawEM)?rawEM:Object.values(rawEM),currency:di.currency||"KRW"});}}} style={{background:"none",border:"1px solid rgba(99,102,241,0.4)",color:"#a5b4fc",padding:"4px 10px",borderRadius:"6px",cursor:"pointer",fontSize:"12px",fontWeight:700}}>{isEditing?"✕ 닫기":"✏️ 편집"}</button>

                        </div>
                      </div>
                      {isEditing&&(
                        <div style={{marginTop:"12px",display:"flex",flexDirection:"column",gap:"10px"}}>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                            <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>주당 배당금 (1회)</div><input type="number" value={divInfoForm.perShare} onChange={e=>setDivInfoForm(p=>({...p,perShare:e.target.value}))} style={{...S.inp,fontSize:"13px",padding:"7px 10px"}}/></div>
                            <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>통화</div><select value={divInfoForm.currency} onChange={e=>setDivInfoForm(p=>({...p,currency:e.target.value}))} style={{...S.inp,fontSize:"13px",padding:"7px 10px",appearance:"none"}}><option value="KRW">₩ 원화</option><option value="USD">$ 달러</option></select></div>
                          </div>
                          <div style={{display:"flex",flexWrap:"wrap",gap:"5px"}}>{[1,2,3,4,5,6,7,8,9,10,11,12].map(m=>{const sel=(divInfoForm.months||[]).includes(m);return(<button key={m} onClick={()=>setDivInfoForm(p=>{const c=p.months||[];return{...p,months:sel?c.filter(x=>x!==m):[...c,m].sort((a,b)=>a-b)};})} style={{width:"36px",height:"32px",borderRadius:"6px",cursor:"pointer",fontSize:"11px",fontWeight:sel?800:500,background:sel?"rgba(245,158,11,0.3)":"rgba(255,255,255,0.05)",border:sel?"1px solid rgba(245,158,11,0.6)":"1px solid rgba(255,255,255,0.1)",color:sel?"#fbbf24":"#64748b"}}>{m}월</button>);})}</div>
                          <button onClick={()=>{setDivInfo(p=>({...p,[h.ticker]:{...divInfoForm}}));setDivEditTicker(null);}} style={S.btn("#f59e0b",{fontSize:"13px"})}>💾 저장</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            {/* 배당금 수령 일지 */}
            <div style={S.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px",flexWrap:"wrap",gap:"8px"}}>
                <div style={{fontSize:"15px",fontWeight:800}}>📖 배당금 수령 일지</div>
                <button onClick={()=>setShowForm(showForm==="div"?null:"div")} style={S.btn("#f59e0b",{fontSize:"13px"})}>+ 수령 기록</button>
              </div>
              {showForm==="div"&&(
                <div style={{background:"rgba(0,0,0,0.3)",borderRadius:"12px",padding:"16px",marginBottom:"14px",border:"1px solid rgba(245,158,11,0.3)"}}>
                  <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"1fr 1fr 1fr 1fr",gap:"8px"}}>
                    <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>수령일</div><input type="date" value={divForm.date} onChange={e=>setDivForm(p=>({...p,date:e.target.value}))} style={{...S.inp,fontSize:"13px",padding:"7px 10px"}}/></div>
                    <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>종목</div><select value={divForm.ticker} onChange={e=>{const h=holdings.find(x=>x.ticker===e.target.value);setDivForm(p=>({...p,ticker:e.target.value,name:h?.name||""}));}} style={{...S.inp,fontSize:"13px",padding:"7px 10px",appearance:"none"}}><option value="">선택</option>{holdings.filter(h=>h.market!=="ISA"&&h.market!=="CRYPTO").map(h=><option key={h.ticker} value={h.ticker}>{h.name||h.ticker}</option>)}<option value="기타">기타</option></select></div>
                    <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>수령액</div><input type="number" value={divForm.amount} onChange={e=>setDivForm(p=>({...p,amount:e.target.value}))} style={{...S.inp,fontSize:"13px",padding:"7px 10px"}}/></div>
                    <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>통화</div><select value={divForm.currency} onChange={e=>setDivForm(p=>({...p,currency:e.target.value}))} style={{...S.inp,fontSize:"13px",padding:"7px 10px",appearance:"none"}}><option value="KRW">₩</option><option value="USD">$</option></select></div>
                  </div>
                  <div style={{display:"flex",gap:"8px",marginTop:"10px"}}>
                    <button onClick={()=>{if(!divForm.date||!divForm.amount)return;setDivRecords(p=>[...p,{id:Date.now(),...divForm,amount:+divForm.amount}]);setDivForm({date:"",ticker:"",name:"",amount:"",currency:"KRW"});setShowForm(null);}} style={S.btn("#f59e0b")}>✓ 저장</button>
                    <button onClick={()=>setShowForm(null)} style={S.btn("#475569")}>취소</button>
                  </div>
                </div>
              )}
              {divRecords.filter(r=>holdings.filter(h=>h.market!=="ISA").some(h=>h.ticker===r.ticker)||r.ticker==="기타").length===0?(
                <div style={{textAlign:"center",padding:"32px",color:"#475569"}}><div style={{fontSize:"28px"}}>💰</div><div>수령한 배당금을 기록해보세요</div></div>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:"0"}}>
                  {[...divRecords].filter(r=>holdings.filter(h=>h.market!=="ISA").some(h=>h.ticker===r.ticker)||r.ticker==="기타").sort((a,b)=>b.date.localeCompare(a.date)).map(r=>(
                    <div key={r.id} style={{display:"grid",gridTemplateColumns:"90px 1fr auto auto",alignItems:"center",gap:"12px",padding:"10px 4px",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                      <div style={{fontSize:"12px",color:"#64748b"}}>{r.date}</div>
                      <div><div style={{fontSize:"13px",fontWeight:700}}>{r.name||r.ticker||"기타"}</div></div>
                      <div style={{fontSize:"14px",fontWeight:800,color:"#f59e0b"}}>{r.currency==="USD"?"$"+Number(r.amount).toFixed(2):Math.round(r.amount).toLocaleString()+"₩"}</div>
                      <button onClick={()=>setDivRecords(p=>p.filter(x=>x.id!==r.id))} style={{background:"none",border:"none",color:"#475569",cursor:"pointer",fontSize:"15px"}}>✕</button>
                    </div>
                  ))}
                  <div style={{display:"flex",justifyContent:"flex-end",marginTop:"10px",fontSize:"13px",color:"#94a3b8"}}>
                    총&nbsp;<span style={{color:"#f59e0b",fontWeight:700}}>{Math.round(divRecords.filter(r=>holdings.filter(h=>h.market!=="ISA").some(h=>h.ticker===r.ticker)||r.ticker==="기타").reduce((s,r)=>s+(r.currency==="USD"?+r.amount*liveUsdKrw:+r.amount),0)).toLocaleString()}₩</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── DIVIDEND P2 ── */}
        {tab==="dividend"&&mainTab==="p2"&&(
          <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
            {(()=>{
              const total2Annual=holdings2.filter(h=>h.market!=="CRYPTO").reduce((s,h)=>{
                const di=divInfo[h.ticker]||{};const ps=+di.perShare||0,qty=+h.quantity;
                const rawM=di.months||[];const months=Array.isArray(rawM)?rawM:Object.values(rawM);
                return s+ps*(months.length||1)*(di.currency==="USD"?liveUsdKrw:1)*qty;
              },0);
              return(
                <div style={{background:"rgba(234,179,8,0.08)",border:"1px solid rgba(234,179,8,0.2)",borderRadius:"12px",padding:"14px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:"8px"}}>
                  <div><div style={{fontSize:"12px",color:"#64748b",fontWeight:700,marginBottom:"4px"}}>💛 절세계좌 예상 연간 배당</div>
                    <div style={{fontSize:"22px",fontWeight:800,color:"#fbbf24"}}>{Math.round(total2Annual).toLocaleString()}₩</div>
                    <div style={{fontSize:"11px",color:"#64748b",marginTop:"2px"}}>월평균 {Math.round(total2Annual/12).toLocaleString()}₩ · 과세이연/저율과세</div>
                  </div>
                  <div style={{fontSize:"11px",color:"#475569",lineHeight:1.6,textAlign:"right"}}>연금저축·IRP 배당<br/>과세이연 또는 저율과세</div>
                </div>
              );
            })()}
            <div style={S.card}>
              <div style={{fontSize:"14px",fontWeight:800,marginBottom:"12px"}}>🏷️ 절세계좌 종목별 배당</div>
              <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                {holdings2.filter(h=>h.market!=="CRYPTO").map(h=>{
                  const di=divInfo[h.ticker]||{},isEditing=divEditTicker===h.ticker;
                  const rawCM=di.months||[];const cm=Array.isArray(rawCM)?rawCM:Object.values(rawCM);
                  const ps=+di.perShare||0,qty=+h.quantity,isUSD=di.currency==="USD";
                  const annualKRW=ps*(cm.length||1)*(isUSD?liveUsdKrw:1)*qty;
                  const yieldPct=h.avgPrice>0&&ps>0?(ps*(cm.length||1)/(isUSD?h.avgPrice*liveUsdKrw:h.avgPrice))*100:0;
                  return(
                    <div key={h.ticker} style={{background:"rgba(234,179,8,0.05)",border:"1px solid rgba(234,179,8,0.15)",borderRadius:"10px",padding:"12px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:"8px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                          <div style={{width:"8px",height:"8px",borderRadius:"2px",background:MARKET_COLOR[h.market]||"#eab308"}}/>
                          <div><div style={{fontWeight:700,fontSize:"14px"}}>{h.name||h.ticker}</div><div style={{fontSize:"11px",color:"#64748b"}}>{h.ticker} · {h.quantity}주 · {h.taxAccount}</div></div>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                          {ps>0&&<div style={{textAlign:"right"}}><div style={{fontSize:"13px",fontWeight:700,color:"#fbbf24"}}>{Math.round(annualKRW).toLocaleString()}₩/년</div><div style={{fontSize:"11px",color:"#64748b"}}>{cm.join("·")}월 · {yieldPct.toFixed(2)}%</div></div>}
                          <button onClick={()=>{if(isEditing){setDivEditTicker(null);}else{setDivEditTicker(h.ticker);const rawEM=di.months||[];setDivInfoForm({perShare:di.perShare||"",months:Array.isArray(rawEM)?rawEM:Object.values(rawEM),currency:di.currency||"KRW"});}}} style={{background:"none",border:"1px solid rgba(234,179,8,0.4)",color:"#fbbf24",padding:"4px 10px",borderRadius:"6px",cursor:"pointer",fontSize:"12px",fontWeight:700}}>{isEditing?"✕ 닫기":"✏️ 편집"}</button>
                        </div>
                      </div>
                      {isEditing&&(
                        <div style={{marginTop:"12px",display:"flex",flexDirection:"column",gap:"10px"}}>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                            <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>주당 배당금 (1회)</div><input type="number" value={divInfoForm.perShare} onChange={e=>setDivInfoForm(p=>({...p,perShare:e.target.value}))} style={{...S.inp,fontSize:"13px",padding:"7px 10px"}}/></div>
                            <div><div style={{fontSize:"11px",color:"#64748b",marginBottom:"3px"}}>통화</div><select value={divInfoForm.currency} onChange={e=>setDivInfoForm(p=>({...p,currency:e.target.value}))} style={{...S.inp,fontSize:"13px",padding:"7px 10px",appearance:"none"}}><option value="KRW">₩</option><option value="USD">$</option></select></div>
                          </div>
                          <div style={{display:"flex",flexWrap:"wrap",gap:"5px"}}>{[1,2,3,4,5,6,7,8,9,10,11,12].map(m=>{const sel=(divInfoForm.months||[]).includes(m);return(<button key={m} onClick={()=>setDivInfoForm(p=>{const c=p.months||[];return{...p,months:sel?c.filter(x=>x!==m):[...c,m].sort((a,b)=>a-b)};})} style={{width:"36px",height:"32px",borderRadius:"6px",cursor:"pointer",fontSize:"11px",fontWeight:sel?800:500,background:sel?"rgba(234,179,8,0.3)":"rgba(255,255,255,0.05)",border:sel?"1px solid rgba(234,179,8,0.6)":"1px solid rgba(255,255,255,0.1)",color:sel?"#fbbf24":"#64748b"}}>{m}월</button>);})}</div>
                          <button onClick={()=>{setDivInfo(p=>({...p,[h.ticker]:{...divInfoForm}}));setDivEditTicker(null);}} style={S.btn("#f59e0b",{fontSize:"13px"})}>💾 저장</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── WATCHLIST (공통) ── */}
        {tab==="watchlist"&&(mainTab==="p1"||mainTab==="p2"||mainTab==="p3")&&(
          <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:"10px"}}>
              <div><div style={{fontSize:"17px",fontWeight:800,letterSpacing:"-0.03em"}}>⭐ 관심종목</div><div style={{fontSize:"13px",color:"#475569",marginTop:"4px"}}>{watchlist.length}종목</div></div>
              <button onClick={()=>setShowForm(showForm==="wl"?null:"wl")} style={S.btn("#6366f1")}>+ 종목 추가</button>
            </div>
            {showForm==="wl"&&(
              <div style={{...S.card,border:"1px solid rgba(99,102,241,0.35)"}}>
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:"8px"}}>
                  <input placeholder="티커" value={wForm.ticker} onChange={e=>setWForm(p=>({...p,ticker:e.target.value.toUpperCase()}))} style={S.inp}/>
                  <input placeholder="종목명" value={wForm.name} onChange={e=>setWForm(p=>({...p,name:e.target.value}))} style={S.inp}/>
                  <select value={wForm.market} onChange={e=>setWForm(p=>({...p,market:e.target.value}))} style={{...S.inp,appearance:"none"}}><option value="KR">한국주식</option><option value="US">미국주식</option><option value="ETF">ETF</option><option value="ISA">ISA</option></select>
                  <input placeholder="목표 매수가" type="number" value={wForm.targetBuy} onChange={e=>setWForm(p=>({...p,targetBuy:e.target.value}))} style={S.inp}/>
                  <input placeholder="목표 매도가" type="number" value={wForm.targetSell} onChange={e=>setWForm(p=>({...p,targetSell:e.target.value}))} style={S.inp}/>
                  <input placeholder="메모" value={wForm.memo} onChange={e=>setWForm(p=>({...p,memo:e.target.value}))} style={{...S.inp,gridColumn:isMobile?"1":"1/-1"}}/>
                </div>
                <div style={{display:"flex",gap:"8px",marginTop:"12px"}}>
                  <button onClick={()=>{if(!wForm.ticker)return;setWatchlist(p=>[...p,{id:Date.now(),...wForm}]);setWForm({ticker:"",name:"",market:"KR",targetBuy:"",targetSell:"",memo:""});setShowForm(null);}} style={S.btn("#10b981")}>✓ 추가</button>
                  <button onClick={()=>setShowForm(null)} style={S.btn("#475569")}>취소</button>
                </div>
              </div>
            )}
            {watchlist.length===0?(
              <div style={{...S.card,textAlign:"center",padding:"44px",color:"#475569"}}><div style={{fontSize:"32px",marginBottom:"12px"}}>⭐</div><div>관심 종목을 추가하면 목표가를 비교할 수 있습니다</div></div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
                {watchlist.map(w=>{
                  const p=prices[w.ticker];const cur=w.market==="US"||w.market==="ETF"?"USD":"KRW";
                  const currentPrice=p?.price,chg=p?.changePercent??0;
                  const hitBuy=w.targetBuy&&currentPrice&&currentPrice<=+w.targetBuy;
                  const hitSell=w.targetSell&&currentPrice&&currentPrice>=+w.targetSell;
                  return(
                    <div key={w.id} style={{background:"rgba(255,255,255,0.04)",border:`1px solid ${hitBuy?"rgba(52,211,153,0.5)":hitSell?"rgba(248,113,113,0.5)":"rgba(255,255,255,0.08)"}`,borderRadius:"12px",padding:"16px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"12px",gap:"8px",flexWrap:"wrap"}}>
                        <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                          <div style={{width:"10px",height:"10px",borderRadius:"3px",background:MARKET_COLOR[w.market]||"#6366f1"}}/>
                          <div><div style={{fontWeight:800,fontSize:"16px",color:"#a5b4fc",cursor:"pointer"}} onClick={()=>setSelectedStock({...w,avgPrice:currentPrice||0,quantity:0})}>{w.ticker}</div>
                            <div style={{fontSize:"12px",color:"#cbd5e1"}}>{w.name}</div>
                            {w.memo&&<div style={{fontSize:"11px",color:"#64748b"}}>📝 {w.memo}</div>}
                          </div>
                        </div>
                        <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
                          {hitBuy&&<span style={{fontSize:"11px",background:"rgba(52,211,153,0.2)",color:"#34d399",padding:"2px 8px",borderRadius:"20px",fontWeight:700}}>🎯 매수 타이밍!</span>}
                          {hitSell&&<span style={{fontSize:"11px",background:"rgba(248,113,113,0.2)",color:"#f87171",padding:"2px 8px",borderRadius:"20px",fontWeight:700}}>🎯 매도 타이밍!</span>}
                          <button onClick={()=>setWatchlist(p=>p.filter(x=>x.id!==w.id))} style={{background:"none",border:"none",color:"#475569",cursor:"pointer",fontSize:"16px"}}>✕</button>
                        </div>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"6px"}}>
                        {[["현재가",currentPrice?(cur==="KRW"?Math.round(currentPrice).toLocaleString()+"₩":"$"+currentPrice.toFixed(2)):"-"],["일변동",(chg>=0?"+":"")+chg.toFixed(2)+"%"],["목표매수",w.targetBuy?(cur==="KRW"?Math.round(+w.targetBuy).toLocaleString()+"₩":"$"+w.targetBuy):"-"],["목표매도",w.targetSell?(cur==="KRW"?Math.round(+w.targetSell).toLocaleString()+"₩":"$"+w.targetSell):"-"]].map(([l,v])=>(
                          <div key={l} style={{background:"rgba(0,0,0,0.2)",borderRadius:"8px",padding:"8px 10px"}}>
                            <div style={{fontSize:"10px",color:"#64748b",marginBottom:"3px",fontWeight:700}}>{l}</div>
                            <div style={{fontSize:"13px",fontWeight:800,color:l==="일변동"?chg>=0?"#34d399":"#f87171":"#f8fafc"}}>{v}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── ALERTS (공통) ── */}
        {tab==="alerts"&&(mainTab==="p1"||mainTab==="p2"||mainTab==="p3")&&(
          <div style={S.card}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"8px",flexWrap:"wrap",gap:"10px"}}>
              <div><div style={{fontSize:"17px",fontWeight:800,letterSpacing:"-0.03em"}}>알람 설정</div><div style={{fontSize:"13px",color:"#475569",marginTop:"5px"}}>일일 변동폭 기준</div></div>
              <button onClick={()=>setShowForm(showForm==="a"?null:"a")} style={S.btn()}>+ 알람 추가</button>
            </div>
            {showForm==="a"&&(
              <div style={{background:"rgba(0,0,0,0.35)",borderRadius:"12px",padding:"18px",margin:"16px 0",border:"1px solid rgba(99,102,241,0.35)"}}>
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:"8px"}}>
                  <input placeholder="티커" value={aForm.ticker} onChange={e=>setAForm(p=>({...p,ticker:e.target.value.toUpperCase()}))} style={S.inp}/>
                  <select value={aForm.direction} onChange={e=>setAForm(p=>({...p,direction:e.target.value}))} style={{...S.inp,appearance:"none"}}><option value="down">하락 시 알람</option><option value="up">상승 시 알람</option></select>
                  <input placeholder="기준 변동폭 % (예: 3)" type="number" value={aForm.threshold} onChange={e=>setAForm(p=>({...p,threshold:e.target.value}))} style={{...S.inp,gridColumn:"1/-1"}}/>
                </div>
                <div style={{display:"flex",gap:"8px",marginTop:"12px"}}>
                  <button onClick={()=>{if(!aForm.ticker||!aForm.threshold)return;setAlerts(p=>[...p,{id:Date.now(),...aForm,threshold:+aForm.threshold,enabled:true}]);setAForm({ticker:"",direction:"down",threshold:""});setShowForm(null);}} style={S.btn("#10b981")}>✓ 저장</button>
                  <button onClick={()=>setShowForm(null)} style={S.btn("#475569")}>취소</button>
                </div>
              </div>
            )}
            {alerts.length===0?(
              <div style={{textAlign:"center",padding:"44px",color:"#475569"}}><div style={{fontSize:"36px",marginBottom:"12px"}}>🔔</div><div>알람을 설정하면 기준 변동폭 초과 시 알림을 받습니다</div></div>
            ):(
              alerts.map(a=>(
                <div key={a.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"14px"}}>
                    <div style={{fontSize:"24px"}}>{a.direction==="down"?"📉":"📈"}</div>
                    <div><div style={{fontWeight:800,fontSize:"16px"}}>{a.ticker}</div><div style={{fontSize:"13px",color:"#94a3b8"}}>{a.direction==="down"?`-${a.threshold}%`:`+${a.threshold}%`} {a.direction==="down"?"이상 하락":"이상 상승"} 시</div></div>
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


        {/* ── 양도세 탭 ── */}
        {mainTab === "tax" && (()=>{
          const sellTrades = trades.filter(t=>t.type==="sell");
          const allH = [...holdings, ...holdings2];
          const getName = tk => allH.find(h=>h.ticker===tk)?.name || tk;
          const isUS = tk => {
            const h = allH.find(h=>h.ticker===tk);
            if(h) return h.market==="US";
            return !/(\.KS|\.KQ)/.test(tk) && !/^\d{6}$/.test(tk);
          };
          const years = [...new Set(sellTrades.map(t=>t.date?.slice(0,4)).filter(Boolean))].sort().reverse();
          const yearSells = sellTrades.filter(t=>t.date?.startsWith(taxYear));
          const usSells = yearSells.filter(t=>isUS(t.ticker));
          const krSells = yearSells.filter(t=>!isUS(t.ticker));
          const calcProfitKRW = t => {
            const h=allH.find(x=>x.ticker===t.ticker);
            const bp=h?.avgPrice||0;
            const raw=(t.price-bp)*t.quantity-(t.fee||0);
            return t.cur==="USD"?raw*liveUsdKrw:raw;
          };
          const usProfits = usSells.map(t=>({...t,profitKRW:calcProfitKRW(t)}));
          const krProfits = krSells.map(t=>({...t,profitKRW:calcProfitKRW(t)}));
          const usTotal = usProfits.reduce((s,t)=>s+t.profitKRW,0);
          const krTotal = krProfits.reduce((s,t)=>s+t.profitKRW,0);
          const US_EXEMPT = 2_500_000;
          const usTaxable = Math.max(0, usTotal - US_EXEMPT);
          const usTax = Math.round(usTaxable * 0.22);
          const fmt = v => (v>=0?"+":"")+Math.round(v).toLocaleString()+"₩";
          return (
            <div style={{display:"flex",flexDirection:"column",gap:"16px",paddingBottom:"20px"}}>
              {/* 연도 선택 */}
              <div style={{...S.card, background:"linear-gradient(135deg,rgba(239,68,68,0.1),rgba(251,146,60,0.06))", borderColor:"rgba(239,68,68,0.25)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:"10px",marginBottom:"14px"}}>
                  <div>
                    <div style={{fontSize:"18px",fontWeight:800,letterSpacing:"-0.03em"}}>💰 양도소득세 계산기</div>
                    <div style={{fontSize:"12px",color:"#94a3b8",marginTop:"3px"}}>매매일지 기반 자동 계산 · 손익통산 · 참고용</div>
                  </div>
                  <select value={taxYear} onChange={e=>setTaxYear(e.target.value)} style={{...S.inp,padding:"6px 10px",fontSize:"13px",width:"auto",minWidth:"90px"}}>
                    {(years.length?years:[String(new Date().getFullYear())]).map(y=><option key={y} value={y}>{y}년</option>)}
                  </select>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:isMobile?"6px":"12px"}}>
                  {[["🇺🇸 해외주식 손익(통산)",usTotal,usTotal>=0?"#34d399":"#f87171"],
                    ["🇰🇷 국내주식 손익(참고)",krTotal,krTotal>=0?"#34d399":"#f87171"],
                    ["납부 예상 세액",usTax,usTax>0?"#f87171":"#64748b"]
                  ].map(([l,v,c])=>(
                    <div key={l} style={{background:"rgba(0,0,0,0.25)",borderRadius:"10px",padding:isMobile?"10px":"14px",border:"1px solid rgba(255,255,255,0.07)"}}>
                      <div style={{fontSize:"10px",color:"#94a3b8",fontWeight:700,letterSpacing:"0.04em",marginBottom:"4px"}}>{l}</div>
                      <div style={{fontSize:isMobile?"15px":"20px",fontWeight:800,color:c,letterSpacing:"-0.03em"}}>{fmt(v)}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 해외주식 */}
              <div style={S.card}>
                <div style={{fontSize:"15px",fontWeight:800,marginBottom:"10px"}}>🇺🇸 해외주식 양도세</div>
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(4,1fr)",gap:"8px",marginBottom:"12px"}}>
                  {[["연간 총 수익(통산)",usTotal,usTotal>=0?"#34d399":"#f87171"],
                    ["비과세 공제",-Math.min(US_EXEMPT,Math.max(0,usTotal)),"#94a3b8"],
                    ["과세 대상",usTaxable,usTaxable>0?"#fbbf24":"#64748b"],
                    ["예상 세액(22%)",usTax,usTax>0?"#f87171":"#64748b"]
                  ].map(([l,v,c])=>(
                    <div key={l} style={{background:"rgba(0,0,0,0.2)",borderRadius:"8px",padding:"10px 12px"}}>
                      <div style={{fontSize:"10px",color:"#64748b",marginBottom:"3px",fontWeight:700}}>{l}</div>
                      <div style={{fontSize:"14px",fontWeight:800,color:c}}>{fmt(v)}</div>
                    </div>
                  ))}
                </div>
                <div style={{background:"rgba(239,68,68,0.06)",border:"1px solid rgba(239,68,68,0.18)",borderRadius:"10px",padding:"10px",marginBottom:"12px",fontSize:"12px",color:"#94a3b8",lineHeight:1.8}}>
                  📌 <strong style={{color:"#fca5a5"}}>비과세 250만원</strong> · <strong style={{color:"#fca5a5"}}>세율 22%</strong> · <strong style={{color:"#86efac"}}>손익통산</strong> 적용
                </div>
                {usSells.length===0 ? <div style={{textAlign:"center",padding:"14px",color:"#475569",fontSize:"13px"}}>해외주식 매도 기록 없음</div> : (
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse"}}>
                      <thead><tr>{["날짜","종목","매도가","수량","평단가","손익"].map(h=><th key={h} style={{...S.TH,fontSize:"11px"}}>{h}</th>)}</tr></thead>
                      <tbody>
                        {usProfits.map(t=>{
                          const h=allH.find(x=>x.ticker===t.ticker);const bp=h?.avgPrice||0;
                          return(<tr key={t.id}>
                            <td style={{...S.TD,fontSize:"12px"}}>{t.date}</td>
                            <td style={{...S.TD,fontSize:"12px"}}><div style={{fontWeight:700}}>{getName(t.ticker)}</div><div style={{fontSize:"10px",color:"#64748b"}}>{t.ticker}</div></td>
                            <td style={{...S.TD,fontSize:"12px"}}>{t.cur==="USD"?"$"+Number(t.price).toFixed(2):Number(t.price).toLocaleString()+"₩"}</td>
                            <td style={{...S.TD,fontSize:"12px"}}>{t.quantity.toLocaleString()}</td>
                            <td style={{...S.TD,fontSize:"12px",color:"#64748b"}}>{bp>0?(t.cur==="USD"?"$"+bp.toFixed(2):bp.toLocaleString()+"₩"):"미상"}</td>
                            <td style={{...S.TD,fontSize:"12px",fontWeight:700,color:t.profitKRW>=0?"#34d399":"#f87171"}}>{fmt(t.profitKRW)}</td>
                          </tr>);
                        })}
                        <tr style={{borderTop:"2px solid rgba(255,255,255,0.1)"}}>
                          <td colSpan={5} style={{...S.TD,fontSize:"12px",fontWeight:700,color:"#94a3b8"}}>합계(통산)</td>
                          <td style={{...S.TD,fontSize:"13px",fontWeight:800,color:usTotal>=0?"#34d399":"#f87171"}}>{fmt(usTotal)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* 국내주식 */}
              <div style={S.card}>
                <div style={{fontSize:"15px",fontWeight:800,marginBottom:"8px"}}>🇰🇷 국내주식 (비과세)</div>
                <div style={{background:"rgba(16,185,129,0.07)",border:"1px solid rgba(16,185,129,0.2)",borderRadius:"10px",padding:"10px",marginBottom:"10px"}}>
                  <div style={{fontSize:"13px",color:"#86efac",fontWeight:700,marginBottom:"2px"}}>✅ 일반 개인투자자 비과세</div>
                  <div style={{fontSize:"12px",color:"#94a3b8"}}>코스피·코스닥 — 대주주 요건 미해당 시 양도세 면제</div>
                </div>
                {krSells.length===0 ? <div style={{textAlign:"center",padding:"14px",color:"#475569",fontSize:"13px"}}>국내주식 매도 기록 없음</div> : (
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse"}}>
                      <thead><tr>{["날짜","종목","매도가","수량","평단가","손익","과세"].map(h=><th key={h} style={{...S.TH,fontSize:"11px"}}>{h}</th>)}</tr></thead>
                      <tbody>
                        {krProfits.map(t=>{
                          const h=allH.find(x=>x.ticker===t.ticker);const bp=h?.avgPrice||0;
                          return(<tr key={t.id}>
                            <td style={{...S.TD,fontSize:"12px"}}>{t.date}</td>
                            <td style={{...S.TD,fontSize:"12px"}}><div style={{fontWeight:700}}>{getName(t.ticker)}</div><div style={{fontSize:"10px",color:"#64748b"}}>{t.ticker}</div></td>
                            <td style={{...S.TD,fontSize:"12px"}}>{Number(t.price).toLocaleString()}₩</td>
                            <td style={{...S.TD,fontSize:"12px"}}>{t.quantity.toLocaleString()}</td>
                            <td style={{...S.TD,fontSize:"12px",color:"#64748b"}}>{bp>0?bp.toLocaleString()+"₩":"미상"}</td>
                            <td style={{...S.TD,fontSize:"12px",fontWeight:700,color:t.profitKRW>=0?"#34d399":"#f87171"}}>{fmt(t.profitKRW)}</td>
                            <td style={S.TD}><span style={{background:"rgba(16,185,129,0.15)",color:"#86efac",padding:"2px 6px",borderRadius:"20px",fontWeight:700,fontSize:"10px"}}>비과세</span></td>
                          </tr>);
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div style={{background:"rgba(251,191,36,0.07)",border:"1px solid rgba(251,191,36,0.18)",borderRadius:"10px",padding:"10px",fontSize:"12px",color:"#94a3b8",lineHeight:1.8}}>
                ⚠️ <strong style={{color:"#fbbf24"}}>주의</strong> 참고용 계산 · 신고: 매년 5월 · 세무사 확인 권장
              </div>
            </div>
          );
        })()}

        {/* ── 캘린더 탭 ── */}
        {mainTab === "calendar" && (()=>{
          const allH = [...holdings, ...holdings2];
          const snapByDate = {};
          snapshots.forEach(s => {
            if (!s.id) return;
            const dt = new Date(s.id+9*3600000).toISOString().slice(0,10);
            if (!snapByDate[dt]) snapByDate[dt] = [];
            snapByDate[dt].push(s);
          });
          const dailySnap = {};
          Object.entries(snapByDate).forEach(([dt, snaps]) => {
            dailySnap[dt] = snaps.reduce((a,b)=>(a.id>b.id?a:b));
          });
          const dates = Object.keys(dailySnap).sort();
          const now = new Date();
          const calDateRef = calSelectedDate && calSelectedDate.length>=7 ? calSelectedDate : now.toISOString().slice(0,7)+"-01";
          const calY = parseInt(calDateRef.slice(0,4));
          const calM = parseInt(calDateRef.slice(5,7))-1;
          const firstDay = new Date(calY, calM, 1).getDay();
          const daysInMonth = new Date(calY, calM+1, 0).getDate();
          const calcDayChg = (snap, prev) => {
            if (!snap || !prev) return null;
            const chg = snap.totalValue - prev.totalValue;
            const pct = prev.totalValue > 0 ? (chg/prev.totalValue)*100 : 0;
            return { chg, pct };
          };
          const selSnap = calSelectedDate && calSelectedDate.length===10 ? dailySnap[calSelectedDate] : null;
          const selIdx = calSelectedDate ? dates.indexOf(calSelectedDate) : -1;
          const prevDateSnap = selIdx > 0 ? dailySnap[dates[selIdx-1]] : null;
          return (
            <div style={{display:"flex",flexDirection:"column",gap:"14px",paddingBottom:"20px"}}>
              {/* 캘린더 */}
              <div style={S.card}>
                <div style={{display:"flex",flexDirection:"column",gap:"8px",marginBottom:"14px"}}>
                  {/* 년도+월 네비게이션 */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <button onClick={()=>{const d=new Date(calY,calM-1,1);setCalSelectedDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`);}}
                      style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#94a3b8",padding:"6px 14px",borderRadius:"8px",cursor:"pointer",fontSize:"14px",fontWeight:700}}>‹</button>
                    <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                      {/* 년도 선택 */}
                      <select value={calY} onChange={e=>{const y=e.target.value;setCalSelectedDate(`${y}-${String(calM+1).padStart(2,"0")}-01`);}}
                        style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.15)",color:"#f1f5f9",padding:"4px 8px",borderRadius:"7px",fontSize:"15px",fontWeight:800,cursor:"pointer",appearance:"none",outline:"none",textAlign:"center"}}>
                        {Array.from({length:6},(_,i)=>new Date().getFullYear()-3+i).map(y=>(
                          <option key={y} value={y} style={{background:"#1e293b"}}>{y}년</option>
                        ))}
                      </select>
                      {/* 월 선택 */}
                      <select value={calM+1} onChange={e=>{const m=+e.target.value;setCalSelectedDate(`${calY}-${String(m).padStart(2,"0")}-01`);}}
                        style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.15)",color:"#f1f5f9",padding:"4px 8px",borderRadius:"7px",fontSize:"15px",fontWeight:800,cursor:"pointer",appearance:"none",outline:"none",textAlign:"center"}}>
                        {Array.from({length:12},(_,i)=>i+1).map(m=>(
                          <option key={m} value={m} style={{background:"#1e293b"}}>{m}월</option>
                        ))}
                      </select>
                    </div>
                    <button onClick={()=>{const d=new Date(calY,calM+1,1);setCalSelectedDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`);}}
                      style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#94a3b8",padding:"6px 14px",borderRadius:"8px",cursor:"pointer",fontSize:"14px",fontWeight:700}}>›</button>
                  </div>
                  {/* 빠른 이동: 오늘 */}
                  <div style={{display:"flex",justifyContent:"center",gap:"6px"}}>
                    <button onClick={()=>setCalSelectedDate(new Date().toISOString().slice(0,10))}
                      style={{background:"rgba(99,102,241,0.15)",border:"1px solid rgba(99,102,241,0.3)",color:"#a5b4fc",padding:"3px 12px",borderRadius:"6px",cursor:"pointer",fontSize:"11px",fontWeight:700}}>
                      오늘
                    </button>
                    {dates.length>0&&(
                      <button onClick={()=>setCalSelectedDate(dates[dates.length-1])}
                        style={{background:"rgba(16,185,129,0.1)",border:"1px solid rgba(16,185,129,0.3)",color:"#34d399",padding:"3px 12px",borderRadius:"6px",cursor:"pointer",fontSize:"11px",fontWeight:700}}>
                        마지막 기록
                      </button>
                    )}
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"2px",marginBottom:"4px"}}>
                  {["일","월","화","수","목","금","토"].map((d,i)=>(
                    <div key={d} style={{textAlign:"center",fontSize:"11px",fontWeight:700,color:i===0?"#fca5a5":i===6?"#93c5fd":"#64748b",padding:"4px 0"}}>{d}</div>
                  ))}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"3px"}}>
                  {Array.from({length:firstDay},(_,i)=><div key={"e"+i}/>)}
                  {Array.from({length:daysInMonth},(_,i)=>{
                    const d=i+1;
                    const dateStr=`${calY}-${String(calM+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                    const snap=dailySnap[dateStr];
                    const prevIdx2=dates.indexOf(dateStr);
                    const prevS=prevIdx2>0?dailySnap[dates[prevIdx2-1]]:null;
                    const dayChg=calcDayChg(snap,prevS);
                    const isToday=dateStr===new Date().toISOString().slice(0,10);
                    const isSel=dateStr===calSelectedDate;
                    const dow=new Date(calY,calM,d).getDay();
                    const isWeekend=dow===0||dow===6;
                    return(
                      <div key={d} onClick={()=>setCalSelectedDate(isSel?null:dateStr)} style={{borderRadius:"8px",padding:"5px 2px",cursor:"pointer",background:isSel?"rgba(99,102,241,0.3)":isToday?"rgba(99,102,241,0.1)":"rgba(255,255,255,0.02)",border:isSel?"1px solid rgba(99,102,241,0.7)":isToday?"1px solid rgba(99,102,241,0.3)":"1px solid transparent",minHeight:"46px",display:"flex",flexDirection:"column",alignItems:"center",gap:"1px",opacity:isWeekend&&!snap?0.35:1,transition:"all 0.1s"}}>
                        <span style={{fontSize:"12px",fontWeight:isSel||isToday?800:400,color:isToday?"#a5b4fc":dow===0?"#fca5a5":dow===6?"#93c5fd":"#e2e8f0"}}>{d}</span>
                        {snap&&<span style={{fontSize:"9px",fontWeight:700,color:snap.returnRate>=0?"#34d399":"#f87171",lineHeight:1.2}}>{snap.returnRate>=0?"+":""}{snap.returnRate.toFixed(1)}%</span>}
                        {dayChg&&<span style={{fontSize:"8px",color:dayChg.chg>=0?"#34d399":"#f87171",opacity:0.75,lineHeight:1.1}}>{dayChg.chg>=0?"▲":"▼"}{Math.abs(dayChg.pct).toFixed(1)}%</span>}
                        {!snap&&isWeekend&&<span style={{fontSize:"7px",color:"#2d3748",marginTop:"2px"}}>휴장</span>}
                      </div>
                    );
                  })}
                </div>
              </div>

  선택 날짜 상세 + 매매 내역 */}
              {calSelectedDate&&calSelectedDate.length===10&&(()=>{
                const dayChg=calcDayChg(selSnap,prevDateSnap);
                const dayTrades=[...trades].filter(t=>t.date===calSelectedDate);
                return(
                  <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
                    {selSnap?(
                      <div style={S.card}>
                        <div style={{fontSize:"14px",fontWeight:800,marginBottom:"10px",color:"#a5b4fc"}}>📊 {calSelectedDate} 포트폴리오</div>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"8px"}}>
                          {[["총 평가금액",Math.round(selSnap.totalValue).toLocaleString()+"₩","#f1f5f9"],["누적 수익률",(selSnap.returnRate>=0?"+":"")+selSnap.returnRate.toFixed(2)+"%",selSnap.returnRate>=0?"#34d399":"#f87171"],dayChg?["전일 대비",(dayChg.chg>=0?"+":"")+Math.round(dayChg.chg).toLocaleString()+"₩ ("+(dayChg.pct>=0?"+":"")+dayChg.pct.toFixed(2)+"%)",dayChg.chg>=0?"#34d399":"#f87171"]:["전일 대비","—","#475569"]].map(([l,v,c])=>(
                            <div key={l} style={{background:"rgba(0,0,0,0.2)",borderRadius:"9px",padding:"10px 12px"}}>
                              <div style={{fontSize:"10px",color:"#64748b",marginBottom:"3px",fontWeight:700}}>{l}</div>
                              <div style={{fontSize:"13px",fontWeight:800,color:c}}>{v}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ):(
                      <div style={{...S.card,textAlign:"center",padding:"14px",color:"#475569"}}>
                        <div>📭 {calSelectedDate} — 스냅샷 없음</div>
                        <div style={{fontSize:"11px",color:"#374151",marginTop:"3px"}}>앱이 열려있을 때 30초마다 자동 기록됩니다</div>
                      </div>
                    )}
                    <div style={S.card}>
                      <div style={{fontSize:"14px",fontWeight:800,marginBottom:"8px",color:"#f59e0b"}}>
                        📝 {calSelectedDate} 매매 내역 <span style={{fontSize:"12px",color:"#64748b",fontWeight:400}}>{dayTrades.length}건</span>
                      </div>
                      {dayTrades.length===0?(
                        <div style={{textAlign:"center",padding:"10px",color:"#475569",fontSize:"12px"}}>해당 날짜에 매매 기록이 없습니다</div>
                      ):(
                        <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                          {dayTrades.map(t=>{
                            const allH2=[...holdings,...holdings2];
                            const tH2=allH2.find(x=>x.ticker===t.ticker);
                            const tName2=tH2?.name||t.ticker;
                            const tCur2=tH2?.market==="US"||(tH2?.market==="ETF"&&!/^[0-9]/.test(t.ticker))?"USD":"KRW";
                            const fmtP2=v=>tCur2==="USD"?"$"+Number(v).toFixed(2):Number(v).toLocaleString()+"₩";
                            const isBuy=t.type==="buy";
                            const portLabel=t.portfolio==="p2"&&t.taxAccount?t.taxAccount.replace("연금저축","연금").replace("(신한금융투자)","신한").replace("(미래에셋증권)","미래"):t.portfolio==="p3"?"ISA":t.portfolio==="p1"?"P1":"";
                            return(
                              <div key={t.id} style={{display:"flex",alignItems:"center",gap:"10px",padding:"8px 10px",background:"rgba(0,0,0,0.15)",borderRadius:"8px",border:`1px solid ${isBuy?"rgba(99,102,241,0.2)":"rgba(239,68,68,0.2)"}`}}>
                                <div style={{background:isBuy?"rgba(99,102,241,0.2)":"rgba(239,68,68,0.2)",border:`1px solid ${isBuy?"rgba(99,102,241,0.5)":"rgba(239,68,68,0.5)"}`,color:isBuy?"#c7d2fe":"#fca5a5",padding:"3px 9px",borderRadius:"12px",fontSize:"12px",fontWeight:800,flexShrink:0}}>{isBuy?"매수":"매도"}</div>
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{fontWeight:700,fontSize:"14px",color:"#f1f5f9",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tName2}</div>
                                  <div style={{fontSize:"11px",color:"#64748b"}}>{t.ticker}{portLabel?` · ${portLabel}`:""}</div>
                                </div>
                                <div style={{textAlign:"right",flexShrink:0}}>
                                  <div style={{fontSize:"13px",fontWeight:700,color:"#e2e8f0",whiteSpace:"nowrap"}}>{t.quantity.toLocaleString()}주 × {fmtP2(t.price)}</div>
                                  <div style={{fontSize:"11px",color:"#94a3b8",whiteSpace:"nowrap"}}>총 {tCur2==="USD"?"$"+Math.round(t.quantity*t.price).toLocaleString():Math.round(t.quantity*t.price).toLocaleString()+"₩"}</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

                            {/* 종목별 종가 히스토리 */}
              <div style={S.card}>
                {/* 헤더 */}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontSize:"14px",fontWeight:800}}>📈 종목별 종가 히스토리</div>
                    {calStockTicker&&<div style={{fontSize:"11px",color:"#64748b",marginTop:"2px"}}>최근 3개월 · 날짜별 종가·등락폭</div>}
                  </div>
                  <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
                    {calStockTicker&&(
                      <button onClick={()=>{setCalStockTicker(null);setCalShowSelector(false);}}
                        style={{background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",color:"#f87171",padding:"3px 9px",borderRadius:"6px",cursor:"pointer",fontSize:"11px",fontWeight:700}}>
                        ✕ 닫기
                      </button>
                    )}
                    <button onClick={()=>setCalShowSelector(v=>!v)}
                      style={{background:calShowSelector?"rgba(99,102,241,0.3)":"rgba(255,255,255,0.05)",border:calShowSelector?"1px solid rgba(99,102,241,0.5)":"1px solid rgba(255,255,255,0.1)",color:calShowSelector?"#c7d2fe":"#64748b",padding:"3px 10px",borderRadius:"6px",cursor:"pointer",fontSize:"11px",fontWeight:700}}>
                      {calShowSelector?"▴ 접기":"▾ 종목 선택"}
                    </button>
                  </div>
                </div>

                {/* 종목 선택 패널 - calShowSelector일 때만 표시 */}
                {calShowSelector&&(
                  <div style={{marginTop:"10px",padding:"10px",background:"rgba(0,0,0,0.2)",borderRadius:"8px"}}>
                    <div style={{fontSize:"11px",color:"#64748b",marginBottom:"8px",fontWeight:600}}>종목을 선택하세요</div>
                    <div style={{display:"flex",gap:"5px",flexWrap:"wrap"}}>
                      {[...holdings,...holdings2]
                        .filter((v,i,arr)=>arr.findIndex(x=>x.ticker===v.ticker)===i)
                        .map(h=>(
                          <button key={h.ticker}
                            onClick={()=>{
                              setCalStockTicker(h.ticker);
                              setCalShowSelector(false);
                              if(!stockHistory[h.ticker]){
                                fetchHistory(h.ticker, h.market, "3mo")
                                  .then(d=>{ if(d&&d.length>0) setStockHistory(p=>({...p,[h.ticker]:d})); })
                                  .catch(()=>{});
                              }
                            }}
                            style={{
                              background:calStockTicker===h.ticker?"rgba(99,102,241,0.35)":"rgba(255,255,255,0.06)",
                              border:calStockTicker===h.ticker?"1px solid rgba(99,102,241,0.6)":"1px solid rgba(255,255,255,0.1)",
                              color:calStockTicker===h.ticker?"#c7d2fe":"#e2e8f0",
                              padding:"5px 12px",borderRadius:"7px",cursor:"pointer",fontSize:"12px",fontWeight:calStockTicker===h.ticker?700:400,
                              transition:"all 0.1s",
                            }}>
                            {h.name||h.ticker}
                          </button>
                        ))
                      }
                    </div>
                  </div>
                )}

                {/* 선택된 종목 데이터 테이블 */}
                {calStockTicker&&(()=>{
                  const hist = stockHistory[calStockTicker];
                  const h = [...holdings,...holdings2].find(x=>x.ticker===calStockTicker);
                  const cur = (h?.market==="US"||(h?.market==="ETF"&&!/^[0-9]/.test(calStockTicker))) ? "USD" : "KRW";
                  const fmtPr = v => cur==="USD" ? "$"+v.toFixed(2) : Math.round(v).toLocaleString()+"₩";
                  if(!hist) return (
                    <div style={{textAlign:"center",padding:"24px",color:"#475569"}}>
                      <div style={{fontSize:"20px",marginBottom:"8px"}}>⏳</div>
                      <div style={{fontSize:"13px"}}>데이터 불러오는 중...</div>
                      <div style={{fontSize:"11px",color:"#374151",marginTop:"4px"}}>잠시 기다려 주세요</div>
                    </div>
                  );
                  if(hist.length===0) return (
                    <div style={{textAlign:"center",padding:"20px",color:"#475569",fontSize:"13px"}}>데이터를 가져오지 못했습니다</div>
                  );
                  const rows = [...hist].reverse().slice(0,90);
                  return(
                    <div style={{marginTop:"12px"}}>
                      <div style={{fontSize:"12px",color:"#64748b",marginBottom:"6px",fontWeight:600}}>
                        {h?.name||calStockTicker} ({calStockTicker}) · {rows.length}일
                      </div>
                      <div style={{overflowX:"auto",maxHeight:"360px",overflowY:"auto"}}>
                        <table style={{width:"100%",borderCollapse:"collapse"}}>
                          <thead style={{position:"sticky",top:0,background:"rgba(15,23,42,0.96)"}}>
                            <tr>
                              {["날짜","종가","전일비","등락률"].map(c=>(
                                <th key={c} style={{...S.TH,textAlign:c==="날짜"?"left":"right",padding:"7px 10px",fontSize:"11px"}}>{c}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((row,i)=>{
                              const prev = rows[i+1];
                              const chgAmt = prev ? row.price-prev.price : null;
                              const chgPct = prev&&prev.price>0 ? (row.price-prev.price)/prev.price*100 : null;
                              const up = chgAmt>=0;
                              const isCalSel = calSelectedDate&&row.date&&(row.date===calSelectedDate||row.date===calSelectedDate.slice(2));
                              return(
                                <tr key={i}
                                  style={{borderBottom:"1px solid rgba(255,255,255,0.04)",background:isCalSel?"rgba(99,102,241,0.1)":"transparent",transition:"background 0.1s"}}
                                  onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}
                                  onMouseLeave={e=>e.currentTarget.style.background=isCalSel?"rgba(99,102,241,0.1)":"transparent"}>
                                  <td style={{...S.TD,fontSize:"12px",color:"#94a3b8"}}>{row.date}</td>
                                  <td style={{...S.TD,textAlign:"right",fontWeight:700,color:"#e2e8f0",fontSize:"13px"}}>{fmtPr(row.price)}</td>
                                  <td style={{...S.TD,textAlign:"right",fontWeight:600,color:chgAmt===null?"#475569":up?"#34d399":"#f87171",fontSize:"12px"}}>
                                    {chgAmt===null?"—":(up?"+":"")+fmtPr(Math.abs(chgAmt))}
                                  </td>
                                  <td style={{...S.TD,textAlign:"right",fontWeight:700,color:chgPct===null?"#475569":up?"#34d399":"#f87171",fontSize:"12px"}}>
                                    {chgPct===null?"—":(up?"+":"")+chgPct.toFixed(2)+"%"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                {/* 초기 안내 - 아무것도 선택 안 됨 */}
                {!calStockTicker&&!calShowSelector&&(
                  <div style={{textAlign:"center",padding:"20px",color:"#475569",fontSize:"12px",marginTop:"8px"}}>
                    <div style={{fontSize:"20px",marginBottom:"6px"}}>📊</div>
                    <div>위 <strong style={{color:"#a5b4fc"}}>▾ 종목 선택</strong> 버튼을 눌러</div>
                    <div>날짜별 종가·등락폭을 확인하세요</div>
                  </div>
                )}
              </div>

              {/* 전체 일별 히스토리 테이블 */}
              {dates.length>1&&(
                <div style={S.card}>
                  <div style={{fontSize:"14px",fontWeight:800,marginBottom:"10px"}}>📋 포트폴리오 일별 기록</div>
                  <div style={{overflowX:"auto",maxHeight:"300px",overflowY:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse"}}>
                      <thead style={{position:"sticky",top:0,background:"rgba(15,23,42,0.96)"}}>
                        <tr>{["날짜","총 평가금액","전일 변동","누적 수익률"].map(c=><th key={c} style={{...S.TH,textAlign:c==="날짜"?"left":"right",padding:"7px 10px",fontSize:"11px"}}>{c}</th>)}</tr>
                      </thead>
                      <tbody>
                        {[...dates].reverse().map((dt,i)=>{
                          const s=dailySnap[dt];
                          const prevDt=[...dates].reverse()[i+1];
                          const ps=prevDt?dailySnap[prevDt]:null;
                          const chg=ps?s.totalValue-ps.totalValue:null;
                          const chgP=ps&&ps.totalValue>0?(chg/ps.totalValue)*100:null;
                          const up=chg>=0;
                          const isSel=dt===calSelectedDate;
                          return(
                            <tr key={dt} style={{borderBottom:"1px solid rgba(255,255,255,0.04)",background:isSel?"rgba(99,102,241,0.1)":"transparent",cursor:"pointer",transition:"background 0.1s"}}
                              onClick={()=>setCalSelectedDate(isSel?null:dt)}
                              onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.04)"}
                              onMouseLeave={e=>e.currentTarget.style.background=isSel?"rgba(99,102,241,0.1)":"transparent"}>
                              <td style={{...S.TD,fontSize:"12px",color:isSel?"#a5b4fc":"#94a3b8",fontWeight:isSel?700:400}}>{dt}</td>
                              <td style={{...S.TD,textAlign:"right",fontWeight:700,color:"#e2e8f0",fontSize:"12px"}}>{Math.round(s.totalValue).toLocaleString()}₩</td>
                              <td style={{...S.TD,textAlign:"right",fontWeight:600,color:chg===null?"#475569":up?"#34d399":"#f87171",fontSize:"12px"}}>{chg===null?"첫 기록":(up?"+":"")+Math.round(Math.abs(chg)).toLocaleString()+"₩ ("+(up?"+":"")+chgP.toFixed(2)+"%)"}</td>
                              <td style={{...S.TD,textAlign:"right",fontWeight:700,color:s.returnRate>=0?"#34d399":"#f87171",fontSize:"12px"}}>{s.returnRate>=0?"+":""}{s.returnRate.toFixed(2)}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
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
          onEdit={h=>{
            const isP2=holdings2.some(x=>x.id===h.id);
            if(isP2){startEdit2(h);setMainTab("p2");setTab("portfolio");}
            else{startEdit(holdings.find(x=>x.id===h.id)||h);setMainTab("p1");setTab("portfolio");}
            setSelectedAccount(null);
          }}
        />
      )}
      {showContrib && (
        <ContribModal limits={contribLimits} amounts={contribAmounts} onSave={(l,a)=>{setContribLimits(l);setContribAmounts(a);setShowContrib(false);}} onClose={()=>setShowContrib(false)} isMobile={isMobile}/>
      )}

      <div style={{position:"fixed",bottom:"22px",right:"22px",display:"flex",flexDirection:"column-reverse",gap:"10px",zIndex:999}}>
        {toasts.map(t=>(
          <div key={t.id} style={{background:t.type==="up"?"rgba(16,185,129,0.18)":t.type==="down"?"rgba(239,68,68,0.18)":"rgba(30,41,59,0.96)",backdropFilter:"blur(14px)",border:`1px solid ${t.type==="up"?"rgba(16,185,129,0.45)":t.type==="down"?"rgba(239,68,68,0.45)":"rgba(255,255,255,0.12)"}`,padding:"14px 20px",borderRadius:"12px",fontSize:"15px",fontWeight:700,maxWidth:"320px"}}>
            {t.msg}
          </div>
        ))}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes rollUp{0%{transform:translateY(8px);opacity:0.3}100%{transform:translateY(0);opacity:1}} select option{background:#1e293b} *{-webkit-font-smoothing:antialiased}`}</style>
    </div>
  );
}

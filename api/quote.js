// Vercel API Route: /api/quote
// KR: 네이버 실시간 API (지연 없음)
// US: Yahoo v8/chart 1분봉 최신가 (거의 실시간) + v7/quote fallback

let _crumb = null;
let _cookie = null;
let _crumbTs = 0;

async function getYahooCrumb() {
  if (_crumb && _cookie && Date.now() - _crumbTs < 1800000) {
    return { crumb: _crumb, cookie: _cookie };
  }
  const r1 = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    redirect: 'follow',
    signal: AbortSignal.timeout(6000),
  });
  const rawCookies = r1.headers.get('set-cookie') || '';
  const cookie = rawCookies.split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
  const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookie },
    signal: AbortSignal.timeout(6000),
  });
  const crumb = await r2.text();
  if (!crumb || crumb.includes('<')) throw new Error('crumb failed');
  _crumb = crumb.trim();
  _cookie = cookie;
  _crumbTs = Date.now();
  return { crumb: _crumb, cookie: _cookie };
}

async function fetchNaverKR(ticker6, stateKR) {
  try {
    const url = `https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${ticker6}&_=${Date.now()}`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.naver.com/', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const d = await r.json();
      const item = d?.result?.areas?.[0]?.datas?.[0];
      if (item?.nv) {
        const price = parseFloat(item.nv);
        const sign  = String(item.rf) === '5' ? -1 : 1;
        const chgPct = sign * parseFloat(item.cr || 0);
        const chgAmt = sign * Math.round(parseFloat(item.cv || 0));
        if (price > 0) return { price, regularPrice: price, closePrice: price,
          changePercent: chgPct, changeAmount: chgAmt,
          regularChangePercent: chgPct, regularChangeAmount: chgAmt,
          currency: 'KRW', marketState: stateKR };
      }
    }
  } catch {}
  try {
    const r = await fetch(`https://m.stock.naver.com/api/stock/${ticker6}/basic`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)', 'Referer': 'https://m.stock.naver.com/' },
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const d = await r.json();
      const price  = parseFloat((d.closePrice || '').replace(/,/g, '') || 0);
      const chgAmt = parseFloat((d.compareToPreviousClosePrice || '').replace(/[+,]/g, '') || 0);
      const chgPct = parseFloat(d.fluctuationsRatio || 0);
      if (price > 0) return { price, regularPrice: price, closePrice: price,
        changePercent: chgPct, changeAmount: Math.round(chgAmt),
        regularChangePercent: chgPct, regularChangeAmount: Math.round(chgAmt),
        currency: 'KRW', marketState: stateKR };
    }
  } catch {}
  return null;
}

async function fetchYahooChart(sym, crumb, cookie) {
  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&range=1d&includePrePost=true${crumb ? `&crumb=${encodeURIComponent(crumb)}` : ''}`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com', ...(cookie ? { 'Cookie': cookie } : {}) },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const d = await r.json();
      const result = d?.chart?.result?.[0];
      const meta   = result?.meta;
      if (!meta?.regularMarketPrice) continue;

      const regularPrice = meta.regularMarketPrice;
      const prevClose    = meta.previousClose || meta.chartPreviousClose || regularPrice;
      const timestamps   = result.timestamp || [];
      const closes       = result.indicators?.quote?.[0]?.close || [];

      let lastPrice = regularPrice, lastTs = 0;
      for (let i = closes.length - 1; i >= 0; i--) {
        if (closes[i] != null) { lastPrice = closes[i]; lastTs = (timestamps[i] || 0) * 1000; break; }
      }

      // 2분 이내 봉이면 실시간에 가까운 가격 사용
      const nowMs = Date.now();
      const useLastBar = lastTs > nowMs - 120000;
      const displayPrice = useLastBar ? lastPrice : regularPrice;
      const displayChg   = prevClose > 0 ? ((displayPrice - prevClose) / prevClose) * 100 : 0;
      const displayAmt   = displayPrice - prevClose;
      const regChg = prevClose > 0 ? ((regularPrice - prevClose) / prevClose) * 100 : 0;

      // ET 기준 장 상태
      const isDST = (() => { const n=new Date(),j=new Date(n.getFullYear(),0,1),ul=new Date(n.getFullYear(),6,1); return n.getTimezoneOffset() < Math.max(j.getTimezoneOffset(),ul.getTimezoneOffset()); })();
      const etOffMs = isDST ? 4*3600000 : 5*3600000;
      const etNow = new Date(nowMs - etOffMs);
      const etM = etNow.getUTCHours()*60+etNow.getUTCMinutes();
      const etDow = etNow.getUTCDay();
      const isWE = etDow===0||etDow===6;
      const stateUS = (!isWE&&etM>=9*60+30&&etM<16*60)?'REGULAR':(!isWE&&etM>=4*60&&etM<9*60+30)?'PRE':(!isWE&&etM>=16*60&&etM<20*60)?'POST':'CLOSED';

      return { price: displayPrice, regularPrice, changePercent: displayChg, changeAmount: displayAmt, regularChangePercent: regChg, regularChangeAmount: regularPrice - prevClose, currency: meta.currency || 'USD', marketState: stateUS };
    } catch { continue; }
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { symbols } = req.query;
  if (!symbols) { res.status(400).json({ error: 'symbols required' }); return; }
  const symList = symbols.split(',').map(s => s.trim()).filter(Boolean);
  const results = {};

  let crumb = '', cookie = '';
  try { ({ crumb, cookie } = await getYahooCrumb()); } catch {}

  const nowKST = new Date(Date.now() + 9*3600000);
  const kstM = nowKST.getUTCHours()*60+nowKST.getUTCMinutes();
  const kstDow = nowKST.getUTCDay();
  const isWKR = kstDow===0||kstDow===6;
  const stateKR = (!isWKR&&kstM>=8*60&&kstM<9*60)?'PRE':(!isWKR&&kstM>=9*60&&kstM<15*60+30)?'REGULAR':(!isWKR&&kstM>=15*60+30&&kstM<20*60)?'POST':'CLOSED';

  const chunkSize = 8;
  for (let ci = 0; ci < symList.length; ci += chunkSize) {
    const chunk = symList.slice(ci, ci + chunkSize);
    await Promise.all(chunk.map(async (sym) => {
      const isKR = sym.endsWith('.KS') || sym.endsWith('.KQ');
      if (isKR) {
        const ticker6 = sym.replace('.KS','').replace('.KQ','').padStart(6,'0');
        const naver = await fetchNaverKR(ticker6, stateKR);
        if (naver) { results[sym] = naver; return; }
        const chart = await fetchYahooChart(sym, crumb, cookie);
        if (chart) { results[sym] = {...chart, currency:'KRW', marketState:stateKR}; }
        return;
      }
      // US/해외: v8/chart 우선 (실시간에 가까움)
      const chart = await fetchYahooChart(sym, crumb, cookie);
      if (chart) { results[sym] = chart; return; }
      // fallback: v7/quote
      try {
        const fields = 'regularMarketPrice,regularMarketPreviousClose,regularMarketChangePercent,regularMarketChange,preMarketPrice,preMarketChangePercent,preMarketChange,postMarketPrice,postMarketChangePercent,postMarketChange,currency,marketState';
        const r = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(sym)}&fields=${fields}&crumb=${encodeURIComponent(crumb)}`, {
          headers: { 'User-Agent': 'Mozilla/5.0', ...(cookie?{'Cookie':cookie}:{}) },
          signal: AbortSignal.timeout(6000),
        });
        if (!r.ok) return;
        const d = await r.json();
        const q = d?.quoteResponse?.result?.[0];
        if (!q) return;
        const reg=q.regularMarketPrice||0, pre=q.preMarketPrice, post=q.postMarketPrice;
        const state=q.marketState||'CLOSED';
        const price=state==='PRE'&&pre?pre:state==='POST'&&post?post:reg;
        const chgPct=state==='PRE'&&q.preMarketChangePercent!=null?q.preMarketChangePercent:state==='POST'&&q.postMarketChangePercent!=null?q.postMarketChangePercent:q.regularMarketChangePercent||0;
        const chgAmt=state==='PRE'&&q.preMarketChange!=null?q.preMarketChange:state==='POST'&&q.postMarketChange!=null?q.postMarketChange:q.regularMarketChange||0;
        results[sym]={price,regularPrice:reg,changePercent:chgPct,changeAmount:chgAmt,regularChangePercent:q.regularMarketChangePercent||0,regularChangeAmount:q.regularMarketChange||0,currency:q.currency||'USD',marketState:state};
      } catch {}
    }));
  }

  const failed = symList.filter(s => !results[s]);
  if (failed.length) console.warn('[quote] failed:', failed.join(','));
  res.status(200).json(results);
}

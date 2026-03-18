// Vercel API Route: /api/quote
// Yahoo Finance 서버사이드 조회 (crumb 인증 포함)

let _crumb = null;
let _cookie = null;
let _crumbTs = 0;

async function getYahooCrumb() {
  // 30분마다 갱신
  if (_crumb && _cookie && Date.now() - _crumbTs < 1800000) {
    return { crumb: _crumb, cookie: _cookie };
  }
  // 1단계: 쿠키 획득
  const r1 = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    redirect: 'follow',
    signal: AbortSignal.timeout(5000),
  });
  const cookies = r1.headers.get('set-cookie') || '';
  const cookie = cookies.split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');

  // 2단계: crumb 획득
  const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Cookie': cookie,
    },
    signal: AbortSignal.timeout(5000),
  });
  const crumb = await r2.text();
  if (!crumb || crumb.includes('<')) throw new Error('crumb failed');

  _crumb = crumb.trim();
  _cookie = cookie;
  _crumbTs = Date.now();
  return { crumb: _crumb, cookie: _cookie };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { symbols } = req.query;
  if (!symbols) { res.status(400).json({ error: 'symbols required' }); return; }

  const symList = symbols.split(',').map(s => s.trim()).filter(Boolean);
  const results = {};

  const fields = [
    'regularMarketPrice','regularMarketPreviousClose','regularMarketChangePercent','regularMarketChange',
    'preMarketPrice','preMarketChangePercent','preMarketChange',
    'postMarketPrice','postMarketChangePercent','postMarketChange',
    'currency','marketState',
  ].join(',');

  // Yahoo crumb 인증
  let crumb = '', cookie = '';
  try {
    ({ crumb, cookie } = await getYahooCrumb());
  } catch {}

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Referer': 'https://finance.yahoo.com',
    'Cache-Control': 'no-cache',
    ...(cookie ? { 'Cookie': cookie } : {}),
  };

  const chunkSize = 10;
  for (let ci = 0; ci < symList.length; ci += chunkSize) {
    const chunk = symList.slice(ci, ci + chunkSize);
    await Promise.all(chunk.map(async (sym) => {
      const isKR = sym.endsWith('.KS') || sym.endsWith('.KQ');
      try {
        if (isKR) {
          // ── 국내주식: 네이버 모바일 API ──
          const ticker6 = sym.replace('.KS','').replace('.KQ','').padStart(6,'0');
          let krDone = false;

          try {
            const mr = await fetch(`https://m.stock.naver.com/api/stock/${ticker6}/basic`, {
              headers: { 'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15', 'Referer':'https://m.stock.naver.com/' },
              signal: AbortSignal.timeout(6000),
            });
            if (mr.ok) {
              const md = await mr.json();
              const price   = parseFloat((md.closePrice||'').replace(/,/g,'') || 0);
              const chgAmt  = parseFloat((md.compareToPreviousClosePrice||'').replace(/,/g,'') || 0);
              const chgPct  = parseFloat(md.fluctuationsRatio || 0);
              if (price > 0) {
                results[sym] = { price, changePercent: chgPct, changeAmount: Math.round(chgAmt), currency: 'KRW', marketState: 'REGULAR' };
                krDone = true;
              }
            }
          } catch {}

          if (!krDone) {
            try {
              const nr = await fetch(`https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${ticker6}`, {
                headers: { 'Referer':'https://finance.naver.com', 'User-Agent':'Mozilla/5.0' },
                signal: AbortSignal.timeout(6000),
              });
              if (nr.ok) {
                const nd = await nr.json();
                const item = nd?.result?.areas?.[0]?.datas?.[0];
                if (item?.nv) {
                  const price  = parseFloat(item.nv);
                  const sign   = String(item.rf) === '5' ? -1 : 1;
                  results[sym] = { price, changePercent: sign*parseFloat(item.cr||0), changeAmount: sign*Math.round(parseFloat(item.cv||0)), currency:'KRW', marketState:'REGULAR' };
                  krDone = true;
                }
              }
            } catch {}
          }

          if (!krDone) {
            const yr = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1m&range=1d`, { headers, signal: AbortSignal.timeout(8000) });
            if (yr.ok) {
              const yd = await yr.json();
              const m = yd?.chart?.result?.[0]?.meta;
              if (m?.regularMarketPrice) {
                const price = m.regularMarketPrice;
                const prev  = m.previousClose || m.chartPreviousClose || price;
                results[sym] = { price, changePercent: prev>0?((price-prev)/prev)*100:0, changeAmount: Math.round(price-prev), currency:'KRW', marketState:'REGULAR' };
              }
            }
          }

        } else {
          // ── 미국주식: Yahoo v7/quote + crumb ──
          let done = false;

          // 1순위: v7/quote with crumb (프리/애프터 포함)
          for (const host of ['query1','query2']) {
            if (done) break;
            try {
              const crumbParam = crumb ? `&crumb=${encodeURIComponent(crumb)}` : '';
              const url = `https://${host}.finance.yahoo.com/v7/finance/quote?symbols=${sym}&fields=${fields}${crumbParam}`;
              const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
              if (!r.ok) continue;
              const d = await r.json();
              const q = d?.quoteResponse?.result?.[0];
              if (!q?.regularMarketPrice) continue;

              const price = q.regularMarketPrice;
              const prev  = q.regularMarketPreviousClose || price;
              const state = q.marketState || 'REGULAR';
              const dPrice = state==='PRE'  && q.preMarketPrice  ? q.preMarketPrice
                           : state==='POST' && q.postMarketPrice ? q.postMarketPrice : price;
              const dChg   = state==='PRE'  && q.preMarketPrice
                           ? (q.preMarketChangePercent  ?? ((q.preMarketPrice -prev)/prev*100))
                           : state==='POST' && q.postMarketPrice
                           ? (q.postMarketChangePercent ?? ((q.postMarketPrice-prev)/prev*100))
                           : (q.regularMarketChangePercent ?? ((price-prev)/prev*100));
              const dAmt   = state==='PRE'  && q.preMarketChange  ? q.preMarketChange
                           : state==='POST' && q.postMarketChange ? q.postMarketChange
                           : (q.regularMarketChange ?? 0);

              results[sym] = {
                price: dPrice, regularPrice: price,
                changePercent: dChg, changeAmount: Math.round(dAmt*100)/100,
                regularChangePercent: q.regularMarketChangePercent ?? ((price-prev)/prev*100),
                regularChangeAmount: q.regularMarketChange ?? 0,
                preMarketPrice: q.preMarketPrice ?? null,
                preMarketChangePercent: q.preMarketChangePercent ?? null,
                preMarketChange: q.preMarketChange ?? null,
                postMarketPrice: q.postMarketPrice ?? null,
                postMarketChangePercent: q.postMarketChangePercent ?? null,
                postMarketChange: q.postMarketChange ?? null,
                currency: q.currency||'USD', marketState: state, closePrice: price,
              };
              done = true;
            } catch { continue; }
          }

          // 2순위: v8/chart includePrePost fallback
          if (!done) {
            try {
              const url2 = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1m&range=1d&includePrePost=true`;
              const r2 = await fetch(url2, { headers, signal: AbortSignal.timeout(8000) });
              if (r2.ok) {
                const d2 = await r2.json();
                const result = d2?.chart?.result?.[0];
                const m = result?.meta;
                if (m?.regularMarketPrice) {
                  const regularPrice = m.regularMarketPrice;
                  const prevClose    = m.previousClose || m.chartPreviousClose || regularPrice;
                  const timestamps   = result.timestamp || [];
                  const closes       = result.indicators?.quote?.[0]?.close || [];
                  let lastPrice = regularPrice, lastTs = 0;
                  for (let i = closes.length-1; i >= 0; i--) {
                    if (closes[i] != null) { lastPrice = closes[i]; lastTs = timestamps[i]*1000; break; }
                  }
                  const nowNY = new Date(Date.now() - 4*3600000);
                  const nyM = nowNY.getUTCHours()*60+nowNY.getUTCMinutes();
                  const isPre  = nyM >= 4*60   && nyM < 9*60+30;
                  const isPost = nyM >= 16*60  && nyM < 20*60;
                  const state  = isPre?'PRE':isPost?'POST':nyM>=9*60+30&&nyM<16*60?'REGULAR':'CLOSED';
                  const dispPrice = (isPre||isPost)&&lastTs>Date.now()-3600000 ? lastPrice : regularPrice;
                  const dChg  = prevClose>0?((dispPrice-prevClose)/prevClose)*100:0;
                  results[sym] = {
                    price: dispPrice, regularPrice, closePrice: regularPrice,
                    changePercent: dChg, changeAmount: Math.round((dispPrice-prevClose)*100)/100,
                    regularChangePercent: prevClose>0?((regularPrice-prevClose)/prevClose)*100:0,
                    regularChangeAmount: Math.round((regularPrice-prevClose)*100)/100,
                    preMarketPrice: isPre?dispPrice:null,
                    preMarketChangePercent: isPre?dChg:null,
                    postMarketPrice: isPost?dispPrice:null,
                    postMarketChangePercent: isPost?dChg:null,
                    currency: m.currency||'USD', marketState: state,
                  };
                }
              }
            } catch {}
          }
        }
      } catch {}
    }));
    if (ci + chunkSize < symList.length) await new Promise(r => setTimeout(r, 50));
  }

  res.status(200).json({ results, ts: Date.now() });
}

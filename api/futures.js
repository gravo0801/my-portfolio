// Vercel API Route: /api/futures
// 코스피200 야간선물 시세 - 다중 소스

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Referer': 'https://finance.naver.com',
  };

  const _now = new Date();
  const m = _now.getMonth() + 1;
  const d = _now.getDate();
  let expM;
  if ((m===3&&d>15)||m===4||m===5||(m===6&&d<=15)) expM='06';
  else if ((m===6&&d>15)||m===7||m===8||(m===9&&d<=15)) expM='09';
  else if ((m===9&&d>15)||m===10||m===11||(m===12&&d<=15)) expM='12';
  else expM='03';
  const futureCode = `101S${expM}`;

  // 1순위: 네이버 polling API
  try {
    const r = await fetch(`https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${futureCode}`, {
      headers, signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const d = await r.json();
      const item = d?.result?.areas?.[0]?.datas?.[0];
      if (item?.nv) {
        const price = parseFloat(item.nv);
        if (price > 100 && price < 1000) {
          const sign = String(item.rf) === '5' ? -1 : 1;
          return res.status(200).json({
            price, chg: sign * parseFloat(item.cr||0),
            chgAmt: sign * parseFloat(item.cv||0),
            label: '코스피200 야간선물', source: 'naver', ts: Date.now(),
          });
        }
      }
    }
  } catch {}

  // 2순위: 네이버 모바일 API (다른 엔드포인트)
  try {
    const r = await fetch(`https://m.stock.naver.com/api/stock/${futureCode}/basic`, {
      headers: { ...headers, 'Referer': 'https://m.stock.naver.com/' },
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const d = await r.json();
      const price = parseFloat((d.closePrice||'').replace(/,/g,'') || 0);
      if (price > 100 && price < 1000) {
        const chgAmt = parseFloat((d.compareToPreviousClosePrice||'').replace(/,/g,'') || 0);
        const chgPct = parseFloat(d.fluctuationsRatio || 0);
        return res.status(200).json({
          price, chg: chgPct, chgAmt,
          label: '코스피200 야간선물', source: 'naver_m', ts: Date.now(),
        });
      }
    }
  } catch {}

  // 3순위: Yahoo Finance KM=F (코스피200 선물 CME)
  try {
    const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/KM%3DF?interval=1m&range=1d', {
      headers: { ...headers, 'Referer': 'https://finance.yahoo.com' },
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const d = await r.json();
      const meta = d?.chart?.result?.[0]?.meta;
      if (meta?.regularMarketPrice) {
        const price = meta.regularMarketPrice;
        const prev  = meta.previousClose || meta.chartPreviousClose || price;
        if (price > 100 && price < 1000) {
          return res.status(200).json({
            price: Math.round(price*100)/100,
            chg: Math.round(((price-prev)/prev)*10000)/100,
            chgAmt: Math.round((price-prev)*100)/100,
            label: '코스피200 선물', source: 'yahoo_kmf', ts: Date.now(),
          });
        }
      }
    }
  } catch {}

  // 4순위: Yahoo ^KS200 (코스피200 지수)
  try {
    const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5EKS200?interval=1d&range=1d', {
      headers: { ...headers, 'Referer': 'https://finance.yahoo.com' },
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const d = await r.json();
      const meta = d?.chart?.result?.[0]?.meta;
      if (meta?.regularMarketPrice) {
        const price = meta.regularMarketPrice;
        const prev  = meta.previousClose || meta.chartPreviousClose || price;
        if (price > 100 && price < 700) {
          return res.status(200).json({
            price: Math.round(price*100)/100,
            chg: Math.round(((price-prev)/prev)*10000)/100,
            chgAmt: Math.round((price-prev)*100)/100,
            label: '코스피200', source: 'yahoo_ks200', ts: Date.now(),
          });
        }
      }
    }
  } catch {}

  res.status(200).json({ price: null, chg: 0, chgAmt: 0, label: '', ts: Date.now() });
}

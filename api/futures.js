// Vercel API Route: /api/futures
// 코스피200 야간선물 시세

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Referer': 'https://finance.yahoo.com',
    'Cache-Control': 'no-cache',
  };

  // 1순위: 네이버 polling API
  try {
    const m = new Date().getMonth() + 1;
    const futureCode = `101S${m <= 3 ? '03' : m <= 6 ? '06' : m <= 9 ? '09' : '12'}`;
    const naverUrl = `https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${futureCode}`;
    const r = await fetch(naverUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.naver.com', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const d = await r.json();
      const item = d?.result?.areas?.[0]?.datas?.[0];
      if (item?.nv) {
        const price = parseFloat(item.nv);
        const sign  = String(item.rf) === '5' ? -1 : 1;
        return res.status(200).json({
          price, chg: sign * parseFloat(item.cr || 0),
          chgAmt: sign * parseFloat(item.cv || 0),
          label: '코스피200 야간선물', source: 'naver', ts: Date.now(),
        });
      }
    }
  } catch {}

  // 2순위: Yahoo Finance ^KS200 (코스피200 지수)
  try {
    const symbols = ['^KS200', 'KM%3DF'];
    for (const sym of symbols) {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1m&range=1d`;
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const d = await r.json();
      const m = d?.chart?.result?.[0]?.meta;
      if (m?.regularMarketPrice) {
        const price = m.regularMarketPrice;
        const prev  = m.previousClose || m.chartPreviousClose || price;
        const chg   = prev > 0 ? ((price - prev) / prev) * 100 : 0;
        const chgAmt = price - prev;
        return res.status(200).json({
          price: Math.round(price * 100) / 100,
          chg: Math.round(chg * 100) / 100,
          chgAmt: Math.round(chgAmt * 100) / 100,
          label: '코스피200', source: 'yahoo', ts: Date.now(),
        });
      }
    }
  } catch {}

  res.status(200).json({ price: null, chg: 0, chgAmt: 0, label: '코스피200 선물', ts: Date.now() });
}

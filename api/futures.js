// Vercel API Route: /api/futures
// 코스피200 야간선물 시세

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // 1순위: 네이버 polling API (야간선물 실제 데이터)
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
        // 코스피200 선물은 200~500 범위여야 정상
        if (price > 100 && price < 1000) {
          const sign = String(item.rf) === '5' ? -1 : 1;
          return res.status(200).json({
            price, chg: sign * parseFloat(item.cr || 0),
            chgAmt: sign * parseFloat(item.cv || 0),
            label: '코스피200 야간선물', source: 'naver', ts: Date.now(),
          });
        }
      }
    }
  } catch {}

  // 2순위: Yahoo ^KS200 (코스피200 지수 - 정규장 종가)
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Referer': 'https://finance.yahoo.com',
    };
    const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5EKS200?interval=1d&range=1d', {
      headers, signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const d = await r.json();
      const m = d?.chart?.result?.[0]?.meta;
      if (m?.regularMarketPrice) {
        const price = m.regularMarketPrice;
        const prev  = m.previousClose || m.chartPreviousClose || price;
        // 코스피200 지수는 200~600 범위
        if (price > 100 && price < 800) {
          const chg    = prev > 0 ? ((price - prev) / prev) * 100 : 0;
          const chgAmt = Math.round((price - prev) * 100) / 100;
          return res.status(200).json({
            price: Math.round(price * 100) / 100,
            chg: Math.round(chg * 100) / 100,
            chgAmt,
            label: '코스피200', source: 'yahoo', ts: Date.now(),
          });
        }
      }
    }
  } catch {}

  // 데이터 없음 → null 반환 (표시 안 함)
  res.status(200).json({ price: null, chg: 0, chgAmt: 0, label: '', ts: Date.now() });
}

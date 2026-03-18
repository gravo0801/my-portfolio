// Vercel API Route: /api/history
// Yahoo Finance 주가 차트 데이터 (서버사이드, CORS 없음)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { symbol, range = '3mo', interval = '1d' } = req.query;
  if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Referer': 'https://finance.yahoo.com',
    'Cache-Control': 'no-cache',
  };

  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`;
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      if (!r.ok) continue;

      const d = await r.json();
      const result = d?.chart?.result?.[0];
      if (!result?.timestamp?.length) continue;

      const timestamps = result.timestamp;
      const closes = result.indicators?.quote?.[0]?.close || [];

      const data = timestamps.map((ts, i) => ({
        date: new Date(ts * 1000).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }),
        price: closes[i] ? Math.round(closes[i] * 100) / 100 : null,
      })).filter(d => d.price !== null);

      if (data.length < 2) continue;

      return res.status(200).json({ data, symbol, range, ts: Date.now() });
    } catch { continue; }
  }

  res.status(502).json({ error: 'Failed to fetch chart data', data: [] });
}


// Vercel API Route: /api/rates
// Yahoo Finance FX 실시간 환율 (서버사이드, 캐시 없음)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const symbols = ['KRW=X','JPY=X','EURUSD=X','CNY=X','GBPUSD=X','AUDUSD=X','SGD=X','HKD=X','CHF=X','CAD=X'];
  const fields  = 'regularMarketPrice,currency';
  const url     = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(',')}&fields=${fields}`;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Referer': 'https://finance.yahoo.com',
    'Cache-Control': 'no-cache',
  };

  try {
    // query1 시도
    let quotes = null;
    for (const host of ['query1', 'query2']) {
      try {
        const r = await fetch(url.replace('query1', host), { headers, signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        const d = await r.json();
        quotes = d?.quoteResponse?.result;
        if (quotes?.length) break;
      } catch {}
    }

    if (!quotes?.length) throw new Error('No quotes');

    const rates = {};
    quotes.forEach(q => {
      const p = q.regularMarketPrice;
      if (!p) return;
      if (q.symbol === 'KRW=X')    rates.KRW = Math.round(p);
      if (q.symbol === 'JPY=X')    rates.JPY = Math.round(p * 10) / 10;
      if (q.symbol === 'EURUSD=X') rates.EUR = p > 0 ? Math.round(10000/p)/10000 : null;
      if (q.symbol === 'CNY=X')    rates.CNY = Math.round(p * 1000) / 1000;
      if (q.symbol === 'GBPUSD=X') rates.GBP = p > 0 ? Math.round(10000/p)/10000 : null;
      if (q.symbol === 'AUDUSD=X') rates.AUD = p > 0 ? Math.round(10000/p)/10000 : null;
      if (q.symbol === 'SGD=X')    rates.SGD = Math.round(p * 1000) / 1000;
      if (q.symbol === 'HKD=X')    rates.HKD = Math.round(p * 100) / 100;
      if (q.symbol === 'CHF=X')    rates.CHF = Math.round(p * 1000) / 1000;
      if (q.symbol === 'CAD=X')    rates.CAD = Math.round(p * 1000) / 1000;
    });

    if (!rates.KRW || rates.KRW < 900) throw new Error('Invalid KRW rate');

    res.status(200).json({ rates, ts: Date.now(), source: 'yahoo' });

  } catch (e) {
    // Fallback: open.er-api.com (일일 기준)
    try {
      const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(6000) });
      const d = await r.json();
      if (d?.rates?.KRW > 900) {
        return res.status(200).json({ rates: d.rates, ts: Date.now(), source: 'er-api' });
      }
    } catch {}

    res.status(502).json({ error: e.message });
  }
}

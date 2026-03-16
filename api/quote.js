
// Vercel API Route: /api/quote
// 서버사이드에서 Yahoo Finance 직접 조회 (CORS/캐시 문제 없음)

export default async function handler(req, res) {
  // CORS 헤더
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { symbols, type = 'quote' } = req.query;
  if (!symbols) { res.status(400).json({ error: 'symbols required' }); return; }

  const fields = [
    'regularMarketPrice', 'regularMarketPreviousClose', 'regularMarketChangePercent',
    'preMarketPrice', 'preMarketChangePercent',
    'postMarketPrice', 'postMarketChangePercent',
    'currency', 'marketState'
  ].join(',');

  const symList = symbols.split(',').map(s => s.trim()).filter(Boolean);
  const results = {};

  await Promise.all(symList.map(async (sym) => {
    const isKR = sym.endsWith('.KS') || sym.endsWith('.KQ');
    try {
      if (isKR) {
        // 국내주식: v8/chart
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`;
        const r = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Referer': 'https://finance.yahoo.com',
          },
          signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) return;
        const d = await r.json();
        const m = d?.chart?.result?.[0]?.meta;
        if (!m?.regularMarketPrice) return;
        const price = m.regularMarketPrice;
        const prev  = m.previousClose || m.chartPreviousClose || price;
        results[sym] = {
          price,
          changePercent: prev > 0 ? ((price - prev) / prev) * 100 : 0,
          currency: m.currency || 'KRW',
          marketState: 'REGULAR',
        };
      } else {
        // 미국주식/ETF: v7/quote (프리/애프터 포함)
        const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${sym}&fields=${fields}`;
        const r = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Referer': 'https://finance.yahoo.com',
          },
          signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) return;
        const d = await r.json();
        const q = d?.quoteResponse?.result?.[0];
        if (!q?.regularMarketPrice) return;

        const price  = q.regularMarketPrice;
        const prev   = q.regularMarketPreviousClose || price;
        const state  = q.marketState || 'REGULAR';

        const displayPrice = state === 'PRE'  && q.preMarketPrice  ? q.preMarketPrice
                           : state === 'POST' && q.postMarketPrice ? q.postMarketPrice
                           : price;
        const displayChg   = state === 'PRE'  && q.preMarketPrice
                           ? (q.preMarketChangePercent  ?? ((q.preMarketPrice  - prev) / prev * 100))
                           : state === 'POST' && q.postMarketPrice
                           ? (q.postMarketChangePercent ?? ((q.postMarketPrice - prev) / prev * 100))
                           : (q.regularMarketChangePercent ?? ((price - prev) / prev * 100));

        results[sym] = {
          price: displayPrice,
          regularPrice: price,
          changePercent: displayChg,
          currency: q.currency || 'USD',
          marketState: state,
        };
      }
    } catch { /* 개별 종목 실패 시 스킵 */ }
  }));

  res.status(200).json({ results, ts: Date.now() });
}

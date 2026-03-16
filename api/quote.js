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

  // 병렬 요청 시 Yahoo rate limit 방지: 10개씩 나눠서 처리
  const chunkSize = 10;
  for (let i = 0; i < symList.length; i += chunkSize) {
    const chunk = symList.slice(i, i + chunkSize);
    await Promise.all(chunk.map(async (sym) => {
    const isKR = sym.endsWith('.KS') || sym.endsWith('.KQ');
    try {
      if (isKR) {
        // 국내주식: v8/chart (1m interval로 프리/애프터 포함 실시간)
        const headers = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
          'Referer': 'https://finance.yahoo.com',
        };
        // 1m interval: 프리/정규/애프터 모두 최신 가격
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1m&range=1d`;
        const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
        if (!r.ok) return;
        const d = await r.json();
        const m = d?.chart?.result?.[0]?.meta;
        if (!m?.regularMarketPrice) return;
        const price = m.regularMarketPrice;
        const prev  = m.previousClose || m.chartPreviousClose || price;
        const chg   = prev > 0 ? ((price - prev) / prev) * 100 : 0;
        results[sym] = {
          price,
          changePercent: chg,
          currency: m.currency || 'KRW',
          marketState: m.currentTradingPeriod ? 'REGULAR' : 'REGULAR',
        };
      } else {
        // 미국주식/ETF: v7/quote 시도 → 실패시 v8/chart fallback
        const headers = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Referer': 'https://finance.yahoo.com',
          'Cache-Control': 'no-cache',
        };

        // 1차: v7/quote
        let resolved = false;
        try {
          const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${sym}&fields=${fields}`;
          const url_q2 = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${sym}&fields=${fields}`;
          const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
          if (r.ok) {
            const d = await r.json();
            const q = d?.quoteResponse?.result?.[0];
            if (q?.regularMarketPrice) {
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
              results[sym] = { price: displayPrice, regularPrice: price, changePercent: displayChg, currency: q.currency || 'USD', marketState: state };
              resolved = true;
            }
          }
        } catch {}

        // 2차: v8/chart fallback (v7 실패 또는 빈 결과)
        if (!resolved) {
          try {
            const url2 = `https://query2.finance.yahoo.com/v8/finance/chart/${sym}?interval=1m&range=1d`;
            const r2 = await fetch(url2, { headers, signal: AbortSignal.timeout(8000) });
            if (r2.ok) {
              const d2 = await r2.json();
              const m = d2?.chart?.result?.[0]?.meta;
              if (m?.regularMarketPrice) {
                const price = m.regularMarketPrice;
                const prev  = m.previousClose || m.chartPreviousClose || price;
                results[sym] = { price, changePercent: prev > 0 ? ((price - prev) / prev) * 100 : 0, currency: m.currency || 'USD', marketState: 'REGULAR' };
              }
            }
          } catch {}
        }
      }
    } catch { /* 개별 종목 실패 시 스킵 */ }
    }));
    // 청크 간 50ms 대기 (rate limit 방지)
    if (i + chunkSize < symList.length) {
      await new Promise(r => setTimeout(r, 50));
    }
  }

  res.status(200).json({ results, ts: Date.now() });
}

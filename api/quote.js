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
        // 국내주식: 네이버증권 API (NXT 20시까지 포함) → Yahoo fallback
        const ticker6 = sym.replace('.KS','').replace('.KQ','').padStart(6,'0');
        const naverUrl = `https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${ticker6}`;
        let krResolved = false;

        try {
          const nr = await fetch(naverUrl, {
            headers: { 'Referer': 'https://finance.naver.com', 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(6000),
          });
          if (nr.ok) {
            const nd = await nr.json();
            // 네이버 응답 구조: result.areas[0].datas[0]
            const item = nd?.result?.areas?.[0]?.datas?.[0];
            if (item) {
              const price = parseFloat(item.nv || item.sv || 0);  // nv=현재가, sv=전일종가
              const prev  = parseFloat(item.sv || price);
              // rf: 2=상승, 5=하락, cr=등락률(부호 없음)
              const crAbs = parseFloat(item.cr || 0);
              const rf    = String(item.rf || '');
              const chg   = rf === '5' ? -crAbs : crAbs;
              if (price > 0) {
                results[sym] = { price, changePercent: chg, currency: 'KRW', marketState: 'REGULAR' };
                krResolved = true;
              }
            }
          }
        } catch {}

        // Fallback: Yahoo v8/chart (interval=1m)
        if (!krResolved) {
          try {
            const yUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1m&range=1d`;
            const yr = await fetch(yUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Referer': 'https://finance.yahoo.com',
              },
              signal: AbortSignal.timeout(8000),
            });
            if (yr.ok) {
              const yd = await yr.json();
              const m  = yd?.chart?.result?.[0]?.meta;
              if (m?.regularMarketPrice) {
                const price = m.regularMarketPrice;
                const prev  = m.previousClose || m.chartPreviousClose || price;
                results[sym] = {
                  price,
                  changePercent: prev > 0 ? ((price-prev)/prev)*100 : 0,
                  currency: 'KRW',
                  marketState: 'REGULAR',
                };
              }
            }
          } catch {}
        }
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

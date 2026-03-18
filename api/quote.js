// Vercel API Route: /api/quote
// ?쒕쾭?ъ씠?쒖뿉??Yahoo Finance 吏곸젒 議고쉶 (CORS/罹먯떆 臾몄젣 ?놁쓬)

export default async function handler(req, res) {
  // CORS ?ㅻ뜑
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { symbols, type = 'quote' } = req.query;
  if (!symbols) { res.status(400).json({ error: 'symbols required' }); return; }

  const fields = [
    'regularMarketPrice', 'regularMarketPreviousClose', 'regularMarketChangePercent',
    'regularMarketChange',
    'preMarketPrice', 'preMarketChangePercent', 'preMarketChange',
    'postMarketPrice', 'postMarketChangePercent', 'postMarketChange',
    'currency', 'marketState'
  ].join(',');

  const symList = symbols.split(',').map(s => s.trim()).filter(Boolean);
  const results = {};

  // 蹂묐젹 ?붿껌 ??Yahoo rate limit 諛⑹?: 10媛쒖뵫 ?섎닠??泥섎━
  const chunkSize = 10;
  for (let i = 0; i < symList.length; i += chunkSize) {
    const chunk = symList.slice(i, i + chunkSize);
    await Promise.all(chunk.map(async (sym) => {
    const isKR = sym.endsWith('.KS') || sym.endsWith('.KQ');
    try {
      if (isKR) {
        // 援?궡二쇱떇: ?ㅼ쨷 ?뚯뒪 (?숈떆?멸?/NXT ?ы븿)
        const ticker6 = sym.replace('.KS','').replace('.KQ','').padStart(6,'0');
        let krResolved = false;

        // ?? 1?쒖쐞: ?ㅼ씠踰?紐⑤컮??API (?숈떆?멸? ?덉긽泥닿껐媛 ?ы븿) ??
        try {
          const mobileUrl = `https://m.stock.naver.com/api/stock/${ticker6}/basic`;
          const mr = await fetch(mobileUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
              'Referer': 'https://m.stock.naver.com/',
              'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(6000),
          });
          if (mr.ok) {
            const md = await mr.json();
            // stockEndType: 0=?μ쨷, 1=?ν썑, 2=?숈떆?멸?, 4=?μ쟾, 5=?쒓컙??            // closePrice = ?꾩옱媛/?덉긽泥닿껐媛, compareToPreviousClosePrice = ?깅씫??            const price = parseFloat(md.closePrice?.replace(/,/g,'') || 0);
            const chgAmt = parseFloat(md.compareToPreviousClosePrice?.replace(/,/g,'') || 0);
            const chgPct = parseFloat(md.fluctuationsRatio || 0);
            if (price > 0) {
              results[sym] = {
                price,
                changePercent: chgPct,
                changeAmount: Math.round(chgAmt),
                currency: 'KRW',
                marketState: 'REGULAR',
              };
              krResolved = true;
            }
          }
        } catch {}

        // ?? 2?쒖쐞: ?ㅼ씠踰?polling API (NXT ?ы븿) ??
        if (!krResolved) {
          try {
            const naverUrl = `https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${ticker6}`;
            const nr = await fetch(naverUrl, {
              headers: { 'Referer': 'https://finance.naver.com', 'User-Agent': 'Mozilla/5.0' },
              signal: AbortSignal.timeout(6000),
            });
            if (nr.ok) {
              const nd = await nr.json();
              const item = nd?.result?.areas?.[0]?.datas?.[0];
              if (item) {
                const price  = parseFloat(item.nv || item.sv || 0);
                const rf     = String(item.rf || '');
                const sign   = rf === '5' ? -1 : 1;
                const chgPct = sign * parseFloat(item.cr || 0);
                const chgAmt = sign * Math.round(parseFloat(item.cv || 0));
                if (price > 0) {
                  results[sym] = { price, changePercent: chgPct, changeAmount: chgAmt, currency: 'KRW', marketState: 'REGULAR' };
                  krResolved = true;
                }
              }
            }
          } catch {}
        }

        // ?? 3?쒖쐞: Yahoo v8/chart (interval=1m) ??
        if (!krResolved) {
          try {
            const yUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1m&range=1d`;
            const yr = await fetch(yUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
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
        // 誘멸뎅二쇱떇/ETF: Finnhub(?꾨━/?좏봽?? + Yahoo(?뺢퇋?? ?쇳빀
        const FINNHUB_KEY = process.env.FINNHUB_KEY;
        const headers = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Referer': 'https://finance.yahoo.com',
          'Cache-Control': 'no-cache',
        };

        // ?꾩옱 ?쒖옣 ?곹깭 ?먮떒 (KST 湲곗?)
        const nowKST = new Date(Date.now() + 9*3600000);
        const kstMins = nowKST.getUTCHours()*60 + nowKST.getUTCMinutes();
        // DST 怨꾩궛 (3??2踰덉㎏ ?쇱슂??~ 11??1踰덉㎏ ?쇱슂??
        const yr = nowKST.getUTCFullYear();
        const dstS = new Date(Date.UTC(yr,2,1)); dstS.setUTCDate(1+(7-dstS.getUTCDay())%7+7); dstS.setUTCHours(7);
        const dstE = new Date(Date.UTC(yr,10,1)); dstE.setUTCDate(1+(7-dstE.getUTCDay())%7); dstE.setUTCHours(6);
        const isDST = Date.now() >= dstS.getTime() && Date.now() < dstE.getTime();
        const preStart = isDST ? 17*60 : 18*60;     // KST 17:00(EDT) / 18:00(EST)
        const regStart = isDST ? 22*60+30 : 23*60+30;
        const isPreOrAfter = (kstMins >= preStart && kstMins < regStart)
                          || (kstMins >= (isDST?5*60:6*60) && kstMins < (isDST?9*60:10*60));

        // ?? 1?쒖쐞: Finnhub (?꾨━/?좏봽?곕쭏耳??꾩슜 - ?ㅼ떆媛? ??
        let resolved = false;
        if (FINNHUB_KEY && isPreOrAfter) {
          try {
            const fUrl = `https://finnhub.io/api/v1/quote?symbol=${sym}&token=${FINNHUB_KEY}`;
            const fr = await fetch(fUrl, { signal: AbortSignal.timeout(6000) });
            if (fr.ok) {
              const fd = await fr.json();
              if (fd.c && fd.c > 0) {
                results[sym] = {
                  price: fd.c,
                  regularPrice: fd.pc || fd.c,
                  changePercent: fd.dp ?? 0,
                  changeAmount: fd.d ? Math.round(fd.d * 100) / 100 : 0,
                  currency: 'USD',
                  marketState: isPreOrAfter ? 'PRE' : 'REGULAR',
                };
                resolved = true;
              }
            }
          } catch {}
        }

        // ?? 2?쒖쐞: Yahoo v7/quote (query1 ??query2) ??
        const v7urls = [
          `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${sym}&fields=${fields}`,
          `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${sym}&fields=${fields}`,
        ];
        for (const v7url of v7urls) {
         if (resolved) break;
         try {
          const url = v7url;
          const url_q2 = v7url;
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
              // 蹂?숆툑??吏곸젒 ?ъ슜
              const displayAmt = state === 'PRE'  && q.preMarketChange  ? q.preMarketChange
                               : state === 'POST' && q.postMarketChange ? q.postMarketChange
                               : (q.regularMarketChange ?? 0);
              results[sym] = {
                price: displayPrice,           // ?꾩옱 ?쒖떆 媛寃?(?꾨━/?좏봽??醫낃?)
                regularPrice: price,           // ?뺢퇋??醫낃?
                changePercent: displayChg,     // ?쒖떆 ?깅씫瑜?(?꾩씪醫낃? ?鍮?
                changeAmount: Math.round(displayAmt * 100) / 100,
                currency: q.currency || 'USD',
                marketState: state,
                // ?λ쭏媛???醫낃? 紐낆떆 (罹먯떆 ?ㅼ뿼 諛⑹?)
                closePrice: price,
                closePct: q.regularMarketChangePercent ?? ((price - (q.regularMarketPreviousClose||price)) / (q.regularMarketPreviousClose||price) * 100),
              };
              resolved = true;
            }
          }
        } catch {}
        if (resolved) break;
        } // end for v7urls

        // 2李? v8/chart fallback (v7 ?꾩쟾 ?ㅽ뙣?쒕쭔 - pre/after ?곗씠???놁쓬 二쇱쓽)
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
    } catch { /* 媛쒕퀎 醫낅ぉ ?ㅽ뙣 ???ㅽ궢 */ }
    }));
    // 泥?겕 媛?50ms ?湲?(rate limit 諛⑹?)
    if (i + chunkSize < symList.length) {
      await new Promise(r => setTimeout(r, 50));
    }
  }

  res.status(200).json({ results, ts: Date.now() });
}

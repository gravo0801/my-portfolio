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
        // 誘멸뎅二쇱떇/ETF: Yahoo v7/quote (?꾨━/?좏봽???ы븿) ??v8/chart fallback
        const headers = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Referer': 'https://finance.yahoo.com',
          'Cache-Control': 'no-cache',
        };

        let resolved = false;

        // 1?쒖쐞: v8/chart includePrePost=true (?꾨━/?좏봽???ㅼ떆媛??ы븿)
        for (const host of ['query1', 'query2']) {
          if (resolved) break;
          try {
            const chartUrl = `https://${host}.finance.yahoo.com/v8/finance/chart/${sym}?interval=1m&range=1d&includePrePost=true`;
            const r = await fetch(chartUrl, { headers, signal: AbortSignal.timeout(8000) });
            if (!r.ok) continue;
            const d = await r.json();
            const result = d?.chart?.result?.[0];
            const meta   = result?.meta;
            if (!meta?.regularMarketPrice) continue;

            const regularPrice = meta.regularMarketPrice;
            const prevClose    = meta.previousClose || meta.chartPreviousClose || regularPrice;
            const timestamps   = result.timestamp || [];
            const closes       = result.indicators?.quote?.[0]?.close || [];

            // 留덉?留??좏슚 媛寃?(?꾨━/?좏봽???ы븿)
            let lastPrice = regularPrice;
            let lastTs = 0;
            for (let i = closes.length - 1; i >= 0; i--) {
              if (closes[i] != null) { lastPrice = closes[i]; lastTs = timestamps[i]*1000; break; }
            }

            // ?꾩옱 ?쒖옣 ?곹깭 ?먮떒
            const nowMs = Date.now();
            const nowNY = new Date(nowMs - 4*3600000); // EDT
            const nyMins = nowNY.getUTCHours()*60 + nowNY.getUTCMinutes();
            const isPre  = nyMins >= 4*60  && nyMins < 9*60+30;
            const isPost = nyMins >= 16*60 && nyMins < 20*60;
            const isReg  = nyMins >= 9*60+30 && nyMins < 16*60;
            const state  = isPre ? 'PRE' : isPost ? 'POST' : isReg ? 'REGULAR' : 'CLOSED';

            // ?쒖떆 媛寃?            const displayPrice = (isPre || isPost) && lastTs > 0 ? lastPrice : regularPrice;
            const displayChg   = prevClose > 0 ? ((displayPrice - prevClose) / prevClose) * 100 : 0;
            const displayAmt   = Math.round((displayPrice - prevClose) * 100) / 100;

            // ?뺢퇋???깅씫
            const regChg    = prevClose > 0 ? ((regularPrice - prevClose) / prevClose) * 100 : 0;
            const regChgAmt = Math.round((regularPrice - prevClose) * 100) / 100;

            results[sym] = {
              price: displayPrice,
              regularPrice,
              regularChangePercent: regChg,
              regularChangeAmount: regChgAmt,
              changePercent: displayChg,
              changeAmount: displayAmt,
              preMarketPrice:          isPre  ? displayPrice : null,
              preMarketChangePercent:  isPre  ? displayChg   : null,
              preMarketChange:         isPre  ? displayAmt   : null,
              postMarketPrice:         isPost ? displayPrice : null,
              postMarketChangePercent: isPost ? displayChg   : null,
              postMarketChange:        isPost ? displayAmt   : null,
              currency: meta.currency || 'USD',
              marketState: state,
              closePrice: regularPrice,
            };
            resolved = true;
          } catch { continue; }
        }

        // 2?쒖쐞: v7/quote fallback
        if (!resolved) {
          try {
            const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${sym}&fields=${fields}`;
            const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
            if (r.ok) {
              const d = await r.json();
              const q = d?.quoteResponse?.result?.[0];
              if (q?.regularMarketPrice) {
                const price = q.regularMarketPrice;
                const prev  = q.regularMarketPreviousClose || price;
                const state = q.marketState || 'REGULAR';
                const dPrice = state==='PRE' && q.preMarketPrice ? q.preMarketPrice
                             : state==='POST'&& q.postMarketPrice? q.postMarketPrice : price;
                const dChg = state==='PRE' && q.preMarketPrice
                           ? (q.preMarketChangePercent ?? ((q.preMarketPrice-prev)/prev*100))
                           : state==='POST'&& q.postMarketPrice
                           ? (q.postMarketChangePercent ?? ((q.postMarketPrice-prev)/prev*100))
                           : (q.regularMarketChangePercent ?? ((price-prev)/prev*100));
                results[sym] = {
                  price: dPrice, regularPrice: price,
                  changePercent: dChg,
                  changeAmount: Math.round((dPrice-prev)*100)/100,
                  preMarketPrice: q.preMarketPrice ?? null,
                  preMarketChangePercent: q.preMarketChangePercent ?? null,
                  postMarketPrice: q.postMarketPrice ?? null,
                  postMarketChangePercent: q.postMarketChangePercent ?? null,
                  currency: q.currency||'USD', marketState: state, closePrice: price,
                };
                resolved = true;
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

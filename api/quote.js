// Vercel API Route: /api/quote
// Yahoo Finance 서버사이드 조회 (crumb 인증 포함)

let _crumb = null;
let _cookie = null;
let _crumbTs = 0;

async function getYahooCrumb() {
  // 30분마다 갱신
  if (_crumb && _cookie && Date.now() - _crumbTs < 1800000) {
    return { crumb: _crumb, cookie: _cookie };
  }
  // 1단계: 쿠키 획득
  const r1 = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    redirect: 'follow',
    signal: AbortSignal.timeout(5000),
  });
  const cookies = r1.headers.get('set-cookie') || '';
  const cookie = cookies.split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');

  // 2단계: crumb 획득
  const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Cookie': cookie,
    },
    signal: AbortSignal.timeout(5000),
  });
  const crumb = await r2.text();
  if (!crumb || crumb.includes('<')) throw new Error('crumb failed');

  _crumb = crumb.trim();
  _cookie = cookie;
  _crumbTs = Date.now();
  return { crumb: _crumb, cookie: _cookie };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { symbols } = req.query;
  if (!symbols) { res.status(400).json({ error: 'symbols required' }); return; }

  const symList = symbols.split(',').map(s => s.trim()).filter(Boolean);
  const results = {};

  const fields = [
    'regularMarketPrice','regularMarketPreviousClose','regularMarketChangePercent','regularMarketChange',
    'preMarketPrice','preMarketChangePercent','preMarketChange',
    'postMarketPrice','postMarketChangePercent','postMarketChange',
    'currency','marketState',
  ].join(',');

  // Yahoo crumb 인증
  let crumb = '', cookie = '';
  try {
    ({ crumb, cookie } = await getYahooCrumb());
  } catch {}

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Referer': 'https://finance.yahoo.com',
    'Cache-Control': 'no-cache',
    ...(cookie ? { 'Cookie': cookie } : {}),
  };

  const chunkSize = 10;
  for (let ci = 0; ci < symList.length; ci += chunkSize) {
    const chunk = symList.slice(ci, ci + chunkSize);
    await Promise.all(chunk.map(async (sym) => {
      const isKR = sym.endsWith('.KS') || sym.endsWith('.KQ');
      try {
        if (isKR) {
        // 국내주식: Yahoo v8/chart + includePrePost=true
        // 프리장(08:00~09:00) / 정규장 / NXT애프터(15:30~20:00) 모두 커버
        let krDone = false;

        for (const host of ['query1', 'query2']) {
          if (krDone) break;
          try {
            const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${sym}?interval=1m&range=1d&includePrePost=true`;
            const r = await fetch(url, {
              headers: {
                ...headers,
                ...(cookie ? { 'Cookie': cookie } : {}),
              },
              signal: AbortSignal.timeout(8000),
            });
            if (!r.ok) continue;
            const d = await r.json();
            const result = d?.chart?.result?.[0];
            const meta   = result?.meta;
            if (!meta?.regularMarketPrice) continue;

            const regularPrice = meta.regularMarketPrice;
            const prevClose    = meta.previousClose || meta.chartPreviousClose || regularPrice;
            const timestamps   = result.timestamp || [];
            const closes       = result.indicators?.quote?.[0]?.close || [];

            // 현재 KST 시간 기반 장 상태
            const nowKST = new Date(Date.now() + 9 * 3600000);
            const kstM   = nowKST.getUTCHours() * 60 + nowKST.getUTCMinutes();
            const isPreKR  = kstM >= 8*60   && kstM < 9*60;
            const isRegKR  = kstM >= 9*60   && kstM < 15*60+30;
            const isPostKR = kstM >= 15*60+30 && kstM < 20*60;
            const stateKR  = isPreKR ? 'PRE' : isRegKR ? 'REGULAR' : isPostKR ? 'POST' : 'CLOSED';

            // 마지막 유효 가격 (프리/애프터 포함)
            let lastPrice = regularPrice;
            let lastTs    = 0;
            for (let i = closes.length - 1; i >= 0; i--) {
              if (closes[i] != null) {
                lastPrice = closes[i];
                lastTs    = (timestamps[i] || 0) * 1000;
                break;
              }
            }

            // 프리/애프터 시간이면 마지막 봉 가격 사용 (1시간 이내)
            const useExtended = (isPreKR || isPostKR) && lastTs > Date.now() - 3600000;
            const displayPrice = useExtended ? lastPrice : regularPrice;
            const displayChg   = prevClose > 0 ? ((displayPrice - prevClose) / prevClose) * 100 : 0;
            const displayAmt   = Math.round(displayPrice - prevClose);

            const regChg = prevClose > 0 ? ((regularPrice - prevClose) / prevClose) * 100 : 0;
            const regAmt = Math.round(regularPrice - prevClose);

            results[sym] = {
              price:   displayPrice,
              regularPrice, closePrice: regularPrice,
              changePercent: displayChg, changeAmount: displayAmt,
              regularChangePercent: regChg, regularChangeAmount: regAmt,
              currency: 'KRW', marketState: stateKR,
            };
            krDone = true;
          } catch { continue; }
        }

        } else {
          // ── 미국주식 / ETF / 암호화폐 ──
          // v7/quote: 프리·정규·애프터 가격 모두 한 번에 수신
          let usDone = false;
          for (const host of ['query1', 'query2']) {
            if (usDone) break;
            try {
              const url = `https://${host}.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(sym)}&fields=${fields}${crumb ? `&crumb=${encodeURIComponent(crumb)}` : ''}`;
              const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
              if (!r.ok) continue;
              const d = await r.json();
              const q = d?.quoteResponse?.result?.[0];
              if (!q?.regularMarketPrice) continue;

              const price    = q.regularMarketPrice;
              const prev     = q.regularMarketPreviousClose || price;
              const state    = q.marketState || 'REGULAR';
              const regChgPct = q.regularMarketChangePercent ?? ((price - prev) / prev * 100);
              const regChgAmt = q.regularMarketChange ?? (price - prev);

              // 프리/애프터 가격 우선 적용
              let displayPrice = price;
              let displayChgPct = regChgPct;
              let displayChgAmt = regChgAmt;
              if (state === 'PRE' && q.preMarketPrice) {
                displayPrice   = q.preMarketPrice;
                displayChgPct  = q.preMarketChangePercent ?? ((q.preMarketPrice - prev) / prev * 100);
                displayChgAmt  = q.preMarketChange ?? (q.preMarketPrice - prev);
              } else if (state === 'POST' && q.postMarketPrice) {
                displayPrice   = q.postMarketPrice;
                displayChgPct  = q.postMarketChangePercent ?? ((q.postMarketPrice - prev) / prev * 100);
                displayChgAmt  = q.postMarketChange ?? (q.postMarketPrice - prev);
              }

              results[sym] = {
                price: displayPrice,
                regularPrice: price,
                closePrice: price,
                changePercent: displayChgPct,
                changeAmount: Math.round(displayChgAmt * 100) / 100,
                regularChangePercent: regChgPct,
                regularChangeAmount: Math.round(regChgAmt * 100) / 100,
                currency: q.currency || 'USD',
                marketState: state,
                preMarketPrice: q.preMarketPrice ?? null,
                preMarketChange: q.preMarketChange ?? null,
                preMarketChangePercent: q.preMarketChangePercent ?? null,
                postMarketPrice: q.postMarketPrice ?? null,
                postMarketChange: q.postMarketChange ?? null,
                postMarketChangePercent: q.postMarketChangePercent ?? null,
              };
              usDone = true;
            } catch { continue; }
          }

          // v7 실패 시 v8/chart 폴백
          if (!usDone) {
            try {
              const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&range=1d&includePrePost=true${crumb ? `&crumb=${encodeURIComponent(crumb)}` : ''}`;
              const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
              if (r.ok) {
                const d = await r.json();
                const meta = d?.chart?.result?.[0]?.meta;
                if (meta?.regularMarketPrice) {
                  const price = meta.regularMarketPrice;
                  const prev  = meta.previousClose || meta.chartPreviousClose || price;
                  results[sym] = {
                    price, regularPrice: price, closePrice: price,
                    changePercent: prev > 0 ? ((price - prev) / prev * 100) : 0,
                    changeAmount: Math.round((price - prev) * 100) / 100,
                    regularChangePercent: prev > 0 ? ((price - prev) / prev * 100) : 0,
                    regularChangeAmount: Math.round((price - prev) * 100) / 100,
                    currency: meta.currency || 'USD',
                    marketState: 'REGULAR',
                  };
                }
              }
            } catch {}
          }
        }

      } catch (e) {
        console.error(`[quote] ${sym} error:`, e.message);
      }
    }));
  }

  res.status(200).json({ results, ts: Date.now() });
}

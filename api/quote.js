// Vercel API Route: /api/quote
// 국내주식: 네이버 실시간 API 1순위 (지연 없음)
// 해외주식: Yahoo Finance (crumb 인증)

let _crumb = null;
let _cookie = null;
let _crumbTs = 0;

async function getYahooCrumb() {
  if (_crumb && _cookie && Date.now() - _crumbTs < 1800000) {
    return { crumb: _crumb, cookie: _cookie };
  }
  const r1 = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    redirect: 'follow',
    signal: AbortSignal.timeout(5000),
  });
  const cookies = r1.headers.get('set-cookie') || '';
  const cookie = cookies.split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
  const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookie },
    signal: AbortSignal.timeout(5000),
  });
  const crumb = await r2.text();
  if (!crumb || crumb.includes('<')) throw new Error('crumb failed');
  _crumb = crumb.trim();
  _cookie = cookie;
  _crumbTs = Date.now();
  return { crumb: _crumb, cookie: _cookie };
}

// ── 네이버 실시간 국내주식 조회 ─────────────────────────────────────────────
async function fetchNaverStock(ticker6) {
  const nowKST = new Date(Date.now() + 9 * 3600000);
  const kstM = nowKST.getUTCHours() * 60 + nowKST.getUTCMinutes();
  const isPreKR  = kstM >= 8*60    && kstM < 9*60;
  const isRegKR  = kstM >= 9*60    && kstM < 15*60+30;
  const isPostKR = kstM >= 15*60+30 && kstM < 20*60;
  const stateKR  = isPreKR ? 'PRE' : isRegKR ? 'REGULAR' : isPostKR ? 'POST' : 'CLOSED';

  // 1순위: 네이버 실시간 polling API
  try {
    const url = `https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${ticker6}&_=${Date.now()}`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://finance.naver.com/',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const d = await r.json();
      const item = d?.result?.areas?.[0]?.datas?.[0];
      if (item?.nv) {
        const price  = parseFloat(item.nv);
        const sign   = String(item.rf) === '5' ? -1 : 1;
        const chgPct = sign * parseFloat(item.cr || 0);
        const chgAmt = sign * Math.round(parseFloat(item.cv || 0));
        if (price > 0) {
          return { price, regularPrice: price, closePrice: price,
            changePercent: chgPct, changeAmount: chgAmt,
            regularChangePercent: chgPct, regularChangeAmount: chgAmt,
            currency: 'KRW', marketState: stateKR };
        }
      }
    }
  } catch {}

  // 2순위: 네이버 모바일 API
  try {
    const url = `https://m.stock.naver.com/api/stock/${ticker6}/basic`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)',
        'Referer': 'https://m.stock.naver.com/',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const d = await r.json();
      const price  = parseFloat((d.closePrice||'').replace(/,/g,'') || 0);
      const chgAmt = parseFloat((d.compareToPreviousClosePrice||'').replace(/[+,]/g,'') || 0);
      const chgPct = parseFloat(d.fluctuationsRatio || 0);
      if (price > 0) {
        return { price, regularPrice: price, closePrice: price,
          changePercent: chgPct, changeAmount: Math.round(chgAmt),
          regularChangePercent: chgPct, regularChangeAmount: Math.round(chgAmt),
          currency: 'KRW', marketState: stateKR };
      }
    }
  } catch {}

  return null;
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

  let crumb = '', cookie = '';
  try {
    ({ crumb, cookie } = await getYahooCrumb());
  } catch {}

  const chunkSize = 10;
  for (let ci = 0; ci < symList.length; ci += chunkSize) {
    const chunk = symList.slice(ci, ci + chunkSize);
    await Promise.all(chunk.map(async (sym) => {
      const isKR = sym.endsWith('.KS') || sym.endsWith('.KQ');

      if (isKR) {
        // ── 국내주식: 네이버 실시간 API 우선 ──────────────────────────
        const ticker6 = sym.replace('.KS','').replace('.KQ','').padStart(6,'0');
        const naverResult = await fetchNaverStock(ticker6);
        if (naverResult) {
          results[sym] = naverResult;
          return;
        }

        // 네이버 실패 시 Yahoo v8/chart fallback
        try {
          const nowKST = new Date(Date.now() + 9 * 3600000);
          const kstM = nowKST.getUTCHours() * 60 + nowKST.getUTCMinutes();
          const isPreKR  = kstM >= 8*60    && kstM < 9*60;
          const isRegKR  = kstM >= 9*60    && kstM < 15*60+30;
          const isPostKR = kstM >= 15*60+30 && kstM < 20*60;
          const stateKR  = isPreKR ? 'PRE' : isRegKR ? 'REGULAR' : isPostKR ? 'POST' : 'CLOSED';

          for (const host of ['query1', 'query2']) {
            try {
              const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${sym}?interval=1m&range=1d&includePrePost=true`;
              const headers = { 'User-Agent': 'Mozilla/5.0' };
              if (crumb) { headers['Cookie'] = cookie; }
              const r = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
              if (!r.ok) continue;
              const d = await r.json();
              const meta   = d?.chart?.result?.[0]?.meta || {};
              const result = d?.chart?.result?.[0];
              if (!meta.regularMarketPrice) continue;

              const regularPrice = meta.regularMarketPrice;
              const prevClose    = meta.previousClose || meta.chartPreviousClose || regularPrice;
              const closes       = result.indicators?.quote?.[0]?.close || [];
              const timestamps   = result.timestamp || [];
              let lastPrice = regularPrice, lastTs = 0;
              for (let i = closes.length - 1; i >= 0; i--) {
                if (closes[i] != null) { lastPrice = closes[i]; lastTs = (timestamps[i]||0)*1000; break; }
              }
              const useExtended = (isPreKR || isPostKR) && lastTs > Date.now() - 3600000;
              const displayPrice = useExtended ? lastPrice : regularPrice;
              const displayChg   = prevClose > 0 ? ((displayPrice - prevClose) / prevClose) * 100 : 0;
              const displayAmt   = Math.round(displayPrice - prevClose);
              const regChg = prevClose > 0 ? ((regularPrice - prevClose) / prevClose) * 100 : 0;
              const regAmt = Math.round(regularPrice - prevClose);
              results[sym] = {
                price: displayPrice, regularPrice, closePrice: regularPrice,
                changePercent: displayChg, changeAmount: displayAmt,
                regularChangePercent: regChg, regularChangeAmount: regAmt,
                currency: 'KRW', marketState: stateKR,
              };
              break;
            } catch { continue; }
          }
        } catch {}
        return;
      }

      // ── 해외주식: Yahoo Finance quoteSummary ──────────────────────
      try {
        const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${sym}&fields=${fields}&crumb=${encodeURIComponent(crumb)}`;
        const r = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookie },
          signal: AbortSignal.timeout(6000),
        });
        if (!r.ok) throw new Error(`${r.status}`);
        const d = await r.json();
        const q = d?.quoteResponse?.result?.[0];
        if (!q) throw new Error('no quote');

        const reg   = q.regularMarketPrice || 0;
        const pre   = q.preMarketPrice;
        const post  = q.postMarketPrice;
        const state = q.marketState || 'CLOSED';
        const price = state === 'PRE' && pre ? pre : state === 'POST' && post ? post : reg;
        const changePercent = state === 'PRE' && q.preMarketChangePercent != null ? q.preMarketChangePercent
          : state === 'POST' && q.postMarketChangePercent != null ? q.postMarketChangePercent
          : q.regularMarketChangePercent || 0;
        const changeAmount = state === 'PRE' && q.preMarketChange != null ? q.preMarketChange
          : state === 'POST' && q.postMarketChange != null ? q.postMarketChange
          : q.regularMarketChange || 0;

        results[sym] = {
          price, regularPrice: reg,
          changePercent, changeAmount,
          regularChangePercent: q.regularMarketChangePercent || 0,
          regularChangeAmount:  q.regularMarketChange || 0,
          currency: q.currency || 'USD',
          marketState: state,
        };
      } catch {}
    }));
  }

  const failed = symList.filter(s => !results[s]);
  if (failed.length) console.warn('[quote] 실패:', failed.join(','));
  res.status(200).json(results);
}

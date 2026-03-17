// Vercel API Route: /api/futures
// 코스피200 야간선물 시세 (네이버 증권 polling API)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { code } = req.query;
  const futureCode = code || (() => {
    const m = new Date().getMonth() + 1;
    return `101S${m <= 3 ? '03' : m <= 6 ? '06' : m <= 9 ? '09' : '12'}`;
  })();

  try {
    const naverUrl = `https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${futureCode}`;
    const r = await fetch(naverUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://finance.naver.com',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(6000),
    });

    if (!r.ok) throw new Error(`Naver API ${r.status}`);
    const d = await r.json();
    const item = d?.result?.areas?.[0]?.datas?.[0];
    if (!item?.nv) throw new Error('no data');

    const price = parseFloat(item.nv);
    const rf    = String(item.rf || '');
    const sign  = rf === '5' ? -1 : 1;
    const crAbs = parseFloat(item.cr || 0);
    const cvAbs = parseFloat(item.cv || 0);

    res.status(200).json({
      price,
      chg:    sign * crAbs,
      chgAmt: sign * cvAbs,
      label:  `코스피200 야간선물`,
      code:   futureCode,
      ts:     Date.now(),
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}


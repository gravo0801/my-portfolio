// KRW mark-to-market performance of open holdings; excludes cash and realized P/L.
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
export const isUsdHolding = h => h.market === 'US' || (h.market === 'ETF' && !/^(\d|.*\.(KS|KQ)$)/i.test(h.ticker || ''));
export const holdingKey = h => `${h.portfolio}:${h.id}`;

export function costBasis(h, trades = [], historicalRates = {}) {
  const quantity = positive(h.quantity), price = positive(h.avgPrice);
  if (!quantity || !price) return { cost: null, source: 'missing' };
  if (!isUsdHolding(h)) return { cost: quantity * price, source: 'krw' };
  const explicit = positive(h.avgFxRate) || positive(h.fxRate);
  if (explicit) return { cost: quantity * price * explicit, source: 'entered', rate: explicit };
  // Use a complete, reconciled moving-average ledger only. Never infer an opening lot.
  const matching = trades.filter(t => (t.portfolio || 'p1') === h.portfolio &&
    String(t.ticker).toUpperCase() === String(h.ticker).toUpperCase() &&
    (h.portfolio !== 'p2' || String(t.taxAccount || t.broker || '') === String(h.taxAccount || h.broker || '')) &&
    (!h.broker || t.broker === h.broker))
    .sort((a,b) => String(a.date).localeCompare(String(b.date)) || Number(a.id || 0)-Number(b.id || 0));
  let qty = 0, usd = 0, krw = 0;
  for (const t of matching) {
    const q = positive(t.quantity), p = positive(t.price);
    if (!q || !p || !['buy','sell'].includes(t.type)) return { cost:null, source:'missing' };
    if (t.type === 'buy') {
      const rate = positive(t.buyFxRate) || positive(t.fxRate) || positive(t.usdKrw) || positive(historicalRates[String(t.date).slice(0,10)]);
      if (!rate) return { cost:null, source:'missing' };
      qty += q; usd += q*p; krw += q*p*rate;
    } else {
      if (q > qty + 1e-8 || qty <= 0) return { cost:null, source:'missing' };
      const remaining = Math.max(0, (qty-q)/qty);
      usd *= remaining; krw *= remaining; qty = Math.max(0,qty-q);
    }
  }
  if (Math.abs(qty-quantity) > Math.max(1e-6,quantity*1e-6) ||
      Math.abs(usd-quantity*price) > Math.max(0.02,quantity*price*0.001)) return { cost:null, source:'missing' };
  return { cost:krw, source:'estimated-ledger', rate:krw/(quantity*price) };
}

export function calculatePerformance(holdings, prices, fx, trades = [], historicalRates = {}) {
  const rows = holdings.filter(h => Number(h.quantity)>0).map(h => {
    const usd = isUsdHolding(h);
    const quote = prices[h.ticker] || prices[h.ticker+'.KS'] || prices[h.ticker+'.KQ'];
    const price = positive(quote?.price) || positive(h.avgPrice);
    const rate = usd ? positive(fx?.rate) : 1;
    const ambiguous = holdings.filter(other=>other.portfolio===h.portfolio && other.ticker===h.ticker && String(other.taxAccount||other.broker||'')===String(h.taxAccount||h.broker||'')).length>1;
    const basis = costBasis(h,ambiguous ? [] : trades,historicalRates);
    const value = price && rate ? price*Number(h.quantity)*rate : null;
    const fxPnl = usd && basis.cost !== null && rate ? Number(h.avgPrice)*Number(h.quantity)*rate-basis.cost : usd ? null : 0;
    return {...h, key:holdingKey(h), usd, value, basis, fxPnl, missingPrice:!positive(quote?.price)};
  });
  const missingBasis = rows.filter(r=>r.basis.cost===null).length;
  const missingValue = rows.some(r=>r.value===null);
  const totalValue = missingValue ? null : rows.reduce((s,r)=>s+r.value,0);
  const totalCost = missingBasis ? null : rows.reduce((s,r)=>s+r.basis.cost,0);
  const totalPnl = totalValue!==null && totalCost!==null ? totalValue-totalCost : null;
  const fxPnl = rows.some(r=>r.fxPnl===null) ? null : rows.reduce((s,r)=>s+r.fxPnl,0);
  return { totalValue,totalCost,totalPnl,fxPnl,returnRate:totalCost>0 && totalPnl!==null ? totalPnl/totalCost*100:null,
    missingBasis, estimated:rows.filter(r=>r.basis.source==='estimated-ledger').length,
    missingPrices:rows.filter(r=>r.missingPrice).length, rows };
}

export function calendarSnapshot(snap, scope='all') {
  const metric = snap.fxPerformance?.[scope];
  if (metric) return {...snap,...metric,
    ...Object.fromEntries(['totalValue','totalCost','totalPnl','returnRate','fxPnl'].map(key=>[key,Number.isFinite(metric[key])?metric[key]:null])),scope,basisVersion:2};
  // Legacy aggregate cannot be reconstructed: retain it only in explicitly labeled P1 view.
  if (scope==='all' || scope==='p4') return null;
  const legacy = snap.portfolios?.[scope] || (scope==='p1' ? snap : null);
  return legacy ? {...snap,...legacy,scope,basisVersion:1} : null;
}
export function snapshotChange(current, previous) {
  if (!current || !previous || current.basisVersion!==previous.basisVersion || current.scope!==previous.scope ||
      !Number.isFinite(current.totalValue) || !Number.isFinite(previous.totalValue) || previous.totalValue<=0) return null;
  const chg=current.totalValue-previous.totalValue;
  return {chg,pct:chg/previous.totalValue*100};
}

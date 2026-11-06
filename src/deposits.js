// Deposits are cash contributions in KRW, independent of investment performance.
export function validDeposit(r) {
  return !!r && typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(r.id)
    && typeof r.account === 'string' && r.account.trim().length > 0 && r.account.length <= 100
    && typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date)
    && Number.isFinite(Date.parse(r.date)) && new Date(r.date).toISOString().slice(0,10) === r.date
    && Number.isSafeInteger(r.amount) && r.amount > 0 && r.amount <= 1e12
    && typeof r.note === 'string' && r.note.length <= 500;
}
export function depositStats(records, year, account = '') {
  const selected = records.filter(r => validDeposit(r) && (!account || r.account === account));
  const annual = selected.filter(r => r.date.slice(0,4) === String(year));
  const months = Array.from({length:12}, (_, i) => ({month:`${year}-${String(i+1).padStart(2,'0')}`, amount:0, count:0}));
  const accounts = new Map();
  for (const r of annual) {
    const month = months[Number(r.date.slice(5,7))-1];
    month.amount += r.amount; month.count++;
    const a = accounts.get(r.account) || {account:r.account, amount:0, count:0};
    a.amount += r.amount; a.count++; accounts.set(r.account,a);
  }
  return {months, accounts:[...accounts.values()].sort((a,b)=>b.amount-a.amount),
    total:annual.reduce((s,r)=>s+r.amount,0), lifetime:selected.reduce((s,r)=>s+r.amount,0), count:annual.length};
}
// Compare the record being edited, not the whole ledger: unrelated concurrent writes survive.
export function depositMutation(current, expected, next) {
  if (!sameDeposit(current, expected)) return undefined;
  return next;
}

export function sameDeposit(a, b) {
  if (!a || !b) return !a && !b;
  return ['id','account','date','amount','note','updatedAt'].every(k=>a[k] === b[k]);
}
export function mergeDepositBackup(current, records) {
  const next = {...(current || {})};
  for (const r of records) {
    if (!validDeposit(r) || (next[r.id] && !sameDeposit(next[r.id],r))) return undefined;
    next[r.id] = r;
  }
  return next;
}

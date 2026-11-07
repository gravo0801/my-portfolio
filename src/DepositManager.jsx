import { useMemo, useRef, useState } from 'react';
import { depositStats } from './deposits.js';
import './deposits.css';
const won = n => `${n.toLocaleString('ko-KR')}원`;
export default function DepositManager({ledger, suggestions, today}) {
  const {records,ready,connected,error,save,restore} = ledger;
  const [year,setYear] = useState(today.slice(0,4));
  const [account,setAccount] = useState('');
  const [month,setMonth] = useState('');
  const [form,setForm] = useState({date:today,account:'',amount:'',note:''});
  const [editing,setEditing] = useState(null);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const fileInput = useRef(null);
  const accounts = useMemo(()=>[...new Set(["케이뱅크",...suggestions,...records.map(r=>r.account)])].filter(Boolean).sort(),[suggestions,records]);
  const stats = useMemo(()=>depositStats(records,year,account),[records,year,account]);
  const years = [...new Set([today.slice(0,4),year,...records.map(r=>r.date.slice(0,4))])].sort().reverse();
  const rows = records.filter(r=>r.date.startsWith(month || year) && (!account || r.account===account)).sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));
  const selectedTotal = rows.reduce((s,r)=>s+r.amount,0);
  const max = Math.max(1,...stats.months.map(m=>m.amount));
  const change = (k,v)=>setForm(p=>({...p,[k]:v}));
  const reset = ()=>{setEditing(null);setForm(p=>({...p,amount:'',note:''}));};
  async function submit(e) {
    e.preventDefault(); if(busy) return;
    setMessage('');
    const digits = form.amount.replaceAll(',','').trim();
    if (!/^\d+$/.test(digits)) {setMessage('입금액을 원 단위의 양의 정수로 입력해 주세요.');return;}
    const next = {id:editing?.id || crypto.randomUUID(), date:form.date, account:form.account.trim(), amount:Number(digits), note:form.note.trim(),updatedAt:Date.now()};
    if (!editing && records.some(r=>r.date===next.date && r.account===next.account && r.amount===next.amount) && !window.confirm('같은 날짜·계좌·금액의 기록이 있습니다. 별도 입금으로 추가할까요?')) return;
    setBusy(true);
    try {await save(next,editing);reset();setMessage('저장 완료');} catch(e) {setMessage(e.message);} finally {setBusy(false);}
  }
  async function remove(r) {
    if(busy || !window.confirm(`${r.date} · ${r.account} · ${won(r.amount)} 입금 기록을 삭제할까요?`)) return;
    setBusy(true);setMessage('');
    try {await save(null,r);if(editing?.id===r.id) reset();setMessage('삭제 완료');} catch(e) {setMessage(e.message);} finally {setBusy(false);}
  }
  function download() {
    const blob = new Blob([JSON.stringify({version:1,type:'portfolio-deposits',date:today,records},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`deposits-${today}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function importFile(e) {
    const file=e.target.files?.[0];e.target.value='';if(!file) return;
    setBusy(true);setMessage('');
    try {
      const parsed=JSON.parse(await file.text());
      const data=parsed.type==='portfolio-deposits'?parsed.records:parsed.data?.deposits;
      if(!Array.isArray(data)) throw new Error('입금 기록이 포함된 JSON 백업을 선택해 주세요.');
      if(window.confirm(`입금 ${data.length}건을 현재 계정에 병합할까요? 같은 ID의 기록은 중복 추가하지 않으며, 내용이 다르면 복원을 중단합니다.`)) {await restore(data);setMessage('입금 백업 복원 완료');}
    } catch(e) {setMessage(e.message);} finally {setBusy(false);}
  }
  return <section className="deposits">
    <header><div><h2>입금 관리</h2><p>계좌에 넣은 돈을 월별로 확인하세요. 모든 금액은 원화 기준입니다.</p></div><span className="dep-status">{!ready?'불러오는 중':connected?'동기화 연결됨':'연결 끊김 · 저장 대기'}</span></header>
    {error && <p role="alert" className="dep-message">{error}</p>}
    <div className="dep-card">
      <h3>{editing?'입금 수정':'입금 기록하기'}</h3>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <div className="dep-form">
            <label>입금 날짜<span style={{display:'flex',gap:6}}><input type="date" aria-label="입금 날짜" required value={form.date} onChange={e=>change('date',e.target.value)} style={{colorScheme:'dark'}}/><button type="button" onClick={e=>{const input=e.currentTarget.previousElementSibling;try{input.showPicker();}catch{input.focus();}}}>달력</button></span><span style={{display:'flex',gap:6}}><input aria-label="입금 날짜 직접 입력" type="text" placeholder="YYYY-MM-DD" value={form.date} onChange={e=>change('date',e.target.value)} maxLength={10}/><button type="button" onClick={()=>change('date',today)}>오늘</button></span></label>
            <label>입금 계좌<input list="deposit-accounts" required maxLength={100} placeholder="계좌 선택 또는 직접 입력" value={form.account} onChange={e=>change('account',e.target.value)}/><datalist id="deposit-accounts">{accounts.map(a=><option key={a} value={a}/>)}</datalist></label>
            <label>입금액 (원)<input inputMode="numeric" required placeholder="예: 1,000,000" value={form.amount} onChange={e=>change('amount',e.target.value)}/></label>
            <label>메모 (선택)<input maxLength={500} placeholder="예: 11월 정기 납입" value={form.note} onChange={e=>change('note',e.target.value)}/></label>
          </div>
          <div className="dep-actions"><button className="dep-primary" type="submit" disabled={!ready||!connected}>{busy?'처리 중…':editing?'수정 저장':'입금 저장'}</button>{editing && <button type="button" onClick={reset}>수정 취소</button>}</div>
        </fieldset>
      </form>
      <p className="dep-hint">계좌가 여러 개라면 ‘신한 일반’, ‘신한 ISA’처럼 구분해 주세요. 계좌 간 이체도 입력하면 총 입금액에 포함됩니다. 투자수익·순입금·세액공제 납입액과는 별도 집계입니다.</p>
    </div>
    <p role="status" aria-live="polite" className="dep-message">{message || (busy?'서버 저장 확인 중…':'')}</p>
    <div className="dep-filters"><label>조회 연도<select value={year} onChange={e=>{setYear(e.target.value);setMonth('');}}>{years.map(y=><option key={y}>{y}</option>)}</select></label><label>계좌 필터<select value={account} onChange={e=>setAccount(e.target.value)}><option value="">전체 계좌</option>{accounts.map(a=><option key={a}>{a}</option>)}</select></label><label>조회 월<select value={month} onChange={e=>setMonth(e.target.value)}><option value="">연간 전체</option>{stats.months.map(m=><option key={m.month} value={m.month}>{m.month}</option>)}</select></label></div>
    <div className="dep-summary">
      {[[month?`${month} 입금 합계`:`${year} 입금 합계`,selectedTotal],[`${year} 연간 누적`,stats.total],['전체 기간 누적',stats.lifetime]].map(([label,value])=><div className="dep-card" key={label}><span>{label}</span><strong>{ready?won(value):'—'}</strong><small>{account || '전체 계좌'}</small></div>)}
    </div>
    <div className="dep-card"><h3>{year} 월별 입금 추이 <small>{account || '전체 계좌'}</small></h3><div className="dep-bars">{stats.months.map(m=><button key={m.month} onClick={()=>setMonth(m.month)} aria-label={`${m.month} ${won(m.amount)}, ${m.count}건 조회`} title={`${m.month} · ${won(m.amount)}`}><span className="dep-bar-space"><span style={{height:`${m.amount/max*100}%`}}/></span><span>{Number(m.month.slice(5))}월</span></button>)}</div><p className="dep-hint">막대를 선택하면 해당 월의 계좌별 합계와 입금 내역을 확인할 수 있습니다.</p></div>
    <div className="dep-card"><h3>{month || year} 계좌별 합계</h3><div className="dep-table"><table><thead><tr><th>계좌</th><th>입금 건수</th><th>입금 합계</th><th>비중</th></tr></thead><tbody>{stats.accounts.map(a=>{const list=rows.filter(r=>r.account===a.account);const sum=list.reduce((s,r)=>s+r.amount,0);return <tr key={a.account}><td>{a.account}</td><td>{list.length}건</td><td>{won(sum)}</td><td>{selectedTotal?(sum/selectedTotal*100).toFixed(1):'0.0'}%</td></tr>;})}</tbody><tfoot><tr><th>합계</th><td>{rows.length}건</td><td>{won(selectedTotal)}</td><td>{selectedTotal?'100%':'—'}</td></tr></tfoot></table></div></div>
    <div className="dep-card"><h3>입금 내역 · {rows.length}건</h3>{ready && !rows.length && <p className="dep-hint">선택한 기간에 입금 기록이 없습니다. 위에서 첫 입금을 기록해 주세요.</p>}<div className="dep-table"><table><thead><tr><th>날짜</th><th>계좌</th><th>입금액</th><th>메모</th><th>관리</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.date}</td><td>{r.account}</td><td>{won(r.amount)}</td><td className="dep-note">{r.note || '—'}</td><td><div className="dep-row-actions"><button disabled={busy||!connected} onClick={()=>{setEditing(r);setForm({...r,amount:String(r.amount)});setMessage('');}}>수정</button><button disabled={busy||!connected} onClick={()=>remove(r)}>삭제</button></div></td></tr>)}</tbody></table></div></div>
    <div className="dep-actions"><button onClick={download} disabled={!ready||busy}>입금 기록 JSON 백업</button><button onClick={()=>fileInput.current.click()} disabled={!ready||!connected||busy}>입금 기록 복원</button><input hidden type="file" accept="application/json,.json" ref={fileInput} onChange={importFile}/></div>
  </section>;
}

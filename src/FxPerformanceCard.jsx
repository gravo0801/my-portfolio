import { useState } from 'react';
const money = v => Number.isFinite(v) ? Math.round(v).toLocaleString()+'₩' : '확인 필요';
export default function FxPerformanceCard({metric,fx,onSave,scope,onScope}) {
  const [drafts,setDrafts]=useState({});
  const [showInputs,setShowInputs]=useState(false);
  const [message,setMessage]=useState('');
  const usdRows=metric.rows.filter(r=>r.usd);
  return <section style={{background:'rgba(255,255,255,0.05)',border:'1px solid #334155',borderRadius:14,padding:18}}>
    <h3 style={{margin:'0 0 12px'}}>환차손익 포함 · 원화 평가수익률</h3>
    <label>계좌 범위 <select aria-label="수익률 계좌 범위" value={scope} onChange={e=>onScope(e.target.value)} style={{padding:8,background:'#1e293b',color:'white',borderRadius:6}}>
      {[['all','전체 P1~P4'],['p1','P1 일반'],['p2','P2 절세'],['p3','P3 ISA'],['p4','P4 RIA']].map(([v,l])=><option key={v} value={v}>{l}</option>)}
    </select></label>
    <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:12,marginTop:16}}>
      {[['총 평가금액',money(metric.totalValue)],['원화 취득원가',money(metric.totalCost)],['평가수익금',money(metric.totalPnl)],['원화 평가수익률',Number.isFinite(metric.returnRate)?(metric.returnRate>=0?'+':'')+metric.returnRate.toFixed(2)+'%':metric.rows.length===0?'보유자산 없음':'자료 확인 필요'],['환차손익',money(metric.fxPnl)]].map(([l,v])=><div key={l}><div style={{fontSize:12,color:'#94a3b8'}}>{l}</div><strong style={{fontSize:18,overflowWrap:'anywhere'}}>{v}</strong></div>)}
    </div>
    <p style={{fontSize:12,color:'#94a3b8',lineHeight:1.7}}>보유자산 기준 · 배당·실현손익·현금·수수료 제외. 국내 상장 ETF는 원화 가격에 반영된 환율 효과를 중복 계산하지 않습니다.<br/>
      적용 환율: {fx?.rate ? `${fx.rate.toLocaleString()}원/USD · ${fx.source} · 조회 ${new Date(fx.fetchedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}`:'조회 중'}{fx?.stale?' (캐시 또는 지연 환율)':''}{fx?.asOf ? ` · 시세 기준 ${new Date(fx.asOf).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}` : ''}
    </p>
    {(metric.missingBasis>0 || metric.estimated>0 || metric.missingPrices>0) && <p style={{fontSize:12,color:'#fbbf24'}}>매수환율 미확인 {metric.missingBasis}건 · 거래내역 기반 추정 {metric.estimated}건 · 시세 대신 매수가 사용 {metric.missingPrices}건. 미확인 원가가 있으면 전체 수익률을 확정하지 않습니다.</p>}
    {!!usdRows.length && <button onClick={()=>setShowInputs(v=>!v)} style={{padding:9,cursor:'pointer'}}>매수환율 확인·입력 ({usdRows.length})</button>}
    {showInputs && <div style={{marginTop:12}}><p style={{fontSize:12,color:'#94a3b8'}}>증권사 원화 취득원가 ÷ (평균 매수가 × 현재 수량)을 입력하세요. 여러 번 매수했다면 남아 있는 보유분의 가중평균 환율입니다. 거래내역 추정치는 매수·매도 수량과 원가가 현재 보유분에 일치할 때만 사용합니다.</p>
      {usdRows.map(r=><div key={r.key} style={{padding:'10px 0',borderBottom:'1px solid #334155'}}>
        <div>{r.portfolio.toUpperCase()} · {r.name||r.ticker} {r.taxAccount||r.broker||''}</div>
        <small style={{color:'#94a3b8'}}>{r.basis.rate ? `${r.basis.source==='entered'?'입력값':'추정값'} ${r.basis.rate.toFixed(2)}원`:'매수환율 없음'}</small>
        <div style={{display:'flex',gap:8,marginTop:5}}><input aria-label={`${r.portfolio} ${r.ticker} 매수환율`} type="number" min="0.01" step="0.01" placeholder="보유분 평균 매수환율" value={drafts[r.key]??''} onChange={e=>setDrafts(d=>({...d,[r.key]:e.target.value}))} style={{minWidth:0,flex:1,padding:9}}/><button onClick={()=>{const rate=Number(drafts[r.key]);if(!Number.isFinite(rate)||rate<=0){setMessage('0보다 큰 매수환율을 입력해 주세요.');return;}onSave(r,rate);setMessage(`${r.name||r.ticker} 매수환율을 반영했습니다.`);}}>저장</button></div>
      </div>)}<p role="status">{message}</p></div>}
  </section>;
}

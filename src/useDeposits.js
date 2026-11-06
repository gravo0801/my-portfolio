import { useEffect, useState, useCallback } from 'react';
import { validDeposit, depositMutation, mergeDepositBackup } from './deposits.js';
export default function useDeposits(userPath) {
  const [state,setState] = useState({path:'',records:[],ready:false,error:''});
  const [connected,setConnected] = useState(false);
  useEffect(() => {
    let active = true;
    const api = window.firebaseDB, db = api.getDatabase();
    setState({path:userPath,records:[],ready:false,error:''});
    const off = api.onValue(api.ref(db,`${userPath}/deposits`), snap => {
      if (!active) return;
      const raw = snap.val() || {};
      const values = Object.entries(raw).map(([id,r])=>({...r,id}));
      const records = values.filter(validDeposit);
      setState({path:userPath,records,ready:true,error:records.length !== values.length ? '일부 입금 기록의 형식이 잘못되어 집계에서 제외했습니다.' : ''});
    }, () => { if(active) setState(s=>({...s,ready:false,error:'입금 기록을 불러오지 못했습니다. 연결·접근 권한을 확인하고 다시 접속해 주세요.'})); });
    const offConnected = api.onValue(api.ref(db,'.info/connected'),snap=>{ if(active) setConnected(snap.val()===true); });
    return ()=>{active=false;off();offConnected();};
  },[userPath]);
  const save = useCallback(async (next, expected=null) => {
    if (!connected || !state.ready || state.path !== userPath) throw new Error('서버 연결 후 저장할 수 있습니다. 입력 내용을 유지했습니다.');
    if (next && !validDeposit(next)) throw new Error('날짜, 계좌, 양의 정수 원화 금액을 확인해 주세요.');
    const id = next?.id || expected?.id;
    if (!id || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error('잘못된 기록입니다.');
    const ref = window.firebaseDB.ref(window.firebaseDB.getDatabase(),`${userPath}/deposits/${id}`);
    const result = await ref.transaction(current => depositMutation(current,expected,next),undefined,false);
    if (!result.committed) throw new Error('다른 기기에서 이 기록을 변경했습니다. 최신 기록을 다시 열어 수정해 주세요.');
  },[connected,state.ready,state.path,userPath]);
  const restore = useCallback(async records => {
    if (!connected || !state.ready || state.path !== userPath) throw new Error('연결 후 복원해 주세요.');
    if (!Array.isArray(records) || !records.every(validDeposit) || new Set(records.map(r=>r.id)).size !== records.length) throw new Error('올바르지 않은 입금 백업입니다.');
    const ref = window.firebaseDB.ref(window.firebaseDB.getDatabase(),`${userPath}/deposits`);
    const result = await ref.transaction(current=>mergeDepositBackup(current,records),undefined,false);
    if (!result.committed) throw new Error('현재 기록과 내용이 다른 항목이 있습니다. 덮어쓰지 않았습니다.');
  },[connected,state.ready,state.path,userPath]);
  return {restore,records:state.path===userPath?state.records:[],ready:state.path===userPath&&state.ready,connected,error:state.error,save};
}

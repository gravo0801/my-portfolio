import test from 'node:test';
import assert from 'node:assert/strict';
import {validDeposit,depositStats,depositMutation,mergeDepositBackup} from './deposits.js';
const make=(id,date,account,amount)=>({id,date,account,amount,note:'',updatedAt:1});
const a=make('a','2026-01-31','ISA',1000000);
const b=make('b','2026-02-01','IRP',500000);
const c=make('c','2026-02-28','ISA',300000);
const d=make('d','2025-12-31','ISA',200000);
test('monthly / annual / all-time totals and account filtering',()=>{
 const s=depositStats([a,b,c,d],2026);
 assert.equal(s.total,1800000);assert.equal(s.lifetime,2000000);
 assert.equal(s.months[0].amount,1000000);assert.equal(s.months[1].amount,800000);assert.equal(s.months[2].amount,0);
 assert.deepEqual(s.accounts.map(a=>a.amount),[1300000,500000]);
 assert.equal(depositStats([a,b,c,d],2026,'ISA').total,1300000);
 assert.equal(depositStats([],2026).total,0);
});
test('invalid dates and amounts excluded, leap day accepted',()=>{
 for(const patch of [{date:'2026-02-30'},{date:'2026-13-01'},{amount:0},{amount:-1},{amount:1.2},{amount:Infinity},{amount:'100'},{account:' '},{id:'../a'}]) assert.equal(validDeposit({...a,...patch}),false);
 assert.equal(validDeposit({...a,date:'2024-02-29'}),true);
});
test('edits and deletions update statistics',()=>{
 const changed={...a,amount:2000000,date:'2026-02-01'};
 assert.equal(depositStats([changed,b],2026).months[1].amount,2500000);
 assert.equal(depositStats([b],2026).total,500000);
});
test('record compare is independent of object key order and detects concurrent changes',()=>{
 const reordered={note:'',amount:1000000,account:'ISA',date:'2026-01-31',updatedAt:1,id:'a'};
 assert.deepEqual(depositMutation(reordered,a,{...a,amount:2}),{...a,amount:2});
 assert.equal(depositMutation({...a,updatedAt:2},a,null),undefined);
 assert.equal(depositMutation(a,a,null),null);
 assert.deepEqual(depositMutation(null,null,a),a);
 assert.equal(depositMutation(a,null,a),undefined);
});
test('backup merge is idempotent, preserves other records, rejects conflicts atomically',()=>{
 assert.deepEqual(mergeDepositBackup({a},[a,b]),{a,b});
 assert.deepEqual(mergeDepositBackup({a,b},[a,b]),{a,b});
 assert.equal(mergeDepositBackup({a},[{...a,amount:99}]),undefined);
 assert.deepEqual(mergeDepositBackup({a},[]),{a});
});

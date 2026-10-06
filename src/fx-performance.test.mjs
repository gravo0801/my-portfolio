import test from 'node:test';
import assert from 'node:assert/strict';
import {calculatePerformance,costBasis,calendarSnapshot,snapshotChange} from './fx-performance.js';
const h={id:1,portfolio:'p1',ticker:'VOO',market:'US',quantity:100,avgPrice:100,fxRate:1300};
test('KRW return includes currency gain and loss',()=>{
 const a=calculatePerformance([h],{VOO:{price:110}},{rate:1400});
 assert.equal(a.totalCost,13000000);assert.equal(a.totalValue,15400000);assert.equal(a.fxPnl,1000000);assert.ok(Math.abs(a.returnRate-18.46153846)<1e-7);
 const b=calculatePerformance([h],{VOO:{price:110}},{rate:1200});assert.equal(b.totalPnl,200000);assert.equal(b.fxPnl,-1000000);
});
test('aggregate P1-P4 by cost and do not double convert Korean ETF',()=>{
 const rows=[h,{...h,id:2,portfolio:'p2'},{id:3,portfolio:'p3',market:'ISA',ticker:'123456',quantity:10,avgPrice:1000},{...h,id:4,portfolio:'p4'}, {id:5,portfolio:'p2',market:'ETF',ticker:'123456',quantity:10,avgPrice:1000}];
 const r=calculatePerformance(rows,{VOO:{price:110},'123456':{price:1200}},{rate:1400});assert.equal(r.totalCost,39020000);assert.equal(r.totalValue,46224000);assert.equal(r.returnRate,r.totalPnl/r.totalCost*100);
});
test('missing basis and missing live FX are not substituted',()=>{
 assert.equal(calculatePerformance([{...h,fxRate:null}],{VOO:{price:110}},{rate:1400}).returnRate,null);
 assert.equal(calculatePerformance([h],{VOO:{price:110}},null).totalValue,null);
});
test('complete moving-average ledger supports partial sales, rejects incomplete ledger',()=>{
 const raw={...h,fxRate:null,quantity:150,avgPrice:150};
 const ts=[{portfolio:'p1',ticker:'VOO',type:'buy',date:'2026-01-01',quantity:100,price:100,fxRate:1300},{portfolio:'p1',ticker:'VOO',type:'buy',date:'2026-02-01',quantity:100,price:200,fxRate:1400},{portfolio:'p1',ticker:'VOO',type:'sell',date:'2026-03-01',quantity:50,price:250}];
 assert.equal(costBasis(raw,ts).cost,30750000);assert.equal(costBasis({...raw,quantity:151},ts).cost,null);
 assert.equal(costBasis(raw,ts.slice(1)).cost,null);
});
test('historical rates are marked estimated, isolate account ledger',()=>{
 const ts=[{portfolio:'p2',taxAccount:'A',ticker:'VOO',type:'buy',date:'2026-01-01',quantity:100,price:100}];
 const raw={...h,portfolio:'p2',taxAccount:'A',fxRate:null};
 assert.equal(costBasis(raw,ts,{'2026-01-01':1250}).source,'estimated-ledger');
 assert.equal(costBasis({...raw,taxAccount:'B'},ts,{'2026-01-01':1250}).cost,null);
});
test('old P1 data never presented as total or compared across methodology change',()=>{
 const old={id:1,totalValue:100,returnRate:10};
 assert.equal(calendarSnapshot(old,'all'),null);assert.equal(calendarSnapshot(old,'p1').basisVersion,1);
 assert.equal(snapshotChange({totalValue:200,scope:'p1',basisVersion:2},calendarSnapshot(old,'p1')),null);
 assert.deepEqual(snapshotChange({totalValue:90,scope:'all',basisVersion:2},{totalValue:100,scope:'all',basisVersion:2}),{chg:-10,pct:-10});
});
test('Firebase omitted null fields never inherit legacy P1 totals',()=>{
 const snap=calendarSnapshot({id:1,totalValue:999,totalCost:100,returnRate:899,fxPerformance:{all:{missingBasis:1}}});
 assert.equal(snap.returnRate,null);assert.equal(snap.totalValue,null);assert.equal(snap.totalCost,null);
});
test('ambiguous duplicate holdings do not reuse a single ledger',()=>{
 const raw={...h,fxRate:null};const trades=[{ticker:'VOO',type:'buy',quantity:100,price:100,fxRate:1300}];
 assert.equal(calculatePerformance([raw,{...raw,id:2}],{VOO:{price:110}},{rate:1400},trades).missingBasis,2);
});

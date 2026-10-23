import test from 'node:test';
import assert from 'node:assert/strict';
import { marketDate, summarize, buildReport, dailyRows } from '../api/cron/morning-report.js';
const rows = [{date:'2026-10-21',open:98,close:100},{date:'2026-10-22',open:110,close:112}];
const holding = {ticker:'ABC',market:'US',quantity:2};
const dependencies = (read = async () => rows) => { const saved=[]; return {saved, fetchDaily:read, writeReport:async (key, report) => saved.push(report)}; };
test('summer: before close uses prior date; after finalization includes today', () => {
  assert.equal(marketDate(new Date('2026-10-22T19:00:00Z')), '2026-10-21');
  assert.equal(marketDate(new Date('2026-10-22T20:14:00Z')), '2026-10-21');
  assert.equal(marketDate(new Date('2026-10-22T20:15:00Z')), '2026-10-22');
});
test('winter uses New York offset rather than fixed Korean close time', () => {
  assert.equal(marketDate(new Date('2026-12-15T20:30:00Z')), '2026-12-14');
  assert.equal(marketDate(new Date('2026-12-15T21:15:00Z')), '2026-12-15');
});
test('daily change includes opening gap and applies current quantity', () => {
  const result=summarize({symbol:'ABC',quantity:2},rows,'2026-10-22');
  assert.equal(result.changePct,12); assert.equal(result.positionImpact,24); assert.equal(result.previousClose,100);
});
test('missing prior close is missing data, never zero performance', () => {
  assert.equal(summarize({symbol:'ABC',quantity:2},rows.slice(1),'2026-10-22').status,'no_data');
});
test('weekend/holiday resolves last actual session and merges duplicate symbols', async () => {
  const deps=dependencies(); const result=await buildReport('fixture',{holdings:[holding],holdings2:[holding]},'2026-10-25',deps);
  assert.equal(result.report.market_session_date,'2026-10-22'); assert.equal(result.symbols,1); assert.equal(result.report.total_change,48);
});
test('partial provider failure retains available rows and explicitly labels subtotal', async () => {
  const deps=dependencies(async symbol => {if(symbol==='FAIL') throw Error('offline');return rows;});
  const result=await buildReport('fixture',{holdings:[holding,{...holding,ticker:'FAIL'}]},'2026-10-22',deps);
  assert.equal(result.report.provider_status.partial,true); assert.equal(result.report.provider_status.available,1); assert.equal(result.report.total_change,24);
});
test('complete provider outage never writes an empty replacement', async () => {
  const deps=dependencies(async symbol => {if(symbol!=='SPY') throw Error('offline');return rows;});
  await assert.rejects(buildReport('fixture',{holdings:[holding]},'2026-10-22',deps)); assert.equal(deps.saved.length,0);
});
test('benchmark failure never overwrites saved report', async () => {
  const deps=dependencies(async () => {throw Error('offline');});
  await assert.rejects(buildReport('fixture',{holdings:[holding]},'2026-10-22',deps)); assert.equal(deps.saved.length,0);
});
test('same session and holdings reuse complete v2 report', async () => {
  const deps=dependencies();const first=await buildReport('fixture',{holdings:[holding]},'2026-10-22',deps);
  const cached=await buildReport('fixture',{holdings:[holding],morningReport:{latest:first.report}},'2026-10-22',deps);
  assert.deepEqual(cached.report,first.report);assert.equal(deps.saved.length,1);
});
test('no US holdings is empty, not zero percent', async () => {
  const deps=dependencies();const result=await buildReport('fixture',{holdings:[{...holding,market:'KR'}]},'2026-10-22',deps);
  assert.equal(result.report.total_change_pct,null); assert.equal(result.symbols,0);
});
test('null provider close is excluded', () => {
  assert.deepEqual(dailyRows({timestamp:[1792690200],indicators:{quote:[{close:[null]}]}}),[]);
});

import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const widgetSource=readFileSync(new URL('./morning-report-widget.js', import.meta.url),'utf8');
function widgetHarness(fetcher, initial={pm_synckey:'test-only',pm_auth_mode:'legacy-key'}) {
 const values=new Map(Object.entries(initial)), events={};
 const root={innerHTML:'',contains:()=>false,querySelector:()=>null};
 const context={Intl,Date,Number,Map,Promise,AbortSignal,fetch:fetcher,setTimeout:()=>0,setInterval:()=>0,
  window:{localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},addEventListener:(k,f)=>events[k]=f},
  document:{visibilityState:'visible',activeElement:null,getElementById:id=>id==='morning-report-root'?root:id==='morning-report-style'?{}:null,
   addEventListener(){},removeEventListener(){},querySelectorAll:()=>[]}};
 vm.createContext(context);vm.runInContext(widgetSource+'\nthis.api={loadReport,panelHtml,chartPath,setOpen};',context);
 return {context,root,values,api:context.api};
}
const reportFixture={schema_version:2,market_session_date:'2026-10-22',total_change:24,total_change_pct:12,per_symbol_metrics:[],provider_status:{ok:true}};
test('widget ignores stale response after logout',async()=>{
 let resolve;const h=widgetHarness(()=>new Promise(r=>resolve=r));const first=h.api.loadReport({force:true});
 h.values.clear();await h.api.loadReport({force:true});resolve({ok:true,json:async()=>({ok:true,report:reportFixture})});await first;
 assert.equal(h.root.innerHTML,'');
});
test('widget keeps previous report when refresh fails and displays retry status',async()=>{
 let fail=false;const h=widgetHarness(async()=>{if(fail)throw Error('offline');return {ok:true,json:async()=>({ok:true,report:reportFixture})};});
 await h.api.loadReport({force:true});fail=true;await h.api.loadReport({force:true,retry:true});
 assert.match(h.root.innerHTML,/12.00%/);assert.match(vm.runInContext('statusMessage',h.context),/이전 리포트/);
});
test('widget does not render a legacy calculation as daily change',async()=>{
 const h=widgetHarness(async()=>({ok:true,json:async()=>({ok:true,report:{...reportFixture,schema_version:1}})}));
 await h.api.loadReport({force:true});assert.doesNotMatch(h.root.innerHTML,/12.00%/);
});
test('provider text is escaped before innerHTML and invalid charts are empty',()=>{
 const h=widgetHarness(async()=>{});vm.runInContext('isOpen=true',h.context);
 const html=h.api.panelHtml(reportFixture,[{symbol:'<img src=x onerror=alert(1)>',name:'<script>',status:'no_data',message:'<b>bad</b>'}]);
 assert.doesNotMatch(html,/<img|<script>|<b>/);assert.equal(h.api.chartPath([{close:null},{close:'invalid'}]),'');
});

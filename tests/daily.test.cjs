const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('function beijingDay('),html.indexOf('var dailyRenderedDate='));
const c=vm.createContext({});vm.runInContext(source,c);
test('daily boundary uses Beijing day rather than UTC or browser local timezone',()=>{
 assert.equal(c.beijingDay(new Date('2026-10-11T15:59:59Z')),'2026-10-11');
 assert.equal(c.beijingDay(new Date('2026-10-11T16:00:00Z')),'2026-10-12');
});
test('today includes only explicit incremental entries, deduplicates, never falls back to yesterday',()=>{
 const now=new Date('2026-10-11T04:00:00Z');
 const make=(id,kind='incremental',at='2026-10-11T07:00:00+08:00')=>({id,ingest_kind:kind,ingested_at:at});
 const papers=[make('new'),make('historical','historical'),make('abstract-fill','abstract_update'),make('old','incremental','2026-10-10T07:00:00+08:00'),make('bad','incremental','invalid'),{id:'legacy'}];
 const daily={'2026-10-11':[make('new'),make('batch2')],'2026-10-10':[make('old')]};
 assert.deepEqual(Array.from(c.todayIncrementalRecords(daily,papers,now),p=>p.id),['new','batch2']);
 assert.equal(c.todayIncrementalRecords(daily,papers,new Date('2026-10-12T04:00:00Z')).length,0);
});

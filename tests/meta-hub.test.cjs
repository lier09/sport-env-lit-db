const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{test}=require('node:test');
const {JSDOM}=require('jsdom'),core=require('../meta-core.js'),rules=require('../meta-rules.json'),Personal=require('../library-storage.js');
const code=fs.readFileSync(path.join(__dirname,'../meta-hub.js'),'utf8');
const delay=()=>new Promise(r=>setTimeout(r,12));
function fixture(){
 const dom=new JSDOM('<button data-meta-open>Meta</button><div id="library">Library</div>',{url:'https://fixture.invalid/#z-search',runScripts:'outside-only'}),w=dom.window,d=w.document;
 w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.confirm=()=>true;
 const papers=Array.from({length:45},(_,i)=>({id:'p'+i,title:'Cold-water immersion exercise recovery '+i,abstract:'Full abstract. '+('Methods. '.repeat(100))+' CONCLUSION_SENTINEL',year:2025,journal:'Journal',authors:['A. Author'],population:i===1?'animal':'unknown'}));
 papers.push({id:'review',title:'Cold-water immersion exercise recovery: systematic review',type:'综述',abstract:'REVIEW_ABSTRACT',year:2026});
 const t={...rules.topics[0],records:core.collect(papers,rules.topics[0])};
 const payload={format:'litdb-meta-candidates',version:1,ruleVersion:1,corpus:{version:'fixture',generated_at:'2026-10-20',total:papers.length},topics:[t,{...rules.topics[1],records:[]}]};
 const requests=[],reads=[],blobs=[];w.fetch=async url=>{requests.push(String(url));return {ok:true,json:async()=>JSON.parse(JSON.stringify(payload))};};
 w.Blob=Blob;w.URL.createObjectURL=b=>(blobs.push(b),'blob:test');w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){};
 w.LitdbMetaCore=core;w.eval(code);
 const storage=Personal.create('tester',w.localStorage);let allowed=true;
 w.LitdbMeta.configure({storage,papers:()=>papers,paper:id=>papers.find(p=>p.id===id),deleted:()=>false,read:id=>reads.push(id),enter:()=>{if(!allowed)return false;d.getElementById('library').hidden=true;},leave:()=>{d.getElementById('library').hidden=false;}});
 const click=s=>{const el=d.querySelector(s);assert.ok(el,'Missing '+s);el.click();return el;};
 const saved=()=>JSON.parse(storage.getItem('litdb-meta-tracker'));
 return {dom,w,d,hub:w.LitdbMeta,papers,requests,reads,click,storage,saved,blobs,setAllowed:v=>allowed=v};
}
test('candidate matcher uses all groups, retains missing abstracts when title suffices, and deduplicates DOI reports without claiming study independence',()=>{
 const t=rules.topics[0],p={id:'a',title:'Cold-water immersion for exercise recovery',abstract:null,doi:'https://doi.org/10.TEST/a'};
 assert.ok(core.match(p,core.compile(t)));assert.equal(core.match({title:'Cold-water immersion'},core.compile(t)),null);
 assert.equal(core.collect([p,{...p,id:'b',doi:'10.test/A'}],t).length,1);
 assert.equal(core.kind({title:'Effectiveness of cold-water immersion: a meta-analysis'}),'synthesis');
 assert.equal(core.kind({type:'原创研究',title:'Exercise recovery'}),'unverified');
});
test('tracker does no startup fetch; workspace pagination, complete abstracts, reading, reviews and source provenance work',async()=>{
 const f=fixture();try{
 assert.equal(f.requests.length,0);assert.equal(f.d.getElementById('metaHub'),null);
 f.setAllowed(false);await f.hub.open();assert.equal(f.requests.length,0);
 f.setAllowed(true);await f.hub.open();assert.equal(f.requests.length,1);assert.equal(f.d.getElementById('library').hidden,true);
 f.click('[data-tab="evidence"]');assert.equal(f.d.querySelectorAll('.meta-paper').length,20);assert.match(f.d.querySelector('.meta-abstract').textContent,/CONCLUSION_SENTINEL/);
 f.click('#metaNext');f.click('#metaNext');assert.equal(f.d.querySelectorAll('.meta-paper').length,5);
 f.click('[data-read]');assert.equal(f.reads.length,1);
 f.click('[data-tab="reviews"]');assert.equal(f.d.querySelectorAll('.meta-paper').length,1);assert.match(f.d.getElementById('metaPanel').textContent,/出版年份不是检索截止日期/);
 assert.match(f.d.getElementById('metaSource').textContent,/fixture/);
 f.hub.close();assert.equal(f.d.getElementById('library').hidden,false);await f.hub.open();assert.equal(f.requests.length,1);
 }finally{f.dom.window.close();}
});
test('screening requires an exclusion reason, preserves draft on cancelled navigation, persists decisions per account and exports beyond one page',async()=>{
 const f=fixture();try{await f.hub.open();f.click('[data-tab="evidence"]');
 const card=f.d.querySelector('.meta-paper'),select=card.querySelector('[data-field="status"]'),id=card.dataset.id;
 select.value='exclude';f.click('[data-save]');assert.match(card.textContent,/请填写排除理由/);assert.equal(f.storage.getItem('litdb-meta-tracker'),null);
 f.w.confirm=()=>false;assert.equal(f.hub.close(),false);f.click('[data-tab="reviews"]');assert.equal(f.d.querySelectorAll('.meta-paper').length,20);
 card.querySelector('[data-field="note"]').value='Animal model, outside specified PICO';f.click('[data-save]');assert.equal(f.saved().decisions['cold-recovery'][id].status,'exclude');
 f.click('#metaExport');const csv=await f.blobs.at(-1).text();assert.equal(csv.trim().split('\r\n').length,46);assert.match(csv,/Animal model/);
 f.click('#metaBackup');const backup=JSON.parse(await f.blobs.at(-1).text());assert.ok(backup.values['litdb-meta-tracker']);
 const other=Personal.create('other',f.w.localStorage);assert.equal(other.getItem('litdb-meta-tracker'),null);other.restore(backup);assert.equal(other.getItem('litdb-meta-tracker'),f.storage.getItem('litdb-meta-tracker'));
 }finally{f.dom.window.close();}
});
test('follow baseline distinguishes new corpus records; explicit scans run only on demand and keep screening decisions',async()=>{
 const f=fixture();try{await f.hub.open();f.click('#metaFollow');assert.equal(f.saved().topics['cold-recovery'].seen.length,46);
 f.papers.push({id:'fresh',title:'Cold-water immersion exercise recovery new',year:2026,abstract:'New evidence'});
 f.click('[data-tab="evidence"]');f.click('#metaScan');for(let i=0;i<30&&f.d.querySelector('#metaScan').disabled;i++)await delay();
 assert.match(f.d.querySelector('.meta-metrics').textContent,/47/);assert.equal(f.requests.length,1,'scan reuses already loaded corpus');
 const filter=f.d.getElementById('metaFilter');filter.value='new';filter.dispatchEvent(new f.w.Event('change',{bubbles:true}));assert.equal(f.d.querySelectorAll('.meta-paper').length,1);assert.equal(f.d.querySelector('.meta-paper').dataset.id,'fresh');
 f.click('#metaSeen');assert.equal(f.saved().topics['cold-recovery'].seen.length,47);assert.equal(f.d.querySelectorAll('.meta-paper').length,0);
 }finally{f.dom.window.close();}
});
test('network failure is retryable, closing during loading cannot show stale workspace, and PDF/AI endpoints are never called',async()=>{
 const f=fixture();try{
 f.w.fetch=async()=>{throw Error('offline');};await f.hub.open();assert.match(f.d.getElementById('metaNotice').textContent,/加载失败/);assert.ok(f.d.getElementById('metaRetry'));
 let resolve;f.w.fetch=()=>new Promise(r=>resolve=r);const pending=f.hub.open();f.hub.close();resolve({ok:true,json:async()=>({format:'litdb-meta-candidates',version:1,ruleVersion:1,corpus:{version:'x',total:0},topics:[{...rules.topics[0],records:[]}]})});await pending;assert.equal(f.d.getElementById('metaHub').hidden,true);
 assert.equal(f.requests.length,0);
 }finally{f.dom.window.close();}
});
test('opening from workbench restores scrolling; corrupted tracker data is preserved rather than overwritten',async()=>{
 const f=fixture();try{
 const style=f.d.createElement('style');style.textContent='.is-app{overflow:hidden}'+fs.readFileSync(path.join(__dirname,'../meta-hub.css'),'utf8');f.d.head.appendChild(style);f.d.body.classList.add('is-app');
 f.storage.setItem('litdb-meta-tracker','{"topics":"broken","decisions":{}}');
 f.hub.configure({storage:f.storage,papers:()=>f.papers,paper:id=>f.papers.find(p=>p.id===id),enter:()=>{},leave:()=>{}});
 await f.hub.open();assert.equal(f.w.getComputedStyle(f.d.body).overflow,'auto');
 f.click('#metaFollow');assert.equal(f.storage.getItem('litdb-meta-tracker'),'{"topics":"broken","decisions":{}}');
 }finally{f.dom.window.close();}
});

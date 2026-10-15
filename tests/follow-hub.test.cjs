const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{test}=require('node:test');
let JSDOM;try{({JSDOM}=require('jsdom'));}catch(e){({JSDOM}=require(path.join(process.env.TEMP,'sport-env-startup-tests','node_modules','jsdom')));}
const hubModule=require('../follow-hub.js'),html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const markup=html.slice(html.indexOf('<div id="followHub" hidden>'),html.indexOf('<!-- ================= 全局阅读弹窗'));
function fixture(){
 const dom=new JSDOM(markup,{url:'https://fixture.invalid/#z-search'}),w=dom.window,d=w.document;
 w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
 const records=Array.from({length:45},(_,i)=>({id:'paper-'+i,title:'Exercise '+i,authors:i<12?['Patrick Rodrigues','Ben Lee']:['Ben Lee'],journal:'Test Journal',year:2025,cited:i,abstract:'BACKGROUND: '+('Complete paragraph. '.repeat(30))+' FINAL_CONCLUSION',tags:[]}));
 const follows={authors:{'Patrick Rodrigues':{},'Ben Lee':{}},journals:{'Test Journal':{}}};const deleted=new Set(),reads=[],favs=new Set();let enter=0,leave=0;
 const hub=hubModule.create({document:d,window:w,escape:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),papers:()=>records,follows:()=>follows,deleted:id=>deleted.has(id),badges:()=>'<span class="badge jcr">JCR Q1</span>',toggle:(tab,name)=>{const map=follows[tab==='au'?'authors':'journals'];if(map[name])delete map[name];else map[name]={};},read:id=>reads.push(id),favorited:id=>favs.has(id),favorite:id=>favs.add(id),enter:()=>enter++,leave:()=>leave++});
 hub.bind();hub.render();return {dom,w,d,records,follows,hub,deleted,reads,counts:()=>({enter,leave})};
}
test('author selection shows all twelve papers, full abstracts and working reading actions',()=>{
 const f=fixture();try{f.hub.open();assert.equal(f.d.querySelectorAll('.follow-paper').length,12);assert.match(f.d.getElementById('folPaperCount').textContent,/全部 12 篇/);
 const details=f.d.querySelector('details');details.open=true;assert.match(details.textContent,/FINAL_CONCLUSION/);
 f.d.querySelector('[data-read]').click();assert.equal(f.reads.length,1);assert.equal(f.d.getElementById('followHub').hidden,false);
 f.d.getElementById('folBack').click();assert.equal(f.d.getElementById('followHub').hidden,true);assert.equal(f.w.location.hash,'#z-search');assert.equal(f.counts().leave,1);
 }finally{f.dom.window.close();}
});
test('pagination reaches every author paper; journal selection and deletion counts agree',()=>{
 const f=fixture();try{f.hub.open();f.d.querySelector('[data-person="1"]').click();const seen=new Set();
 for(let page=0;page<3;page++){f.d.querySelectorAll('[data-paper]').forEach(el=>seen.add(el.dataset.paper));if(page<2)f.d.getElementById('folNext').click();}
 assert.equal(seen.size,45);assert.equal(f.d.querySelectorAll('[data-paper]').length,5);assert.equal(f.d.getElementById('folNext').disabled,true);
 f.deleted.add('paper-1');f.d.getElementById('folTabJo').click();assert.match(f.d.getElementById('folPaperCount').textContent,/全部 44 篇/);
 f.d.getElementById('folPageSize').value='100';f.d.getElementById('folPageSize').dispatchEvent(new f.w.Event('change'));assert.equal(f.d.querySelectorAll('[data-paper]').length,44);
 assert.ok(!f.d.querySelector('[data-paper="paper-1"]'));
 }finally{f.dom.window.close();}
});
test('direct links open selected authors and unfollow never deletes their articles',()=>{
 const f=fixture();try{f.w.history.replaceState(null,'','#following?tab=au&name=Ben+Lee');f.hub.route();assert.equal(f.d.getElementById('folSelected').textContent,'Ben Lee');
 f.d.getElementById('folToggle').click();assert.ok(!f.follows.authors['Ben Lee']);assert.equal(f.records.length,45);assert.match(f.d.getElementById('folPaperCount').textContent,/全部 45 篇/);
 f.w.history.replaceState(null,'','#z-search');f.hub.route();assert.equal(f.hub.isOpen(),false);
 }finally{f.dom.window.close();}
});

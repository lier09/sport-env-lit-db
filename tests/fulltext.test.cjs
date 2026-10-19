const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{test}=require('node:test');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../fulltext-reader.js'),'utf8');
const work={id:'https://openalex.org/W2168063968',title:'Cerebral perturbations during exercise in hypoxia',has_content:{pdf:true},best_oa_location:null};
const pdf='%PDF-1.7\nfixture body';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}assert.fail('Full text UI did not update');}
function setup(fetch){
 const dom=new JSDOM('<button id="origin">Read</button>',{url:'https://fixture.invalid/',runScripts:'dangerously',pretendToBeVisual:true}),w=dom.window,d=w.document,requests=[],stats={loads:0,renders:[],destroyed:0,revoked:0};
 w.Blob=Blob;w.TextDecoder=TextDecoder;w.AbortController=AbortController;
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
 w.HTMLElement.prototype.scrollTo=function(){};w.HTMLCanvasElement.prototype.getContext=()=>({});w.URL.createObjectURL=()=> 'blob:fixture';w.URL.revokeObjectURL=()=>stats.revoked++;
 w.fetch=async(u,o)=>{requests.push({url:u,options:o});return fetch(u,o);};
 w.eval(source);w.LitdbFulltext.configure({loadLibrary:async()=>{stats.loads++;return {GlobalWorkerOptions:{},getDocument:()=>({destroy:async()=>{stats.destroyed++;},promise:Promise.resolve({numPages:3,getPage:async(number)=>({getViewport:({scale})=>({width:600*scale,height:800*scale}),getTextContent:async()=>({items:[{str:'Full page '+number,hasEOL:true},{str:'Complete conclusion.',hasEOL:true}]}),render:()=>{stats.renders.push(number);return {promise:Promise.resolve(),cancel(){}};}})})})};}});
 return {dom,w,d,requests,stats};
}
function submitKey(a,value){a.d.getElementById('ftKey').value=value;a.d.getElementById('ftConfig').dispatchEvent(new a.w.Event('submit',{cancelable:true}));}
test('full text does no startup work; key-gated OpenAlex download renders in-page and releases resources on close',async()=>{
 const a=setup(async u=>u.includes('api.openalex.org')?json(work):new Response(pdf)),{w,d,stats,requests}=a;
 try{
  assert.equal(requests.length,0);assert.equal(stats.loads,0);d.getElementById('origin').focus();w.LitdbFulltext.open(work);
  await until(()=>!d.getElementById('ftConfig').hidden);assert.equal(requests.length,1);assert.equal(stats.loads,0);assert.match(d.getElementById('ftStatus').textContent,/API Key/);
  submitKey(a,'test-key');await until(()=>!d.getElementById('ftTools').hidden);await until(()=>stats.renders.length);
  const content=requests.find(r=>r.url.includes('content.openalex.org'));assert.equal(new URL(content.url).searchParams.get('api_key'),'test-key');assert.equal(content.options.credentials,'omit');assert.equal(content.options.cache,'no-store');
  assert.equal(w.localStorage.getItem('litdb-openalex-content-key'),null);assert.equal(d.getElementById('ftDownload').href,'blob:fixture');
  d.getElementById('ftNext').click();await until(()=>d.getElementById('ftPage').value==='2');d.getElementById('ftText').click();await until(()=>d.getElementById('ftTextPage').textContent.includes('Complete conclusion.'));assert.match(d.getElementById('ftTextPage').textContent,/Full page 2/);
  w.LitdbFulltext.close();assert.equal(stats.destroyed,1);assert.equal(stats.revoked,1);assert.equal(d.getElementById('ftCanvas').width,0);assert.equal(d.activeElement.id,'origin');
 }finally{w.close();}
});
test('no-content and network failure remain explicit; HTML and oversized responses never reach PDF.js',async()=>{
 for(const variant of ['none','html','large','network']){
  const a=setup(async u=>{if(variant==='network')throw new TypeError('Network error');if(u.includes('api.openalex.org'))return json({...work,has_content:{pdf:false},best_oa_location:variant==='none'?null:{pdf_url:'https://repository.invalid/paper.pdf'}});return new Response(variant==='html'?'<html>Sign in</html>':pdf,{headers:variant==='large'?{'content-length':String(81*1024*1024)}:{}});});
  try{a.w.LitdbFulltext.open(work);await until(()=>!a.d.getElementById('ftRetry').disabled);assert.equal(a.stats.loads,0);assert.equal(a.d.getElementById('ftTools').hidden,true);assert.match(a.d.getElementById('ftStatus').textContent,variant==='none'?/未找到/:/无法直接读取/);}
  finally{a.w.close();}
 }
});
test('publisher fallback never receives an OpenAlex key, and rate-limit errors do not trigger repeated downloads',async()=>{
 const a=setup(async u=>u.includes('api.openalex.org')?json({...work,best_oa_location:{pdf_url:'https://repository.invalid/paper.pdf'}}):u.includes('content.openalex.org')?json({},429):new Response(pdf));
 try{
  a.w.localStorage.setItem('litdb-openalex-content-key','test-key');a.w.LitdbFulltext.open(work);await until(()=>a.stats.renders.length);
  const publisher=a.requests.find(r=>r.url.startsWith('https://repository.invalid'));assert.equal(publisher.url,'https://repository.invalid/paper.pdf');assert.equal(a.requests.filter(r=>r.url.includes('content.openalex.org')).length,1);
  a.d.getElementById('ftForget').click();assert.equal(a.w.localStorage.getItem('litdb-openalex-content-key'),null);
 }finally{a.w.close();}
});
test('closing cancels in-flight downloads and stale responses cannot populate a different paper',async()=>{
 let delayed;
 const a=setup(async u=>u.includes('W2168063968')?new Promise(r=>{delayed=r;}):json({...work,id:'https://openalex.org/W123',has_content:{pdf:false}}));
 try{
  a.w.LitdbFulltext.open(work);const first=a.requests[0];a.w.LitdbFulltext.open({id:'W123',title:'Second paper'});await until(()=>!a.d.getElementById('ftRetry').disabled);
  assert.equal(first.options.signal.aborted,true);delayed(json(work));await new Promise(r=>setTimeout(r,20));assert.equal(a.d.getElementById('ftTitle').textContent,'Second paper');assert.match(a.d.getElementById('ftStatus').textContent,/未找到/);assert.equal(a.stats.loads,0);
 }finally{a.w.close();}
});
test('local PDF upload renders without a key and an invalid file preserves a visible error',async()=>{
 const a=setup(async()=>json({...work,has_content:{pdf:false}}));try{
  a.w.LitdbFulltext.open(work);await until(()=>!a.d.getElementById('ftRetry').disabled);var input=a.d.getElementById('ftUpload');Object.defineProperty(input,'files',{configurable:true,value:[new Blob([pdf],{type:'application/pdf'})]});input.dispatchEvent(new a.w.Event('change'));await until(()=>a.stats.renders.length);assert.match(a.d.getElementById('ftStatus').textContent,/本地上传/);
  Object.defineProperty(input,'files',{configurable:true,value:[new Blob(['not pdf'])]});input.dispatchEvent(new a.w.Event('change'));await until(()=>a.d.getElementById('ftStatus').textContent.includes('有效 PDF'));assert.equal(a.d.getElementById('ftTools').hidden,true);
 }finally{a.w.close();}
});

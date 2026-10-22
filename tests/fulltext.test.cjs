const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{test}=require('node:test');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../fulltext-reader.js'),'utf8');
const work={id:'https://openalex.org/W2168063968',title:'Cerebral perturbations during exercise in hypoxia',has_content:{pdf:true},best_oa_location:null};
const pdf='%PDF-1.7\nfixture body';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}assert.fail('Full text UI did not update');}
function setup(fetch,content){
 const dom=new JSDOM('<button id="origin">Read</button>',{url:'https://fixture.invalid/',runScripts:'dangerously',pretendToBeVisual:true}),w=dom.window,d=w.document,requests=[],stats={loads:0,renders:[],texts:[],destroyed:0,revoked:0};
 w.Blob=Blob;w.TextDecoder=TextDecoder;w.AbortController=AbortController;
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
 w.HTMLElement.prototype.scrollTo=function(){};w.HTMLCanvasElement.prototype.getContext=()=>({});w.URL.createObjectURL=()=> 'blob:fixture';w.URL.revokeObjectURL=()=>stats.revoked++;
 w.fetch=async(u,o)=>{requests.push({url:u,options:o});return fetch(u,o);};
 w.eval(fs.readFileSync(path.join(__dirname,'../article-reader.js'),'utf8'));w.eval(source);w.LitdbFulltext.configure({loadLibrary:async()=>{stats.loads++;return {GlobalWorkerOptions:{},getDocument:()=>({destroy:async()=>{stats.destroyed++;},promise:Promise.resolve({numPages:3,getPage:async(number)=>({getViewport:({scale})=>({width:600*scale,height:800*scale}),getTextContent:async()=>{stats.texts.push(number);return content?content(number):{items:[{str:'Full page '+number,hasEOL:true},{str:'Complete conclusion.',hasEOL:true}]};},render:()=>{stats.renders.push(number);return {promise:Promise.resolve(),cancel(){}};}})})})};}});
 return {dom,w,d,requests,stats};
}
function submitKey(a,value){a.d.getElementById('ftKey').value=value;a.d.getElementById('ftConfig').dispatchEvent(new a.w.Event('submit',{cancelable:true}));}
test('full text does no startup work; key-gated OpenAlex download renders in-page and releases resources on close',async()=>{
 const a=setup(async u=>u.includes('api.openalex.org')?json(work):new Response(pdf)),{w,d,stats,requests}=a;
 try{
  assert.equal(requests.length,0);assert.equal(stats.loads,0);d.getElementById('origin').focus();w.LitdbFulltext.open(work);
  await until(()=>!d.getElementById('ftRetry').disabled);assert.equal(d.getElementById('ftConfig').hidden,true);assert.equal(requests.length,1);assert.equal(stats.loads,0);assert.match(d.getElementById('ftStatus').textContent,/密钥/);d.getElementById('ftSettings').click();
  submitKey(a,'test-key');await until(()=>!d.getElementById('ftTools').hidden);await until(()=>stats.renders.length);
  const content=requests.find(r=>r.url.includes('content.openalex.org'));assert.equal(new URL(content.url).searchParams.get('api_key'),'test-key');assert.equal(content.options.credentials,'omit');assert.equal(content.options.cache,'no-store');
  assert.equal(w.localStorage.getItem('litdb-openalex-content-key'),null);assert.equal(d.getElementById('ftDownload').href,'blob:fixture');
  d.getElementById('ftNext').click();await until(()=>d.getElementById('ftPage').value==='2');d.getElementById('ftText').click();await until(()=>d.getElementById('ftTextPage').textContent.includes('Complete conclusion.'));assert.match(d.getElementById('ftTextPage').textContent,/Full page 2/);
  w.LitdbFulltext.close();assert.equal(stats.destroyed,1);assert.equal(stats.revoked,1);assert.equal(d.getElementById('ftCanvas').width,0);assert.equal(d.activeElement.id,'origin');
 }finally{w.close();}
});

const readableXML=`<article xml:lang="en"><front><article-meta><article-id pub-id-type="doi">10.1234/test</article-id><title-group><article-title>Readable research</article-title></title-group><abstract><p>Complete source abstract.</p></abstract><permissions><license><license-p>CC BY test license.</license-p></license></permissions></article-meta></front><body><sec id="methods"><title>Methods</title><p>${'Detailed study methods and complete results. '.repeat(8)}<bold>Important result</bold><xref rid="fig1">Figure 1</xref></p><fig id="fig1"><label>Figure 1</label><caption><p>Original figure caption.</p></caption><graphic><?image-cloudpmc-urn urn:cdn:blobs/abcd/123/ef012/image.jpg?></graphic></fig><table-wrap id="tab1"><label>Table 1</label><caption><p>Results</p></caption><table><tbody><tr><td>Outcome</td><td>12.3</td></tr></tbody></table></table-wrap><p><ext-link xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="javascript:alert(1)">Unsafe URL</ext-link><script>alert(1)</script><img src="bad" onerror="alert(1)"/></p></sec><sec id="conclusion"><title>Conclusion</title><p>FINAL_WEB_CONCLUSION</p></sec></body><back><ref-list><ref id="ref1"><mixed-citation>Study citation.</mixed-citation></ref></ref-list></back></article>`;
test('structured open full text is preferred without a key or PDF runtime, retains semantic content, and switches summary/full text without refetching',async()=>{
 const a=setup(async u=>u.includes('/search?')?json({resultList:{result:[{pmcid:'PMC123',doi:'10.1234/test',isOpenAccess:'Y'}]}}):new Response(readableXML));try{
  a.w.localStorage.setItem('litdb-openalex-content-key','private-fixture-key');assert.equal(a.requests.length,0);
  a.w.LitdbFulltext.open({...work,doi:'10.1234/test',abstract:'Original library abstract.'});await until(()=>a.d.querySelector('#ftStructured .article-full'));
  assert.equal(a.stats.loads,0);assert.equal(a.requests.length,2);assert.ok(a.requests.every(r=>r.url.startsWith('https://www.ebi.ac.uk/')&&!r.url.includes('private-fixture-key')));
  const article=a.d.querySelector('#ftStructured article');assert.equal(article.lang,'en');assert.equal(article.getAttribute('translate'),'yes');assert.match(article.textContent,/FINAL_WEB_CONCLUSION/);assert.match(article.textContent,/CC BY/);
  assert.equal(article.querySelector('table td').textContent,'Outcome');assert.equal(article.querySelector('img').src,'https://cdn.ncbi.nlm.nih.gov/pmc/blobs/abcd/123/ef012/image.jpg');assert.equal(article.querySelectorAll('script,[onerror],a[href^="javascript"]').length,0);
  assert.equal(a.d.getElementById('ftTools').hidden,true);a.d.getElementById('ftSummary').click();assert.equal(a.d.getElementById('ftStructured').hidden,true);assert.match(a.d.getElementById('ftAbstract').textContent,/Original library abstract/);
  a.d.getElementById('ftFull').click();assert.equal(a.d.getElementById('ftStructured').hidden,false);assert.equal(a.requests.length,2);
  a.w.LitdbFulltext.close();assert.equal(a.d.getElementById('ftStructured').textContent,'');
 }finally{a.w.close();}
});
test('unavailable or mismatched structured text falls back to the original PDF path instead of showing another paper',async()=>{
 for(const variant of ['none','wrong-doi']){const a=setup(async u=>u.includes('/search?')?json({resultList:{result:variant==='none'?[]:[{pmcid:'PMC123',doi:'10.1234/test',isOpenAccess:'Y'}]}}):u.includes('/fullTextXML')?new Response(readableXML.replace('10.1234/test','10.1234/other')):u.includes('api.openalex.org')?json({...work,best_oa_location:{pdf_url:'https://repository.invalid/paper.pdf'}}):new Response(pdf));try{
  a.w.LitdbFulltext.open({...work,doi:'10.1234/test'});await until(()=>a.stats.renders.length);assert.equal(a.d.getElementById('ftStructured').textContent,'');assert.equal(a.stats.loads,1);
 }finally{a.w.close();}}
});
test('W loads only the visible reader, ignores typing and modifiers, and reuses loaded full content',async()=>{
 const a=setup(async u=>u.includes('/search?')?json({resultList:{result:[{pmcid:'PMC123',doi:'10.1234/test',isOpenAccess:'Y'}]}}):new Response(readableXML));try{
  const b=a.d.createElement('button');b.id='r_btnFulltext';b.onclick=()=>a.w.LitdbFulltext.open({...work,doi:'10.1234/test'});a.d.body.appendChild(b);
  const input=a.d.createElement('textarea');a.d.body.appendChild(input);input.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'w',bubbles:true}));assert.equal(a.requests.length,0);
  a.d.body.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'w',ctrlKey:true,bubbles:true}));assert.equal(a.requests.length,0);
  b.hidden=true;a.d.body.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'w',bubbles:true}));assert.equal(a.requests.length,0);b.hidden=false;
  a.d.body.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'w',bubbles:true}));await until(()=>a.d.querySelector('#ftStructured article'));
  a.d.getElementById('ftSummary').click();a.d.getElementById('fulltextDialog').dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'w',bubbles:true}));assert.equal(a.d.getElementById('ftStructured').hidden,false);assert.equal(a.requests.length,2);
 }finally{a.w.close();}
});
test('original PDF remains an explicit choice after structured full text succeeds',async()=>{
 const a=setup(async u=>u.includes('/search?')?json({resultList:{result:[{pmcid:'PMC123',doi:'10.1234/test',isOpenAccess:'Y'}]}}):u.includes('/fullTextXML')?new Response(readableXML):u.includes('api.openalex.org')?json({...work,best_oa_location:{pdf_url:'https://repository.invalid/paper.pdf'}}):new Response(pdf));try{
  a.w.LitdbFulltext.open({...work,doi:'10.1234/test'});await until(()=>a.d.querySelector('#ftStructured article'));a.d.getElementById('ftPDF').click();await until(()=>a.stats.renders.length);assert.equal(a.d.getElementById('ftStructured').hidden,true);assert.equal(a.d.getElementById('ftDownload').hidden,false);assert.equal(a.requests.filter(r=>r.url.includes('/search?')).length,1);
 }finally{a.w.close();}
});
test('applying an optional archive key preserves PDF selection; webpage cache is only restored on explicit webpage action',async()=>{
 const a=setup(async u=>u.includes('/search?')?json({resultList:{result:[{pmcid:'PMC123',doi:'10.1234/test',isOpenAccess:'Y'}]}}):u.includes('/fullTextXML')?new Response(readableXML):u.includes('api.openalex.org')?json(work):new Response(pdf));try{
  a.w.LitdbFulltext.open({...work,doi:'10.1234/test'});await until(()=>a.d.querySelector('#ftStructured article'));a.d.getElementById('ftPDF').click();await until(()=>!a.d.getElementById('ftRetry').disabled);
  assert.equal(a.d.getElementById('ftConfig').hidden,true);assert.equal(a.d.getElementById('ftPDF').getAttribute('aria-pressed'),'true');assert.equal(a.d.getElementById('ftStructured').hidden,true);
  a.d.getElementById('ftSettings').click();submitKey(a,'test-key');await until(()=>a.stats.renders.length);
  assert.equal(a.requests.filter(r=>r.url.includes('/search?')).length,1);assert.ok(a.requests.find(r=>r.url.includes('content.openalex.org')));assert.equal(a.d.getElementById('ftPDF').classList.contains('primary'),true);
  const count=a.requests.length;a.d.getElementById('ftRetry').click();assert.equal(a.d.getElementById('ftStructured').hidden,false);assert.equal(a.requests.length,count);assert.equal(a.d.getElementById('ftPDF').getAttribute('aria-pressed'),'false');
 }finally{a.w.close();}
});
test('blocked public PDF exposes a direct link and does not force or repeatedly open key entry',async()=>{
 const a=setup(async u=>u.includes('api.openalex.org')?json({...work,best_oa_location:{pdf_url:'https://repository.invalid/paper.pdf'}}):Promise.reject(new TypeError('CORS blocked')));try{
  a.w.LitdbFulltext.open(work);await until(()=>!a.d.getElementById('ftRetry').disabled);a.d.getElementById('ftPDF').click();await until(()=>!a.d.getElementById('ftRetry').disabled);
  assert.equal(a.d.getElementById('ftConfig').hidden,true);assert.equal(a.d.getElementById('ftExternalPDF').href,'https://repository.invalid/paper.pdf');assert.equal(a.d.getElementById('ftExternalPDF').hidden,false);assert.equal(a.d.getElementById('ftExternalPDF').target,'_blank');assert.match(a.d.getElementById('ftStatus').textContent,/新窗口/);
 }finally{a.w.close();}
});
test('licensed same-origin PDF catalog is loaded on demand, verifies bytes/hash and renders without OpenAlex credentials',async()=>{
 const crypto=require('node:crypto'),catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../open-pdf-sources.json'),'utf8'));
 for(const [identifier,entry] of Object.entries(catalog.papers)){
 const bytes=fs.readFileSync(path.join(__dirname,'..',entry.path));
 assert.equal(bytes.length,entry.bytes);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),entry.sha256);assert.equal(entry.license,'CC BY 4.0');assert.match(bytes.subarray(0,8).toString(),/%PDF-/);
 const a=setup(async u=>u.includes('open-pdf-sources.json')?json(catalog):u.includes(entry.path)?new Response(bytes):u.includes('/search?')?json({resultList:{result:[]}}):json({...work,has_content:{pdf:false}}));try{
  Object.defineProperty(a.w.crypto,'subtle',{value:crypto.webcrypto.subtle});assert.equal(a.requests.length,0);a.w.LitdbFulltext.open({...work,doi:identifier,title:entry.title});await until(()=>!a.d.getElementById('ftRetry').disabled);assert.equal(a.requests.filter(r=>r.url.includes(entry.path)).length,0);
  const count=a.requests.filter(r=>r.url.includes('api.openalex.org')).length;a.d.getElementById('ftPDF').click();await until(()=>a.stats.renders.length);
  assert.equal(a.requests.filter(r=>r.url.includes('api.openalex.org')).length,count);assert.equal(a.d.getElementById('ftConfig').hidden,true);assert.ok(a.d.getElementById('ftStatus').textContent.includes(entry.citation));assert.match(a.d.getElementById('ftStatus').textContent,/CC BY 4.0/);assert.equal(a.d.getElementById('ftSource').href,entry.source);
  assert.ok(!fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8').includes(entry.path),'PDF is not in startup shell');
 }finally{a.w.close();}
 }
});
test('PDF relay is on demand, posts only paper identifiers and never forwards the reader OpenAlex key',async()=>{
 const endpoint='https://project.supabase.co/functions/v1/pdf-reader',identifier='10.1234/relay';
 const a=setup(async u=>u===endpoint?new Response(pdf,{headers:{'X-Litdb-Protocol':'1','X-Litdb-Source':'https://www.frontiersin.org/paper.pdf','X-Litdb-DOI':identifier}}):u.includes('open-pdf-sources.json')?json({}):u.includes('/search?')?json({resultList:{result:[]}}):json({...work,has_content:{pdf:false}}));
 try{
  a.w.LITDB_PDF_SERVICE_URL=endpoint;a.w.SUPABASE_URL='https://project.supabase.co';a.w.SUPABASE_ANON_KEY='public-anon';
  a.w.localStorage.setItem('litdb-openalex-content-key','private-reader-key');assert.equal(a.requests.length,0);
  a.w.LitdbFulltext.open({...work,doi:identifier});await until(()=>a.stats.renders.length);
  const post=a.requests.find(x=>x.url===endpoint);assert.equal(post.options.method,'POST');assert.equal(post.options.credentials,'omit');
  assert.deepEqual(JSON.parse(post.options.body),{doi:identifier,workId:'W2168063968'});
  assert.equal(post.options.headers.Authorization,'Bearer public-anon');assert.ok(!JSON.stringify(post).includes('private-reader-key'));
  assert.equal(a.d.getElementById('ftSource').href,'https://www.frontiersin.org/paper.pdf');assert.match(a.d.getElementById('ftStatus').textContent,/开放 PDF 服务/);
 }finally{a.w.close();}
});
test('disabled PDF service sends no relay request and successful direct PDF bypasses the relay config',async()=>{
 const endpoint='https://project.supabase.co/functions/v1/pdf-reader';
 for(const direct of [true,false]){
  const a=setup(async u=>u.includes('pdf-service-config')?json({enabled:false,url:endpoint,protocol:1}):u.includes('api.openalex.org')?json({...work,has_content:{pdf:false},best_oa_location:direct?{pdf_url:'https://repository.invalid/paper.pdf'}:null}):new Response(pdf));
  try{a.w.SUPABASE_URL='https://project.supabase.co';a.w.LitdbFulltext.open(work);await until(()=>!a.d.getElementById('ftRetry').disabled);assert.ok(!a.requests.some(x=>x.url===endpoint));if(direct)assert.ok(!a.requests.some(x=>x.url.includes('pdf-service-config')));}finally{a.w.close();}
 }
});
test('PDF relay rejects DOI mismatches and shows service authorization failures without asking for OpenAlex keys',async()=>{
 const endpoint='https://project.supabase.co/functions/v1/pdf-reader';
 for(const variant of ['doi','auth','html']){
  const a=setup(async u=>u===endpoint?(variant==='auth'?json({},401):new Response(variant==='html'?'<html>error</html>':pdf,{headers:{'X-Litdb-Protocol':'1','X-Litdb-Source':'https://www.frontiersin.org/paper.pdf','X-Litdb-DOI':'10.1234/wrong'}})):u.includes('/search?')?json({resultList:{result:[]}}):json({...work,has_content:{pdf:false}}));
  try{a.w.LITDB_PDF_SERVICE_URL=endpoint;a.w.LitdbFulltext.open({...work,doi:'10.1234/correct'});await until(()=>!a.d.getElementById('ftRetry').disabled);assert.equal(a.stats.loads,0);assert.equal(a.d.getElementById('ftConfig').hidden,true);assert.match(a.d.getElementById('ftStatus').textContent,variant==='doi'?/标识不一致/:variant==='auth'?/服务尚未正确授权/:/没有返回有效/);}finally{a.w.close();}
 }
});
test('closing reader cancels relay download and prevents stale rendering',async()=>{
 const endpoint='https://project.supabase.co/functions/v1/pdf-reader';let finish,signal;
 const a=setup(async(u,o)=>u===endpoint?new Promise(resolve=>{finish=resolve;signal=o.signal;}):json({...work,has_content:{pdf:false}}));
 try{a.w.LITDB_PDF_SERVICE_URL=endpoint;a.w.LitdbFulltext.open(work);await until(()=>finish);a.w.LitdbFulltext.close();assert.equal(signal.aborted,true);finish(new Response(pdf,{headers:{'X-Litdb-Protocol':'1','X-Litdb-Source':'https://www.frontiersin.org/paper.pdf'}}));await new Promise(r=>setTimeout(r,30));assert.equal(a.stats.loads,0);}finally{a.w.close();}
});
test('no-content and network failure remain explicit; HTML and oversized responses never reach PDF.js',async()=>{
 for(const variant of ['none','html','large','network']){
  const a=setup(async u=>{if(variant==='network')throw new TypeError('Network error');if(u.includes('api.openalex.org'))return json({...work,has_content:{pdf:false},best_oa_location:variant==='none'?null:{pdf_url:'https://repository.invalid/paper.pdf'}});return new Response(variant==='html'?'<html>Sign in</html>':pdf,{headers:variant==='large'?{'content-length':String(81*1024*1024)}:{}});});
  try{a.w.LitdbFulltext.open(work);await until(()=>!a.d.getElementById('ftRetry').disabled);assert.equal(a.stats.loads,0);assert.equal(a.d.getElementById('ftTools').hidden,true);assert.match(a.d.getElementById('ftStatus').textContent,variant==='none'?/未找到/:/无法直接读取/);}
  finally{a.w.close();}
 }
});
test('public PDF is preferred without forwarding a key or spending an OpenAlex archive download',async()=>{
 const a=setup(async u=>u.includes('api.openalex.org')?json({...work,best_oa_location:{pdf_url:'https://repository.invalid/paper.pdf'}}):u.includes('content.openalex.org')?json({},429):new Response(pdf));
 try{
  a.w.localStorage.setItem('litdb-openalex-content-key','test-key');a.w.LitdbFulltext.open(work);await until(()=>a.stats.renders.length);
  const publisher=a.requests.find(r=>r.url.startsWith('https://repository.invalid'));assert.equal(publisher.url,'https://repository.invalid/paper.pdf');assert.equal(a.requests.filter(r=>r.url.includes('content.openalex.org')).length,0);
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

test('browser-readable HTML exposes all requested pages without more network traffic and reuses extracted text',async()=>{
 const a=setup(async u=>u.includes('api.openalex.org')?json(work):new Response(pdf));try{
  a.w.localStorage.setItem('litdb-openalex-content-key','test-key');a.w.LitdbFulltext.open(work);await until(()=>a.stats.renders.length);
  assert.equal(a.stats.texts.length,0,'no text extraction before user requests it');const requests=a.requests.length;
  a.d.getElementById('ftText').click();await until(()=>a.d.querySelector('#ftTextPage p'));assert.equal(a.d.getElementById('ftTextPage').tagName,'ARTICLE');assert.equal(a.d.getElementById('ftTextPage').getAttribute('translate'),'yes');assert.equal(a.d.querySelector('.ft-text-section').lang,'en');
  a.d.getElementById('ftWholeText').click();await until(()=>a.d.querySelectorAll('.ft-text-section').length===3);
  assert.equal(a.requests.length,requests);assert.deepEqual(a.stats.texts,[1,2,3]);assert.match(a.d.getElementById('ftTextPage').textContent,/Full page 3/);assert.equal(a.d.getElementById('ftPage').disabled,true);
  a.d.getElementById('ftWholeText').click();await until(()=>a.d.querySelectorAll('.ft-text-section').length===1);assert.deepEqual(a.stats.texts,[1,2,3]);
  a.d.getElementById('ftBack').click();assert.equal(a.d.getElementById('ftTextPage').textContent,'');assert.equal(a.w.LitdbFulltext.isOpen(),false);
 }finally{a.w.close();}
});
test('PDF text remains inert HTML and empty scanned pages explain the OCR requirement',async()=>{
 const a=setup(async u=>u.includes('api.openalex.org')?json(work):new Response(pdf),number=>({items:number===2?[]:[{str:'<script>not executable</script> This is extracted English text.',hasEOL:true}]}));try{
  a.w.localStorage.setItem('litdb-openalex-content-key','test-key');a.w.LitdbFulltext.open(work);await until(()=>a.stats.renders.length);a.d.getElementById('ftText').click();await until(()=>a.d.querySelector('#ftTextPage p'));
  assert.equal(a.d.querySelector('#ftTextPage script'),null);assert.match(a.d.getElementById('ftTextPage').textContent,/<script>/);a.d.getElementById('ftNext').click();await until(()=>a.d.getElementById('ftTextPage').textContent.includes('扫描页'));
 }finally{a.w.close();}
});

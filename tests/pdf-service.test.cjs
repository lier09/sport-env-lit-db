const {test}=require('node:test'),assert=require('node:assert/strict');
const doi='10.3389/fspor.2026.1738075',origin='https://lier09.github.io';
const PDF='https://public-pages-files-2026.frontiersin.org/paper.pdf',PAGE='https://www.frontiersin.org/paper/full';
const bytes='%PDF-1.7\nverified fixture';
const json=x=>Response.json(x);
const crossref=(extra={})=>json({message:{DOI:doi,license:[{URL:'https://creativecommons.org/licenses/by/4.0/'}],link:[{URL:PDF,'content-type':'application/pdf'}],...extra}});
const req=(body={doi},extra={})=>new Request('https://project.supabase.co/functions/v1/pdf-reader',{method:'POST',headers:{origin,'content-type':'application/json',...extra},body:JSON.stringify(body)});
const modulePromise=import('../supabase/functions/pdf-reader/service.mjs');

test('PDF service: methods/CORS/identifier validation cannot trigger upstream I/O',async()=>{
 const {createHandler,allowedURL}=await modulePromise;let count=0;
 const handle=createHandler({fetcher:async()=>{count++;throw Error('unexpected')}});
 assert.equal((await handle(req({}, {origin:'https://evil.invalid'}))).status,403);
 assert.equal((await handle(new Request('https://fixture.invalid',{method:'OPTIONS',headers:{origin}}))).status,204);
 for(const body of [{url:'http://127.0.0.1/admin'},{doi:'invalid'},{doi:'10.1234/x?api_key=secret'},{workId:'not-a-work'},{}])assert.equal((await handle(req(body))).status,400);
 assert.equal(count,0);
 for(const url of ['http://www.frontiersin.org/a','https://127.0.0.1/a','https://169.254.169.254/a','https://www.frontiersin.org.evil.invalid/a','https://user:pw@www.frontiersin.org/a','https://www.frontiersin.org:8443/a','https://www.frontiersin.org/a?api_key=secret'])assert.equal(allowedURL(url),null);
});

test('PDF service: exact DOI + open Crossref license resolves PDF without OpenAlex or browser credentials',async()=>{
 const {createHandler}=await modulePromise,calls=[];
 const handle=createHandler({fetcher:async(url,opts)=>{calls.push({url,opts});return url.includes('api.crossref.org')?crossref():new Response(bytes);}});
 const res=await handle(req({doi},{authorization:'Bearer public-anon-key'}));
 assert.equal(res.status,200);assert.equal(await res.text(),bytes);
 assert.equal(res.headers.get('x-litdb-doi'),doi);assert.equal(res.headers.get('x-litdb-source'),PDF);
 assert.equal(res.headers.get('access-control-allow-origin'),origin);assert.equal(res.headers.get('cache-control'),'no-store');
 assert.equal(calls.length,2);assert.ok(calls.every(x=>x.opts.credentials==='omit'&&!JSON.stringify(x).includes('public-anon-key')));
});

test('PDF service: registered publisher page must match DOI before citation_pdf_url is followed',async()=>{
 const {createHandler}=await modulePromise,calls=[];
 const handle=createHandler({fetcher:async url=>{calls.push(url);if(url.includes('api.crossref.org'))return crossref({link:[{URL:PAGE}]});if(url===PAGE)return new Response(`<meta name="citation_doi" content="${doi}"><meta name="citation_pdf_url" content="${PDF}">`);return new Response(bytes);}});
 const res=await handle(req());assert.equal(res.status,200);assert.equal(await res.text(),bytes);assert.deepEqual(calls.slice(1),[PAGE,PDF]);
});

test('PDF service: wrong DOI and paywalled links are never downloaded from Crossref',async()=>{
 const {createHandler}=await modulePromise;
 for(const variant of ['wrong','closed','future']){
  const calls=[];const handle=createHandler({fetcher:async url=>{calls.push(url);if(url.includes('api.crossref.org'))return crossref(variant==='wrong'?{DOI:'10.1234/other'}:variant==='closed'?{license:[]}:{license:[{URL:'https://creativecommons.org/licenses/by/4.0/',start:{'date-time':'2099-01-01'}}]});return json({id:'https://openalex.org/W1',doi:'https://doi.org/'+doi,locations:[]});}});
  assert.notEqual((await handle(req())).status,200);assert.ok(!calls.includes(PDF));
 }
});

test('PDF service: OpenAlex alternatives are tried and only OA locations are eligible',async()=>{
 const {createHandler}=await modulePromise,calls=[];
 const second='https://journals.plos.org/open.pdf';
 const handle=createHandler({openalexKey:'server-only-key',fetcher:async(url,opts)=>{calls.push({url,opts});if(url.includes('api.crossref.org'))return crossref({license:[]});if(url.includes('api.openalex.org'))return json({id:'https://openalex.org/W1',doi:'https://doi.org/'+doi,best_oa_location:{pdf_url:PDF,is_oa:true},locations:[{pdf_url:second,is_oa:true},{pdf_url:'https://www.nature.com/closed.pdf',is_oa:false}]});if(url===PDF)return new Response('<html>captcha</html>');return new Response(bytes);}});
 const res=await handle(req());assert.equal(res.status,200);assert.equal(res.headers.get('x-litdb-source'),second);
 const signed=calls.find(x=>x.url.includes('api.openalex.org'));assert.equal(new URL(signed.url).searchParams.get('api_key'),'server-only-key');
 assert.ok(calls.filter(x=>!x.url.includes('api.openalex.org')).every(x=>!JSON.stringify(x).includes('server-only-key')));
 assert.ok(!calls.some(x=>x.url.includes('closed.pdf')));
});

test('PDF service: redirects are checked at every hop and cannot target private or unknown hosts',async()=>{
 const {createHandler}=await modulePromise;
 for(const location of ['http://127.0.0.1/admin','https://evil.invalid/pdf','https://www.frontiersin.org/a?api_key=leak']){
  const calls=[];const handle=createHandler({fetcher:async url=>{calls.push(url);if(url.includes('api.crossref.org'))return crossref();if(url===PDF)return new Response(null,{status:302,headers:{location}});return json({doi,locations:[]});}});
  assert.notEqual((await handle(req())).status,200);assert.ok(!calls.includes(location));
 }
});

test('PDF service: declared and streamed file size limits reject oversized files',async()=>{
 const {createHandler}=await modulePromise;
 for(const declared of [true,false]){
  const handle=createHandler({maxPDF:8,fetcher:async url=>url.includes('api.crossref.org')?crossref():url===PDF?new Response(bytes,{headers:declared?{'content-length':'999'}:{}}):json({doi,locations:[]})});
  assert.notEqual((await handle(req())).status,200);
 }
});

test('PDF service: non-PDF HTML is never returned as an application/pdf success',async()=>{
 const {createHandler}=await modulePromise;
 const handle=createHandler({fetcher:async url=>url.includes('api.crossref.org')?crossref():url===PDF?new Response('<html>Log in</html>'):json({doi,locations:[]})});
 const res=await handle(req());assert.notEqual(res.status,200);assert.match(res.headers.get('content-type'),/json/);
});

test('PDF service: Work ID is checked against resolved metadata',async()=>{
 const {createHandler}=await modulePromise;
 const handle=createHandler({fetcher:async()=>json({id:'https://openalex.org/W2',doi,locations:[{is_oa:true,pdf_url:PDF}]})});
 const res=await handle(req({workId:'W1'}));assert.equal(res.status,422);assert.equal((await res.json()).code,'identifier_mismatch');
});

test('PDF service: per-isolate limiter returns Retry-After and recovers after its window',async()=>{
 const {createHandler}=await modulePromise;let now=0;
 const handle=createHandler({perIP:1,clock:()=>now,fetcher:async url=>url.includes('api.crossref.org')?crossref():new Response(bytes)});
 assert.equal((await handle(req())).status,200);const busy=await handle(req());assert.equal(busy.status,429);assert.equal(busy.headers.get('retry-after'),'600');
 now=600001;assert.equal((await handle(req())).status,200);
});

test('PDF service: deadline abort is explicit and does not expose upstream exception details',async()=>{
 const {createHandler}=await modulePromise;
 const handle=createHandler({timeoutMs:5,fetcher:async(url,opts)=>new Promise((resolve,reject)=>{const fail=()=>reject(new Error('secret internal exception'));if(opts.signal.aborted)fail();else opts.signal.addEventListener('abort',fail,{once:true});})});
 const res=await handle(req());assert.equal(res.status,504);assert.equal(await res.text(),'{"code":"download_timeout"}');
});

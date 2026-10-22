const {test}=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const review=require('../environment-review.js'),crypto=require('node:crypto');
const endpoint='https://project.supabase.co/functions/v1/environment-review',base='https://project.supabase.co';
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Review UI did not update');}
function setup({enabled=true,canReview=true,rows=[],saveError=false}={}){
 const dom=new JSDOM('<div id="host"></div>',{url:'https://fixture.invalid/'}),w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.confirm=()=>true;
 Object.defineProperty(w.crypto,'randomUUID',{value:crypto.randomUUID});
 const papers=[{id:'https://openalex.org/W1',title:'Unclassified study',env:['待分类'],tags:['机制研究']},{id:'W2',title:'No environment',env:[]},{id:'W3',title:'Known heat study',env:['高温']}];
 let server=rows.slice(),updates=0,fail=saveError;const calls=[],requests=new Map();
 w.fetch=async(url,opts={})=>{
  calls.push({url,opts});
  if(url.includes('environment-review-config'))return Response.json({enabled,protocol:1,url:endpoint});
  if(url.includes('/rest/v1/literature_env_reviews'))return Response.json(server);
  if(url.includes('/auth/v1/token'))return Response.json({access_token:'user-access-token',refresh_token:'must-not-store'});
  if(url===endpoint&&opts.method!=='POST')return Response.json(canReview?{can_review:true}:{code:'admin_required'},{status:canReview?200:403});
  if(url===endpoint&&opts.method==='POST'){
   const payload=JSON.parse(opts.body);if(requests.has(payload.request_id))return Response.json(requests.get(payload.request_id));
   if(payload.changes.some(c=>(server.find(x=>x.paper_id===c.paper_id)?.revision||0)!==c.expected_revision))return Response.json({code:'revision_conflict'},{status:409});
   const changed=payload.changes.map(c=>({paper_id:c.paper_id,environments:c.environments,revision:c.expected_revision+1,updated_at:'2026-10-22T06:00:00Z'}));
   server=server.filter(x=>!changed.some(c=>c.paper_id===x.paper_id)).concat(changed);updates++;requests.set(payload.request_id,{rows:changed});
   if(fail){fail=false;throw new TypeError('network interrupted after commit');}
   return Response.json({rows:changed});
  }
  throw Error('Unexpected request '+url);
 };
 const controller=review.create({window:w,papers,base,anon:'public-anon',existingToken:()=> 'admin-token',getSelected:()=>papers.slice(0,2),onlyPending:()=>{},onChange:()=>{}});
 return {dom,w,d:w.document,papers,controller,calls,get server(){return server;},set server(v){server=v;},get updates(){return updates;}};
}
test('pending normalization distinguishes scientific environments, preserves source and never infers population/type',()=>{
 const papers=[{id:'W1',env:['待分类'],population:'animal'},{id:'W2',env:[]},{id:'W3',env:['低温','高温']}];review.apply(papers,[]);
 assert.deepEqual(papers.map(p=>p.env),[['待核查'],['待核查'],['低温','高温']]);assert.deepEqual(papers[0]._reviewSourceEnv,['待分类']);assert.equal(papers[0].population,'animal');
 review.apply(papers,[{paper_id:'W1',environments:['高氧','低温'],revision:1}]);assert.deepEqual(papers[0].env,['高氧','低温']);assert.deepEqual(papers[0]._reviewSourceEnv,['待分类']);
 review.apply(papers,[{paper_id:'W1',environments:[],revision:2}]);assert.deepEqual(papers[0].env,['待核查']);assert.equal(papers[0]._envReviewConfirmed,false);
});
test('invalid public review rows are rejected before papers are changed',()=>{
 const papers=[{id:'W1',env:['低温']}];assert.throws(()=>review.apply(papers,[{paper_id:'W1',environments:['invented'],revision:1}]));assert.deepEqual(papers[0].env,['低温']);
});
test('admin batch assignment applies all selected records and a separate visitor reads the shared result',async()=>{
 const a=setup();try{
  await a.controller.load();a.controller.mount(a.d.getElementById('host'));await a.controller.open(a.papers.slice(0,2));
  a.d.querySelector('input[value="高氧"]').checked=true;a.d.querySelector('input[value="交叉适应"]').checked=true;
  a.d.getElementById('erAssign').dispatchEvent(new a.w.Event('submit',{cancelable:true}));await until(()=>!a.d.getElementById('environmentReviewDialog').open);
  assert.deepEqual(a.papers[0].env,['高氧','交叉适应']);assert.deepEqual(a.papers[1].env,['高氧','交叉适应']);assert.deepEqual(a.papers[2].env,['高温']);assert.equal(a.updates,1);
  const visitor=setup({rows:a.server});try{await visitor.controller.load();assert.deepEqual(visitor.papers[0].env,['高氧','交叉适应']);}finally{visitor.dom.window.close();}
  assert.equal(a.w.localStorage.length,0,'decisions are not local personal overrides');
 }finally{a.dom.window.close();}
});
test('revision conflict keeps local decisions unchanged until a refresh',async()=>{
 const a=setup();try{await a.controller.load();await a.controller.open([a.papers[0]]);a.server=[{paper_id:'W1',environments:['低温'],revision:1}];a.d.querySelector('input[value="高氧"]').checked=true;a.d.getElementById('erAssign').dispatchEvent(new a.w.Event('submit',{cancelable:true}));await until(()=>a.d.getElementById('erMessage').textContent.includes('其他审核'));assert.deepEqual(a.papers[0].env,['待核查']);assert.equal(a.updates,0);await a.controller.load();assert.deepEqual(a.papers[0].env,['低温']);}finally{a.dom.window.close();}
});
test('network uncertainty retries the same request ID rather than applying a batch twice',async()=>{
 const a=setup({saveError:true});try{await a.controller.load();await a.controller.open([a.papers[0]]);a.d.querySelector('input[value="高氧"]').checked=true;
 const submit=()=>a.d.getElementById('erAssign').dispatchEvent(new a.w.Event('submit',{cancelable:true}));submit();await until(()=>a.d.getElementById('erMessage').textContent.includes('network interrupted'));assert.deepEqual(a.papers[0].env,['待核查']);submit();await until(()=>!a.d.getElementById('environmentReviewDialog').open);assert.equal(a.updates,1);const posts=a.calls.filter(x=>x.opts.method==='POST');assert.equal(JSON.parse(posts[0].opts.body).request_id,JSON.parse(posts[1].opts.body).request_id);}finally{a.dom.window.close();}
});
test('a confirmed paper can return to pending while keeping original source labels',async()=>{
 const a=setup({rows:[{paper_id:'W1',environments:['高氧'],revision:1}]});try{await a.controller.load();await a.controller.open([a.papers[0]]);a.d.getElementById('erReturn').click();await until(()=>!a.d.getElementById('environmentReviewDialog').open);assert.deepEqual(a.papers[0].env,['待核查']);assert.equal(a.papers[0]._envReviewRevision,2);assert.deepEqual(a.papers[0]._reviewSourceEnv,['待分类']);}finally{a.dom.window.close();}
});
test('non-admin and not-yet-deployed service cannot write shared classifications',async()=>{
 for(const options of [{canReview:false},{enabled:false}]){
  const a=setup(options);try{await a.controller.load();await a.controller.open([a.papers[0]]);assert.equal(a.d.getElementById('erAssign').hidden,true);assert.equal(a.updates,0);assert.equal(a.calls.some(x=>x.opts.method==='POST'),false);}finally{a.dom.window.close();}
 }
});
test('admin login clears password and does not store user tokens or refresh token',async()=>{
 const a=setup();try{await a.controller.load();await a.controller.open([a.papers[0]]);a.d.getElementById('erLogout').click();a.d.getElementById('erEmail').value='owner@example.invalid';a.d.getElementById('erPassword').value='test-password';a.d.getElementById('erLoginForm').dispatchEvent(new a.w.Event('submit',{cancelable:true}));await until(()=>a.d.getElementById('erLogin').hidden);assert.equal(a.d.getElementById('erPassword').value,'');assert.equal(a.w.localStorage.length,0);assert.ok(a.calls.every(x=>x.url.indexOf('test-password')<0));}finally{a.dom.window.close();}
});
test('review selections and record titles render inertly, and unrecognized imported IDs cannot be shared',async()=>{
 const a=setup();try{await a.controller.load();a.papers[0].title='<img src=x onerror=alert(1)>';a.papers[0].id='ris:local';await a.controller.open([a.papers[0]]);assert.equal(a.d.querySelectorAll('#erPreview img').length,0);a.d.querySelector('input[value="低温"]').checked=true;a.d.getElementById('erAssign').dispatchEvent(new a.w.Event('submit',{cancelable:true}));assert.match(a.d.getElementById('erMessage').textContent,/本机导入/);assert.equal(a.updates,0);}finally{a.dom.window.close();}
});

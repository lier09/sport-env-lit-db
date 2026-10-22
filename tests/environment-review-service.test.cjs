const {test}=require('node:test'),assert=require('node:assert/strict');
const imports=import('../supabase/functions/environment-review/service.mjs');
const admin='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const input={request_id:'33333333-3333-4333-8333-333333333333',note:'manual review',changes:[{paper_id:'W1',expected_revision:0,source_environments:['待分类'],environments:['高氧']}]};
const req=(body=input,method='POST',token='admin-token')=>new Request('https://project.supabase.co/functions/v1/environment-review',{method,headers:{origin:'https://lier09.github.io',Authorization:'Bearer '+token,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})});
test('review service authenticates real project user and restricts writes to configured admin IDs',async()=>{
 const {createReviewHandler}=await imports;
 for(const user of [null,other]){let writes=0;const handler=createReviewHandler({base:'https://project.supabase.co',anon:'public-key',serviceKey:'server-only',admins:[admin],fetcher:async url=>{if(url.includes('/auth/v1/user'))return Response.json(user?{id:user}:{},{status:user?200:401});writes++;return Response.json({rows:[]});}});assert.equal((await handler(req())).status,user?403:401);assert.equal(writes,0);}
});
test('review service uses verified actor and keeps management credentials exclusively on server RPC',async()=>{
 const {createReviewHandler}=await imports,calls=[];
 const handler=createReviewHandler({base:'https://project.supabase.co',anon:'public-key',serviceKey:'server-only',admins:[admin],fetcher:async(url,opts)=>{calls.push({url,opts});return Response.json(url.includes('/auth/v1/user')?{id:admin}:{rows:[{paper_id:'W1',environments:['高氧'],revision:1}]});}});
 const res=await handler(req({...input,actor:other}));assert.equal(res.status,200);
 assert.ok(!JSON.stringify(calls[0]).includes('server-only'));assert.equal(JSON.parse(calls[1].opts.body).p_actor,admin);assert.equal(calls[1].opts.headers.Authorization,'Bearer server-only');assert.ok(!(await res.text()).includes('server-only'));
});
test('invalid, duplicate and oversized review batches cannot reach the database',async()=>{
 const {createReviewHandler,validPayload}=await imports;
 for(const p of [{...input,changes:[]},{...input,changes:[...input.changes,...input.changes]},{...input,changes:[{...input.changes[0],paper_id:'http://evil.invalid'}]},{...input,changes:[{...input.changes[0],environments:['待分类']}]},{...input,note:'x'.repeat(201)}])assert.equal(validPayload(p),false);
 let rpc=0;const handler=createReviewHandler({base:'https://project.supabase.co',anon:'anon',serviceKey:'secret',admins:[admin],fetcher:async url=>{if(url.includes('/rpc/'))rpc++;return Response.json({id:admin});}});assert.equal((await handler(req({...input,changes:[]}))).status,400);assert.equal(rpc,0);
});
test('review service returns conflicts explicitly and fails closed when admin setup is missing',async()=>{
 const {createReviewHandler}=await imports;
 assert.equal((await createReviewHandler({})(req())).status,503);
 const handler=createReviewHandler({base:'https://project.supabase.co',anon:'anon',serviceKey:'secret',admins:[admin],fetcher:async url=>url.includes('/auth/v1/user')?Response.json({id:admin}):Response.json({code:'40001'},{status:400})});assert.equal((await handler(req())).status,409);
});
test('public origin checks and CORS preflight do not leak admin capability',async()=>{
 const {createReviewHandler}=await imports;let calls=0;const handler=createReviewHandler({fetcher:async()=>{calls++;}});
 const r=await handler(new Request('https://fixture.invalid',{method:'OPTIONS',headers:{origin:'https://lier09.github.io'}}));assert.equal(r.status,204);
 const bad=await handler(new Request('https://fixture.invalid',{method:'GET',headers:{origin:'https://evil.invalid'}}));assert.equal(bad.status,403);assert.equal(calls,0);
});

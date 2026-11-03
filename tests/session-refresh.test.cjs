const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const code=html.slice(html.indexOf('function supaSave('),html.indexOf('/* 拉取当前用户档案'));
function session(token='old',id='u'){return {access_token:token,refresh_token:token+'-refresh',user:{id}};}
function fixture(fetch,storage=new Map(),locks){
 const c=vm.createContext({supaSession:null,supaProfile:null,LS_SESS:'session',SUPA_URL:'https://example.test',SUPA_ANON:'anon',navigator:{locks},atob,Date,
 localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},supaFetch:fetch});
 vm.runInContext(code,c);c.supaSave(session());return {c,storage};
}
test('parallel requests share one refresh and store rotated tokens',async()=>{
 let calls=0;const {c}=fixture(async()=>{calls++;await new Promise(r=>setTimeout(r,5));return Response.json(session('new'));});
 assert.deepEqual(await Promise.all([c.supaRefresh(),c.supaRefresh()]),[true,true]);assert.equal(calls,1);assert.equal(c.supaLoadSess().refresh_token,'new-refresh');
});
for(const status of [429,500,503])test('transient refresh '+status+' preserves login and personal data',async()=>{
 const {c,storage}=fixture(async()=>Response.json({message:'try later'},{status}));storage.set('notes','precious');
 await assert.rejects(c.supaRefresh(),/暂时/);assert.equal(c.supaLoadSess().refresh_token,'old-refresh');assert.equal(storage.get('notes'),'precious');
});
test('network error preserves refresh token',async()=>{
 const {c}=fixture(async()=>{throw new Error('offline');});await assert.rejects(c.supaRefresh(),/offline/);assert.ok(c.supaLoadSess());
});
test('invalid refresh clears only login',async()=>{
 const {c,storage}=fixture(async()=>Response.json({error:'invalid_grant'},{status:400}));storage.set('notes','precious');
 assert.equal(await c.supaRefresh(),false);assert.equal(c.supaLoadSess(),null);assert.equal(storage.get('notes'),'precious');
});
test('logout during refresh cannot restore session',async()=>{
 let resolve;const {c}=fixture(()=>new Promise(r=>resolve=r));const pending=c.supaRefresh();c.supaClear();resolve(Response.json(session('new')));
 assert.equal(await pending,false);assert.equal(c.supaLoadSess(),null);
});
test('account switch during refresh stops the original request',async()=>{
 let resolve;const {c,storage}=fixture(()=>new Promise(r=>resolve=r));const pending=c.supaRefresh();storage.set('session',JSON.stringify(session('other','v')));resolve(Response.json(session('new')));
 await assert.rejects(pending,/账号发生变化/);assert.equal(c.supaLoadSess().user.id,'v');
});
test('another window rotated the token while waiting for the lock',async()=>{
 let run,calls=0;const {c,storage}=fixture(async()=>{calls++;},new Map(),{request:(_,fn)=>new Promise(resolve=>run=()=>resolve(fn()))});
 const pending=c.supaRefresh();storage.set('session',JSON.stringify(session('new')));run();assert.equal(await pending,true);assert.equal(calls,0);assert.equal(c.supaSession.access_token,'new');
});
test('API refreshes expired JWT before sending request',async()=>{
 const seen=[];const {c}=fixture(async(url,opts)=>{seen.push([url,opts.headers.Authorization]);return Response.json(url.includes('/token?')?session('new'):{id:'u'});});
 c.supaSave(session('x.'+btoa(JSON.stringify({exp:1}))+'.x'));assert.equal((await c.supaApi('/auth/v1/user')).status,200);
 assert.equal(seen.length,2);assert.equal(seen[1][1],'Bearer new');
});
test('API stops after logout in a different window',async()=>{
 let calls=0;const {c,storage}=fixture(async()=>{calls++;});storage.delete('session');await assert.rejects(c.supaApi('/rest/v1/notes'),/退出/);assert.equal(calls,0);
});

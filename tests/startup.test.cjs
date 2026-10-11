const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('<script>/* 低温与运动科学文献数据库 - 前端逻辑 */') + '<script>'.length;
const script = html.slice(start, html.indexOf('</script>', start));
new vm.Script(script);
function segment(from, to) {
  const a = script.indexOf(from), b = script.indexOf(to, a);
  assert.ok(a >= 0 && b > a, from);
  return script.slice(a, b);
}
const helper = segment('/* Network timeouts', '\n(async function(){\n"use strict";');
const api = segment('var SUPA_URL', '/* ---------- 登录 / 注册 UI');
const auth = segment('async function supaEnsureAuth(){', '/* 从私有存储桶');
const load = segment('async function supaLoadData(){', '/* 退出登录');
const normalize = segment('function normalizePaper(p){', 'var PAPERS =');
function context(fetch, initialSession = {access_token:'fixture-token', refresh_token:'fixture-refresh', user:{id:'fixture-user'}}, manifestReply=null) {
  const elements = new Map();
  function element() {
    return {style:{}, classList:{add(){},remove(){}}, textContent:'', children:[],
      appendChild(node){this.children.push(node); if(node.id) elements.set(node.id,node);},
      remove(){elements.delete(this.id);}};
  }
  elements.set('boot', element());
  const body = element();
  let saved = initialSession;
  const logs = [];
  const box = vm.createContext({fetch:(url,opts)=>url.endsWith("/manifest.json")?Promise.resolve(manifestReply ? manifestReply.clone() : json({},404)):fetch(url,opts), Response, AbortController, TextDecoder, console:{error:(...x)=>logs.push(x)},
    setTimeout:(fn, ms)=>setTimeout(fn, Math.min(ms, 60)), clearTimeout,
    document:{body,getElementById:id=>elements.get(id)||null,createElement:element},
    localStorage:{getItem:()=>saved ? JSON.stringify(saved):null,setItem:(_,value)=>{saved=JSON.parse(value);},removeItem:()=>{saved=null;}},
    window:{},location:{reload(){}}});
  vm.runInContext(helper + api + auth + load + normalize + '\nsupaSession = supaLoadSess();', box);
  return {box,elements,session:()=>saved,logs};
}
const json = (value, status=200)=>new Response(JSON.stringify(value), {status,headers:{'content-type':'application/json'}});
test('main application script compiles',()=>assert.ok(script.length > 100000));
test('timeout aborts request and preserves saved login',async()=>{
  let signal;
  const c=context((_,opts)=>{signal=opts.signal;return new Promise(()=>{});});
  await assert.rejects(c.box.supaEnsureAuth(), /超时/);
  assert.equal(signal.aborted,true); assert.ok(c.session());
});
test('timeout also covers a response body which never completes',async()=>{
  const c=context(async()=>({arrayBuffer:()=>new Promise(()=>{})}));
  await assert.rejects(c.box.supaFetch('/fixture',{},10),/超时/);
});
test('profile service error is visible and does not erase login',async()=>{
  const c=context(async url=>url.includes('/auth/v1/user') ? json({id:'fixture-user'}) : json({error:'fixture'},503));
  await assert.rejects(c.box.supaEnsureAuth(), /档案.*503/); assert.ok(c.session());
});
test('expired login refreshes before validation, concurrent refresh uses one request',async()=>{
  let refreshes=0, checks=0;
  const c=context(async url=>{
    if(url.includes('refresh_token')){refreshes++;return json({access_token:'new-fixture',refresh_token:'fixture-refresh',user:{id:'fixture-user'}});}
    if(url.includes('/auth/v1/user')) return ++checks===1 ? json({},401):json({id:'fixture-user'});
    return json([{id:'fixture-user',banned:false}]);
  });
  await c.box.supaEnsureAuth(); assert.equal(refreshes,1); assert.equal(checks,2);
  await Promise.all([c.box.supaRefresh(),c.box.supaRefresh(),c.box.supaRefresh()]);
  assert.equal(refreshes,2);
});
test('failed data shard rejects instead of rendering zero records',async()=>{
  const c=context(async url=>url.includes('papers-2') ? json({},403):json([]));
  await assert.rejects(c.box.supaLoadData(), /403.*分片2/);
  assert.equal(c.box.window.PAPERS,undefined);
});
test('all data shards must contain arrays',async()=>{
  const c=context(async()=>json({records:[]}));
  await assert.rejects(c.box.supaLoadData(), /格式错误/);
});
test('successful data load merges four shards',async()=>{
  const c=context(async url=>json([{id:url.match(/papers-(\d)/)[1]}]));
  await c.box.supaLoadData(); assert.equal(c.box.window.PAPERS.length,4);
});
test('malformed optional arrays normalize without inventing cold labels',()=>{
  const c=context(async()=>json([]));
  const p=c.box.normalizePaper({env:null,tags:'["热习服"]',authors:'Ben Lee',year:'2026',cited:'5'});
  assert.equal(p.env.length,0); assert.equal(p.tags[0],'热习服'); assert.equal(p.authors[0],'Ben Lee');
  assert.equal(p.year,2026); assert.equal(p.cited,5);
  assert.throws(()=>c.box.normalizePaper(null),/无效记录/);
});
test('fatal error renders an explicit retry button',()=>{
  const c=context(async()=>json([]));
  c.box.startupFailure(new Error('分片2失败'));
  const boot=c.elements.get('boot'); assert.equal(boot.style.display,'flex');
  assert.match(boot.children[0].children[0].textContent,/分片2失败/);
  assert.equal(boot.children[0].children[1].textContent,'重新加载');
});
test('optional module error is contained',()=>{
  const c=context(async()=>json([])); let next=false;
  c.box.runModule('知识网络',()=>{throw new Error('fixture');});
  c.box.runModule('检索',()=>{next=true;}); assert.equal(next,true);
});


test('legacy manifest object-not-found status 400 still loads all four shards',async()=>{
 const c=context(async()=>json([]),undefined,json({statusCode:'404',error:'not_found'},400));await c.box.supaLoadData();assert.equal(c.box.window.PAPERS.length,0);
});
test('cached legacy shards are validated by ETag; another user downloads their own data',async()=>{
 const data=new Map();let downloads=0,heads=0;
 const c=context(async(url,opts)=>{if(opts.method==='HEAD'){heads++;return new Response(null,{headers:{etag:'"version-one"'}});}downloads++;return new Response(JSON.stringify([{id:url}]),{headers:{etag:'"version-one"'}});});
 c.box.LitdbCache={create:()=>({get:async(user,url)=>data.get(user+'|'+url),put:async(user,url,value)=>data.set(user+'|'+url,value)})};
 await c.box.supaLoadData();await c.box.supaLoadData();assert.equal(downloads,4);assert.equal(heads,4);
 vm.runInContext('supaSession.user.id="another-user"',c.box);await c.box.supaLoadData();assert.equal(downloads,8);
});
test('changed ETag refreshes cached data; unchanged full abstracts are retained',async()=>{
 const data=new Map();let version=1,downloads=0;
 const c=context(async(url,opts)=>{if(opts.method==='HEAD')return new Response(null,{headers:{etag:String(version)}});downloads++;return new Response(JSON.stringify([{id:url,abstract:'complete '.repeat(300),version}]),{headers:{etag:String(version)}});});
 c.box.LitdbCache={create:()=>({get:async(user,url)=>data.get(user+'|'+url),put:async(user,url,value)=>data.set(user+'|'+url,value)})};
 await c.box.supaLoadData();version=2;await c.box.supaLoadData();assert.equal(downloads,8);assert.equal(c.box.window.PAPERS[0].version,2);assert.ok(c.box.window.PAPERS[0].abstract.length>500);
});
test('versioned shards enforce hashes and counts; invalid version paths never load',async()=>{
 const {createHash,webcrypto}=require('node:crypto');const version='a'.repeat(20),raw=JSON.stringify([{id:'paper',abstract:'complete original abstract'}]);
 const digest=createHash('sha256').update(raw).digest('hex');const manifest={format:'sport-env-litdb-shards',version,total:4,shards:[1,2,3,4].map(i=>({path:`versions/${version}/papers-${i}.json`,sha256:digest,bytes:Buffer.byteLength(raw),records:1}))};
 const c=context(async()=>new Response(raw),undefined,json(manifest));c.box.window.crypto=webcrypto;await c.box.supaLoadData();assert.equal(c.box.window.LITDB_DATA_VERSION,version);
 const bad=context(async()=>new Response(raw.replace('paper','papex')),undefined,json(manifest));bad.box.window.crypto=webcrypto;await assert.rejects(bad.box.supaLoadData(),/内容校验失败/);
 manifest.shards[0].path='https://outside.invalid/papers.json';const path=context(async()=>{throw new Error('must not fetch');},undefined,json(manifest));await assert.rejects(path.box.supaLoadData(),/清单格式错误/);
});

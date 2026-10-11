const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test');
let JSDOM;try{({JSDOM}=require('jsdom'));}catch(e){({JSDOM}=require(path.join(process.env.TEMP,'sport-env-startup-tests','node_modules','jsdom')));}
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function segment(a,b){let i=html.indexOf(a),j=html.indexOf(b,i);assert.ok(i>=0&&j>i);return html.slice(i,j);}
const author=segment('var AUTHOR_VARIANTS=','function filtered(){');
const ai=segment('function aiMatch(p, concepts){','/* ---------- 导出 ---------- */');
const core=segment('function authSessionFromResponse','/* ---------- 登录 / 注册 UI');
const auth=segment('function supaShowAuth(', '/* 确保已登录');
test('author search supports full names, omitted initials, accents, but not inner substrings',()=>{
 const c=vm.createContext({});vm.runInContext(author,c);
 for(const [n,q,ok] of [['Ben Lee','Ben',true],['Ben Lee','Ben Lee',true],['Michael N. Sawka','Michael Sawka',true],['Grégoire Millet','Gregoire Millet',true],['Ruben Lee','Ben',false],['Benjamin Lee','Ben',false],['Ben Lee','Lee Ben',false]]) assert.equal(c.authorTokenMatch(n,q,false),ok,`${n}/${q}`);
 assert.equal(c.authorTokenMatch('Benjamin Lee','Ben',true),true);
 assert.deepEqual(Array.from(c.paperAffiliations({affiliations:['Unit A'],_authorships:[{institutions:[{display_name:'Unit B'}]}]})),['Unit A','Unit B']);
});
test('AI requires every requested concept group, accepts synonyms within a group',()=>{
 const c=vm.createContext({});vm.runInContext(ai,c);
 assert.equal(c.aiMatch({title:'cold exposure',tags:[],abstract:''},[['cold','低温'],['recovery','恢复']]).score,0);
 assert.ok(c.aiMatch({title:'低温运动恢复',tags:[],abstract:''},[['cold','低温'],['recovery','恢复']]).score>0);
});
function signupFixture(response,{rpcStatus=200,rpcData=true,profileExists=true}={}){
 const dom=new JSDOM('<body></body>',{url:'https://fixture.invalid/'}); const d=dom.window.document;let saved=null,activated=false,calls=0;
 const c=vm.createContext({document:d,localStorage:dom.window.localStorage,console,esc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),SUPA_URL:'https://fixture.invalid',SUPA_ANON:'test',LS_INVITE:'invite',supaSession:null,
 supaSave:s=>{saved=s;c.supaSession=s;},supaClear:()=>{saved=null;c.supaSession=null;},
 supaFetch:async()=>new Response(JSON.stringify(response),{status:200}),
 supaFetchProfile:async()=>activated&&profileExists?{id:'fixture-user',banned:false}:null,
 supaApi:async()=>{calls++;activated=true;return {status:rpcStatus,data:rpcData};}});
 vm.runInContext(core+auth,c); const finished=c.supaShowAuth('','signup');
 d.getElementById('suEmail').value='fixture@example.test';d.getElementById('suPass').value='fixture-password';d.getElementById('suInvite').value='TEST-INVITE';
 return {c,d,finished,submit:()=>d.getElementById('suGo').onclick(),saved:()=>saved,calls:()=>calls,close:()=>dom.window.close()};
}
for(const nested of [false,true]) test(`successful ${nested?'nested':'REST top-level'} signup activates without false failure`,async()=>{
 const sess={access_token:'fixture',refresh_token:'fixture-refresh',user:{id:'fixture-user'}};
 const f=signupFixture(nested?{session:sess,user:sess.user}:sess);
 try{await f.submit();await f.finished;assert.ok(f.saved());assert.equal(f.calls(),1);assert.ok(f.d.getElementById('gate').classList.contains('hide'));}finally{f.close();}
});
test('email confirmation response reports accepted registration, does not claim failure',async()=>{
 const f=signupFixture({id:'fixture-user',email:'fixture@example.test'});
 try{await f.submit();assert.match(f.d.getElementById('suOk').textContent,/已受理/);assert.equal(f.saved(),null);assert.equal(f.calls(),0);}finally{f.close();}
});
test('RPC service failure is not labeled invalid invite and never grants access without profile',async()=>{
 const f=signupFixture({access_token:'fixture',user:{id:'fixture-user'}},{rpcStatus:503,rpcData:{error:'unavailable'},profileExists:false});
 try{await f.submit();assert.match(f.d.getElementById('suErr').textContent,/HTTP 503/);assert.doesNotMatch(f.d.getElementById('suErr').textContent,/邀请码无效/);assert.ok(!f.d.getElementById('gate').classList.contains('hide'));}finally{f.close();}
});
test('activation committed despite RPC response error is confirmed through profile',async()=>{
 const f=signupFixture({access_token:'fixture',user:{id:'fixture-user'}},{rpcStatus:503,profileExists:true});
 try{await f.submit();await f.finished;assert.ok(f.d.getElementById('gate').classList.contains('hide'));}finally{f.close();}
});
test('invalid invite preserves account and offers activation instead of another signup',async()=>{
 const f=signupFixture({access_token:'fixture',user:{id:'fixture-user'}},{rpcData:false,profileExists:false});
 try{await f.submit();assert.match(f.d.getElementById('suErr').textContent,/邀请码无效/);assert.equal(f.d.getElementById('suGo').textContent,'激活');assert.ok(f.saved());}finally{f.close();}
});


test('pagination reuses filter results, while hidden-paper changes invalidate them',()=>{
 const records=[{id:'1',title:'Cold recovery',authors:[],abstract:'',env:['低温'],tags:[],type:'原创研究',year:2026,cited:0,journal:'J'}];let scans=0;
 records.filter=function(fn){scans++;return Array.prototype.filter.call(this,fn);};
 const c=vm.createContext({PAPERS:records,window:{},DATA_YEAR_MIN:2020,DATA_YEAR_MAX:2026,state:{q:'',env:{'低温':true},tags:{},type:'all',ymin:2020,ymax:2026,journal:'all',minCited:0,population:'all',page:1,sort:'year_desc'},favOnly:false,favs:{},myTags:{},folders:{},deletedIds:{},parseQ:q=>({text:q}),matchAdv:()=>true,EV_LEVEL:{}});
 c.isDeleted=id=>!!c.deletedIds[id];vm.runInContext(segment('var filterMemo=', '/* ---------- 渲染结果'),c);
 const first=c.filtered();c.state.page=2;assert.equal(c.filtered(),first);assert.equal(scans,1);
 c.deletedIds['1']=true;assert.equal(c.filtered().length,0);assert.equal(scans,2);
});
test('BibTeX escapes reserved characters and gives different records different keys',()=>{
 const c=vm.createContext({});vm.runInContext(segment('function bibKey(', 'function exportBib(){'),c);
 assert.equal(c.bibEscape('A & B_{x}'),String.raw`A \& B\_\{x\}`);
 assert.notEqual(c.bibKey({id:'W1',authors:['Ben Lee'],title:'Cold recovery',year:2026}),c.bibKey({id:'W2',authors:['Ben Lee'],title:'Cold recovery',year:2026}));
});

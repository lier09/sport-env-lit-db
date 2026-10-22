/* Shared manual environment review. No browser-local decision overrides. */
(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LitdbEnvironmentReview=api;}(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
var ENV=['低温','高氧','高温','高温高湿','交叉适应','高原低氧','其他环境'],PENDING='待核查';
function id(value){var m=String(value||'').match(/^(?:https:\/\/openalex\.org\/)?(W\d{1,20})$/i);return m?m[1].toUpperCase():'';}
function unique(a){return Array.from(new Set(a));}
function normalize(a){a=Array.isArray(a)?a:[];return !a.length||a.some(function(e){return ENV.indexOf(e)<0;})?[PENDING]:unique(a);}
function validateRows(rows){
 if(!Array.isArray(rows))throw Error('公共审核数据格式无效');
 return rows.map(function(r){if(!r||!id(r.paper_id)||!Array.isArray(r.environments)||r.environments.some(function(e){return ENV.indexOf(e)<0;})||!Number.isInteger(r.revision)||r.revision<1)throw Error('公共审核记录无效');return {paper_id:id(r.paper_id),environments:unique(r.environments),revision:r.revision,updated_at:String(r.updated_at||'')};});
}
function apply(papers,rows){
 var map=Object.create(null);rows=validateRows(rows);rows.forEach(function(r){map[r.paper_id]=r;});
 papers.forEach(function(p){
  if(!p._reviewSourceEnv)p._reviewSourceEnv=(p.env||[]).slice();
  var r=map[id(p.id)];p.env=r?(r.environments.length?r.environments.slice():[PENDING]):normalize(p._reviewSourceEnv);
  p._envReviewRevision=r?r.revision:0;p._envReviewConfirmed=!!(r&&r.environments.length);
 });
}
function create(ctx){
 var w=ctx.window||window,d=w.document,config=null,rows=[],token='',admin=false,existing=true,loaded=false,lastRequest=null,focusBefore;
 var version=0,status='正在检查公共审核服务…';apply(ctx.papers,[]);
 function byId(x){return d.getElementById(x);}
 function esc(s){return String(s||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 function message(text){status=text;if(byId('erStatus'))byId('erStatus').textContent=text;}
 function currentToken(){return token||(existing&&ctx.existingToken&&ctx.existingToken())||'';}
 async function request(url,opts){
  var c=new AbortController(),timer=setTimeout(function(){c.abort();},20000);
  try{
   var r=await w.fetch(url,Object.assign({cache:'no-store',credentials:'omit',signal:c.signal},opts));
   var text=await r.text();if(text.length>2*1024*1024)throw Error('公共审核响应过大');
   var value;try{value=text?JSON.parse(text):null;}catch(_){throw Error('公共审核服务返回格式无效');}
   if(!r.ok){var e=Error(r.status===409?'这批文献已被其他审核更新，请刷新后重新确认。':r.status===401?'登录已失效，请重新登录审核账号。':r.status===403?'当前账号没有公共审核权限。':r.status===503?'公共审核服务尚未配置完成。':'公共审核请求失败（HTTP '+r.status+'）');e.status=r.status;throw e;}
   return value;
  }catch(e){if(e.name==='AbortError')throw Error('请求超时；提交可能已完成，请刷新核对，或重试本次提交。');throw e;}
  finally{clearTimeout(timer);}
 }
 function headers(auth){var h={apikey:ctx.anon};if(auth)h.Authorization='Bearer '+auth;return h;}
 async function load(notify){
  try{
   config=await request(new URL('./environment-review-config.json?v=93',d.baseURI).href);
   if(!config||config.enabled!==true){loaded=false;message('待核查文献可查看；公共审核服务待管理员部署。');return false;}
   if(config.protocol!==1||config.url!==ctx.base+'/functions/v1/environment-review')throw Error('公共审核地址配置无效');
   var next=[],cursor='';
   for(var page=0;page<100;page++){
    var u=new URL(ctx.base+'/rest/v1/literature_env_reviews');u.searchParams.set('select','paper_id,environments,revision,updated_at');u.searchParams.set('order','paper_id.asc');u.searchParams.set('limit','1000');if(cursor)u.searchParams.set('paper_id','gt.'+cursor);
    var batch=validateRows(await request(u.href,{headers:headers(ctx.anon)}));next=next.concat(batch);
    if(batch.length<1000)break;
    var last=batch[batch.length-1].paper_id;if(last<=cursor)throw Error('公共审核分页异常');cursor=last;
    if(page===99)throw Error('公共审核记录超出读取上限');
   }
   rows=next;apply(ctx.papers,rows);loaded=true;version++;message('公共分类已同步；管理员确认后，所有访客刷新即可看到。');if(notify&&ctx.onChange)ctx.onChange();return true;
  }catch(e){message('审核同步失败：'+e.message+' 已保留本次页面现有分类。');return false;}
 }
 function shell(){
  if(byId('environmentReviewDialog'))return;
  var el=d.createElement('dialog');el.id='environmentReviewDialog';el.className='env-review-dialog';el.setAttribute('aria-labelledby','erTitle');
  el.innerHTML='<header><div><small>公共环境审核</small><h2 id="erTitle">确认文献所属环境</h2></div><button type="button" class="btn ghost" id="erClose">关闭</button></header><p id="erScope"></p><p id="erMessage" role="status" aria-live="polite"></p><section id="erLogin"><h3>审核管理员登录</h3><p>只有授权账号可以修改公共分类。密码只发往本项目的认证服务，不保存在笔记或备份中。</p><form id="erLoginForm"><label>注册邮箱<input id="erEmail" type="email" autocomplete="username" required></label><label>密码<input id="erPassword" type="password" autocomplete="current-password" required></label><button class="btn" type="submit">登录审核账号</button></form><button type="button" class="btn ghost" id="erExisting">使用当前已登录账号</button></section><form id="erAssign"><fieldset><legend>目标环境（可多选）</legend><div class="er-envs">'+ENV.map(function(e){return '<label><input type="checkbox" name="environment" value="'+esc(e)+'">'+esc(e)+'</label>';}).join('')+'</div></fieldset><p>确认后会替换选中文献的环境分类，主题标签、摘要和个人笔记保持不变。</p><label>审核备注（选填，最多200字）<textarea id="erNote" maxlength="200" rows="2"></textarea></label><div class="er-actions"><button class="btn" type="submit" id="erSave">确认归类并同步</button><button class="btn ghost" type="button" id="erReturn">退回待核查</button><button class="btn ghost" type="button" id="erLogout">退出审核登录</button></div></form><details><summary id="erPreviewTitle">查看本次选中文献</summary><ul id="erPreview"></ul></details>';
  d.body.appendChild(el);byId('erClose').onclick=function(){if(!busy){el.close();if(focusBefore&&focusBefore.isConnected)focusBefore.focus();}};
  el.addEventListener('cancel',function(e){if(busy)e.preventDefault();});
  byId('erLoginForm').onsubmit=async function(e){e.preventDefault();if(busy)return;setBusy(true);try{
   var data=await request(ctx.base+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:ctx.anon,'Content-Type':'application/json'},body:JSON.stringify({email:byId('erEmail').value.trim(),password:byId('erPassword').value})});
   token=data.access_token||'';await checkAdmin();
  }catch(err){token='';admin=false;byId('erMessage').textContent=err.message;}finally{byId('erPassword').value='';setBusy(false);paintAuth();}};
  byId('erExisting').onclick=async function(){if(busy)return;existing=true;setBusy(true);try{await checkAdmin();}catch(e){byId('erMessage').textContent=e.message;}finally{setBusy(false);paintAuth();}};
  byId('erLogout').onclick=function(){token='';existing=false;admin=false;paintAuth();byId('erMessage').textContent='已退出本次审核登录。';};
  byId('erAssign').onsubmit=function(e){e.preventDefault();save(false);};byId('erReturn').onclick=function(){save(true);};
 }
 var selected=[],busy=false;
 function setBusy(value){busy=value;['erSave','erReturn','erLogout','erExisting','erClose'].forEach(function(x){if(byId(x))byId(x).disabled=value;});if(byId('erLoginForm'))byId('erLoginForm').querySelector('button').disabled=value;}
 function paintAuth(){byId('erLogin').hidden=admin;byId('erAssign').hidden=!admin;}
 async function checkAdmin(){
  if(!currentToken())throw Error('请先登录审核管理员账号。');
  var result=await request(config.url,{headers:headers(currentToken())});admin=result&&result.can_review===true;if(!admin)throw Error('当前账号没有公共审核权限。');byId('erMessage').textContent='审核权限已确认，修改将对所有访客生效。';
 }
 async function open(papers){
  shell();focusBefore=d.activeElement;var seen=Object.create(null);selected=unique(papers).filter(function(p){if(!p)return false;var key=id(p.id)||p.id;if(seen[key])return false;seen[key]=true;return true;});lastRequest=null;
  byId('erScope').textContent='本次选中 '+selected.length+' 篇。每次最多200篇，确认前请核对文献和环境。';
  byId('erPreviewTitle').textContent='查看本次选中的 '+selected.length+' 篇文献';byId('erPreview').replaceChildren();
  selected.slice(0,200).forEach(function(p){var li=d.createElement('li');li.textContent=p.title+' · 当前：'+(p.env||[]).join(' / ');byId('erPreview').appendChild(li);});
  byId('erMessage').textContent='';byId('erNote').value='';byId('erAssign').querySelectorAll('input').forEach(function(i){i.checked=selected.length===1&&selected[0]._envReviewConfirmed&&(selected[0].env||[]).indexOf(i.value)>=0;});
  paintAuth();if(!byId('environmentReviewDialog').open)byId('environmentReviewDialog').showModal();
  if(!loaded){byId('erMessage').textContent=status;byId('erLogin').hidden=true;byId('erAssign').hidden=true;return;}
  if(currentToken()&&!admin){try{await checkAdmin();}catch(e){byId('erMessage').textContent=e.message;}paintAuth();}
 }
 async function save(returnPending){
  if(busy)return;if(!admin||!loaded){byId('erMessage').textContent='请先完成服务配置并登录审核管理员账号。';return;}
  if(!selected.length||selected.length>200){byId('erMessage').textContent='每次请选择1至200篇，未提交任何修改。';return;}
  if(selected.some(function(p){return !id(p.id);})){byId('erMessage').textContent='包含本机导入或缺少OpenAlex标识的文献，无法写入公共审核。';return;}
  var targets=returnPending?[]:Array.from(byId('erAssign').querySelectorAll('input:checked')).map(function(i){return i.value;});
  if(!returnPending&&!targets.length){byId('erMessage').textContent='至少选择一个目标环境。';return;}
  if(returnPending&&!w.confirm('将这 '+selected.length+' 篇退回待核查？所有访客刷新后均会看到此状态。'))return;
  var changes=selected.map(function(p){return {paper_id:id(p.id),expected_revision:p._envReviewRevision||0,source_environments:p._reviewSourceEnv||[],environments:targets.slice()};});
  var payload={changes:changes,note:byId('erNote').value.trim()},fingerprint=JSON.stringify(payload);
  if(!lastRequest||lastRequest.fingerprint!==fingerprint)lastRequest={fingerprint:fingerprint,request_id:w.crypto.randomUUID()};
  payload.request_id=lastRequest.request_id;setBusy(true);byId('erMessage').textContent='正在同步公共分类…';
  try{
   var data=await request(config.url,{method:'POST',headers:Object.assign(headers(currentToken()),{'Content-Type':'application/json'}),body:JSON.stringify(payload)}),changed=validateRows(data.rows);
   if(changed.length!==changes.length||changed.some(function(r){return !changes.some(function(c){return c.paper_id===r.paper_id;});}))throw Error('审核结果与提交不一致，请刷新核对。');
   var map=Object.create(null);rows.forEach(function(r){map[r.paper_id]=r;});changed.forEach(function(r){map[r.paper_id]=r;});rows=Object.keys(map).map(function(k){return map[k];});apply(ctx.papers,rows);version++;lastRequest=null;
   message('已同步 '+changed.length+' 篇，所有访客刷新后可见。');if(ctx.onChange)ctx.onChange(changed);
   byId('environmentReviewDialog').close();if(focusBefore&&focusBefore.isConnected)focusBefore.focus();
  }catch(e){byId('erMessage').textContent=e.message;if(e.status===401){token='';admin=false;paintAuth();}}
  finally{setBusy(false);}
 }
 function mount(host){
  var box=d.createElement('section');box.id='environmentReviewBar';box.className='environment-review-bar';box.innerHTML='<div><strong>文献环境审核</strong><p id="erStatus" role="status"></p></div><div><button type="button" class="btn ghost sm" id="erOnly">只看待核查</button><button type="button" class="btn sm" id="erBatch">选中文献归类</button><button type="button" class="btn ghost sm" id="erRefresh">刷新公共分类</button></div>';host.appendChild(box);message(status);
  byId('erOnly').onclick=ctx.onlyPending;byId('erBatch').onclick=function(){open(ctx.getSelected());};byId('erRefresh').onclick=async function(){byId('erRefresh').disabled=true;await load(true);byId('erRefresh').disabled=false;};
 }
 return {load:load,mount:mount,open:open,revision:function(){return version;},rows:function(){return rows.slice();},isLoaded:function(){return loaded;}};
}
return {environments:ENV,pending:PENDING,id:id,normalize:normalize,apply:apply,validateRows:validateRows,create:create};
}));

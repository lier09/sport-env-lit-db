/* Private account sync. Local saves remain usable when the network fails. */
(function(){
'use strict';
var w=window,d=document,core=w.LitdbCloudCore,cfg,db,base={},running=false,applying=false,changed=0,syncEpoch=0,timer,poll,notice='未登录 · 仅保存在本机',remote=[],lastError='',conflicts=0;
var enc=function(v){return encodeURIComponent(v);},key=function(r){return r.kind+':'+r.doc_id;};
var safeKeys=['litdb-meta-tracker','envLitPageSize','litdb-ris-imports','envLitFolders','envLitFolderList','envLitMyTags','envLitTagList','envLitFollow','envLitHist','envLitSavedQ','envLitDeleted','envLitFavs','litdb-follows','envLitNotes','envLitRead'];
function el(tag,text){var x=d.createElement(tag);if(text!==undefined)x.textContent=text;return x;}
function button(text,action){var b=el('button',text);b.type='button';b.onclick=function(){Promise.resolve().then(action).catch(fail);};return b;}
function status(text,error){notice=text;lastError=error?text:'';d.querySelectorAll('[data-cloud-status]').forEach(function(x){x.textContent=text;x.classList.toggle('cloud-warning',!!error);});var p=d.getElementById('personalStatus');if(p)p.textContent=text;}
function fail(e){console.error('Personal sync:',e&&e.message);status('尚未同步：'+(e&&e.message||'连接失败')+'。本机内容保留，请重试或导出完整备份。',true);}
function openDB(){if(db)return Promise.resolve(db);return new Promise(function(res,rej){var r=w.indexedDB.open('litdb-sync',1);r.onupgradeneeded=function(){r.result.createObjectStore('state');};r.onsuccess=function(){db=r.result;res(db);};r.onerror=function(){rej(r.error);};});}
async function stateGet(id){await openDB();return new Promise(function(res,rej){var r=db.transaction('state').objectStore('state').get(id);r.onsuccess=function(){res(r.result);};r.onerror=function(){rej(r.error);};});}
async function statePut(id,value){await openDB();return new Promise(function(res,rej){var tx=db.transaction('state','readwrite');tx.objectStore('state').put(value,id);tx.oncomplete=res;tx.onerror=tx.onabort=function(){rej(tx.error);};});}
async function api(path,opts){var r=await cfg.api(path,opts||{});if(r.status<200||r.status>=300)throw new Error(r.status===401?'登录已过期，请重新登录':r.data&&r.data.message||'服务返回 HTTP '+r.status);return r.data;}
async function list(table,query){var out=[],offset=0;while(true){var page=await api('/rest/v1/'+table+'?'+query+'&limit=100&offset='+offset);if(!Array.isArray(page))throw new Error('云端响应无效');out=out.concat(page);if(page.length<100)break;offset+=100;if(offset>20000)throw new Error('资料数量超过当前读取上限，已停止以避免遗漏');}return out;}
function prefRecords(){var values=cfg.store.snapshot().values;return Object.keys(values).map(function(k){if(!safeKeys.includes(k))throw new Error('不支持的个人资料');return {kind:'pref',doc_id:k,payload:{value:JSON.parse(values[k])}};});}
async function localRecords(){return prefRecords().concat(await w.LitdbMemo.cloud.records());}
async function downloadBlob(hash){return cfg.binary('/storage/v1/object/authenticated/litdb-personal/'+cfg.userId+'/'+hash,{method:'GET'});}
async function uploadFiles(doc,known){if(doc.kind!=='memo')return;for(var file of doc.payload.files||[]){if(known.has(file.hash))continue;if(file.size>26214400)throw new Error('附件超过25MB，尚未上传，请另存备份');var bytes=await w.LitdbMemo.cloud.file(file.hash);try{await cfg.binary('/storage/v1/object/litdb-personal/'+cfg.userId+'/'+file.hash,{method:'POST',body:bytes,headers:{'Content-Type':'application/octet-stream','x-upsert':'false'}});}catch(e){if(e.status!==409)throw e;}known.add(file.hash);}}
async function push(doc,revision){var rows=await api('/rest/v1/rpc/personal_put',{method:'POST',body:JSON.stringify({p_kind:doc.kind,p_doc_id:doc.doc_id,p_payload:doc.payload,p_expected_revision:revision||0})});if(!Array.isArray(rows)||rows.length!==1)throw new Error('另一设备刚更新了同一条资料，正在保留本机内容，请再次同步');return rows[0];}
async function apply(doc){if(running&&syncEpoch!==changed)throw new Error('本机有新修改，请重新同步');if(doc.kind==='pref'){applying=true;try{if(!safeKeys.includes(doc.doc_id)||!doc.payload||!Object.prototype.hasOwnProperty.call(doc.payload,'value'))throw new Error('云端资料字段不受支持');var values={};values[doc.doc_id]=JSON.stringify(doc.payload.value);cfg.store.restore({format:'sport-env-personal-backup',version:1,values:values});}finally{applying=false;}}else await w.LitdbMemo.cloud.apply(doc,downloadBlob);}
function queue(){if(applying||!cfg||!cfg.userId)return;changed++;status(cfg.store.persistent()?'本机已保存 · 等待云同步':'本机保存失败 · 正在尝试云同步，请立即导出备份',!cfg.store.persistent());clearTimeout(timer);timer=setTimeout(function(){sync().catch(fail);},1500);}
async function sync(){
 if(!cfg||!cfg.userId){status('未登录 · 仅保存在本机');return;}if(running)return;running=true;var epoch=changed;syncEpoch=epoch;
 try{
  status('正在同步个人资料…');await cfg.validate();await w.LitdbMemo.ready;
  if(w.LitdbMemo.cloud.isEditing())throw new Error('请先保存当前编辑');
  remote=await list('personal_documents','select=*&order=seq.asc');var locals=await localRecords(),lm=new Map(locals.map(function(r){return [key(r),r];})),rm=new Map(remote.map(function(r){return [key(r),r];})),allKeys=new Set(Array.from(lm.keys()).concat(Array.from(rm.keys()))),uploads=new Set();
  remote.forEach(function(r){if(r.kind==='memo')(r.payload.files||[]).forEach(function(f){uploads.add(f.hash);});});
  for(var k of allKeys){
   if(epoch!==changed)throw new Error('本机有新修改，已保留，稍后继续同步');
   var l=lm.get(k),r=rm.get(k),kind=(l||r).kind;if(!['memo','groups','pref'].includes(kind))continue;
   var choice=core.decision(kind,base[k],l&&l.payload,r),doc=l||r,result=r;
   if(choice.action==='conflict'){
    conflicts++;
    if(kind==='memo'){
     var copy=Object.assign({},l.payload,{uid:w.crypto.randomUUID(),title:(l.payload.title||'未命名笔记')+'（冲突保留副本）',updated:Date.now()});
     var duplicate={kind:'memo',doc_id:copy.uid,payload:copy};await uploadFiles(duplicate,uploads);var saved=await push(duplicate,0);await apply(saved);base[key(saved)]=saved;
    }else{
     // Both alternatives are retained in the server's immutable revision history.
     // Save local first only against the current remote revision, then restore the merged remote choice.
     await push({kind:kind,doc_id:doc.doc_id,payload:l.payload},r.revision);
     r=await push({kind:kind,doc_id:doc.doc_id,payload:choice.payload},r.revision+1);result=r;
    }
    await apply(result);
   }else if(choice.action==='push'){
    doc={kind:kind,doc_id:doc.doc_id,payload:choice.payload};await uploadFiles(doc,uploads);result=await push(doc,r?r.revision:0);
    if(!core.equal(l&&l.payload,result.payload))await apply(result);
   }else if(choice.action==='pull')await apply(result);
   base[k]=result;await statePut('base:'+cfg.userId,base);
  }
  if(cfg.reload)cfg.reload();status(conflicts?'已同步 · 冲突内容已保留，请查看历史版本':'已同步到账号 · '+new Date().toLocaleTimeString('zh-CN'));
  await statePut('last-sync:'+cfg.userId,Date.now());
  await dailyLocalBackup().catch(function(e){status('云端已同步；电脑独立备份失败：'+e.message,true);});
 }finally{running=false;if(epoch!==changed){clearTimeout(timer);timer=setTimeout(function(){sync().catch(fail);},1500);}}
}
async function fullBackup(documents){
 var docs=documents||await localRecords(),hashes=new Set(),files=[];docs.forEach(function(r){if(r.kind==='memo')(r.payload.files||[]).forEach(function(f){hashes.add(f.hash);});});
 for(var hash of hashes){var bytes;try{bytes=await w.LitdbMemo.cloud.file(hash);}catch(e){bytes=await downloadBlob(hash);}var a=new Uint8Array(bytes),s='';for(var i=0;i<a.length;i+=8192)s+=String.fromCharCode.apply(null,a.subarray(i,i+8192));files.push({hash:hash,data:w.btoa(s)});}
 return {format:'sport-env-complete-backup',version:1,exportedAt:new Date().toISOString(),documents:docs.map(function(r){return {kind:r.kind,doc_id:r.doc_id,payload:r.payload};}),files:files};
}
function download(name,payload){var u=URL.createObjectURL(new Blob([JSON.stringify(payload)],{type:'application/json'})),a=el('a');a.href=u;a.download=name;d.body.appendChild(a);a.click();setTimeout(function(){a.remove();URL.revokeObjectURL(u);},1000);}
async function exportAll(){status('正在打包正文和附件，请勿关闭…');download('文献个人资料完整备份-'+new Date().toISOString().slice(0,10)+'.json',await fullBackup());status('完整备份已交给浏览器下载，请确认下载成功');}
async function importAll(payload){
 if(!payload||payload.format!=='sport-env-complete-backup'||payload.version!==1||!Array.isArray(payload.documents)||!Array.isArray(payload.files))throw new Error('完整备份格式无效');
 var bytes=new Map(),total=0,documents=payload.documents;
 for(var f of payload.files){if(!f||!/^[a-f0-9]{64}$/.test(f.hash)||typeof f.data!=='string'||f.data.length>36*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(f.data))throw new Error('附件格式无效');var b=Uint8Array.from(w.atob(f.data),function(c){return c.charCodeAt(0);}).buffer;total+=b.byteLength;if(total>256*1024*1024)throw new Error('备份附件总量超过256MB');var digest=Array.from(new Uint8Array(await w.crypto.subtle.digest('SHA-256',b))).map(function(x){return x.toString(16).padStart(2,'0');}).join('');if(digest!==f.hash)throw new Error('备份附件校验失败');bytes.set(f.hash,b);}
 documents.forEach(function(r){if(!r||!['memo','groups','pref'].includes(r.kind)||typeof r.doc_id!=='string'||!r.payload||typeof r.payload!=='object')throw new Error('备份记录无效');if(r.kind==='pref'&&!safeKeys.includes(r.doc_id))throw new Error('备份包含不支持的字段');if(r.kind==='memo'&&(!Array.isArray(r.payload.files)||r.payload.files.some(function(f){return !bytes.has(f.hash);})))throw new Error('备份缺少附件，尚未导入');});
 var local=await localRecords(),map=new Map(local.map(function(r){return [key(r),r];}));applying=true;
 try{for(var r of documents){var old=map.get(key(r)),copy=JSON.parse(JSON.stringify(r));if(old&&core.equal(old.payload,copy.payload))continue;
   if(copy.kind==='memo'){if(old){copy.doc_id=w.crypto.randomUUID();copy.payload.uid=copy.doc_id;copy.payload.title+='（备份恢复副本）';}await w.LitdbMemo.cloud.apply(copy,function(hash){return Promise.resolve(bytes.get(hash));});}
   else if(copy.kind==='pref'){var merged=old?core.merge(undefined,old.payload,copy.payload,false).value:copy.payload;var values={};values[copy.doc_id]=JSON.stringify(merged.value);cfg.store.restore({format:'sport-env-personal-backup',version:1,values:values});}
   else {var groups=old?(old.payload.groups||[]).concat((copy.payload.groups||[]).filter(function(g){return !old.payload.groups.some(function(x){return x.uid===g.uid;});})):copy.payload.groups;await w.LitdbMemo.cloud.apply({kind:'groups',payload:{groups:groups}},function(){});}
  }}finally{applying=false;}if(cfg.reload)cfg.reload();queue();
}
async function dailyLocalBackup(){
 if(!cfg.userId)return;var handle=await stateGet('backup-directory:'+cfg.userId);if(!handle)return;
 var today=new Date().toLocaleDateString('en-CA'),id='backup-day:'+cfg.userId;if(await stateGet(id)===today)return;
 if(await handle.queryPermission({mode:'readwrite'})!=='granted')throw new Error('请重新授权备份目录');
 var dir=await handle.getDirectoryHandle('litdb-'+cfg.userId,{create:true}),file=await dir.getFileHandle('backup-'+today+'.json',{create:true}),writer=await file.createWritable();
 try{await writer.write(JSON.stringify(await fullBackup()));await writer.close();}catch(e){await writer.abort().catch(function(){});throw e;}
 await statePut(id,today);
}
async function chooseBackupDirectory(){if(!cfg.userId)throw new Error('请先登录');if(!w.showDirectoryPicker)throw new Error('当前浏览器不支持目录备份，请使用完整导出');var handle=await w.showDirectoryPicker({mode:'readwrite',id:'litdb-personal-backup'});await statePut('backup-directory:'+cfg.userId,handle);await statePut('backup-day:'+cfg.userId,null);await dailyLocalBackup();status('电脑独立备份已写入所选目录；网页使用期间每天自动备份');}
async function historyView(container){
 container.replaceChildren(el('p','正在读取云端历史…'));await cfg.validate();var docs=await list('personal_documents','select=*&order=updated_at.desc');container.replaceChildren();
 for(var r of docs){var row=el('div');row.className='cloud-history-row';row.append(el('strong',r.kind==='memo'?r.payload.title||'未命名笔记':r.kind==='groups'?'笔记分组':r.doc_id));
  (function(doc){row.append(button('查看历史版本',async function(){var versions=await list('personal_versions','select=*&kind=eq.'+enc(doc.kind)+'&doc_id=eq.'+enc(doc.doc_id)+'&order=revision.desc');var box=el('div');box.className='cloud-versions';
   versions.forEach(function(v){var line=el('div'),label='版本 '+v.revision+' · '+new Date(v.saved_at).toLocaleString('zh-CN');line.append(el('span',label));line.append(button('恢复',async function(){if(w.LitdbMemo.cloud.isEditing())throw new Error('请先保存当前编辑');if(!w.confirm('恢复这个版本？当前云端版本会保留在历史中。'))return;var current=await api('/rest/v1/personal_documents?select=*&kind=eq.'+enc(v.kind)+'&doc_id=eq.'+enc(v.doc_id));if(!current.length)throw new Error('未找到当前记录');var restored=await push(v,current[0].revision);await apply(restored);base[key(restored)]=restored;await statePut('base:'+cfg.userId,base);if(cfg.reload)cfg.reload();status('已恢复所选版本，当前版本也保留在历史中');}));box.append(line);});row.querySelector('.cloud-versions')?.remove();row.append(box);
  }));})(r);container.append(row);
 }
 if(!docs.length)container.append(el('p','还没有云端资料。'));
 var backups=await list('personal_daily_backups','select=backup_day,created_at&order=backup_day.desc');var h=el('h3','每日检查点（云端）');container.append(h);
 backups.forEach(function(b){container.append(button('导出 '+b.backup_day+' 的完整备份',async function(){var rows=await api('/rest/v1/personal_daily_backups?select=documents&backup_day=eq.'+enc(b.backup_day));if(!rows.length)throw new Error('检查点不存在');download('文献个人资料完整备份-'+b.backup_day+'.json',await fullBackup(rows[0].documents));}));});
}
function panel(){
 var dialog=d.getElementById('cloudDialog');if(dialog){dialog.showModal();return;}
 dialog=el('dialog');dialog.id='cloudDialog';dialog.className='cloud-dialog';var top=el('header');top.append(el('h2','个人资料与备份'),button('关闭',function(){dialog.close();}));dialog.append(top);
 var state=el('p',notice);state.dataset.cloudStatus='';state.setAttribute('role','status');dialog.append(state);
 dialog.append(el('p',cfg&&cfg.userId?'已登录账号：'+(cfg.email||cfg.userId):'登录后可将本机资料同步到自己的账号。未登录时仅保存在当前浏览器。'));
 var actions=el('div');actions.className='cloud-actions';actions.append(button(cfg&&cfg.userId?'立即同步':'登录并开启云同步',async function(){if(!cfg.userId){await cfg.login();return;}await sync();}),button('导出完整备份',exportAll));
 var input=el('input');input.type='file';input.accept='.json,application/json';input.hidden=true;input.onchange=async function(){try{var file=input.files[0];if(!file)return;if(file.size>400*1024*1024)throw new Error('文件超过400MB');var payload=JSON.parse(await file.text());await importAll(payload);status('完整备份已导入，本机已有笔记保留');}catch(e){fail(e);}finally{input.value='';}};actions.append(input,button('导入完整备份',function(){input.click();}));
 if(cfg&&cfg.userId){actions.append(button('重新登录／切换账号',cfg.login),button('历史版本与每日检查点',function(){return historyView(history);}),button('开启电脑独立备份',chooseBackupDirectory),button('归入本账号：本机未归属资料',async function(){if(!w.confirm('确认这台浏览器中未归属的笔记、关注和收藏属于当前登录账号？其他账号的资料不会迁入。'))return;await cfg.claim();await w.LitdbMemo.cloud.claimLocal();if(cfg.reload)cfg.reload();queue();status('本机未归属资料已归入当前账号，正在等待同步');}),button('退出账号',async function(){if(w.LitdbMemo.cloud.isEditing())throw new Error('请先保存笔记');if(!w.confirm('退出前请确认资料已同步，或先导出完整备份。'))return;cfg.logout();}));}
 dialog.append(actions,el('p','云端保存正文、附件、关注、收藏和分组，并保留至少30天历史。电脑独立备份需选择目录，仅在网页使用期间每天写入；清理浏览器后，已经写出的备份文件仍在。'));
 var history=el('section');history.className='cloud-history';dialog.append(history);d.body.append(dialog);dialog.showModal();
}
async function configure(config){
 cfg=config;var entry=button('个人资料 · 云同步',panel);entry.className='cloud-launcher';entry.setAttribute('aria-label','个人资料、云同步和备份');var label=el('span',notice);label.dataset.cloudStatus='';entry.append(label);d.body.append(entry);
 d.addEventListener('click',function(e){if(e.target.closest('[data-cloud-open]'))panel();});
 cfg.store.subscribe(queue);w.addEventListener('litdb-memo-change',queue);w.addEventListener('online',queue);
 w.addEventListener('beforeunload',function(e){if(running||notice.includes('等待')||lastError){e.preventDefault();e.returnValue='';}});
 if(!cfg.userId)return;await w.LitdbMemo.ready;await w.LitdbMemo.cloud.setAccount(cfg.userId);base=await stateGet('base:'+cfg.userId)||{};
 poll=setInterval(function(){if(!d.hidden&&!w.LitdbMemo.cloud.isEditing())sync().catch(fail);},60000);await sync();
}
w.LitdbCloud={configure:function(c){return configure(c).catch(fail);},sync:sync,open:panel,exportAll:exportAll,importAll:importAll,status:function(){return notice;},stop:function(){clearTimeout(timer);clearInterval(poll);}};
}());

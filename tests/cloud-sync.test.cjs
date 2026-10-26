const fs=require('node:fs'),path=require('node:path'),{test}=require('node:test'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const {JSDOM}=require('jsdom'),{IDBFactory}=require('fake-indexeddb'),core=require('../cloud-core');
const read=n=>fs.readFileSync(path.join(__dirname,'..',n),'utf8');
test('three-way preference merge propagates deletions but initial reconciliation never clears cloud data',()=>{
 assert.deepEqual(core.merge(undefined,{authors:{}},{authors:{A:{since:'2026'}}},false).value,{authors:{A:{since:'2026'}}});
 assert.deepEqual(core.merge({authors:{A:1,B:1}},{authors:{B:1}},{authors:{A:1,B:1,C:1}},true),{value:{authors:{B:1,C:1}},conflict:false});
 assert.equal(core.decision('memo',{revision:1,payload:{body:'old'}},{body:'local'},{revision:2,payload:{body:'remote'}}).action,'conflict');
});
function server(){const users=new Map(),files=new Map(),versions=[];let seq=0,offline=false;return {users,files,versions,setOffline:v=>offline=v,
 api:user=>async(url,opts={})=>{if(offline)throw new Error('offline');if(!users.has(user))users.set(user,new Map());const docs=users.get(user);
  if(url.includes('/rpc/personal_put')){const q=JSON.parse(opts.body),id=q.p_kind+':'+q.p_doc_id,old=docs.get(id);if((old?.revision||0)!==q.p_expected_revision)return {status:200,data:[]};const row={user_id:user,seq:old?.seq||++seq,kind:q.p_kind,doc_id:q.p_doc_id,payload:q.p_payload,revision:(old?.revision||0)+1};docs.set(id,row);versions.push(structuredClone(row));return {status:200,data:[structuredClone(row)]};}
  const parsed=new URL(url,'https://fixture.invalid');let rows=Array.from(docs.values());rows.sort((a,b)=>a.seq-b.seq);const offset=+parsed.searchParams.get('offset')||0,limit=+parsed.searchParams.get('limit')||100;return {status:200,data:structuredClone(rows.slice(offset,offset+limit))};
 },binary:user=>async(url,opts={})=>{if(offline)throw new Error('offline');const hash=url.split('/').pop(),key=user+':'+hash;if(opts.method==='POST'){if(files.has(key)){const e=new Error('exists');e.status=409;throw e;}files.set(key,Buffer.from(opts.body));return new ArrayBuffer(0);}if(!files.has(key))throw new Error('missing file');const b=files.get(key);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}};}
async function page(s,user,factory=new IDBFactory(),seed){
 const dom=new JSDOM('<div id="personalStatus"></div>',{url:'https://fixture.invalid',runScripts:'dangerously',pretendToBeVisual:true}),w=dom.window;
 w.indexedDB=factory;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.confirm=()=>true;Object.defineProperty(w,'crypto',{value:webcrypto});w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.eval(read('library-storage.js'));w.eval(read('cloud-core.js'));w.eval(read('memo.js'));await w.LitdbMemo.ready;
 if(seed){await w.LitdbMemo.restore({format:'sport-env-memo-backup',version:1,memos:[{id:1,uid:'original',title:'原始笔记',body:'original body',created:1,updated:1,fileIds:[1]}],files:[{id:1,name:'figure.png',type:'image/png',size:3,data:'AQID'}]});await w.LitdbMemo.cloud.setAccount(user);await w.LitdbMemo.cloud.claimLocal();}
 w.eval(read('cloud-sync.js'));const store=w.LitdbPersonal.create(user,w.localStorage);await w.LitdbCloud.configure({userId:user,store,email:'test@example.invalid',api:s.api(user),binary:s.binary(user),validate:async()=>{},reload:()=>{}});
 return {dom,w,store,close:()=>{w.LitdbCloud.stop();w.close();}};
}
test('fresh browser restores complete account notes, attachments, follows and folders without using the old cache',async()=>{
 const s=server(),a=await page(s,'A',undefined,true);let b;
 try{a.store.setItem('litdb-follows','{"authors":{"Patrick Rodrigues":{}},"journals":{}}');a.store.setItem('envLitFolderList','["需要精读"]');await a.w.LitdbCloud.sync();
  b=await page(s,'A');const snapshot=await b.w.LitdbMemo.snapshot();assert.equal(snapshot.memos.length,1);assert.equal(snapshot.memos[0].body,'original body');assert.equal(snapshot.files[0].data,'AQID');assert.equal(b.store.getItem('envLitFolderList'),'["需要精读"]');assert.match(b.store.getItem('litdb-follows'),/Patrick/);assert.match(b.w.LitdbCloud.status(),/已同步/);
 }finally{a.close();b?.close();}
});
test('offline edits remain local, failed sync is never marked synced, then retry uploads them',async()=>{
 const s=server(),a=await page(s,'A',undefined,true);
 try{s.setOffline(true);a.store.setItem('envLitFolderList','["离线新文件夹"]');await assert.rejects(a.w.LitdbCloud.sync(),/offline/);assert.equal(a.store.getItem('envLitFolderList'),'["离线新文件夹"]');s.setOffline(false);await a.w.LitdbCloud.sync();assert.deepEqual(s.users.get('A').get('pref:envLitFolderList').payload.value,['离线新文件夹']);}finally{a.close();}
});
test('two devices editing the same note retain both versions with a visible conflict copy',async()=>{
 const s=server(),a=await page(s,'A',undefined,true),b=await page(s,'A');
 try{const doc=(await a.w.LitdbMemo.cloud.records()).find(r=>r.kind==='memo');await a.w.LitdbMemo.cloud.apply({...doc,payload:{...doc.payload,body:'device A'}},s.binary('A'));await a.w.LitdbCloud.sync();await b.w.LitdbMemo.cloud.apply({...doc,payload:{...doc.payload,body:'device B'}},s.binary('A'));await b.w.LitdbCloud.sync();const bodies=(await b.w.LitdbMemo.snapshot()).memos.map(x=>x.body);assert.ok(bodies.includes('device A'));assert.ok(bodies.includes('device B'));assert.equal([...s.users.get('A').values()].filter(r=>r.kind==='memo').length,2);assert.match(b.w.LitdbCloud.status(),/冲突/);}finally{a.close();b.close();}
});
test('a second account sharing the same local IndexedDB cannot see or upload the first account notes',async()=>{
 const s=server(),factory=new IDBFactory(),a=await page(s,'A',factory,true);a.close();const b=await page(s,'B',factory);
 try{assert.equal((await b.w.LitdbMemo.snapshot()).memos.length,0);assert.equal([...s.users.get('B').values()].filter(r=>r.kind==='memo').length,0);assert.equal([...s.users.get('A').values()].filter(r=>r.kind==='memo').length,1);}finally{b.close();}
});
test('corrupt complete backup is rejected before writing notes',async()=>{
 const s=server(),a=await page(s,'A');try{await assert.rejects(a.w.LitdbCloud.importAll({format:'sport-env-complete-backup',version:1,documents:[{kind:'memo',doc_id:'bad',payload:{files:[{hash:'f'.repeat(64)}]}}],files:[]}),/缺少附件/);assert.equal((await a.w.LitdbMemo.snapshot()).memos.length,0);}finally{a.close();}
});
test('full export includes real attachment bytes and restores to another independent account/browser',async()=>{
 const s=server(),a=await page(s,'A',undefined,true),b=await page(s,'B');
 try{let captured;a.w.Blob=Blob;a.w.URL.createObjectURL=x=>(captured=x,'blob:fixture');a.w.URL.revokeObjectURL=()=>{};a.w.HTMLAnchorElement.prototype.click=()=>{};
  a.store.setItem('envLitFolderList','["需要精读"]');await a.w.LitdbCloud.exportAll();const backup=JSON.parse(await captured.text());assert.equal(backup.format,'sport-env-complete-backup');assert.equal(backup.files[0].data,'AQID');await b.w.LitdbCloud.importAll(backup);const snapshot=await b.w.LitdbMemo.snapshot();assert.equal(snapshot.memos[0].body,'original body');assert.equal(snapshot.files[0].data,'AQID');assert.equal(b.store.getItem('envLitFolderList'),'["需要精读"]');
 }finally{a.close();b.close();}
});

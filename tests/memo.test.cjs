const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{test}=require('node:test');
function dependency(name){try{return require(name);}catch(e){return require(path.join(process.env.TEMP||'', 'sport-env-startup-tests','node_modules',name));}}
const {JSDOM}=dependency('jsdom'),{IDBFactory}=dependency('fake-indexeddb');
const source=fs.readFileSync(path.join(__dirname,'../memo.js'),'utf8');
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}assert.fail('Memo UI did not finish updating');}
async function seed(factory,count=1){await new Promise((resolve,reject)=>{
 const r=factory.open('litdb-memo',1);r.onupgradeneeded=()=>{const db=r.result,ms=db.createObjectStore('memos',{keyPath:'id',autoIncrement:true});ms.createIndex('created','created');ms.createIndex('paperId','paperId');db.createObjectStore('files',{keyPath:'id',autoIncrement:true});};
 r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction(['memos','files'],'readwrite');tx.objectStore('files').add({id:1,name:'evidence.pdf',type:'application/pdf',data:new Uint8Array([1,2,3]).buffer,size:3,created:1});for(let i=0;i<count;i++)tx.objectStore('memos').add({title:'Existing memo '+i,body:'Original user content',kind:'text',created:i+1,updated:i+1,fileIds:i===0?[1]:[]});tx.oncomplete=()=>{db.close();resolve();};};
});}
async function page(factory,url='https://fixture.invalid/#z-search'){
 const dom=new JSDOM('<div id="layout-classic"></div><div id="layout-app" hidden></div><div id="layout-study" hidden></div><button data-memo-open>Notes</button>',{url,runScripts:'dangerously',pretendToBeVisual:true});const w=dom.window;w.indexedDB=factory;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.confirm=()=>true;w.eval(source);await w.LitdbMemo.ready;return dom;
}
function click(d,selector){const b=d.querySelector(selector);assert.ok(b,selector);b.click();}
function input(d,id,value){const el=d.getElementById(id);el.value=value;el.dispatchEvent(new d.defaultView.Event('input',{bubbles:true}));}
test('independent notebook preserves original records/files, saves and reloads without altering the library layout',async()=>{
 const factory=new IDBFactory();await seed(factory);const dom=await page(factory),w=dom.window,d=w.document;
 try{
  await w.LitdbMemo.open();assert.equal(d.getElementById('layout-classic').hidden,true);assert.match(d.getElementById('memoList').textContent,/Original user content/);
  click(d,'[data-mnote="1"]');await until(()=>d.querySelector('[data-ma="edit"]'));click(d,'[data-ma="edit"]');input(d,'memoFBody','Edited complete body');click(d,'#memoForm [type="submit"]');await until(()=>d.querySelector('.memo-prose')?.textContent.includes('Edited complete body'));
  click(d,'[data-ma="new"]');input(d,'memoFTitle','New memo');input(d,'memoFBody','Complete note body');click(d,'#memoForm [type="submit"]');await until(()=>d.querySelectorAll('#memoList .memo-row').length===2);
  assert.equal(w.LitdbMemo.close(),true);assert.equal(d.getElementById('layout-classic').hidden,false);assert.equal(d.getElementById('layout-app').hidden,true);
  const backup=await w.LitdbMemo.snapshot();assert.equal(backup.files[0].data,'AQID');assert.equal(backup.memos.length,2);
  const reload=await page(factory);try{assert.match(reload.window.document.getElementById('memoList').textContent,/Edited complete body/);}finally{reload.window.close();}
 }finally{dom.window.close();}
});
test('attachment backups restore additively with remapped IDs, deduplicate and reject malformed input before writes',async()=>{
 const a=new IDBFactory();await seed(a);const first=await page(a),second=await page(new IDBFactory());
 try{
  await second.window.LitdbMemo.importRIS('TY  - JOUR\nTI  - Local entry\nAB  - Local text\nER  -');
  const backup=await first.window.LitdbMemo.snapshot();assert.equal(await second.window.LitdbMemo.restore(backup),1);assert.equal(await second.window.LitdbMemo.restore(backup),0);
  const restored=await second.window.LitdbMemo.snapshot();assert.equal(restored.memos.length,2);const note=restored.memos.find(x=>x.title==='Existing memo 0');assert.notEqual(note.id,backup.memos[0].id);assert.equal(restored.files.find(f=>f.id===note.fileIds[0]).data,'AQID');
  const broken=JSON.parse(JSON.stringify(backup));broken.files[0].data='not base64!';await assert.rejects(second.window.LitdbMemo.restore(broken));assert.equal((await second.window.LitdbMemo.snapshot()).memos.length,2);
 }finally{first.window.close();second.window.close();}
});
test('pagination, search, templates, source reading, reversible trash and unsaved navigation work',async()=>{
 const factory=new IDBFactory();await seed(factory,25);const dom=await page(factory),w=dom.window,d=w.document;let read;
 try{
  w.LitdbMemo.configure({papers:()=>[{id:'W123',doi:'10.1/example',title:'Evidence source',journal:'Fixture',year:2026}],read:id=>{read=id;}});await w.LitdbMemo.open();assert.equal(d.querySelectorAll('.memo-row').length,20);click(d,'[data-ma="next"]');assert.equal(d.querySelectorAll('.memo-row').length,5);
  input(d,'memoSearch','Existing memo 0');assert.equal(d.querySelectorAll('.memo-row').length,1);click(d,'[data-mnote="1"]');await until(()=>d.querySelector('[data-ma="trash"]'));click(d,'[data-ma="trash"]');await until(()=>d.querySelector('[data-ma="restore-note"]'));click(d,'[data-mscope="trash"]');assert.equal(d.querySelectorAll('.memo-row').length,1);click(d,'[data-ma="restore-note"]');await until(()=>!d.querySelector('[data-ma="restore-note"]'));
  click(d,'[data-ma="new"]');input(d,'memoFTitle','Research idea');input(d,'memoFBody','Unsaved');w.confirm=()=>false;assert.equal(w.LitdbMemo.close(),false);assert.equal(d.getElementById('memoFBody').value,'Unsaved');w.confirm=()=>true;click(d,'[data-ma="cancel"]');
  await w.MemoQuickAdd('W123','Reading record');assert.match(d.getElementById('memoFBody').value,/主要发现与原文依据/);click(d,'#memoForm [type="submit"]');await until(()=>d.querySelector('[data-ma="read"]'));assert.equal(d.querySelectorAll('.memo-prose h3').length,4);click(d,'[data-ma="read"]');assert.equal(read,'W123');
 }finally{dom.window.close();}
});
test('new PDF attachments commit with the note and remain present in exported backups',async()=>{
 const dom=await page(new IDBFactory()),w=dom.window,d=w.document;
 try{
  await w.LitdbMemo.open();click(d,'[data-ma="new"]');input(d,'memoFTitle','Attached evidence');input(d,'memoFBody','Evidence note');
  Object.defineProperty(d.getElementById('memoFFile'),'files',{value:[new w.File([new Uint8Array([4,5,6])],'new.pdf',{type:'application/pdf'})],configurable:true});d.getElementById('memoFFile').dispatchEvent(new w.Event('change'));
  click(d,'#memoForm [type="submit"]');await until(()=>d.querySelector('.memo-prose')?.textContent.includes('Evidence note'));
  const backup=await w.LitdbMemo.snapshot();assert.equal(backup.files[0].data,'BAUG');assert.equal(backup.files[0].name,'new.pdf');assert.equal(backup.memos[0].fileIds[0],backup.files[0].id);
 }finally{dom.window.close();}
});
test('a failed local write keeps the unsaved editor and does not claim success',async()=>{
 const dom=await page(new IDBFactory()),w=dom.window,d=w.document,{IDBDatabase}=dependency('fake-indexeddb'),original=IDBDatabase.prototype.transaction;
 try{
  w.console.error=()=>{};await w.LitdbMemo.open();click(d,'[data-ma="new"]');input(d,'memoFTitle','Must not disappear');input(d,'memoFBody','Unsaved evidence');
  IDBDatabase.prototype.transaction=function(stores,mode,...rest){if(mode==='readwrite')throw new w.DOMException('Full','QuotaExceededError');return original.call(this,stores,mode,...rest);};
  click(d,'#memoForm [type="submit"]');await until(()=>d.getElementById('memoFormError')?.textContent.includes('保存失败'));
  assert.equal(d.getElementById('memoFBody').value,'Unsaved evidence');assert.equal((await w.LitdbMemo.snapshot()).memos.length,0);w.confirm=()=>false;assert.equal(w.LitdbMemo.close(),false);
 }finally{IDBDatabase.prototype.transaction=original;dom.window.close();}
});
test('RIS multiline abstracts and legacy deep links remain complete',async()=>{
 const dom=await page(new IDBFactory(),'https://fixture.invalid/#z-memo');try{
  await until(()=>!dom.window.document.getElementById('memoHub').hidden);
  const n=await dom.window.LitdbMemo.importRIS('TY  - JOUR\nTI  - A study\nAB  - Introduction\nMethods across lines\nFinal conclusion\nER  -\n');assert.equal(n,1);const b=await dom.window.LitdbMemo.snapshot();assert.match(b.memos[0].body,/Final conclusion/);assert.equal(b.memos[0].category,'reading');
 }finally{dom.window.close();}
});

function transfer(w,el,event,files,text=''){
 const e=new w.Event(event,{bubbles:true,cancelable:true});
 Object.defineProperty(e,event==='paste'?'clipboardData':'dataTransfer',{value:{files,items:files.map(f=>({kind:'file',getAsFile:()=>f})),types:files.length?['Files']:['text/plain'],getData:t=>t==='text/plain'?text:'<img src="https://untrusted.invalid/a.png" onerror="alert(1)">'}});
 el.dispatchEvent(e);return e;
}
test('pasting a body image preserves cursor text, bytes, and inline placement through reload and backup ID remapping',async()=>{
 const factory=new IDBFactory(),a=await page(factory),w=a.window,d=w.document,b=await page(new IDBFactory());
 let urls=0;w.URL.createObjectURL=()=> 'blob:fixture-'+(++urls);w.URL.revokeObjectURL=()=>{};
 try{
  await w.LitdbMemo.open();click(d,'[data-ma="new"]');input(d,'memoFTitle','Image evidence');
  const rich=d.getElementById('memoRichBody');rich.textContent='BeforeAfter';rich.dispatchEvent(new w.Event('input',{bubbles:true}));
  const range=d.createRange();range.setStart(rich.firstChild,6);range.collapse(true);w.getSelection().removeAllRanges();w.getSelection().addRange(range);
  const f=new w.File([new Uint8Array([137,80,78,71])],'figure.png',{type:'image/png'});
  assert.equal(transfer(w,rich,'paste',[f]).defaultPrevented,true);await until(()=>rich.querySelector('img')?.getAttribute('src'));
  assert.match(d.getElementById('memoFBody').value,/^Before!\[figure.png\]\(memo-image:[\w-]+\)\nAfter$/);
  click(d,'#memoForm [type="submit"]');await until(()=>d.querySelector('.memo-prose img')?.getAttribute('src'));
  const backup=await w.LitdbMemo.snapshot();assert.equal(backup.files[0].data,'iVBORw==');assert.ok(backup.files[0].memoImageKey);
  const reload=await page(factory);reload.window.URL.createObjectURL=()=> 'blob:reloaded';reload.window.URL.revokeObjectURL=()=>{};
  try{await reload.window.LitdbMemo.open();assert.equal(reload.window.document.querySelector('.memo-prose img').src,'blob:reloaded');}finally{reload.window.close();}
  await b.window.LitdbMemo.importRIS('TY  - JOUR\nTI  - Existing local note\nER  -');await seedFile(b.window);
  b.window.URL.createObjectURL=()=> 'blob:restored';b.window.URL.revokeObjectURL=()=>{};
  await b.window.LitdbMemo.restore(backup);await b.window.LitdbMemo.open();
  const restored=await b.window.LitdbMemo.snapshot(),note=restored.memos.find(m=>m.title==='Image evidence');
  assert.notEqual(note.fileIds[0],backup.memos[0].fileIds[0]);
  click(b.window.document,'[data-mnote="'+note.id+'"]');await until(()=>b.window.document.querySelector('.memo-prose img')?.getAttribute('src'));
  assert.equal(b.window.document.querySelector('.memo-prose img').src,'blob:restored');
 }finally{a.window.close();b.window.close();}
});
async function seedFile(w){await new Promise((resolve,reject)=>{const r=w.indexedDB.open('litdb-memo',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('files','readwrite');tx.objectStore('files').add({name:'existing.pdf',type:'application/pdf',size:1,data:new Uint8Array([1]).buffer});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});}
test('attachment zone accepts clipboard images and dropped PDFs, rejects other files, and removes unsaved inline images cleanly',async()=>{
 const a=await page(new IDBFactory()),w=a.window,d=w.document;try{
  await w.LitdbMemo.open();click(d,'[data-ma="new"]');input(d,'memoFTitle','Pasted and dropped');
  const zone=d.getElementById('memoFileDrop'),image=new w.File(['image'],'shot.png',{type:'image/png'}),pdf=new w.File(['pdf'],'paper.pdf',{type:'application/pdf'});
  transfer(w,zone,'paste',[image]);transfer(w,zone,'drop',[pdf,new w.File(['x'],'bad.exe',{type:'application/octet-stream'})]);
  await until(()=>d.querySelectorAll('[data-mpending]').length===2);assert.equal(d.querySelectorAll('#memoRichBody img').length,0);
  transfer(w,d.getElementById('memoRichBody'),'paste',[new w.File(['image2'],'remove.png',{type:'image/png'})]);await until(()=>d.querySelectorAll('[data-mpending]').length===3);
  click(d,'[data-mpending="2"]');await until(()=>d.querySelectorAll('[data-mpending]').length===2);assert.equal(d.querySelectorAll('#memoRichBody img').length,0);assert.doesNotMatch(d.getElementById('memoFBody').value,/memo-image:/);
  click(d,'#memoForm [type="submit"]');await until(()=>d.querySelector('.memo-prose'));const saved=await w.LitdbMemo.snapshot();assert.equal(saved.files.length,2);assert.deepEqual(saved.files.map(f=>f.name).sort(),['paper.pdf','shot.png']);
 }finally{a.window.close();}
});
test('rich text paste inserts plain text without importing remote HTML or executable markup',async()=>{
 const a=await page(new IDBFactory()),w=a.window,d=w.document;try{
  await w.LitdbMemo.open();click(d,'[data-ma="new"]');const rich=d.getElementById('memoRichBody');
  transfer(w,rich,'paste',[],'Evidence <script>alert(1)</script>\nNext line');assert.equal(rich.querySelector('script'),null);assert.equal(rich.querySelector('img'),null);assert.match(d.getElementById('memoFBody').value,/Evidence <script>/);
  click(d,'#memoForm [type="submit"]');await until(()=>d.querySelector('.memo-prose'));assert.equal(d.querySelector('.memo-prose script'),null);assert.match(d.querySelector('.memo-prose').textContent,/Next line/);
 }finally{a.window.close();}
});

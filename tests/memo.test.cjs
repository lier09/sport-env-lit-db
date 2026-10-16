const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{test}=require('node:test');
function dependency(name){try{return require(name);}catch(e){return require(path.join(process.env.TEMP||'', 'sport-env-startup-tests','node_modules',name));}}
const {JSDOM}=dependency('jsdom'),{IDBFactory}=dependency('fake-indexeddb');
const source=fs.readFileSync(path.join(__dirname,'../memo.js'),'utf8');
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}assert.fail('Memo UI did not finish updating');}
async function seed(factory){await new Promise((resolve,reject)=>{
  const r=factory.open('litdb-memo',1);
  r.onupgradeneeded=()=>{const db=r.result,ms=db.createObjectStore('memos',{keyPath:'id',autoIncrement:true});ms.createIndex('created','created');ms.createIndex('paperId','paperId');db.createObjectStore('files',{keyPath:'id',autoIncrement:true});};
  r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('memos','readwrite');tx.objectStore('memos').add({title:'Existing memo',body:'Original user content',kind:'text',created:1,updated:1,fileIds:[]});tx.oncomplete=()=>{db.close();resolve();};};
});}
function page(factory){const d=new JSDOM('<button id="memoNew2">New</button><div id="memoList2"></div><div id="memoList"></div>',{url:'https://fixture.invalid',runScripts:'dangerously'});d.window.indexedDB=factory;d.window.eval(source);return d;}
test('memo module retains existing v1 records and creates, edits and reloads across both layouts',async()=>{
  const factory=new IDBFactory();await seed(factory);const dom=page(factory),d=dom.window.document;
  try{
    await until(()=>d.getElementById('memoList').textContent.includes('Existing memo'));
    assert.match(d.getElementById('memoList2').textContent,/Original user content/);
    d.getElementById('memoNew2').click();d.getElementById('memoFTitle').value='New memo';d.getElementById('memoFBody').value='Complete note body';d.querySelector('#memoModalFoot button').click();
    await until(()=>d.querySelectorAll('#memoList .memo-card').length===2);
    assert.match(d.getElementById('memoList2').textContent,/New memo/);
    d.querySelector('#memoList [data-medit]').click();d.getElementById('memoFBody').value='Edited complete body';d.querySelector('#memoModalFoot button').click();
    await until(()=>d.getElementById('memoList').textContent.includes('Edited complete body'));
    const reload=page(factory);try{await until(()=>reload.window.document.getElementById('memoList').textContent.includes('Edited complete body'));assert.match(reload.window.document.getElementById('memoList').textContent,/Existing memo/);}finally{reload.window.close();}
  }finally{dom.window.close();}
});

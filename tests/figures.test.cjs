const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{test}=require('node:test');
const E=require('../figure-extract.js');
function dependency(n){try{return require(n);}catch(e){return require(path.join(process.env.TEMP||'','sport-env-startup-tests','node_modules',n));}}
const {JSDOM}=dependency('jsdom'),{IDBFactory}=dependency('fake-indexeddb');
test('a compound figure stays one rectangle containing both panels and its full caption',()=>{
 const text=[{text:'A',x:55,y:155,right:65,bottom:166,h:11},{text:'B',x:335,y:155,right:345,bottom:166,h:11},{text:'Figure 1. Combined panels.',x:40,y:500,right:565,bottom:512,h:12},{text:'Complete caption continuation.',x:40,y:515,right:510,bottom:527,h:12}];
 const figures=E.candidates(text,[{x:50,y:160,right:250,bottom:450},{x:330,y:160,right:550,bottom:450}],600,800);
 assert.equal(figures.length,1);assert.equal(figures[0].label,'Figure 1');assert.match(figures[0].caption,/Complete caption continuation/);assert.ok(figures[0].rect[0]<50/600);assert.ok((figures[0].rect[0]+figures[0].rect[2])*600>550);assert.ok((figures[0].rect[1]+figures[0].rect[3])*800<500);
 const short=E.candidates([{text:'Figure 1. Short caption',x:40,y:500,right:280,bottom:512,h:12}], [{x:50,y:160,right:250,bottom:450},{x:330,y:160,right:550,bottom:450}],600,800);assert.equal(short.length,1);assert.ok((short[0].rect[0]+short[0].rect[2])*600>550,'short caption must not cause the right-hand panel to disappear');
});
test('PDF graphics transforms and full-page scan exclusion prevent treating scanned pages as extracted figures',()=>{
 const OPS={save:1,restore:2,transform:3,paintImageXObject:4,constructPath:5};const viewport={width:600,height:800,transform:[1,0,0,-1,0,800]};
 const list={fnArray:[1,3,4,2,1,3,4,2],argsArray:[[],[200,0,0,180,50,350],['image'],[],[],[600,0,0,800,0,0],['scan'],[]]};
 const graphics=E.graphics(list,OPS,viewport);assert.equal(graphics.length,1);assert.equal(graphics[0].x,50);assert.equal(graphics[0].bottom,450);assert.ok(E.validRect([0,0,1,1]));assert.ok(!E.validRect([.9,.1,.2,.5]));
});
async function page(){const dom=new JSDOM('<div id="layout-classic"></div><div id="layout-app" hidden></div><div id="layout-study" hidden></div>',{url:'https://fixture.invalid/#z-search',runScripts:'dangerously'});dom.window.indexedDB=new IDBFactory();dom.window.Blob=Blob;dom.window.URL.createObjectURL=()=> 'blob:fixture';dom.window.URL.revokeObjectURL=()=>{};dom.window.scrollTo=()=>{};dom.window.confirm=()=>true;dom.window.LitdbFigureExtract=E;dom.window.eval(fs.readFileSync(path.join(__dirname,'../figure-hub.js'),'utf8'));await dom.window.LitdbFigures.ready;return dom;}
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}assert.fail('Figure UI did not settle');}
test('library records are deduplicated and an independent workspace returns to the original layout',async()=>{
 const dom=await page(),w=dom.window,d=w.document;try{const p={id:'W1',title:'Research title',doi:'10.1/example',pdf_url:'javascript:alert(1)'};await w.LitdbFigures.addPaper(p);await w.LitdbFigures.addPaper(p);assert.equal((await w.LitdbFigures.snapshot()).papers.length,1);assert.equal(d.getElementById('layout-classic').hidden,true);assert.match(d.getElementById('figStudy').textContent,/等待|PDF/);assert.equal(d.querySelector('#figStudy a[href^="javascript:"]'),null);assert.equal(w.LitdbFigures.close(),true);assert.equal(d.getElementById('layout-classic').hidden,false);}finally{dom.window.close();}
});
test('figure backups restore images and notes, repeated imports do not overwrite study progress',async()=>{
 const dom=await page(),w=dom.window,d=w.document;try{
 const b={format:'sport-env-figure-backup',version:1,papers:[{id:'p1',title:'Paper',pages:2,created:1,pdf:'JVBERi0xLjc='}],figures:[{id:'f1',uid:'f1',paperId:'p1',page:2,label:'Figure 1',caption:'Full caption',rect:[.1,.1,.8,.5],blob:'AQID',note:'Existing observation',created:1,mastered:false,confirmed:false}]};
 assert.equal((await w.LitdbFigures.restore(b)).figures,1);await w.LitdbFigures.open();await until(()=>d.getElementById('figNote'));d.getElementById('figNote').value='My full note';d.querySelector('[data-fa="save-note"]').click();await until(()=>d.getElementById('figStatus').textContent.includes('笔记已保存'));d.querySelector('[data-fa="mastered"]').click();await until(()=>d.querySelector('[data-fa="mastered"]').textContent.includes('取消标记'));
 assert.equal((await w.LitdbFigures.restore(b)).figures,0);const backup=await w.LitdbFigures.snapshot();assert.equal(backup.figures[0].note,'My full note');assert.equal(backup.figures[0].mastered,true);assert.equal(backup.figures[0].blob,'AQID');
 const bad=JSON.parse(JSON.stringify(b));bad.figures[0].blob='bad!';await assert.rejects(w.LitdbFigures.restore(bad));assert.equal((await w.LitdbFigures.snapshot()).figures.length,1);
 }finally{dom.window.close();}
});
test('paper titles prefer meaningful metadata and fall back to multiline first-page headings',()=>{
 const rows=[{text:'Nature Communications',x:40,y:40,bottom:75,h:35},{text:'Exercise recovery after repeated',x:40,y:125,bottom:149,h:24},{text:'whole-body heating interventions',x:40,y:155,bottom:179,h:24},{text:'Patrick Rodrigues and colleagues',x:40,y:205,bottom:217,h:12}];
 assert.equal(E.paperTitle({info:{Title:'s41467-025-56084-6'}},rows,'s41467-025-56084-6.pdf',800),'Exercise recovery after repeated whole-body heating interventions');
 assert.equal(E.paperTitle({info:{Title:'A real scientific paper title'}},rows,'paper.pdf',800),'A real scientific paper title');
 assert.equal(E.paperTitle({info:{Title:'Microsoft Word - manuscript'}},rows,'paper.pdf',800),'Exercise recovery after repeated whole-body heating interventions');
 assert.equal(E.paperTitle({info:{Title:'Untitled document'}},[],'paper.pdf',800),'');
 assert.equal(E.paperTitle(null,[{text:'Ordinary abstract text',x:0,y:300,bottom:310,h:10}],'scan.pdf',800),'');
});
test('folders organize papers, title edits persist and folder backups preserve existing notes',async()=>{
 const dom=await page(),w=dom.window,d=w.document;
 function click(a){d.querySelector('[data-fa="'+a+'"]').click();}
 function submit(id){d.getElementById(id).dispatchEvent(new w.Event('submit',{cancelable:true}));}
 // jsdom has no native dialogs; keep UI state observable.
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 try{
 await w.LitdbFigures.addPaper({id:'Wfolder',title:'Initial paper title'});
 click('new-folder');d.getElementById('figFolderName').value='热适应';submit('figFolderForm');await until(()=>d.querySelector('[data-ffolder]:last-child').textContent.includes('热适应'));
 assert.equal(d.getElementById('figDirectoryCount').textContent,'热适应 · 0 篇');
 d.querySelector('[data-ffolder="all"]').click();await until(()=>d.querySelector('[data-fpaper]'));
 const move=d.getElementById('figMoveFolder');move.value=d.querySelector('[data-ffolder]:last-child').dataset.ffolder;move.dispatchEvent(new w.Event('change',{bubbles:true}));await until(()=>d.getElementById('figStatus').textContent.includes('论文已移动'));
 click('edit-title');d.getElementById('figTitleInput').value='Correct scientific paper title';submit('figTitleForm');await until(()=>d.getElementById('figStatus').textContent.includes('标题已保存'));
 assert.match(d.querySelector('[data-fpaper]').textContent,/Correct scientific paper title/);
 click('rename-folder');d.getElementById('figFolderName').value='热环境与恢复';submit('figFolderForm');await until(()=>d.querySelector('[data-ffolder]:last-child').textContent.includes('热环境与恢复'));
 const backup=await w.LitdbFigures.snapshot();assert.equal(backup.version,2);assert.equal(backup.folders.length,1);assert.equal(backup.papers[0].folderId,backup.folders[0].id);assert.equal(backup.papers[0].titleSource,'manual');
 const other=await page();try{await other.window.LitdbFigures.restore(backup);const restored=await other.window.LitdbFigures.snapshot();assert.equal(restored.folders[0].name,'热环境与恢复');assert.equal(restored.papers[0].title,'Correct scientific paper title');assert.equal((await other.window.LitdbFigures.restore(backup)).papers,0);}finally{other.window.close();}
 click('remove-folder');await until(()=>d.getElementById('figStatus').textContent.includes('论文已保留'));
 const after=await w.LitdbFigures.snapshot();assert.equal(after.folders.length,0);assert.equal(after.papers.length,1);assert.equal(after.papers[0].folderId,'');assert.match(d.querySelector('[data-fpaper]').textContent,/Correct scientific/);
 }finally{w.close();}
});
test('upgrading the original figure database retains saved PDF and image blobs',async()=>{
 const factory=new IDBFactory();await new Promise((resolve,reject)=>{const r=factory.open('litdb-figures',1);r.onupgradeneeded=()=>{r.result.createObjectStore('papers',{keyPath:'id'});r.result.createObjectStore('figures',{keyPath:'id'}).createIndex('paperId','paperId');};r.onsuccess=()=>{const db=r.result,tx=db.transaction(['papers','figures'],'readwrite');tx.objectStore('papers').put({id:'legacy',title:'Legacy paper title',pages:1,pdf:new Blob(['%PDF-old'])});tx.objectStore('figures').put({id:'legacy-image',paperId:'legacy',blob:new Blob(['PNG']),note:'Do not lose this note'});tx.oncomplete=()=>{db.close();resolve();};};r.onerror=()=>reject(r.error);});
 const dom=new JSDOM('<body></body>',{url:'https://fixture.invalid/',runScripts:'dangerously'}),w=dom.window;w.indexedDB=factory;w.Blob=Blob;w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};w.LitdbFigureExtract=E;
 try{w.eval(fs.readFileSync(path.join(__dirname,'../figure-hub.js'),'utf8'));await w.LitdbFigures.ready;const b=await w.LitdbFigures.snapshot();assert.equal(b.papers.length,1);assert.equal(Buffer.from(b.papers[0].pdf,'base64').toString(),'%PDF-old');assert.equal(b.figures[0].note,'Do not lose this note');assert.equal(Buffer.from(b.figures[0].blob,'base64').toString(),'PNG');assert.equal(b.folders.length,0);}finally{w.close();}
});

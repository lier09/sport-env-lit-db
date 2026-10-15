const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function part(a,b){const i=html.indexOf(a),j=html.indexOf(b,i);assert.ok(i>=0&&j>i);return html.slice(i,j);}
function fixture(){
 const records=Array.from({length:2345},(_,i)=>({id:'W'+i,title:'Paper '+i,authors:['Ben Lee'],journal:'Test & Journal',year:2026,cited:0,type:'原创研究',abstract:'First paragraph\nFinal conclusion',env:['低温'],tags:[],_jcr:{quartiles:['Q1'],year:2025,source:'fixture'}}));
 const elements={exportScope:{value:'selected'},exportSummary:{},ckAll:{},batchbar:{style:{}},batchCount:{}};
 for(const name of ['bbFav','bbRead','bbTag','bbOutline','bbCsv','bbBib','bbRis','bbClear','btnCsv','btnBib','btnRis'])elements[name]={};
 const downloads=[];let matches=records;
 const c=vm.createContext({filtered:()=>matches,batchSel:{},rCurList:records.slice(0,100),$:id=>elements[id],download:(name,text)=>downloads.push({name,text}),toast:()=>{},jcrDetails:()=>'',doiUrl:d=>'https://doi.org/'+d,render:()=>{},favs:{},readSt:{}});
 vm.runInContext(part('function csvCell(', '/* ---------- 学术画像 ---------- */')+part('function renderBatchbar(){','/* ---------- 自定义标签弹窗 ---------- */'),c);
 c.bindBatchbar();return {c,e:elements,records,downloads,setMatches:list=>{matches=list;}};
}
test('select-all covers 2345 filtered records although only 100 are rendered; all formats export all records',()=>{
 const f=fixture();f.e.ckAll.checked=true;f.e.ckAll.onchange();assert.equal(Object.keys(f.c.batchSel).length,2345);assert.equal(f.e.batchCount.textContent,2345);
 f.c.exportCsv();f.c.exportBib();f.c.exportRis();
 assert.equal((f.downloads[0].text.match(/"W\d+"/g)||[]).length,2345);
 assert.equal((f.downloads[1].text.match(/@article\{/g)||[]).length,2345);
 assert.equal((f.downloads[2].text.match(/TY  - JOUR/g)||[]).length,2345);
 assert.match(f.downloads[0].text,/JCR分区/);assert.match(f.downloads[0].text,/First paragraph\nFinal conclusion/);
 assert.ok(f.e.ckAll.checked);f.e.ckAll.checked=false;f.e.ckAll.onchange();assert.equal(Object.keys(f.c.batchSel).length,0);
});
test('all-results export bypasses 100 selected records, while batch exports honor selection',()=>{
 const f=fixture();f.records.slice(0,100).forEach(p=>f.c.batchSel[p.id]=1);f.e.exportScope.value='all';f.c.renderExportSummary();assert.match(f.e.exportSummary.textContent,/2,345/);
 f.c.exportCsv();f.c.exportBib();f.c.exportRis();assert.equal((f.downloads[0].text.match(/"W\d+"/g)||[]).length,2345);assert.equal((f.downloads[1].text.match(/@article\{/g)||[]).length,2345);assert.equal((f.downloads[2].text.match(/TY  - JOUR/g)||[]).length,2345);
 f.e.bbRis.onclick();assert.equal((f.downloads[3].text.match(/TY  - JOUR/g)||[]).length,100);
 f.e.exportScope.value='selected';f.c.syncCkAll();assert.equal(f.e.ckAll.indeterminate,true);assert.equal(f.e.ckAll.checked,false);
 f.setMatches(f.records.slice(500,700));assert.equal(f.c.exportList().length,200,'old selections outside the current filter cannot leak into exports');
});

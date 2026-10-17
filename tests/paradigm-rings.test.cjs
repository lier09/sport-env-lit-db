const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{test}=require('node:test');
let JSDOM;try{({JSDOM}=require('jsdom'));}catch(e){({JSDOM}=require(path.join(process.env.TEMP,'sport-env-startup-tests','node_modules','jsdom')));}
const data=require('../paradigm-rings.js');
async function page(hash=''){
 const dom=new JSDOM('<body style="overflow:clip"><main id="library"><button id="search">搜索</button><p>Original library</p></main></body>',{url:'https://fixture.invalid/'+hash,runScripts:'dangerously',pretendToBeVisual:true}),w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.matchMedia=()=>({matches:true});w.requestAnimationFrame=fn=>fn();w.document.getElementById('search').focus();
 w.eval(fs.readFileSync(path.join(__dirname,'../paradigm-rings.js'),'utf8'));return dom;
}
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Sheet did not settle');}
test('research framework keeps all requested independent dimensions and exact Chinese terminology',()=>{
 assert.deepEqual(data.groups.map(g=>g.items.length),[12,9,14,6,4]);
 assert.equal(data.groups[1].items.map(x=>x.name).join('、'),'单独刺激、运动前、运动中、运动后恢复、两次运动之间、训练调制、干预适应、交叉适应、周期化应用');
 assert.equal(data.groups[2].items.map(x=>x.name).join('、'),'有效性、剂量–反应、介入时机、动态过程、作用机制、成分拆分、安慰剂 / 期待效应、比较效果、任务特异性、结局特异性、个体差异、生态效度、急性–慢性关系、决策 / 周期化');
 for(const group of data.groups)for(const x of group.items){assert.ok(x.definition&&x.en&&x.question);assert.ok(x.examples.length>=2&&x.examples.length<=4);}
});
test('homepage opens the sheet, independent ring choices update explanations and copied paths',async()=>{
 const dom=await page(),w=dom.window,d=w.document;try{
 assert.equal(w.LitdbParadigm.isOpen(),true);assert.equal(d.body.style.overflow,'hidden');assert.equal(w.LitdbParadigm.path(),'高压氧 × 运动后恢复 × 剂量–反应 × 运动表现 × 短期');
 d.querySelector('g[data-pr-group="0"][data-pr-item="0"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
 assert.equal(w.LitdbParadigm.path(),'冷疗 × 运动后恢复 × 剂量–反应 × 运动表现 × 短期');assert.match(d.getElementById('prDetail').textContent,/Cold therapy/);
 const mechanism=d.querySelector('g[data-pr-group="2"][data-pr-item="4"]');mechanism.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
 assert.equal(w.LitdbParadigm.path(),'冷疗 × 运动后恢复 × 作用机制 × 运动表现 × 短期');assert.match(d.getElementById('prDetail').textContent,/为什么有效/);
 const appSelect=d.querySelector('[data-pr-select="1"]');appSelect.value='4';appSelect.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(w.LitdbParadigm.path(),'冷疗 × 两次运动之间 × 作用机制 × 运动表现 × 短期');
 d.querySelector('.pr-time [data-pr-item="2"]').click();assert.match(w.LitdbParadigm.path(),/适应期$/);
 let copied;Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async s=>{copied=s;}}});d.getElementById('prCopy').click();await until(()=>copied);assert.equal(copied,w.LitdbParadigm.path());
 d.getElementById('prReset').click();assert.equal(w.LitdbParadigm.path(),'高压氧 × 运动后恢复 × 剂量–反应 × 运动表现 × 短期');
 assert.equal(d.getElementById('library').textContent,'搜索Original library');
 }finally{w.close();}
});
test('dismissal restores the original page and focus; launcher reopens; Escape cancel also dismisses',async()=>{
 const dom=await page(),w=dom.window,d=w.document;try{
 d.getElementById('prClose').click();await until(()=>!w.LitdbParadigm.isOpen());assert.equal(d.body.style.overflow,'clip');assert.equal(d.activeElement.id,'search');assert.equal(d.getElementById('prLauncher').hidden,false);
 d.getElementById('prLauncher').click();assert.equal(w.LitdbParadigm.isOpen(),true);d.getElementById('paradigmSheet').dispatchEvent(new w.Event('cancel',{cancelable:true}));await until(()=>!w.LitdbParadigm.isOpen());assert.equal(d.body.style.overflow,'clip');
 }finally{w.close();}
});
test('upward drag on the handle dismisses, while deep links do not interrupt existing workspaces',async()=>{
 const dom=await page('#figures?paper=p1'),w=dom.window,d=w.document;try{
 assert.equal(w.LitdbParadigm.isOpen(),false);assert.equal(d.body.style.overflow,'clip');d.getElementById('prLauncher').click();const h=d.getElementById('prHandle');h.setPointerCapture=()=>{};
 function pointer(type,y){const e=new w.Event(type,{bubbles:true});Object.defineProperties(e,{clientY:{value:y},pointerId:{value:1}});h.dispatchEvent(e);}
 pointer('pointerdown',700);pointer('pointermove',600);pointer('pointerup',600);await until(()=>!w.LitdbParadigm.isOpen());assert.equal(d.body.style.overflow,'clip');
 }finally{w.close();}
});

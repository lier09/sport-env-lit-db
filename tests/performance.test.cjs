const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
test('offscreen graphs do not initialize and only render latest data when entering viewport',()=>{
 let observerCallback;const observed=new Set(),idle=[],draws=[];
 const el={getBoundingClientRect:()=>({width:600,height:350,top:2000,bottom:2350})};
 class IO{constructor(fn){observerCallback=fn;}observe(e){observed.add(e);}unobserve(e){observed.delete(e);}}
 const c=vm.createContext({window:{IntersectionObserver:IO,innerHeight:900,requestIdleCallback:fn=>idle.push(fn)},IntersectionObserver:IO,$:()=>el,runModule:(_,fn)=>fn(),drawNetNow:(...args)=>draws.push(args)});
 vm.runInContext(html.slice(html.indexOf('var _ecCache={};'),html.indexOf('function drawNetNow(')),c);
 c.drawNet('graph','tip',[{label:'old'}],[]);c.drawNet('graph','tip',[{label:'latest'}],[]);
 assert.equal(draws.length,0);assert.equal(observed.size,1);
 observerCallback([{target:el,isIntersecting:true}]);assert.equal(draws.length,0);idle.shift()();
 assert.equal(draws.length,1);assert.equal(draws[0][2][0].label,'latest');assert.equal(observed.size,0);
 el.getBoundingClientRect=()=>({width:600,height:350,top:400,bottom:750});
 c.drawNet('graph','tip',[{label:'visible update'}],[]);assert.equal(draws.length,2);
});
test('scroll bursts schedule one frame and do not rewrite unchanged back-to-top class',()=>{
 const events={},frames=[],mutations=[];const button={classList:{toggle:(...a)=>mutations.push(a)}};
 const c=vm.createContext({window:{scrollY:0,addEventListener:(name,fn)=>{events[name]=fn;},requestAnimationFrame:fn=>frames.push(fn)},document:{documentElement:{scrollTop:0}},$:id=>id==='backTop'?button:null});
 vm.runInContext(html.slice(html.indexOf('function bindClassicNav(){'),html.indexOf('/* ---------- 客户端壳')),c);c.bindClassicNav();
 assert.equal(mutations.length,1);
 for(let i=0;i<100;i++)events.scroll();assert.equal(frames.length,1);frames.shift()();assert.equal(mutations.length,1);
 c.window.scrollY=800;events.scroll();frames.shift()();assert.equal(mutations.length,2);assert.equal(mutations[1][1],true);
});

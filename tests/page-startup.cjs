const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
let jsdom;
try{jsdom=require('jsdom');}catch(e){jsdom=require(path.join(process.env.TEMP, 'sport-env-startup-tests', 'node_modules', 'jsdom'));}
const {JSDOM, VirtualConsole} = jsdom;
const root = path.join(__dirname, '..');
const baseline=process.argv.includes('--baseline');
const sourceHtml = baseline ? require('node:child_process').execFileSync('git',['show','HEAD:index.html'],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024}) : fs.readFileSync(path.join(root,'index.html'),'utf8');
const html=sourceHtml.replace('<script src="./follow-hub.js"></script>','<script>'+fs.readFileSync(path.join(root,'follow-hub.js'),'utf8')+'</script>').replace('<script src="./jcr-data.js"></script>','<script>'+fs.readFileSync(path.join(root,'jcr-data.js'),'utf8')+'</script>').replace('<script src="./library-jcr.js"></script>','<script>'+fs.readFileSync(path.join(root,'library-jcr.js'),'utf8')+'</script>').replace('<script src="./library-storage.js"></script>','<script>'+fs.readFileSync(path.join(root,'library-storage.js'),'utf8')+'</script>').replace('<script src="./library-cache.js"></script>','<script>'+fs.readFileSync(path.join(root,'library-cache.js'),'utf8')+'</script>');
const storageKey = html.match(/var LS_SESS\s*=\s*"([^"]+)"/)[1];
const warnings=[];
const records=[{id:'fixture1',title:'Cold-water immersion after exercise',abstract:'Background: Exercise recovery in cold water.\nMethods: '+('Complete method details. '.repeat(20))+'\nConclusion: FINAL_ABSTRACT_SENTINEL.',authors:['Ben Lee'],env:['低温'],tags:['冷水浸泡'],type:'原创研究',year:2026,cited:1,journal:'Journal of Applied Physiology',population:'human'},
{id:'fixture2',title:'Exercise heat acclimation',abstract:'Exercise in heat.',authors:'Fixture Author',env:'高温',tags:'热习服',type:'原创研究',year:'2025',cited:0,journal:'Fixture Journal'}];
if(!baseline) records.push({id:'historical',title:'Early cold exercise research',abstract:'Historical exercise physiology.',authors:['Historic Author'],env:['低温'],tags:[],type:'原创研究',year:1935,cited:0});
if(baseline) Object.assign(records[1],{authors:['Fixture Author'],env:['高温'],tags:['热习服']});
function response(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});}
const virtualConsole=new VirtualConsole();
virtualConsole.on('jsdomError',e=>warnings.push(e.message));
virtualConsole.on('error',(...args)=>warnings.push(args.map(x=>x && x.stack ? x.stack : String(x)).join(' ')));
const dom=new JSDOM(html,{url:'https://fixture.invalid/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole,
beforeParse(w){
  w.localStorage.setItem(storageKey,JSON.stringify({access_token:'fixture',refresh_token:'fixture',user:{id:'fixture-user'}}));
  w.Response=Response; w.AbortController=AbortController;w.TextDecoder=TextDecoder;
  w.fetch=async url=>{
    if(url.endsWith("/manifest.json"))return response({},404);
    if(url.includes('/auth/v1/user'))return response({id:'fixture-user'});
    if(url.includes('/rest/v1/profiles'))return response([{id:'fixture-user',banned:false}]);
    if(url.includes('papers-'))return response(url.includes('papers-1')?records:[]);
    throw new Error('Unexpected fixture request');
  };
  w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}});
  w.ResizeObserver=class{observe(){} disconnect(){}};
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.scrollTo=function(){};
  w.HTMLCanvasElement.prototype.getContext=function(){
    return new Proxy({measureText:()=>({width:50}),canvas:this}, {get:(obj,key)=>key in obj?obj[key]:()=>{},set:(obj,key,val)=>(obj[key]=val,true)});
  };
}});
setTimeout(()=>{
  try{
    const d=dom.window.document;
    if(baseline){
      assert.ok(warnings.some(x=>/Cannot set properties of null.*onclick/.test(x)),warnings.join('\n'));
      assert.equal(d.getElementById('slot-classic-analytics').children.length,0);
      console.log('PASS: unmodified GitHub HEAD reproduces the missing-element onclick error and empty analytics layout.');
      return;
    }
    const meta=d.getElementById('dbmeta').textContent;
    assert.match(meta,/已收录 3 篇/);
    assert.equal(d.getElementById('f_ymin').value,'1935');
    assert.ok(d.querySelector('[data-pid="historical"]'),'historical paper visible by default');
    assert.ok(d.querySelector('#slot-classic-results #c-results'),'results moved into visible layout');
    assert.ok(d.querySelector('#slot-classic-analytics #c-analytics'),'analytics moved into visible layout');
    assert.ok(d.getElementById('results').textContent.includes('Cold-water immersion'));
    assert.ok(!d.getElementById('a_authors').textContent.includes('画像数据加载中'));
    assert.equal(d.getElementById('boot').style.display,'none');
    assert.equal(warnings.filter(x=>/文献库初始化失败/.test(x)).length,0,warnings.join('\n'));
    const fullAbstract=records[0].abstract;
    const coldCard=d.querySelector('[data-pid="fixture1"]');
    assert.ok(!coldCard.querySelector('.abs').textContent.includes('FINAL_ABSTRACT_SENTINEL'),'card initially shows a preview');
    coldCard.querySelector('.more').click();
    assert.equal(coldCard.querySelector('.more').tagName,'BUTTON','expanded toggle remains keyboard accessible');
    assert.ok(coldCard.querySelector('.abs').textContent.startsWith(fullAbstract),'expand keeps full source abstract');
    coldCard.querySelector('.more').click();
    assert.ok(!coldCard.querySelector('.abs').textContent.includes('FINAL_ABSTRACT_SENTINEL'),'collapse restores preview');
    coldCard.querySelector('.readlink').click();
    assert.equal(d.querySelector('#r_read .rabs').textContent,fullAbstract,'reader preserves final conclusion and paragraphs');
    assert.ok(d.querySelector('[data-pid="fixture1"] h3').textContent.includes('JCR Q'),'JCR shown at top of card');
    assert.equal(d.querySelectorAll('#results .citelink').length,0,'card footer citation button removed');
    const jcrBadge=d.querySelector('[data-pid="fixture1"] h3 .badge.jcr');
    assert.ok(jcrBadge);assert.ok(!jcrBadge.textContent.includes('2025'),'card badge omits year');
    assert.ok(jcrBadge.title.includes('2025 数据年'),'year retained in tooltip');
    const filter=d.getElementById('f_jcr');
    filter.value='unknown';filter.dispatchEvent(new dom.window.Event('change'));
    assert.equal(d.querySelectorAll('#results .card').length,2,'unknown filter excludes matched journal');
    filter.value='Q4';filter.dispatchEvent(new dom.window.Event('change'));
    assert.equal(d.querySelectorAll('#results .card').length,0,'unknown is never Q4');
    d.getElementById('btnReset').click();assert.equal(filter.value,'all');
    assert.equal(d.querySelectorAll('#results .card').length,3);
    console.log('PASS: JCR badges, unknown/Q4 filters and reset use the public journal table.');
    console.log('PASS: full page initializes with synthetic data; search and analytics are mounted; loader is dismissed.');
    if(warnings.length) console.log('Optional fixture diagnostics:',warnings.slice(0,5));
  }catch(e){console.error(e.message); console.error(warnings.slice(0,6));process.exitCode=1;}
  finally{dom.window.close();}
},1200);

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
let jsdom;
try{jsdom=require('jsdom');}catch(e){jsdom=require(path.join(process.env.TEMP, 'sport-env-startup-tests', 'node_modules', 'jsdom'));}
const {JSDOM, VirtualConsole} = jsdom;
const root = path.join(__dirname, '..');
const baseline=process.argv.includes('--baseline');
const html = baseline ? require('node:child_process').execFileSync('git',['show','HEAD:index.html'],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024}) : fs.readFileSync(path.join(root,'index.html'),'utf8');
const storageKey = html.match(/var LS_SESS\s*=\s*"([^"]+)"/)[1];
const warnings=[];
const records=[{id:'fixture1',title:'Cold-water immersion after exercise',abstract:'Exercise recovery in cold water.',authors:['Ben Lee'],env:['低温'],tags:['冷水浸泡'],type:'原创研究',year:2026,cited:1,journal:'Fixture Journal',population:'human'},
{id:'fixture2',title:'Exercise heat acclimation',abstract:'Exercise in heat.',authors:'Fixture Author',env:'高温',tags:'热习服',type:'原创研究',year:'2025',cited:0,journal:'Fixture Journal'}];
if(baseline) Object.assign(records[1],{authors:['Fixture Author'],env:['高温'],tags:['热习服']});
function response(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});}
const virtualConsole=new VirtualConsole();
virtualConsole.on('jsdomError',e=>warnings.push(e.message));
virtualConsole.on('error',(...args)=>warnings.push(args.map(x=>x && x.stack ? x.stack : String(x)).join(' ')));
const dom=new JSDOM(html,{url:'https://fixture.invalid/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole,
beforeParse(w){
  w.localStorage.setItem(storageKey,JSON.stringify({access_token:'fixture',refresh_token:'fixture',user:{id:'fixture-user'}}));
  w.Response=Response; w.AbortController=AbortController;
  w.fetch=async url=>{
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
    assert.match(meta,/已收录 2 篇/);
    assert.ok(d.querySelector('#slot-classic-results #c-results'),'results moved into visible layout');
    assert.ok(d.querySelector('#slot-classic-analytics #c-analytics'),'analytics moved into visible layout');
    assert.ok(d.getElementById('results').textContent.includes('Cold-water immersion'));
    assert.ok(!d.getElementById('a_authors').textContent.includes('画像数据加载中'));
    assert.equal(d.getElementById('boot').style.display,'none');
    assert.equal(warnings.filter(x=>/文献库初始化失败/.test(x)).length,0,warnings.join('\n'));
    console.log('PASS: full page initializes with synthetic data; search and analytics are mounted; loader is dismissed.');
    if(warnings.length) console.log('Optional fixture diagnostics:',warnings.slice(0,5));
  }catch(e){console.error(e.message); console.error(warnings.slice(0,6));process.exitCode=1;}
  finally{dom.window.close();}
},1200);

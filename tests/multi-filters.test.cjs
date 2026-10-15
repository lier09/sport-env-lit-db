const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
let JSDOM;try{({JSDOM}=require('jsdom'));}catch(e){({JSDOM}=require(path.join(process.env.TEMP,'sport-env-startup-tests','node_modules','jsdom')));}
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('var filterMemo='),html.indexOf('/* ---------- 渲染结果'));
function fixture(){
 const records=[['human','综述','Q1'],['human','综述','Q2'],['human','原创研究','Q3'],['animal','综述','Q3'],['human','综述','Q4'],['both','综述',null]].map(([population,type,q],i)=>({id:String(i),population,type,_jcr:{quartiles:q?[q]:[]},title:'Study',authors:[],env:['低温'],tags:[],year:2026,cited:0}));
 const c=vm.createContext({PAPERS:records,window:{},state:{q:'',tags:{},env:{'低温':true},type:'all',population:'all',jcr:'all',journal:'all',design:'all',ev:'all',ymin:2020,ymax:2026,minCited:0,sort:'year_desc'},DATA_YEAR_MIN:2020,DATA_YEAR_MAX:2026,favOnly:false,favs:{},myTags:{},folders:{},deletedIds:{},isDeleted:()=>false,parseQ:()=>({}),matchAdv:()=>true,EV_LEVEL:{},LitdbJcr:require('../library-jcr.js')});
 vm.runInContext(source,c);return c;
}
test('multiple quartiles are OR; population and review type are AND across dimensions',()=>{
 const c=fixture();c.state.jcr=['Q1','Q2','Q3'];c.state.type=['综述'];c.state.population=['human'];
 assert.deepEqual(Array.from(c.filtered(),p=>p.id),['0','1']);
 c.state.jcr=['Q2','Q4'];assert.deepEqual(Array.from(c.filtered(),p=>p.id),['1','4']);
 c.state.population=['human','both'];c.state.jcr=['Q1','unknown'];assert.deepEqual(Array.from(c.filtered(),p=>p.id),['0','5']);
});
test('legacy scalar selections still work; deleting one selected value preserves others',()=>{
 const c=fixture();c.state.jcr='Q1';assert.equal(c.filtered().length,1);
 c.state.jcr=['Q1','Q2','Q3'];c.state.jcr=c.choiceToggle(c.state.jcr,'Q2');assert.deepEqual(Array.from(c.choiceValues(c.state.jcr)),['Q1','Q3']);
 assert.deepEqual(Array.from(c.choiceValues(c.choiceDecode(JSON.stringify(['Q1','Q2'])))),['Q1','Q2']);assert.equal(c.choiceDecode('Q1'),'Q1');
});
test('checkbox controls retain several choices, support clear-all and preserve journal commas',()=>{
 const c=fixture(),dom=new JSDOM('<div class="filters"><label>JCR 分区<select id="f_jcr"><option value="all">全部</option><option>Q1</option><option>Q2</option><option>Q3</option></select></label><label>期刊<select id="f_journal"><option value="all">全部</option><option>Medicine, Science & Sport</option><option>Other Journal</option></select></label></div>');
 try{
 c.document=dom.window.document;c.window=dom.window;c.Event=dom.window.Event;c.$=id=>c.document.getElementById(id);
 c.initMultiFilters();c.$('f_jcr').addEventListener('change',()=>{c.state.jcr=c.choiceRead('f_jcr');c.syncMultiFilters();});
 c.document.querySelector('[data-field="jcr"] input[value="Q1"]').click();c.document.querySelector('[data-field="jcr"] input[value="Q2"]').click();
 assert.deepEqual(Array.from(c.state.jcr),['Q1','Q2']);assert.match(c.document.querySelector('[data-field="jcr"] summary').textContent,/Q1 \/ Q2/);
 c.document.querySelector('[data-field="jcr"] input[value="all"]').click();assert.equal(c.state.jcr,'all');
 c.choiceWrite('f_journal',['Medicine, Science & Sport','Other Journal']);assert.deepEqual(Array.from(c.choiceRead('f_journal')),['Medicine, Science & Sport','Other Journal']);
 }finally{dom.window.close();}
});

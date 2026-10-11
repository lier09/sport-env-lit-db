(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.LitdbJcr=factory();})(typeof window!=='undefined'?window:globalThis,function(){
  function titleKey(s){return String(s||'').normalize('NFKC').toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
  function issnKey(s){var key=String(s||'').toUpperCase().replace(/[^0-9X]/g,'');return /^\d{7}[\dX]$/.test(key)?key:'';}
  function create(data){
    var titles=new Map(),issns=new Map();
    function add(map,key,row){if(!key)return;if(!map.has(key))map.set(key,row);else if(map.get(key)!==row)map.set(key,null);}
    if(data&&Array.isArray(data.journals))data.journals.forEach(function(row){
      add(titles,titleKey(row.name),row);(row.issn||[]).forEach(function(s){add(issns,issnKey(s),row);});
    });
    return function(p){
      var raw=p.issn||p.issns||[],keys=Array.isArray(raw)?raw:[raw],source=p.primary_location&&p.primary_location.source;
      if(source&&Array.isArray(source.issn))keys=keys.concat(source.issn);
      var matches=[],ambiguous=false,foundIssn=false;
      keys.forEach(function(s){var key=issnKey(s);if(!key||!issns.has(key))return;foundIssn=true;var r=issns.get(key);if(!r)ambiguous=true;else if(matches.indexOf(r)<0)matches.push(r);});
      var row=foundIssn?(!ambiguous&&matches.length===1?matches[0]:null):titles.get(titleKey(p.journal));
      if(!row)return {quartiles:[],categories:[],year:data&&data.year||null,source:data&&data.source||'',matched:false};
      var cats=(row.categories||[]).filter(function(c){return /^Q[1-4]$/.test(c.quartile);});
      return {quartiles:Array.from(new Set(cats.map(function(c){return c.quartile;}))).sort(),categories:cats,year:data.year,source:data.source,matched:true,method:foundIssn?'ISSN':'期刊全名',journal:row.name};
    };
  }
  function matches(p,value){var q=p._jcr&&p._jcr.quartiles||[];return !value||value==='all'||(value==='unknown'?q.length===0:q.indexOf(value)>=0);}
  return {create:create,matches:matches,titleKey:titleKey,issnKey:issnKey};
});

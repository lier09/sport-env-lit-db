/* Shared, auditable candidate rules. No inference of eligibility or study independence. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.LitdbMetaCore=factory();})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
function normalized(v){return String(v||'').normalize('NFKC').replace(/[‐‑–−]/g,'-');}
function compile(topic){return topic.groups.map(function(g){return new RegExp(g,'i');});}
function match(p,rules){
 var fields=[['标题',normalized(p.title)],['摘要',normalized(p.abstract)]],hits=[];
 for(var r of rules){var hit=null;for(var f of fields){var m=f[1].match(r);if(m){hit={field:f[0],term:m[0]};break;}}if(!hit)return null;hits.push(hit);}
 return hits;
}
function kind(p){return /systematic review|meta[ -]?analys|范围综述|系统综述|荟萃分析/i.test(p.title||'')?'synthesis':/review|综述/i.test((p.type||'')+' '+(p.title||''))?'review':'unverified';}
function identity(p){return p.doi?'doi:'+String(p.doi).toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//,'').trim():'id:'+p.id;}
function collect(papers,topic){var seen=new Set(),rules=compile(topic),rows=[];papers.forEach(function(p){var hits=match(p,rules);if(!hits)return;var key=identity(p);if(seen.has(key))return;seen.add(key);rows.push({id:p.id,kind:kind(p),hits:hits});});return rows;}
return {compile:compile,match:match,kind:kind,identity:identity,collect:collect};
});

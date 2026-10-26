/* Deterministic three-way merge. Missing fields are changes only with a known base. */
(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LitdbCloudCore=api;}(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(function(k){return JSON.stringify(k)+':'+canonical(v[k]);}).join(',')+'}';return JSON.stringify(v);}
function equal(a,b){return canonical(a)===canonical(b);}
function object(v){return v&&typeof v==='object'&&!Array.isArray(v);}
function merge(base,local,remote,known){
 if(equal(local,remote))return {value:local,conflict:false};
 if(known&&equal(local,base))return {value:remote,conflict:false};
 if(known&&equal(remote,base))return {value:local,conflict:false};
 if(object(local)&&object(remote)&&(!known||object(base))){
  var out={},bad=false,keys=new Set(Object.keys(local).concat(Object.keys(remote)).concat(Object.keys(base||{})));
  keys.forEach(function(k){
   var l=Object.prototype.hasOwnProperty.call(local,k),r=Object.prototype.hasOwnProperty.call(remote,k),b=base&&Object.prototype.hasOwnProperty.call(base,k);
   if(!l||!r){
    if(!known){if(l)out[k]=local[k];else if(r)out[k]=remote[k];return;}
    if(l&&!r){if(!b||!equal(local[k],base[k])){out[k]=local[k];if(b)bad=true;}return;}
    if(r&&!l){if(!b||!equal(remote[k],base[k])){out[k]=remote[k];if(b)bad=true;}return;}
    return;
   }
   var m=merge(b?base[k]:undefined,local[k],remote[k],!!known&&!!b);out[k]=m.value;bad=bad||m.conflict;
  });return {value:out,conflict:bad};
 }
 if(Array.isArray(local)&&Array.isArray(remote)){
  if(local.concat(remote).every(function(x){return typeof x==='string';})){
   var result=Array.from(new Set(local.concat(remote)));
   if(known&&Array.isArray(base))result=result.filter(function(x){return !base.includes(x)||local.includes(x)&&remote.includes(x);});
   return {value:result,conflict:false};
  }
 }
 return {value:remote,conflict:true};
}
function decision(kind,base,local,remote){
 if(!remote)return {action:'push',payload:local};
 if(local===undefined)return {action:'pull',payload:remote.payload};
 if(equal(local,remote.payload))return {action:'same',payload:local};
 if(base&&equal(local,base.payload))return {action:'pull',payload:remote.payload};
 if(base&&remote.revision===base.revision)return {action:'push',payload:local};
 if(kind==='memo')return {action:'conflict',payload:remote.payload,local:local};
 var m=merge(base&&base.payload,local,remote.payload,!!base);
 return {action:m.conflict?'conflict':equal(m.value,remote.payload)?'pull':'push',payload:m.value,local:local};
}
return {canonical:canonical,equal:equal,merge:merge,decision:decision};
}));

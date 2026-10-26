/* Account-isolated local workspace. No authentication/API secrets in backups. */
(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LitdbPersonal=api;}(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
var keys=['litdb-meta-tracker','envLitPageSize','litdb-ris-imports','envLitFolders','envLitFolderList','envLitMyTags','envLitTagList','envLitFollow','envLitHist','envLitSavedQ','envLitDeleted','envLitFavs','litdb-follows','envLitNotes','envLitRead','litdb-ai-endpoint','litdb-ai-key','litdb-ai-model'];
var backupKeys=keys.filter(function(k){return k.indexOf('litdb-ai-')!==0;});
function create(userId,storage,onError){
 if(!userId)throw new Error('User ID required');
 var generation=null;try{if(userId==='anonymous')generation=storage.getItem('litdb-anonymous-generation');}catch(e){}
 var key='litdb-personal:'+userId+(generation?':'+generation:''), values={}, memoryOnly=false, corrupt=false, listeners=[];
 function fail(e){memoryOnly=true;if(onError)onError('本机保存失败，请立即导出备份；关闭页面后新修改可能丢失。');}
 try{
  var existing=storage.getItem(key);
  if(existing){corrupt=true;var decoded=JSON.parse(existing);if(!decoded||typeof decoded!=='object'||Array.isArray(decoded))throw new Error('Invalid workspace');values=decoded;corrupt=false;}
  else{
   var owner=storage.getItem('litdb-personal-legacy-owner');
   if(!generation&&(!owner||owner===userId)){
    keys.forEach(function(k){var value=storage.getItem(k);if(value!==null)values[k]=value;});
    storage.setItem(key,JSON.stringify(values));
    if(!owner)storage.setItem('litdb-personal-legacy-owner',userId);
   }
  }
 }catch(e){fail(e);}
 function persist(next){
  try{if(corrupt)throw new Error('Corrupt saved workspace retained');storage.setItem(key,JSON.stringify(next));memoryOnly=false;}catch(e){fail(e);}
  values=next;listeners.slice().forEach(function(fn){fn();});
 }
 function validate(payload){
  if(!payload||payload.format!=='sport-env-personal-backup'||payload.version!==1||!payload.values||typeof payload.values!=='object'||Array.isArray(payload.values))throw new Error('备份格式无效');
  var next={};
  Object.keys(payload.values).forEach(function(k){
   if(backupKeys.indexOf(k)<0)throw new Error('备份包含不支持的字段：'+k);
   var value=payload.values[k];
   if(typeof value!=='string')throw new Error('备份字段格式无效：'+k);
   if(['litdb-ai-endpoint','litdb-ai-model'].indexOf(k)<0){
    var parsed=JSON.parse(value);var arrayKeys=['litdb-ris-imports','envLitFolderList','envLitTagList','envLitHist','envLitSavedQ'];if(arrayKeys.indexOf(k)>=0&&!Array.isArray(parsed))throw new Error('备份列表格式无效：'+k);if(arrayKeys.indexOf(k)<0&&k!=='envLitPageSize'&&Array.isArray(parsed))throw new Error('备份对象格式无效：'+k);if(k==='litdb-ris-imports'&&parsed.some(function(p){return !p||typeof p!=='object'||typeof p.id!=='string'||typeof p.title!=='string';}))throw new Error('导入文献格式无效');if(parsed===null||typeof parsed!=='object'){
     if(k!=='envLitPageSize'||[20,50,100].indexOf(parsed)<0)throw new Error('备份字段格式无效：'+k);
    }
   }
   next[k]=value;
  });return next;
 }
 return {
  getItem:function(k){return Object.prototype.hasOwnProperty.call(values,k)?values[k]:null;},
  setItem:function(k,v){if(keys.indexOf(k)<0)throw new Error('Unsupported workspace key');var next=Object.assign({},values);next[k]=String(v);persist(next);},
  snapshot:function(){var result={};backupKeys.forEach(function(k){if(Object.prototype.hasOwnProperty.call(values,k))result[k]=values[k];});return {format:'sport-env-personal-backup',version:1,exported_at:new Date().toISOString(),values:result};},
  restore:function(payload){var imported=validate(payload),next=Object.assign({},values,imported);persist(next);if(memoryOnly)throw new Error('空间不足，备份未能持久保存；请保留备份文件。');},
  subscribe:function(fn){listeners.push(fn);return function(){listeners=listeners.filter(function(x){return x!==fn;});};},
  persistent:function(){return !memoryOnly;}, storageKey:key
 };
}
return {create:create,keys:keys};
}));

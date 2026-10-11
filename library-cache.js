/* Private corpus cache; keys include the signed-in user ID. */
(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LitdbCache=api;}(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function create(indexedDB){
 var pending,writeQueue=Promise.resolve();
 function open(){if(!indexedDB)return Promise.resolve(null);if(pending)return pending;
  pending=new Promise(function(resolve){var finished=false,timer=setTimeout(function(){finished=true;resolve(null);},1500),req;
   try{req=indexedDB.open('litdb-paper-cache',1);}catch(e){clearTimeout(timer);resolve(null);return;}
   req.onupgradeneeded=function(){if(!req.result.objectStoreNames.contains('parts'))req.result.createObjectStore('parts');};
   req.onsuccess=function(){if(finished){req.result.close();return;}finished=true;clearTimeout(timer);req.result.onversionchange=function(){req.result.close();pending=null;};resolve(req.result);};
   req.onerror=req.onblocked=function(){finished=true;clearTimeout(timer);resolve(null);};
  });return pending;
 }
 async function transact(key,value,write){var db=await open();if(!db)return null;
  return new Promise(function(resolve){var tx,req,done=false,timer=setTimeout(function(){if(!done){done=true;resolve(null);}},write?8000:1500);
   function finish(result){if(!done){done=true;clearTimeout(timer);resolve(result);}}
   try{tx=db.transaction('parts',write?'readwrite':'readonly');req=write?tx.objectStore('parts').put(value,key):tx.objectStore('parts').get(key);
    if(write){var cursor=tx.objectStore('parts').openCursor();cursor.onsuccess=function(){var row=cursor.result;if(!row)return;var family=function(value){return String(value).replace(/versions\/[a-f0-9]{20}\//,'');};if(row.key!==key&&family(row.key)===family(key))row.delete();row.continue();};}
    tx.oncomplete=function(){finish(write?true:req.result||null);};tx.onerror=tx.onabort=function(){finish(null);};
   }catch(e){finish(null);}
  });
 }
 return {get:function(user,url){return transact(user+'|'+url,null,false);},put:function(user,url,value){writeQueue=writeQueue.then(function(){return transact(user+'|'+url,value,true);});return writeQueue;}};
}
return {create:create};
}));

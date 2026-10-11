const {test}=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../library-storage.js');
function store(seed={}){const map=new Map(Object.entries(seed));return {getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,v),dump:k=>map.get(k)};}
test('legacy workspace moves to the first account only, preserving the original backup',()=>{
 const s=store({envLitFavs:'{"paper":true}','litdb-ai-key':'secret'}),a=create('a',s),b=create('b',s);
 assert.equal(a.getItem('envLitFavs'),'{"paper":true}');assert.equal(b.getItem('envLitFavs'),null);
 a.setItem('envLitFavs','{"other":true}');assert.equal(b.getItem('envLitFavs'),null);assert.equal(s.dump('envLitFavs'),'{"paper":true}');
 assert.ok(!JSON.stringify(a.snapshot()).includes('secret'));assert.ok(!Object.keys(a.snapshot().values).some(k=>/ai-|session|invite/.test(k)));
});
test('backup round trip preserves folders and notes; malformed imports change nothing',()=>{
 const s=store(),a=create('a',s);a.setItem('envLitFolders','{"p":["冷水恢复"]}');a.setItem('envLitNotes','{"p":"note"}');
 const before=s.dump(a.storageKey),backup=a.snapshot();assert.throws(()=>a.restore({...backup,values:{...backup.values,'litdb-ai-key':'secret'}}),/不支持/);assert.equal(s.dump(a.storageKey),before);
 assert.throws(()=>a.restore({...backup,values:{envLitFolderList:'{}'}}),/列表/);assert.equal(s.dump(a.storageKey),before);
 const b=create('b',s);b.restore(backup);assert.equal(b.getItem('envLitFolders'),a.getItem('envLitFolders'));assert.equal(b.getItem('envLitNotes'),a.getItem('envLitNotes'));
});
test('quota errors retain disk data, keep new edits in memory, and expose backup warning',()=>{
 const s=store(),messages=[],a=create('a',s,m=>messages.push(m));a.setItem('envLitNotes','{"p":"old"}');const old=s.dump(a.storageKey);s.setItem=()=>{throw new Error('quota');};a.setItem('envLitNotes','{"p":"new"}');
 assert.equal(s.dump(a.storageKey),old);assert.equal(a.getItem('envLitNotes'),'{"p":"new"}');assert.equal(a.persistent(),false);assert.match(messages.at(-1),/导出备份/);
});
test('corrupted saved workspace is never silently overwritten',()=>{
 const s=store({'litdb-personal:a':'{corrupt'}),a=create('a',s);a.setItem('envLitNotes','{}');assert.equal(s.dump('litdb-personal:a'),'{corrupt');assert.equal(a.persistent(),false);
});

const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
test('every inline script and local application script compiles independently',()=>{
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
    new vm.Script(match[2]);
    const src=match[1].match(/src="\.\/([^"]+)"/);
    if(src)new vm.Script(fs.readFileSync(path.join(root,src[1].split('?')[0]),'utf8'),{filename:src[1]});
  }
});
test('local application scripts and styles are included in the offline shell',()=>{
  const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  for(const m of html.matchAll(/(?:src|href)="\.\/([^"?]+\.(?:js|css)(?:\?[^\"]*)?)"/g)){
    assert.ok(fs.existsSync(path.join(root,m[1].split('?')[0])),m[1]+' exists');
    assert.ok(sw.includes("'./"+m[1]+"'"),m[1]+' cached with shell');
  }
});

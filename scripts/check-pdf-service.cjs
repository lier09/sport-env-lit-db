/* Target-environment acceptance check. Reads only the already-public anon key.
 * No management token, service-role key, cookie or user OpenAlex key is used.
 * Does not enable the frontend unless ALL checks pass and --enable is explicit.
 */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
async function main(){
 const page=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const base=page.match(/window\.SUPABASE_URL="([^"]+)"/)[1];
 const anon=page.match(/window\.SUPABASE_ANON_KEY="([^"]+)"/)[1];
 const file=path.join(root,'pdf-service-config.json'),config=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(config.url,base.replace(/\/$/,'')+'/functions/v1/pdf-reader');
 const origin='https://lier09.github.io';
 const call=(body,auth=true,method='POST')=>fetch(config.url,{method,redirect:'error',signal:AbortSignal.timeout(60000),headers:{origin,...(method==='POST'?{'content-type':'application/json'}:{}),...(auth?{apikey:anon,Authorization:'Bearer '+anon}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})});
 const preflight=await call(null,false,'OPTIONS');assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
 const anonymous=await call({doi:'10.3389/fspor.2026.1738075'},false);
 assert.equal(anonymous.status,401,'Gateway must require the existing public anon JWT; do not deploy with --no-verify-jwt');
 const invalid=await call({url:'http://127.0.0.1/private'});assert.equal(invalid.status,400);
 for(const doi of ['10.3389/fspor.2026.1738075','10.3389/fspor.2025.1702420','10.3389/fphys.2025.1717275']){
  const r=await call({doi});assert.equal(r.status,200,'PDF check failed for '+doi+' (HTTP '+r.status+')');
  assert.equal(r.headers.get('X-Litdb-Protocol'),'1');assert.equal(r.headers.get('X-Litdb-DOI'),doi);assert.ok(r.headers.get('X-Litdb-Source'));
  const bytes=new Uint8Array(await r.arrayBuffer());assert.equal(new TextDecoder().decode(bytes.subarray(0,5)),'%PDF-');assert.ok(bytes.length>10000&&bytes.length<=25*1024*1024);
  console.log('PASS: '+doi+' · '+bytes.length+' bytes');
 }
 if(process.argv.includes('--enable')){
  config.enabled=true;const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(config,null,2)+'\n');fs.renameSync(tmp,file);
  console.log('Acceptance passed; local pdf-service-config.json enabled. Review and publish ONLY this config change.');
 }else console.log('Acceptance passed. Frontend switch was not changed.');
}
main().catch(e=>{console.error('PDF service acceptance failed: '+e.message);process.exitCode=1;});

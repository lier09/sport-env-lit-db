/* node scripts/build-meta-candidates.cjs <directory containing manifest.json and papers-1..4.json> */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const core=require('../meta-core.js'),rules=require('../meta-rules.json');
const source=process.argv[2];if(!source)throw Error('Provide a verified corpus directory');
const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8'));
console.log(JSON.stringify(manifest).slice(0,500));
let papers=[];
for(let n=1;n<=4;n++){
 const bytes=fs.readFileSync(path.join(source,`papers-${n}.json`));
 const shards=manifest.shards||manifest.files||[];
 const entry=shards.find(s=>String(s.path||s.name||s.file||s.url||'').endsWith(`papers-${n}.json`));
 if(!entry||!entry.sha256)throw Error('Manifest SHA256 missing for shard '+n);
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Shard hash mismatch: '+n);
 papers.push(...JSON.parse(bytes));
}
const expected=manifest.total_papers||manifest.total||manifest.count;
if(expected!==papers.length)throw Error('Corpus count mismatch '+expected+' / '+papers.length);
const out={format:'litdb-meta-candidates',version:1,ruleVersion:rules.version,corpus:{version:manifest.version,generated_at:manifest.generated_at,total:papers.length},topics:rules.topics.map(t=>({...t,records:core.collect(papers,t)}))};
fs.writeFileSync(path.join(__dirname,'../meta-topics.json'),JSON.stringify(out));
out.topics.forEach(t=>console.log(t.id,t.records.length,'review signals',t.records.filter(r=>r.kind!=='unverified').length));

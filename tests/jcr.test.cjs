const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const jcr=require('../library-jcr.js');
const c={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../jcr-data.js'),'utf8'),c);
const data=c.window.LITDB_JCR_DATA;
test('public table has verified provenance, data year, category quartiles and complete extraction',()=>{
 assert.equal(data.year,2025);assert.equal(data.release,'2026-06');assert.equal(data.rows,32215);assert.equal(data.journals.length,22643);
 assert.match(data.source,/^https:\/\/uefiscdi.gov.ro\//);assert.match(data.source_sha256,/^[0-9a-f]{64}$/);
 const row=data.journals.find(j=>j.name==='JOURNAL OF ULTRASOUND IN MEDICINE');
 assert.ok(row);assert.equal(row.categories.find(c=>c.name==='ACOUSTICS').quartile,'Q2'); // source AIS is Q1, must not substitute it
 for(const row of data.journals){assert.ok(row.name&&row.categories.length);for(const c of row.categories)assert.ok(c.quartile===null||/^Q[1-4]$/.test(c.quartile));}
});
test('all subject quartiles match; unknown never becomes Q4; title match is exact',()=>{
 const match=jcr.create({year:2024,source:'fixture',journals:[{name:'Test & Exercise',issn:['1234-567X'],categories:[{name:'A',quartile:'Q1'},{name:'B',quartile:'Q2'}]}]});
 const p={_jcr:match({journal:'test and exercise'})};assert.deepEqual(p._jcr.quartiles,['Q1','Q2']);
 assert.ok(jcr.matches(p,'Q1')&&jcr.matches(p,'Q2'));assert.ok(!jcr.matches(p,'Q4')&&!jcr.matches(p,'unknown'));
 const absent={_jcr:match({journal:'Test & Exercise review'})};assert.ok(jcr.matches(absent,'unknown'));assert.ok(!jcr.matches(absent,'Q4'));
 assert.equal(match({journal:'Different title',issn:'1234-567X'}).method,'ISSN');
});
test('ambiguous titles and conflicting ISSNs stay unmatched',()=>{
 const rows=[{name:'Same name',issn:['1234-567X'],categories:[{name:'A',quartile:'Q1'}]},{name:'Same name',issn:['1111-1111'],categories:[{name:'A',quartile:'Q4'}]}];
 const match=jcr.create({year:2024,journals:rows});
 assert.equal(match({journal:'Same name'}).matched,false);assert.equal(match({journal:'Same name',issn:['1234-567X','1111-1111']}).matched,false);
 assert.deepEqual(match({journal:'Same name',issn:['1234-567X']}).quartiles,['Q1']);
});

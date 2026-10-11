const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {test}=require('node:test');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const start=html.indexOf('function parseRisText(');
const ctx=vm.createContext({});
vm.runInContext(html.slice(start,html.indexOf('function risToPaper(',start)),ctx);
test('wrapped and structured RIS abstracts retain the conclusion and do not cross records',()=>{
  const records=ctx.parseRisText('\uFEFFTY  - JOUR\r\nTI  - Fixture\r\nAB  - Background: First paragraph.\r\n  Methods: Second paragraph.\r\nN2  - Results: Third paragraph.\r\nConclusion: Final paragraph.\r\nAU  - Ben Lee\r\nER  -\r\nTY  - JOUR\r\nTI  - Another\r\nAB  - Separate abstract.\r\nER  -');
  assert.equal(records.length,2);
  assert.equal(records[0].abstract,'Background: First paragraph.\nMethods: Second paragraph.\nResults: Third paragraph.\nConclusion: Final paragraph.');
  assert.equal(records[0].authors[0],'Ben Lee');
  assert.equal(records[1].abstract,'Separate abstract.');
});
test('unknown tagged fields end abstract continuation',()=>{
  const p=ctx.parseRisText('TY  - JOUR\nAB  - Real abstract.\nXX  - Extra metadata\nContinuation of metadata\nER  -')[0];
  assert.equal(p.abstract,'Real abstract.');
});
test('identical AB and N2 exports are not duplicated',()=>{
  const p=ctx.parseRisText('TY  - JOUR\nAB  - One abstract.\nN2  - One abstract.\nER  -')[0];
  assert.equal(p.abstract,'One abstract.');
});
test('empty AB followed by a continuation does not prepend undefined',()=>{
  const p=ctx.parseRisText('TY  - JOUR\nAB  -\n  Complete abstract.\nER  -')[0];
  assert.equal(p.abstract,'Complete abstract.');
});

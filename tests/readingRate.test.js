const { test } = require('node:test');
const assert = require('node:assert/strict');
const { countWords, parsePassage, parseMeasurement, calculateRate } = require('../utils/readingRate');
const passage = { text: 'One two three', wordCount: 3, countMethod: 'automatic', confirmed: true, tokenizerVersion: 'v1' };
test('v1 Unicode tokens preserve internal punctuation and decimals', () => {
  assert.equal(countWords("Héllo e\u0301lan 世界 can't l’amour mother-in-law re‐read non‑stop 3.14 -- …"), 9);
});
test('confirmation is strict, normalized and server authored; automatic mismatch rejected/manual bounded', () => {
  const parsed = parsePassage({...passage, text:' One\r\ntwo ', wordCount:2}, {readingSource:'text',readingText:'One\ntwo'}, 'teacher');
  assert.equal(parsed.wordCount,2); assert.equal(parsed.confirmedBy,'teacher'); assert.ok(parsed.confirmedAt instanceof Date);
  assert.equal(parsePassage({...passage,countMethod:'manual',wordCount:77},{},'t').wordCount,77);
  for(const patch of [{confirmed:false},{confirmed:'true'},{confirmedBy:'spoof'},{text:'x'.repeat(100001)},{wordCount:1.2},{wordCount:100001},{tokenizerVersion:'v2'}]) assert.throws(()=>parsePassage({...passage,...patch},{},'t'));
  assert.throws(()=>parsePassage(passage,{readingSource:'text',readingText:'other'},'t'));
  assert.throws(()=>parsePassage('bad',{},'t'));
});
test('measurement rejects coercion, incomplete completion, and invalid bounds; interrupted/zero no rate', () => {
  const m={completed:true,wordsRead:3,startMs:10,endMs:3000,interrupted:false};
  for(const patch of [{wordsRead:2},{wordsRead:'3'},{completed:'true'},{startMs:-1},{endMs:10},{endMs:3101},{wpm:100},{completed:false}]) assert.throws(()=>parseMeasurement({...m,...patch},passage,3000));
  assert.equal(parseMeasurement({...m,endMs:3100},passage,3000).endMs,3000);
  assert.equal(calculateRate({...m,interrupted:true},passage,3000,'provisional'),null);
  assert.equal(calculateRate({...m,wordsRead:0},passage,3000,'provisional'),null);
  assert.equal(calculateRate(m,undefined,3000,'provisional'),null);
  assert.equal(calculateRate(m,passage,null,'provisional'),null);
});

test('NFC tokenizer preserves comma/dot numeric groups and rejects stale confirmation in both modes', () => {
  assert.equal(countWords('1,000 3,14 1.234,56 12,34.56 l’amour re‐read e\u0301lan'), 7);
  assert.equal(countWords('가 か\u3099'), countWords('가 が'));
  assert.throws(() => parsePassage({...passage,wordCount:99},{},'t'), /Confirm it again/);
  for(const countMethod of ['manual','automatic']) assert.throws(() => parsePassage({...passage,text:'… --- !!!',countMethod},{},'t'), /at least one word/);
});
test('pure rate calculator rejects invalid, empty, nonfinite and inconsistent input without throwing', () => {
  const m={completed:true,wordsRead:3,startMs:0,endMs:1000,interrupted:false};
  assert.deepEqual(calculateRate(m,passage,1000,'reviewed'), {wordsRead:3,readingSeconds:1,wpm:180,status:'reviewed'});
  for(const measurement of [null,undefined,{},[],JSON.stringify(m), ...[
    {completed:'true'},{wordsRead:NaN},{wordsRead:Infinity},{wordsRead:-1},{wordsRead:0},{wordsRead:1.1},
    {wordsRead:2},{completed:false},{startMs:NaN},{startMs:Infinity},{startMs:-1},{startMs:0.1},
    {endMs:0},{endMs:Infinity},{endMs:1001},{endMs:1e-320},{endMs:999.5},{interrupted:true},{interrupted:undefined},
  ].map(p=>({...m,...p}))]) assert.equal(calculateRate(measurement,passage,1000,'provisional'),null);
  for(const p of [null,{}, {...passage,confirmed:'true'}, {...passage,text:''}, {...passage,text:'!!!',countMethod:'manual'}, {...passage,wordCount:4}, {...passage,wordCount:Infinity}, {...passage,tokenizerVersion:'v2'}, {...passage,countMethod:'other'}]) assert.equal(calculateRate(m,p,1000,'provisional'),null);
  for(const duration of [0,-1,Infinity,NaN,1000.5,'1000',Number.MAX_VALUE]) assert.equal(calculateRate(m,passage,duration,'provisional'),null);
  assert.equal(calculateRate(m,passage,1000,'untrusted'),null);
  const smallest={...m,endMs:1};assert.equal(calculateRate(smallest,passage,1000,'provisional').wpm,180000);
  for(const patch of [{startMs:0.5},{endMs:1000.5}]) assert.throws(()=>parseMeasurement({...m,...patch},passage,2000));
});

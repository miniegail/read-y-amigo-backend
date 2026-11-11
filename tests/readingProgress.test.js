const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildHistory, summarizeHistory, validateWordAccuracy, resultSummary } = require('../utils/readingProgress');
const result = { status: 'graded', correctAnswers: 8, totalQuestions: 10, pendingQuestions: 0, percentage: 80, earnedPoints: 12, maxPoints: 20 };
test('history links quizzes to the correct recording, retains older attempts, separates missing and zero', () => {
 const readings = [{ _id:'r1',classwork:'w1',submittedAt:'2026-11-08T01:00:00Z',readingRate:{wpm:92,status:'provisional'},wordAccuracy:{percentage:97,reviewedAt:'2026-11-08'} },
  {_id:'r2',classwork:'w2',submittedAt:'2026-11-10T01:00:00Z'}];
 const attempts = [{_id:'a1',classwork:'w1',readingSubmission:'r1',title:'Snapshot title',status:'graded',submittedAt:'2026-11-08T02:00:00Z',result},
  {_id:'old',classwork:'w1',readingSubmission:'deleted-reading',status:'graded',submittedAt:'2026-11-02T01:00:00Z',result:{...result,percentage:0,correctAnswers:0}},
  {_id:'pending',classwork:'w2',readingSubmission:'r2',status:'pending-review',submittedAt:'2026-11-10T02:00:00Z',result:{...result,percentage:100,pendingQuestions:1}},
  {_id:'draft',classwork:'w3',status:'draft',submittedAt:'2026-11-12T02:00:00Z'},
  {_id:'only',classwork:'w3',status:'graded',submittedAt:'2026-11-09T01:00:00Z',result}];
 const rows=buildHistory(readings,attempts,[{_id:'w1',title:'Edited title'},{_id:'w2',title:'Next',readingActivities:['read-aloud','comprehension']}]);
 assert.equal(rows.length,4); assert.equal(rows[0].id,'reading:r2');assert.equal(rows[0].comprehension.value,null);assert.equal(rows[0].comprehension.status,'pending-review');
 assert.equal(rows.find(r=>r.id==='reading:r1').title,'Snapshot title');assert.equal(rows.find(r=>r.id==='reading:r1').comprehension.value,80);
 assert.equal(rows.at(-1).comprehension.value,0);assert.equal(rows.at(-1).readingUnavailable,true);assert.equal(rows.at(-1).readingSubmissionId,undefined);
 assert.deepEqual(rows.find(r=>r.id==='quiz:only').activities,['comprehension']);
 const summary=summarizeHistory(rows);assert.equal(summary.speed.value,92);assert.equal(summary.speed.status,'provisional');assert.equal(summary.accuracy.value,97);assert.equal(summary.comprehension.value,80);
 assert.equal(summarizeHistory([]).accuracy.value,null);
});
test('no accuracy is inferred from pending or confirmed ASR observations',()=>{
 const row=buildHistory([{_id:'r',classwork:'w',submittedAt:'2026-11-10',miscueReview:{listened:true,events:[]}}],[],[])[0];assert.equal(row.accuracy.value,null);
});
test('teacher-confirmed accuracy rejects coercion, out-of-range counts and unsigned reviews',()=>{
 const passage={confirmed:true,wordCount:100};const valid={wordsAssessed:100,errorCount:3,listened:true};
 assert.equal(validateWordAccuracy(valid,passage).percentage,97);
 assert.equal(validateWordAccuracy({...valid,errorCount:100},passage).percentage,0);
 assert.equal(validateWordAccuracy({...valid,errorCount:0},passage).percentage,100);
 for(const body of [{...valid,listened:false},{...valid,errorCount:-1},{...valid,errorCount:101},{...valid,wordsAssessed:0},{...valid,wordsAssessed:101},{...valid,wordsAssessed:'100'},{...valid,errorCount:0.5}])assert.throws(()=>validateWordAccuracy(body,passage));
 assert.throws(()=>validateWordAccuracy(valid,{...passage,confirmed:false}));
});
test('classroom summaries expose no answer keys, private passage, guides or other learner identity',()=>{
 const safe=resultSummary({_id:'a',classwork:'w',learner:'secret-learner',status:'pending-review',quiz:{secret:'KEY'},passage:'PRIVATE',answers:['SECRET'],grades:['SECRET'],result:{...result,pendingQuestions:1}});
 assert.equal(safe.result.percentage,null);for(const field of ['learner','quiz','passage','answers','grades'])assert.equal(safe[field],undefined);
});

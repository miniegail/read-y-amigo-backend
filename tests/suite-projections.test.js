const { test } = require('node:test'), assert = require('node:assert/strict');
const { reportProjection } = require('../utils/reports');
const { sourceFiles, libraryEntries } = require('../utils/classroomLibrary');
const { standaloneConfig } = require('../utils/standaloneQuiz');
test('reports use real latest results, deduplicate cross-class learners and exclude pending/missing data', () => {
 const classes=[{_id:'c1',title:'A'},{_id:'c2',title:'B'}], enrollments=[{class:'c1',learner:'l1'},{class:'c1',learner:'l2'},{class:'c2',learner:'l1'}];
 const submissions=[{_id:'r1',class:'c1',classwork:'w1',learner:'l1',submittedAt:'2026-11-01T01:00:00Z',readingRate:{wpm:60}},
  {_id:'r2',class:'c1',classwork:'w2',learner:'l2',submittedAt:'2026-11-02T01:00:00Z',readingRate:{wpm:100},wordAccuracy:{percentage:0,reviewedAt:'2026-11-02'}},
  {_id:'r3',class:'c2',classwork:'w3',learner:'l1',submittedAt:'2026-11-03T01:00:00Z',readingRate:{wpm:80,status:'provisional'},wordAccuracy:{percentage:98,reviewedAt:'2026-11-03'}},
  {_id:'foreign',class:'not-owned',classwork:'w1',learner:'l1',submittedAt:'2026-11-04',readingRate:{wpm:999}}];
 const final={status:'graded',pendingQuestions:0,percentage:80,correctAnswers:8,totalQuestions:10,earnedPoints:8,maxPoints:10};
 const attempts=[{_id:'a1',class:'c1',learner:'l1',classwork:'w1',readingSubmission:'r1',submittedAt:'2026-11-01',status:'graded',result:final},
  {_id:'a2',class:'c1',learner:'l2',classwork:'w2',readingSubmission:'r2',submittedAt:'2026-11-02',status:'pending-review',result:{...final,pendingQuestions:1,percentage:100}}];
 const report=reportProjection(classes,enrollments,submissions,attempts,[]);
 assert.equal(report.totals.totalLearners,2);assert.equal(report.totals.withSubmissions,2);assert.equal(report.totals.metrics.speed.value,90);assert.equal(report.totals.metrics.speed.learnerCount,2);assert.equal(report.totals.metrics.speed.provisionalCount,1);
 assert.equal(report.totals.metrics.accuracy.value,49);assert.equal(report.totals.metrics.comprehension.value,80);assert.equal(report.totals.metrics.comprehension.learnerCount,1);assert.equal(report.levels.Independent,1);assert.equal(report.trend.at(-1).metrics.speed.value,90);
 const filtered=reportProjection(classes,enrollments,submissions,attempts,[],{from:Date.parse('2026-11-02'),to:Date.parse('2026-11-03')});assert.equal(filtered.totals.metrics.speed.value,100);assert.equal(filtered.totals.metrics.comprehension.value,null);assert.equal(filtered.trend.length,1);
 const empty=reportProjection(classes,enrollments,[],[],[]);assert.equal(empty.totals.metrics.speed.value,null);assert.equal(empty.totals.totalLearners,2);
});
test('library derives only reading attachments, uses actual upload timestamps, deduplicates and sorts newest first', () => {
 const works=[{_id:'w1',type:'reading',title:'Hiyas',createdAt:'2026-11-01',attachment:{name:'Hiyas.pdf',url:'/api/files/a',fileId:'a'}},
  {_id:'w2',type:'reading',title:'Reuse',createdAt:'2026-11-10',attachment:{name:'Hiyas.pdf',url:'/api/files/a',fileId:'a'}},
  {_id:'w3',type:'reading',readingSource:'text',title:'Text',attachment:{url:'/hidden'}},
  {_id:'w4',type:'quiz',attachment:{url:'/quiz'}},
  {_id:'w5',type:'reading',title:'Older',createdAt:'2026-11-02',attachment:{name:'Old.docx',url:'/uploads/old.docx'}}];
 const entries=libraryEntries(sourceFiles(works),new Map([['a','2026-11-03']]));
 assert.equal(entries.length,2);assert.equal(entries[0].name,'Hiyas.pdf');assert.equal(entries[0].uploadedAt,'2026-11-03');assert.equal(entries[0].activities.length,2);assert.equal(entries[1].name,'Old.docx');
});
test('standalone questions keep private keys, normalize true/false and review written answers manually', () => {
 const quiz=standaloneConfig({questions:[{type:'true-false',question:'True?',correctAnswer:1,points:2},{type:'short-answer',question:'Why?',correctAnswer:'Teacher guide',points:3},{type:'essay',question:'Explain.',points:4}]});
 assert.deepEqual(quiz.questions[0].choices,['True','False']);assert.equal(quiz.questions[0].correctAnswer,1);assert.equal(quiz.questions[1].expectedAnswer,'Teacher guide');assert.ok(quiz.questions[2].rubric);
 assert.throws(()=>standaloneConfig({questions:[{type:'multiple-choice',question:'A?',choices:['A','B'],correctAnswer:5}]}));
});
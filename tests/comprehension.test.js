const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateQuiz, passageHash, answersFor, grade, publicAttempt } = require('../utils/comprehension');
const passage={text:'A seed grew.',wordCount:3,confirmed:true};
const input={passageAccess:'after-submission',questions:[
 {type:'multiple-choice',question:'What?',choices:['A','B'],correctAnswer:0,points:2},
 {type:'checkboxes',question:'Choose',choices:['A','B','C'],correctAnswer:[2,0],points:3},
 {type:'short-answer',question:'Explain',points:4,expectedAnswer:'PRIVATE_GUIDE'},
 {type:'essay',question:'Discuss',points:5,rubric:'PRIVATE_RUBRIC'},
]};
test('passage linkage normalizes composed Unicode and line endings, preserving version differences',()=>{
 assert.equal(passageHash({...passage,text:'Café\r\ngrew'}),passageHash({...passage,text:'Cafe\u0301\ngrew'}));
 assert.notEqual(passageHash(passage),passageHash({...passage,text:'Another seed grew.'}));
 assert.notEqual(passageHash(passage),passageHash({...passage,wordCount:4}));
 assert.throws(()=>passageHash({...passage,confirmed:false}));
});
test('validates all answer keys and rubrics, forbids empty/duplicate/out-of-range choices',()=>{
 const quiz=validateQuiz(input);assert.deepEqual(quiz.questions[1].correctAnswer,[0,2]);
 for(const patch of [{correctAnswer:99},{correctAnswer:'A'},{choices:['same','same']},{points:-1},{type:'unknown'}]) assert.throws(()=>validateQuiz({...input,questions:[{...input.questions[0],...patch}]}));
 assert.throws(()=>validateQuiz({...input,questions:[{type:'essay',question:'Essay',points:1}]}));
 assert.throws(()=>validateQuiz({...input,questions:[]}));
 assert.throws(()=>validateQuiz({...input,questions:[{...input.questions[1],correctAnswer:[0,0]}]}));
});
test('checkboxes use exact matching and manual questions keep percentage pending',()=>{
 const quiz=validateQuiz(input);
 const answers=answersFor(quiz,[{questionId:'q1',answer:0},{questionId:'q2',answer:[2,0]},{questionId:'q3',answer:'written'},{questionId:'q4',answer:'essay'}],true);
 const scored=grade(quiz,answers);assert.equal(scored.result.status,'pending-review');assert.equal(scored.result.percentage,null);assert.equal(scored.result.correctAnswers,2);
 const final=grade(quiz,answers,[{questionId:'q3',correct:true,awardedPoints:2},{questionId:'q4',correct:false,awardedPoints:1}]);
 assert.equal(final.result.percentage,75);assert.equal(final.result.earnedPoints,8);assert.equal(final.result.maxPoints,14);
 assert.equal(grade(quiz,[...answers.filter(a=>a.questionId!=='q2'),{questionId:'q2',answer:[0]}]).grades[1].correct,false);
});
test('responses reject duplicates, spoofed question IDs and invalid choices; drafts allow incomplete work',()=>{
 const quiz=validateQuiz(input);
 assert.deepEqual(answersFor(quiz,[],false),[]);
 for(const answers of [[{questionId:'q1',answer:99}],[{questionId:'missing',answer:0}],[{questionId:'q2',answer:[0,0]}],[{questionId:'q1',answer:0},{questionId:'q1',answer:0}]])assert.throws(()=>answersFor(quiz,answers,false));
 assert.throws(()=>answersFor(quiz,[],true));
});
test('learner DTO never includes keys, rubric or guides and hides the closed passage until submission',()=>{
 const quiz=validateQuiz(input), draft={_id:'a',quiz,passage,status:'draft',answers:[],grades:[]};
 const publicDraft=publicAttempt(draft);assert.equal(publicDraft.passage,undefined);
 for(const q of publicDraft.quiz.questions)for(const key of ['correctAnswer','expectedAnswer','rubric','supportingParagraph'])assert.equal(q[key],undefined);
 assert.equal(publicAttempt({...draft,status:'graded'}).passage.text,passage.text);
 assert.equal(publicAttempt(draft,true).quiz.questions[2].expectedAnswer,'PRIVATE_GUIDE');
});
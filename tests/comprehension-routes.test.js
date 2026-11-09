const {test}=require('node:test'), assert=require('node:assert/strict'), express=require('express'), mongoose=require('mongoose');
const newId=()=>String(new mongoose.Types.ObjectId());
const teacher=newId(),learner=newId(),other=newId(),classId=newId(),workId=newId();
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth(req,res,next){req.userId=req.headers['x-user']||learner;req.userRole=req.headers['x-role']||'learner';next();},requireRole:role=>(req,res,next)=>req.userRole===role?next():res.status(403).json({error:'Role denied'})}};
const Class=require('../models/Class'), Work=require('../models/ClassWork'), Enrollment=require('../models/Enrollment'), Submission=require('../models/Submission');
const {Quiz,QuizSet,Attempt}=require('../models/Comprehension');
const passage={text:'Mara planted a seed.',wordCount:4,confirmed:true};
const classroom={_id:classId,teacher,status:'active'}, work={_id:workId,class:classId,title:'Garden',type:'reading',readingActivities:['read-aloud','comprehension'],readingPassage:passage,assignToAll:true,assignedTo:[]};
let reading={_id:newId(),classwork:workId,learner,readingPassage:passage},enrolled=true;
function query(value){return {select(){return this},populate(){return this},sort(){return Promise.resolve(value)},then(resolve,reject){return Promise.resolve(value).then(resolve,reject)}};}
function match(doc,filter){return Object.entries(filter).every(([k,v])=>v && typeof v==='object' && Array.isArray(v.$in) ? v.$in.includes(doc[k]) : String(doc[k])===String(v));}
Class.findById=async()=>classroom;Work.findById=async value=>String(value)===workId?work:null;Enrollment.findOne=async()=>enrolled?{}:null;Submission.findOne=async()=>reading;Submission.find=()=>query(reading?[reading]:[]);
function storage(Model){const records=[];Model.findOne=filter=>query(records.find(d=>match(d,filter))||null);Model.findById=value=>query(records.find(d=>String(d._id)===String(value))||null);Model.find=filter=>query(records.filter(d=>match(d,filter)));Model.create=async fields=>{if(Model===Quiz&&records.some(d=>match(d,{classwork:fields.classwork})))throw Object.assign(new Error('duplicate'),{code:11000});if(Model===Attempt&&records.some(d=>match(d,{classwork:fields.classwork,learner:fields.learner,attemptKey:fields.attemptKey})))throw Object.assign(new Error('duplicate'),{code:11000});const doc=new Model(fields);await doc.validate();records.push(doc);return doc;};Model.findOneAndUpdate=(filter,update)=>{const doc=records.find(d=>match(d,filter));if(!doc)return query(null);Object.assign(doc,update.$set);doc.revision+=update.$inc.revision;return query(doc);};return records;}
storage(Quiz);storage(QuizSet);const attempts=storage(Attempt);
const quiz={passageAccess:'after-submission',questions:[{type:'multiple-choice',question:'What grew?',choices:['Seed','Stone'],correctAnswer:0,points:2},{type:'short-answer',question:'Why?',expectedAnswer:'SECRET_GUIDE',points:4},{type:'checkboxes',question:'Select',choices:['one','two','three'],correctAnswer:[0,2],points:3}]};
test('authenticated HTTP comprehension lifecycle: linkage, drafts, privacy, ownership, grading and concurrency',async()=>{
 const app=express();app.use(express.json());app.use('/api/comprehension',require('../routes/comprehension'));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}/api/comprehension`;
 async function call(path,method='GET',body,role='learner',user=role==='teacher'?teacher:learner){const res=await fetch(base+path,{method,headers:{'content-type':'application/json','x-role':role,'x-user':user},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json()};}
 try{
  assert.equal((await call(`/classwork/${workId}/config`,'POST',{passage,quiz})).status,403);
  assert.equal((await call(`/classwork/${workId}/config`,'POST',{passage,quiz},'teacher',other)).status,403);
  assert.equal((await call(`/classwork/${workId}/config`,'POST',{passage:{...passage,text:'changed'},quiz},'teacher')).status,409);
  assert.equal((await call(`/classwork/${workId}/config`,'POST',{passage,quiz},'teacher')).status,201);
  assert.equal((await call(`/classwork/${workId}/config`,'POST',{passage,quiz},'teacher')).status,200,'configuration retry is idempotent');
  assert.equal((await call(`/classwork/${workId}/config`,'POST',{passage,quiz:{...quiz,passageAccess:'during-quiz'}},'teacher')).status,409);
  assert.equal((await call('/sets','POST',{title:'Garden set',passage,quiz},'teacher')).status,201);
  assert.equal((await call('/sets/search','POST',{passage},'teacher')).data.sets.length,1);
  assert.equal((await call('/sets/search','POST',{passage},'teacher',other)).data.sets.length,0);
  assert.equal((await call('/sets/search','POST',{passage})).status,403);
  enrolled=false;assert.equal((await call(`/classwork/${workId}/start`,'POST',{})).status,403);enrolled=true;
  const savedReading=reading;reading=null;assert.equal((await call(`/classwork/${workId}/start`,'POST',{})).status,409);reading=savedReading;
  let r=await call(`/classwork/${workId}/start`,'POST',{}),attempt=r.data.attempt;assert.equal(r.status,200);assert.equal(attempt.readingSubmission,reading._id);assert.equal(attempt.passage,undefined);assert.equal(JSON.stringify(attempt).includes('SECRET_GUIDE'),false);assert.equal(attempt.quiz.questions[0].correctAnswer,undefined);
  assert.equal((await call(`/classwork/${workId}/start`,'POST',{})).data.attempt._id,attempt._id);
  assert.equal((await call(`/attempts/${attempt._id}/draft`,'PUT',{revision:0,answers:[]},'learner',other)).status,403);
  r=await call(`/attempts/${attempt._id}/draft`,'PUT',{revision:0,answers:[{questionId:'q1',answer:0}],percentage:100});assert.equal(r.status,200);attempt=r.data.attempt;assert.equal(attempt.revision,1);assert.equal(attempt.result,null);
  assert.equal((await call(`/attempts/${attempt._id}/draft`,'PUT',{revision:0,answers:[]})).status,409);
  assert.equal((await call(`/attempts/${attempt._id}/submit`,'POST',{revision:1,answers:[]})).status,400);
  const answers=[{questionId:'q1',answer:0},{questionId:'q2',answer:'She watered it'},{questionId:'q3',answer:[2,0]}];
  r=await call(`/attempts/${attempt._id}/submit`,'POST',{revision:1,answers,correctAnswers:3,percentage:100});assert.equal(r.status,200);attempt=r.data.attempt;assert.equal(attempt.result.percentage,null);assert.equal(attempt.result.pendingQuestions,1);assert.equal(attempt.passage.text,passage.text);assert.equal(JSON.stringify(attempt).includes('SECRET_GUIDE'),false);
  assert.equal((await call(`/attempts/${attempt._id}/submit`,'POST',{revision:attempt.revision,answers})).status,409);
  assert.equal((await call(`/attempts/${attempt._id}/grade`,'PATCH',{revision:attempt.revision,grades:[]})).status,403);
  const manual={revision:attempt.revision,grades:[{questionId:'q2',correct:false,awardedPoints:1,feedback:'Explain how watering helps.'}]};
  assert.equal((await call(`/attempts/${attempt._id}/grade`,'PATCH',manual,'teacher',other)).status,403);
  r=await call(`/attempts/${attempt._id}/grade`,'PATCH',manual,'teacher');assert.equal(r.status,200);assert.equal(r.data.attempt.result.percentage,2/3*100);assert.equal(r.data.attempt.result.earnedPoints,6);assert.equal(r.data.attempt.result.maxPoints,9);
  assert.equal((await call(`/attempts/${attempt._id}/grade`,'PATCH',manual,'teacher')).status,409);
  assert.equal((await call(`/classwork/${workId}/attempts`)).status,403);
  assert.deepEqual((await call('/mine?classId='+classId)).data.classworkIds,[workId]);
  const teacherList=(await call(`/classwork/${workId}/attempts`,'GET',undefined,'teacher')).data;assert.equal(teacherList.attempts[0].quiz.questions[1].expectedAnswer,'SECRET_GUIDE');
  // An unsubmit/new recording gets a different linked attempt; old responses cannot be edited.
  reading={...savedReading,_id:newId()};assert.deepEqual((await call('/mine?classId='+classId)).data.classworkIds,[]);r=await call(`/classwork/${workId}/start`,'POST',{});const next=r.data.attempt;assert.notEqual(next._id,attempt._id);assert.equal(next.readingSubmission,reading._id);
  reading={...reading,_id:newId()};assert.equal((await call(`/attempts/${next._id}/draft`,'PUT',{revision:0,answers:[]})).status,409);
  // Deadline blocks new attempts and draft changes; final results remain viewable.
  work.dueDate=new Date(Date.now()-1000);assert.equal((await call(`/classwork/${workId}/start`,'POST',{})).status,403);delete work.dueDate;
  work.assignToAll=false;work.assignedTo=[];assert.equal((await call(`/classwork/${workId}`)).status,403);work.assignToAll=true;
  // Comprehension-only activities have their own explicit attempt; no invented recording link.
  work.readingActivities=['comprehension'];reading=null;r=await call(`/classwork/${workId}/start`,'POST',{});assert.equal(r.status,200);assert.equal(r.data.attempt.readingSubmission,undefined);assert.equal(r.data.attempt.attemptLabel,'Comprehension-only attempt');assert.equal(attempts.length,3);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
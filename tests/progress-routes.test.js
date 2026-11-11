const { test }=require('node:test'), assert=require('node:assert/strict'), express=require('express'), mongoose=require('mongoose');
const id=()=>String(new mongoose.Types.ObjectId());const teacher=id(),learner=id(),other=id(),classId=id(),workId=id(),recordingId=id();
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth(req,res,next){req.userId=req.headers['x-user'];req.role=req.headers['x-role'];if(!req.userId)return res.status(401).json({error:'Auth required'});next();},requireRole:role=>(req,res,next)=>req.role===role?next():res.status(403).json({error:'Role denied'})}};
const Class=require('../models/Class'),Work=require('../models/ClassWork'),Enrollment=require('../models/Enrollment'),Submission=require('../models/Submission');const {Attempt}=require('../models/Comprehension');
const classroom={_id:classId,teacher,status:'active'};const enrollment={_id:id(),class:classId,learner:{_id:learner,displayName:'Maria Santos'},comprehensionAvg:0};
const result={status:'graded',correctAnswers:8,totalQuestions:10,pendingQuestions:0,percentage:80,earnedPoints:8,maxPoints:10};
let readings=[{_id:recordingId,class:classId,classwork:workId,learner,submittedAt:'2026-11-10T01:00:00Z',readingRate:{wpm:92,status:'reviewed'}}];
const attempts=[{_id:id(),class:classId,classwork:workId,learner,readingSubmission:recordingId,title:'HIYAS',status:'graded',result,submittedAt:'2026-11-10T02:00:00Z',createdAt:'2026-11-10',quiz:{answer:'SECRET'}},
 {_id:id(),class:classId,classwork:workId,learner:other,status:'graded',result,submittedAt:'2026-11-10'},
 {_id:id(),class:other,classwork:workId,learner,status:'graded',result,submittedAt:'2026-11-10'}];
const works=[{_id:workId,class:classId,title:'HIYAS',type:'reading',assignToAll:true,readingActivities:['read-aloud','comprehension']}];
let enrolled=true,assigned=true,stored,race=false;
const query=value=>({select(){return this},populate(){return this},sort(){return this},then(resolve,reject){return Promise.resolve(value).then(resolve,reject)}});
const match=(doc,filter)=>Object.entries(filter).every(([key,value])=> key==='$or' ? value.some(condition=>condition.assignToAll===true?assigned:false) : value?.$in ? value.$in.includes(doc[key]) : key==='readingActivities'?doc[key].includes(value):String(doc[key])===String(value));
Class.findOne=async()=>classroom;Class.findById=async()=>classroom;
Enrollment.find=filter=>query(enrolled?[enrollment]:[]);Enrollment.findOne=filter=>query(enrolled&&String(filter.learner)===learner?enrollment:null);
Work.find=filter=>query(works.filter(doc=>match(doc,filter)));
Submission.find=filter=>query(readings.filter(doc=>match(doc,filter)));Attempt.find=filter=>query(attempts.filter(doc=>match(doc,filter)));
Submission.findById=async()=>stored;Submission.findOneAndUpdate=async(filter,update)=>{if(race)return null;stored.wordAccuracy=update.$set.wordAccuracy;await stored.validate();return stored;};
test('classroom projections enforce roles, ownership, enrollment and current-attempt linkage',async()=>{
 const app=express();app.use(express.json());app.use('/classes',require('../routes/classes').teacherRouter);app.use('/comprehension',require('../routes/comprehension'));app.use('/submissions',require('../routes/submissions'));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(path,role='teacher',user=teacher,body)=>{const res=await fetch(base+path,{method:body?'PATCH':'GET',headers:{'content-type':'application/json','x-role':role,...(user?{'x-user':user}:{})},body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json()};};
 try {
  assert.equal((await call(`/classes/${classId}/progress`,'teacher','')).status,401);
  assert.equal((await call(`/classes/${classId}/progress`,'learner',learner)).status,403);
  assert.equal((await call(`/classes/${classId}/progress`,'teacher',other)).status,403);
  let response=await call(`/classes/${classId}/progress`);assert.equal(response.status,200);assert.equal(response.data.progress[0].readingSummary.speed.value,92);assert.equal(response.data.progress[0].readingSummary.comprehension.value,80);assert.equal(response.data.progress[0].readingSummary.accuracy.value,null);
  response=await call(`/classes/${classId}/progress/${learner}`);assert.equal(response.status,200);assert.equal(response.data.history.length,1);assert.equal(response.data.history[0].comprehension.value,80);assert.equal(JSON.stringify(response.data).includes('SECRET'),false);
  assert.equal((await call(`/classes/${classId}/progress/${other}`)).status,404);assert.equal((await call(`/classes/${classId}/progress/invalid`)).status,400);
  response=await call(`/comprehension/mine?classId=${classId}&include=results`,'learner',learner);assert.equal(response.status,200);assert.equal(response.data.attempts.length,1);assert.equal(response.data.attempts[0].result.percentage,80);assert.equal(JSON.stringify(response.data).includes('SECRET'),false);
  assigned=false;assert.equal((await call(`/comprehension/mine?classId=${classId}&include=results`,'learner',learner)).data.attempts.length,0);assigned=true;
  readings=[{...readings[0],_id:id()}];assert.equal((await call(`/comprehension/mine?classId=${classId}&include=results`,'learner',learner)).data.attempts.length,0);
  enrolled=false;assert.equal((await call(`/comprehension/mine?classId=${classId}&include=results`,'learner',learner)).status,403);assert.equal((await call(`/classes/${classId}/progress/${learner}`)).status,404);enrolled=true;
  stored=new Submission({_id:recordingId,class:classId,classwork:workId,learner,audio:{fileId:id(),url:'/audio'},readingPassage:{text:'A short story',wordCount:3,confirmed:true,countMethod:'automatic',tokenizerVersion:'v1',confirmedBy:teacher,confirmedAt:new Date()}});
  const body={wordsAssessed:3,errorCount:1,listened:true,previousReviewedAt:null,percentage:100,reviewedBy:other};
  const path=`/submissions/${recordingId}/word-accuracy`;
  assert.equal((await call(path,'learner',learner,body)).status,403);assert.equal((await call(path,'teacher',other,body)).status,403);
  assert.equal((await call(path,'teacher',teacher,{...body,errorCount:4})).status,400);
  response=await call(path,'teacher',teacher,body);assert.equal(response.status,200);assert.equal(response.data.submission.wordAccuracy.reviewedBy,teacher);assert.equal(response.data.submission.wordAccuracy.percentage,2/3*100);
  assert.equal((await call(path,'teacher',teacher,body)).status,409);
  race=true;assert.equal((await call(path,'teacher',teacher,{...body,previousReviewedAt:stored.wordAccuracy.reviewedAt.toISOString()})).status,409);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

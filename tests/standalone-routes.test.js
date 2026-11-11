require('../utils/notifications').notifyTeacher = async () => {};
const {test}=require('node:test'),assert=require('node:assert/strict'),express=require('express'),mongoose=require('mongoose');
const id=()=>String(new mongoose.Types.ObjectId());const teacher=id(),learner=id(),other=id(),classId=id(),workId=id();
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth(req,res,next){req.userId=req.headers['x-user'];req.role=req.headers['x-role'];if(!req.userId)return res.status(401).json({error:'Login required'});next();},requireRole:role=>(req,res,next)=>req.role===role?next():res.status(403).json({error:'Role denied'})}};
const Class=require('../models/Class'),Work=require('../models/ClassWork'),Enrollment=require('../models/Enrollment'),Attempt=require('../models/StandaloneQuizAttempt');
const classroom={_id:classId,teacher,status:'active'},work={_id:workId,class:classId,type:'quiz',title:'Standalone',assignToAll:true,assignedTo:[],questions:[{type:'multiple-choice',question:'Pick A',choices:['A','B'],correctAnswer:0,points:2},{type:'short-answer',question:'Why?',correctAnswer:'SECRET_GUIDE',points:3}]};let enrolled=true;
const query=value=>({select(){return this},populate(){return this},sort(){return this},then(resolve,reject){return Promise.resolve(value).then(resolve,reject)}});
const records=[];const match=(doc,filter)=>Object.entries(filter).every(([key,value])=>value?.$in?value.$in.map(String).includes(String(doc[key])):String(doc[key])===String(value));
Class.findById=async()=>classroom;Work.findById=async value=>String(value)===workId?work:null;Work.find=()=>query(work.assignToAll||work.assignedTo.includes(learner)?[work]:[]);Enrollment.findOne=async()=>enrolled?{}:null;
Attempt.findOne=filter=>query(records.find(doc=>match(doc,filter))||null);Attempt.findById=value=>query(records.find(doc=>String(doc._id)===String(value))||null);Attempt.find=filter=>query(records.filter(doc=>match(doc,filter)));Attempt.create=async fields=>{const doc=new Attempt(fields);await doc.validate();records.push(doc);return doc;};Attempt.findOneAndUpdate=(filter,update)=>{const doc=records.find(doc=>match(doc,filter));if(!doc)return query(null);Object.assign(doc,update.$set);doc.revision+=update.$inc.revision;return query(doc);};
test('standalone quiz lifecycle: drafts, final submission, teacher grading, privacy, assignment and deadlines',async()=>{
 const app=express();app.use(express.json());app.use('/quizzes',require('../routes/quizzes'));const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}/quizzes`;
 const call=async(path,method='GET',body,role='learner',user=role==='teacher'?teacher:learner)=>{const res=await fetch(base+path,{method,headers:{'content-type':'application/json','x-role':role,...(user?{'x-user':user}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json()};};
 try{
  assert.equal((await call(`/classwork/${workId}/start`,'POST',{},'learner','')).status,401);
  assert.equal((await call(`/classwork/${workId}/start`,'POST',{},'teacher')).status,403);
  enrolled=false;assert.equal((await call(`/classwork/${workId}/start`,'POST',{})).status,403);enrolled=true;
  work.assignToAll=false;assert.equal((await call(`/classwork/${workId}/start`,'POST',{})).status,403);work.assignToAll=true;
  let response=await call(`/classwork/${workId}/start`,'POST',{});assert.equal(response.status,200);let attempt=response.data.attempt;assert.equal(attempt.assessmentType,'standalone');assert.equal(attempt.passage,undefined);assert.equal(JSON.stringify(attempt).includes('SECRET_GUIDE'),false);assert.equal(attempt.quiz.questions[0].correctAnswer,undefined);
  assert.equal((await call(`/classwork/${workId}/start`,'POST',{})).data.attempt._id,attempt._id);assert.equal(records.length,1);
  assert.equal((await call(`/attempts/${attempt._id}/draft`,'PUT',{revision:0,answers:[]},'learner',other)).status,403);
  response=await call(`/attempts/${attempt._id}/draft`,'PUT',{revision:0,answers:[{questionId:'q1',answer:0}]});assert.equal(response.status,200);attempt=response.data.attempt;assert.equal(attempt.answers.length,1);
  assert.equal((await call(`/attempts/${attempt._id}/draft`,'PUT',{revision:0,answers:[]})).status,409);
  assert.equal((await call(`/attempts/${attempt._id}/submit`,'POST',{revision:1,answers:[]})).status,400);
  response=await call(`/attempts/${attempt._id}/submit`,'POST',{revision:1,answers:[{questionId:'q1',answer:0},{questionId:'q2',answer:'Because'}],percentage:100});assert.equal(response.status,200);attempt=response.data.attempt;assert.equal(attempt.result.percentage,null);assert.equal(attempt.status,'pending-review');
  assert.equal((await call(`/attempts/${attempt._id}/submit`,'POST',{revision:attempt.revision,answers:[]})).status,409);
  const grades={revision:attempt.revision,grades:[{questionId:'q2',correct:false,awardedPoints:1,feedback:'More detail'}]};
  assert.equal((await call(`/attempts/${attempt._id}/grade`,'PATCH',grades)).status,403);assert.equal((await call(`/attempts/${attempt._id}/grade`,'PATCH',grades,'teacher',other)).status,403);
  response=await call(`/attempts/${attempt._id}/grade`,'PATCH',grades,'teacher');assert.equal(response.status,200);assert.equal(response.data.attempt.result.percentage,50);assert.equal(response.data.attempt.result.earnedPoints,3);assert.equal(response.data.attempt.result.maxPoints,5);
  response=await call(`/mine?classId=${classId}`);assert.equal(response.status,200);assert.deepEqual(response.data.classworkIds,[workId]);assert.equal(response.data.attempts.length,1);assert.equal(JSON.stringify(response.data).includes('SECRET_GUIDE'),false);
  work.assignToAll=false;assert.equal((await call(`/mine?classId=${classId}`)).data.attempts.length,0);work.assignToAll=true;
  work.dueDate=new Date(Date.now()-1000);assert.equal((await call(`/classwork/${workId}/start`,'POST',{})).status,200,'submitted result can be reopened after deadline');
  assert.equal((await call(`/classwork/${workId}/attempts`,'GET',undefined,'teacher')).status,200);assert.equal((await call(`/classwork/${workId}/attempts`)).status,403);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

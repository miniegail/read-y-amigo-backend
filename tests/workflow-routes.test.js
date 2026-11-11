const {test}=require('node:test');const assert=require('node:assert/strict');const express=require('express'),mongoose=require('mongoose');const {Readable}=require('node:stream');
const id=()=>String(new mongoose.Types.ObjectId());const teacher=id(),learner=id(),classId=id(),workId=id();
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,res,next)=>{if(!req.headers['x-user'])return res.sendStatus(401);req.userId=req.headers['x-user'];req.userRole=req.headers['x-role'];next();},requireRole:role=>(req,res,next)=>req.userRole===role?next():res.sendStatus(403)}};
const Class=require('../models/Class'),Work=require('../models/ClassWork'),Enrollment=require('../models/Enrollment'),Activity=require('../models/ActivitySubmission'),Submission=require('../models/Submission'),Inbox=require('../models/TeacherInbox');
let enrolled=true,work={_id:workId,class:classId,type:'activity',title:'Reflection',assignToAll:true},activity=null,events=[],fileMeta,uploads=0,reading={_id:id(),class:classId};
Class.findById=async()=>({_id:classId,teacher,status:'active',title:'Filipino'});Work.findById=()=>Object.assign(Promise.resolve(work),{select:async()=>work});Enrollment.findOne=async()=>enrolled?{}:null;
Activity.findOne=async()=>activity;Activity.create=async fields=>{activity={...fields,_id:id(),submittedAt:new Date()};return activity;};
Activity.findById=()=>Object.assign(Promise.resolve(activity),{populate:async()=>activity});Activity.find=()=>({sort:async()=>activity?[activity]:[]});
Activity.findOneAndUpdate=async(f,u)=>{Object.assign(activity,u.$set);return activity;};
Submission.findById=async()=>reading;Submission.findOneAndUpdate=async(f,u)=>{Object.assign(reading,u.$set);return reading;};
require('../utils/notifications').notifyTeacher=async(...args)=>events.push(args);
const grid=require('../utils/gridfs');grid.saveBuffer=async({metadata})=>{uploads++;fileMeta=metadata;return id();};grid.findFile=async()=>({_id:id(),length:3,filename:'answer.txt',contentType:'text/plain',metadata:{kind:'activity-submission',uploadedBy:learner,class:classId}});grid.getBucket=()=>({openDownloadStream:()=>Readable.from(Buffer.from('abc'))});
let inboxOwner,readOwner;Inbox.findById=async owner=>{inboxOwner=owner;return{items:[]};};Inbox.updateOne=async filter=>{readOwner=filter._id;};
const app=express();app.use(express.json());app.use('/activities',require('../routes/activities'));app.use('/submissions',require('../routes/submissions'));app.use('/notifications',require('../routes/notifications'));app.use('/files',require('../routes/files'));
test('activity and verification HTTP routes enforce ownership, enrollment, assignment, deadline, duplicates and stale reviews; private files and inbox stay scoped',async()=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const lh={'x-user':learner,'x-role':'learner'},th={'x-user':teacher,'x-role':'teacher'},other={'x-user':id(),'x-role':'teacher'};
 const req=(path,headers=lh,method='GET',body)=>fetch(base+path,{headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},method,body:body?JSON.stringify(body):undefined});
 const submit=async(text='My answer',headers=lh,file=false)=>{const f=new FormData();f.append('text',text);f.append('checkedAt','spoof');if(file)f.append('file',new Blob(['abc'],{type:'text/plain'}),'answer.txt');return fetch(base+'/activities/classwork/'+workId,{method:'POST',headers,body:f});};
 try{
  assert.equal((await req('/activities/mine?classId='+classId,{})).status,401);assert.equal((await submit('answer',th)).status,403);
  enrolled=false;assert.equal((await submit()).status,403);enrolled=true;
  work.assignToAll=false;work.assignedTo=[];assert.equal((await submit()).status,403);work.assignToAll=true;
  work.dueDate=new Date(0);assert.equal((await submit()).status,403);delete work.dueDate;
  assert.equal((await submit(' ')).status,400);assert.equal((await submit('My answer',lh,true)).status,201);assert.equal(uploads,1);assert.equal(fileMeta.kind,'activity-submission');assert.equal(activity.checkedAt,undefined);assert.equal(events[0][2].kind,'activity');assert.equal(events[0][2].submissionId,activity._id);
  assert.equal((await submit()).status,409);assert.equal(events.length,1);
  assert.equal((await req('/activities/'+activity._id,other)).status,403);assert.equal((await req('/activities/'+activity._id,th)).status,200);
  const path='/activities/'+activity._id+'/review';assert.equal((await req(path,lh,'PATCH',{confirmed:true,previousCheckedAt:null})).status,403);assert.equal((await req(path,other,'PATCH',{confirmed:true,previousCheckedAt:null})).status,403);
  assert.equal((await req(path,th,'PATCH',{confirmed:false,previousCheckedAt:null})).status,400);assert.equal((await req(path,th,'PATCH',{confirmed:true,previousCheckedAt:null,feedback:'Well done'})).status,200);assert.equal(activity.checkedBy,teacher);assert.equal(activity.feedback,'Well done');assert.equal((await req(path,th,'PATCH',{confirmed:true,previousCheckedAt:null})).status,409);
  const verify='/submissions/'+reading._id+'/verify';assert.equal((await req(verify,other,'PATCH',{confirmed:true,previousVerifiedAt:null})).status,403);assert.equal((await req(verify,th,'PATCH',{confirmed:false,previousVerifiedAt:null})).status,400);assert.equal((await req(verify,th,'PATCH',{confirmed:true,previousVerifiedAt:null})).status,200);assert.equal(reading.verification.verifiedBy,teacher);assert.equal((await req(verify,th,'PATCH',{confirmed:true,previousVerifiedAt:null})).status,409);
  assert.equal((await req('/files/'+id(),{})).status,401);assert.equal((await req('/files/'+id(),other)).status,403);assert.equal((await req('/files/'+id(),lh)).status,200);assert.equal((await req('/files/'+id(),th)).status,200);
  assert.equal((await req('/notifications',lh)).status,403);assert.equal((await req('/notifications',th)).status,200);assert.equal(inboxOwner,teacher);assert.equal((await req('/notifications/'+id()+'/read',other,'PATCH',{})).status,200);assert.equal(readOwner,other['x-user']);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

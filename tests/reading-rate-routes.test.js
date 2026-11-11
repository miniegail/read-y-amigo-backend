require('../utils/notifications').notifyTeacher = async () => {};
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const id=()=>String(new mongoose.Types.ObjectId());
const teacher=id(), learner=id(), classId=id(), classworkId=id();
const auth=require.resolve('../middleware/auth');
require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{
  requireAuth:(req,res,next)=>{req.userId=req.headers['x-user']||learner;req.role=req.headers['x-role']||'learner';next();},
  requireRole:role=>(req,res,next)=>req.role===role?next():res.status(403).json({error:'role'}),
}};
const Class=require('../models/Class'), Classwork=require('../models/ClassWork'), Submission=require('../models/Submission'), Enrollment=require('../models/Enrollment'), StreamPost=require('../models/StreamPost');
let uploads=0, stored, createdClasswork;
require('../utils/gridfs').saveBuffer=async()=>{uploads++;return id();};
const passage={text:'One two three four',wordCount:4,countMethod:'automatic',confirmed:true,tokenizerVersion:'v1',confirmedBy:teacher,confirmedAt:new Date()};
let classwork={_id:classworkId,class:classId,type:'reading',title:'Read',assignToAll:true,assignedTo:[],readingPassage:{...passage}};
Class.findOne=async()=>({_id:classId,teacher}); Class.findById=async()=>({_id:classId,teacher});
Classwork.findById=async()=>classwork;
Classwork.create=async fields=>{createdClasswork=new Classwork(fields);await createdClasswork.validate();createdClasswork.populate=async()=>createdClasswork;return createdClasswork;};
Classwork.find=()=>({populate:()=>({sort:async()=>[createdClasswork]})});
StreamPost.create=async()=>({});
Enrollment.findOne=async()=>({}); Enrollment.find=()=>({populate:async()=>[]});
Submission.findOne=async()=>null;
Submission.create=async fields=>{stored=new Submission(fields);await stored.validate();stored.save=async()=>stored;return stored;};
Submission.findById=async()=>stored;
Submission.find=()=>({populate(){return this;},sort:async()=>stored?[stored]:[]});
const submissions=require('../routes/submissions');
const {teacherRouter,learnerRouter}=require('../routes/classes');
function wav(seconds=2){
 const n=8000*seconds*2,b=Buffer.alloc(44+n);b.write('RIFF');b.writeUInt32LE(36+n,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n,40);return b;
}
test('real multipart routes: measured audio, snapshots, strict validation, review/ownership, legacy, serialization',async()=>{
 const app=express();app.use(express.json());app.use('/api/submissions',submissions);app.use('/api/classes',teacherRouter);app.use('/api/learner/classes',learnerRouter);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const teacherHeaders={'x-user':teacher,'x-role':'teacher'};
 const m={completed:true,wordsRead:4,startMs:0,endMs:2000,interrupted:false};
 async function submit(measurement=m,buffer=wav(),extra={}){
  const form=new FormData();form.append('audio',new Blob([buffer],{type:'audio/wav'}),'reading.wav');form.append('durationMs','999999');if(!Object.hasOwn(extra,'recordingInterrupted'))form.append('recordingInterrupted','false');form.append('transcript','one');
  if(measurement!==undefined)form.append('readingMeasurement',typeof measurement==='string'?measurement:JSON.stringify(measurement));
  for(const [k,v] of Object.entries(extra))form.append(k,v);
  return fetch(`${base}/api/submissions/classwork/${classworkId}`,{method:'POST',body:form});
 }
 async function review(measurement=m,headers=teacherHeaders){return fetch(`${base}/api/submissions/${stored._id}/reading-rate`,{method:'PATCH',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(measurement)});}
 try{
  let r=await submit();assert.equal(r.status,201);let body=(await r.json()).submission;
  assert.equal(body.audio.durationMs,2000);assert.equal(body.audio.durationVerified,true);assert.equal(body.readingRate.wpm,120);assert.equal(body.readingRate.status,'provisional');assert.equal(body.readingPassage.wordCount,4);
  r=await submit({...m,endMs:2001},wav(2.000625));assert.equal(r.status,201);body=(await r.json()).submission;assert.equal(body.audio.durationMs,2001);assert.equal(body.readingRate.readingSeconds,2.001);assert.equal(body.readingRate.wpm,4*60/2.001);
  r=await submit();assert.equal(r.status,201);
  classwork.readingPassage.wordCount=99;
  r=await review();assert.equal(r.status,200);body=(await r.json()).submission;assert.equal(body.readingRate.wpm,120);assert.equal(body.readingRate.status,'reviewed');assert.equal(body.reviewedBy,teacher);assert.ok(body.reviewedAt);
  r=await review(m,{'x-user':id(),'x-role':'teacher'});assert.equal(r.status,403);
  r=await review(m,{'x-user':learner,'x-role':'learner'});assert.equal(r.status,403);
  for(const patch of [{endMs:2101},{wordsRead:3},{startMs:-1},{endMs:0},{wordsRead:4.5},{startMs:0.5},{endMs:1999.5}]){r=await review({...m,...patch});assert.equal(r.status,400);}
  r=await review({...m,endMs:2100});assert.equal(r.status,200);assert.equal((await r.json()).submission.readingMeasurement.endMs,2000);
  r=await review({...m,completed:false,wordsRead:2,startMs:100,endMs:1700});assert.equal(r.status,200);assert.equal((await r.json()).submission.readingRate.wpm,75);
  r=await review({...m,interrupted:true});assert.equal(r.status,200);assert.equal((await r.json()).submission.readingRate,null);
  r=await review(m);assert.equal(r.status,400);
  classwork.readingPassage={...passage};
  r=await submit(m,wav(),{recordingInterrupted:'true'});assert.equal(r.status,201);body=(await r.json()).submission;assert.equal(body.recordingInterrupted,true);assert.equal(body.readingMeasurement.interrupted,true);assert.equal(body.readingRate,null);r=await review();assert.equal(r.status,400);
  const interruptedOnly=new FormData();interruptedOnly.append('audio',new Blob([wav()],{type:'audio/wav'}),'pause.wav');interruptedOnly.append('recordingInterrupted','true');r=await fetch(`${base}/api/submissions/classwork/${classworkId}`,{method:'POST',body:interruptedOnly});assert.equal(r.status,201);body=(await r.json()).submission;assert.equal(body.recordingInterrupted,true);assert.equal(body.readingRate,null);assert.equal(body.readingMeasurement,undefined);r=await review();assert.equal(r.status,400);
  const before=uploads;
  r=await submit(m,wav(),{recordingInterrupted:'yes'});assert.equal(r.status,400);assert.equal(uploads,before);
  for(const invalid of ['{bad', {...m,wordsRead:3},{...m,endMs:2200},{...m,reviewedBy:teacher}]){r=await submit(invalid);assert.equal(r.status,400);}
  r=await submit(m,wav(),{readingRate:'{}'});assert.equal(r.status,400);assert.equal(uploads,before);
  r=await submit({...m,interrupted:true});assert.equal(r.status,201);assert.equal((await r.json()).submission.readingRate,null);
  r=await submit({...m,completed:false,wordsRead:0});assert.equal(r.status,201);assert.equal((await r.json()).submission.readingRate,null);
  r=await submit(m,Buffer.from('not audio'));assert.equal(r.status,201);body=(await r.json()).submission;assert.equal(body.audio.durationVerified,false);assert.equal(body.audio.durationMs,999999);assert.equal(body.readingRate,null);r=await review();assert.equal(r.status,400);
  delete classwork.readingPassage;r=await submit();assert.equal(r.status,201);assert.equal((await r.json()).submission.readingRate,null);r=await review();assert.equal(r.status,400);
  classwork.readingPassage={...passage};r=await fetch(`${base}/api/submissions/classwork/${classworkId}`,{headers:teacherHeaders});assert.equal((await r.json()).classwork.readingPassage.wordCount,4);
  const classForm=(p)=>{const f=new FormData();for(const[k,v]of Object.entries({title:'Read',type:'reading',assignToAll:'true',readingSource:'file',readingPassage:JSON.stringify(p)}))f.append(k,v);f.append('file',new Blob(['pdf'],{type:'application/pdf'}),'read.pdf');return f;};
  let count=uploads;r=await fetch(`${base}/api/classes/${classId}/classwork`,{method:'POST',headers:teacherHeaders,body:classForm({...passage,confirmedBy:'spoof'})});assert.equal(r.status,400);assert.equal(uploads,count);
  const {confirmedBy,confirmedAt,...input}=passage;
  for(const invalid of [{...input,wordCount:999},{...input,countMethod:'manual',text:'--- !!!'}]){
    count=uploads;r=await fetch(`${base}/api/classes/${classId}/classwork`,{method:'POST',headers:teacherHeaders,body:classForm(invalid)});assert.equal(r.status,400);assert.equal(uploads,count);
  }

  r=await fetch(`${base}/api/classes/${classId}/classwork`,{method:'POST',headers:teacherHeaders,body:classForm(input)});assert.equal(r.status,201);body=(await r.json()).classwork;assert.equal(body.readingPassage.wordCount,4);assert.equal(body.readingPassage.confirmedBy,teacher);
  r=await fetch(`${base}/api/learner/classes/${classId}/classwork`);assert.equal((await r.json()).classwork[0].readingPassage.wordCount,4);
  const typed=()=>{const f=new FormData();for(const[k,v]of Object.entries({title:'Typed',type:'reading',assignToAll:'true',readingSource:'text',readingText:'One\r\ntwo',readingPassage:JSON.stringify({...input,text:' One\ntwo ',wordCount:2})}))f.append(k,v);return f;};
  r=await fetch(`${base}/api/classes/${classId}/classwork`,{method:'POST',headers:teacherHeaders,body:typed()});assert.equal(r.status,201);body=(await r.json()).classwork;assert.equal(body.readingPassage.text,'One\ntwo');assert.equal(body.readingPassage.wordCount,2);
  const conflict=typed();conflict.set('readingText','Different');count=uploads;r=await fetch(`${base}/api/classes/${classId}/classwork`,{method:'POST',headers:teacherHeaders,body:conflict});assert.equal(r.status,400);assert.equal(uploads,count);
  const noMeasurement=new FormData();noMeasurement.append('audio',new Blob([wav()],{type:'audio/wav'}),'reading.wav');r=await fetch(`${base}/api/submissions/classwork/${classworkId}`,{method:'POST',body:noMeasurement});assert.equal(r.status,201);assert.equal((await r.json()).submission.readingRate,null);
  r=await fetch(`${base}/api/submissions/mine`);assert.equal((await r.json()).submissions[0].readingRate,null);

 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

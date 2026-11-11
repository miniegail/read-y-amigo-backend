const {test}=require('node:test');const assert=require('node:assert/strict');const mongoose=require('mongoose');
const Inbox=require('../models/TeacherInbox'),User=require('../models/User');
const {appendNotification,notifyTeacher}=require('../utils/notifications');
test('notification insert uses atomic bounded newest-first storage; duplicate and first-insert races retry safely',async()=>{
 let items=[],calls=0;
 Inbox.updateOne=async(filter,update,options)=>{calls++;assert.equal(update.$push.items.$slice,10);assert.equal(update.$push.items.$position,0);
 if(items.some(x=>x.eventKey===filter['items.eventKey'].$ne)){if(options.upsert)throw Object.assign(new Error('duplicate'),{code:11000});return;}
 items=[...update.$push.items.$each,...items].slice(0,10);};
 for(let i=0;i<12;i++)await appendNotification('teacher',{eventKey:`event:${i}`,kind:'joined'});
 assert.equal(items.length,10);assert.deepEqual(items.map(x=>x.eventKey),Array.from({length:10},(_,i)=>`event:${11-i}`));
 await appendNotification('teacher',{eventKey:'event:11',kind:'joined'});assert.equal(items.length,10);assert.equal(calls,14);
 let n=0;Inbox.updateOne=async(f,u,o)=>{if(!n++)throw Object.assign(new Error('race'),{code:11000});assert.equal(o.upsert,undefined);};
 await appendNotification('newteacher',{eventKey:'first',kind:'joined'});assert.equal(n,2);
});
test('notification retains actor name, classroom and submission destination',async()=>{
 const id=()=>new mongoose.Types.ObjectId();const teacher=id(),classId=id(),actor=id(),work=id(),sub=id();let stored;
 User.findById=()=>({select:async()=>({firstName:'Maria',secondName:'Santos'})});
 Inbox.updateOne=async(filter,update)=>{assert.equal(filter._id,teacher);stored=update.$push.items.$each[0];};
 await notifyTeacher({_id:classId,teacher,title:'Filipino'},actor,{eventKey:`reading:${sub}`,kind:'reading',title:'HIYAS',classworkId:work,submissionId:sub});
 assert.equal(stored.actorName,'Maria Santos');assert.equal(stored.classId,classId);assert.equal(stored.submissionId,sub);assert.equal(stored.classTitle,'Filipino');assert.equal(stored.readAt,null);
});

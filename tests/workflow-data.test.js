const {test}=require('node:test');const assert=require('node:assert/strict');
const {toCheckItems,readingReviewed}=require('../utils/teacherWork');
const {classroomPerson,peopleEnrollments}=require('../utils/classroomPeople');
test('To-check includes only pending work in matching active owned classes, oldest first',()=>{
 const classes=[{_id:'c',title:'Filipino'}],works=[{_id:'w',class:'c',title:'HIYAS'}];
 const row={_id:'r',class:'c',classwork:'w',learner:{_id:'l',displayName:'Maria'},submittedAt:'2026-11-10T02:00:00Z'};
 const readings=[row,{...row,_id:'checked',verification:{verifiedAt:new Date()}},{...row,_id:'metrics',readingRate:{status:'reviewed'},wordAccuracy:{reviewedAt:new Date()}},{...row,_id:'foreign',class:'other'},{...row,_id:'deleted',classwork:'gone'}];
 const activities=[{...row,_id:'a',submittedAt:'2026-11-10T01:00:00Z'},{...row,_id:'done',checkedAt:new Date()}];
 const attempts=[{...row,_id:'q',status:'pending-review'},{...row,_id:'graded',status:'graded'},{...row,_id:'draft',status:'draft'}];
 const items=toCheckItems(classes,works,readings,activities,attempts,attempts);
 assert.deepEqual(items.map(x=>x._id),['activity:a','comprehension:q','quiz:q','reading:r']);
 assert.equal(items[0].submissionId,'a');assert.equal(items[1].attemptId,'q');assert.equal(items[3].learnerName,'Maria');
 assert.equal(readingReviewed({readingRate:{status:'reviewed'}}),false);
 row.verification={verifiedAt:new Date()};assert.equal(toCheckItems(classes,works,[row],[],[],[]).length,0);
});
test('People DTO exposes full name, photo and age without account credentials',()=>{
 const user={_id:'l',firstName:'Maria',middleInitial:'D.',secondName:'Santos',displayName:'Maria',age:10,role:'learner',profilePhoto:'/api/files/photo',email:'secret',passwordHash:'secret',birthDate:'secret'};
 const person=classroomPerson(user);assert.equal(person.fullName,'Maria D. Santos');assert.equal(person.age,10);assert.equal(person.profilePhoto,user.profilePhoto);
 for(const field of ['email','passwordHash','birthDate'])assert.equal(field in person,false);
 assert.equal('age' in classroomPerson({...user,role:'teacher'},false),false);
 assert.equal(classroomPerson({...user,age:undefined}).age,null);
 assert.equal(peopleEnrollments([{_id:'e',learner:user},{_id:'orphan',learner:null}]).length,1);
});

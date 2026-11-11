const {test}=require('node:test'),assert=require('node:assert/strict'),express=require('express'),mongoose=require('mongoose');
const id=()=>String(new mongoose.Types.ObjectId());const teacher=id(),learner=id(),other=id(),classId=id(),foreignId=id(),workId=id();
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth(req,res,next){req.userId=req.headers['x-user'];req.role=req.headers['x-role'];if(!req.userId)return res.status(401).json({error:'Login required'});next();},requireRole:role=>(req,res,next)=>req.role===role?next():res.status(403).json({error:'Role denied'})}};
const Class=require('../models/Class'),Work=require('../models/ClassWork'),Enrollment=require('../models/Enrollment'),Submission=require('../models/Submission');const {Attempt}=require('../models/Comprehension');
const classroom={_id:classId,teacher,title:'Filipino',status:'active'};
const works=[{_id:workId,class:classId,title:'Hiyas',type:'reading',readingActivities:['read-aloud'],assignToAll:true,createdAt:'2026-11-10',attachment:{name:'Hiyas.pdf',url:'/uploads/hiyas.pdf'}},
 {_id:id(),class:classId,title:'Private',type:'reading',assignToAll:false,assignedTo:[other],attachment:{name:'Private.pdf',url:'/uploads/private.pdf'},createdAt:'2026-11-09'}];
const query=value=>({select(){return this},populate(){return this},sort(){return this},then(resolve,reject){return Promise.resolve(value).then(resolve,reject)}});
function match(row,filter){return Object.entries(filter).every(([key,value])=>key==='$or'?value.some(condition=>Object.entries(condition).every(([k,v])=>Array.isArray(row[k])?row[k].includes(v):row[k]===v)):value?.$in?value.$in.map(String).includes(String(row[key])):String(row[key])===String(value));}
Class.find=filter=>query(match(classroom,filter)?[classroom]:[]);Class.findOne=async filter=>match(classroom,filter)?classroom:null;
Enrollment.find=filter=>query([{class:classId,learner}].filter(row=>match(row,filter)));Enrollment.findOne=async filter=>filter.learner===learner?{class:classId,learner}:null;
Work.find=filter=>query(works.filter(row=>match(row,filter)));
Submission.find=filter=>query([{_id:id(),class:classId,learner,classwork:workId,submittedAt:'2026-11-10T01:00:00Z',readingRate:{wpm:92,status:'reviewed'}}].filter(row=>match(row,filter)));Attempt.find=()=>query([]);
test('reports and library enforce teacher ownership, learner enrollment, assignment and reporting filters',async()=>{
 const app=express();app.use(express.json());app.use('/reports',require('../routes/reports'));const routes=require('../routes/classes');app.use('/classes',routes.teacherRouter);app.use('/learner/classes',routes.learnerRouter);const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(path,role='teacher',user=teacher)=>{const res=await fetch(base+path,{headers:{'x-role':role,...(user?{'x-user':user}:{})}});return {status:res.status,data:await res.json()};};
 try{
  assert.equal((await call('/reports','teacher','')).status,401);assert.equal((await call('/reports','learner',learner)).status,403);
  assert.equal((await call('/reports?classId='+foreignId)).status,403);assert.equal((await call('/reports?from=invalid')).status,400);assert.equal((await call('/reports?from=2026-11-10&to=2026-11-01')).status,400);
  let response=await call('/reports');assert.equal(response.status,200);assert.equal(response.data.totals.metrics.speed.value,92);assert.equal(response.data.totals.totalLearners,1);assert.equal(response.data.trend.length,1);
  response=await call('/reports?from=2026-12-01&to=2027-01-01');assert.equal(response.data.totals.metrics.speed.value,null);assert.equal(response.data.totals.totalLearners,1);
  response=await call('/reports','teacher',other);assert.equal(response.data.totals.totalLearners,0);assert.equal(response.data.availableClasses.length,0);
  assert.equal((await call(`/classes/${classId}/library`,'teacher',other)).status,403);
  response=await call(`/classes/${classId}/library`);assert.equal(response.status,200);assert.equal(response.data.files.length,2);
  response=await call(`/learner/classes/${classId}/library`,'learner',learner);assert.equal(response.status,200);assert.equal(response.data.files.length,1);assert.equal(response.data.files[0].name,'Hiyas.pdf');assert.equal(JSON.stringify(response.data).includes('Private'),false);
  assert.equal((await call(`/learner/classes/${classId}/library`,'learner',other)).status,403);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
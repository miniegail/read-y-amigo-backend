const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const id = () => String(new mongoose.Types.ObjectId());
const teacher = id(), learner = id(), submissionId = id();
const auth = require.resolve('../middleware/auth');
require.cache[auth] = { id: auth, filename: auth, loaded: true, exports: {
 requireAuth: (req,res,next) => { req.userId = req.headers['x-user']; req.role = req.headers['x-role']; next(); },
 requireRole: role => (req,res,next) => req.role === role ? next() : res.status(403).json({ error: 'role' }),
}};
const Class = require('../models/Class');
const Submission = require('../models/Submission');
let stored, race = false;
Class.findById = async () => ({ teacher });
Submission.findById = async () => stored;
Submission.findOneAndUpdate = async (filter, update) => {
 if (race) return null;
 stored.miscueReview = update.$set.miscueReview;
 await stored.validate();
 return stored;
};
test('review route protects ownership, persists observations and rejects stale edits', async () => {
 stored = new Submission({ _id: submissionId, class: id(), classwork: id(), learner,
  audio: { fileId: id(), url: '/audio' }, readingPassage: { text:'The boy', wordCount:2, countMethod:'automatic', confirmed:true, tokenizerVersion:'v1', confirmedBy:teacher, confirmedAt:new Date() }, transcript:'The boy' });
 const app = express(); app.use(express.json()); app.use(require('../routes/submissions'));
 const server = app.listen(0,'127.0.0.1'); await new Promise(r => server.once('listening',r));
 const url = `http://127.0.0.1:${server.address().port}/${submissionId}/miscue-review`;
 const body = { algorithmVersion:'v1', listened:true, events:[], previousReviewedAt:null, reviewedBy:learner };
 const send = (data=body,user=teacher,role='teacher') => fetch(url,{ method:'PATCH', headers:{ 'Content-Type':'application/json','x-user':user,'x-role':role }, body:JSON.stringify(data) });
 try {
  assert.equal((await send(body,learner,'learner')).status,403);
  assert.equal((await send(body,id())).status,403);
  assert.equal((await send({ ...body,listened:false })).status,400);
  let r = await send(); assert.equal(r.status,200);
  const saved = (await r.json()).submission.miscueReview;
  assert.equal(saved.reviewedBy,teacher); assert.ok(saved.reviewedAt); assert.equal(stored.readingRate,null);
  assert.equal((await send()).status,409);
  r = await send({ ...body,previousReviewedAt:saved.reviewedAt }); assert.equal(r.status,200);
  race = true;
  assert.equal((await send({ ...body,previousReviewedAt:stored.miscueReview.reviewedAt.toISOString() })).status,409);
  race = false; stored.readingPassage = undefined;
  assert.equal((await send({ ...body,previousReviewedAt:stored.miscueReview.reviewedAt.toISOString() })).status,400);
 } finally { server.closeAllConnections(); await new Promise(r=>server.close(r)); }
});

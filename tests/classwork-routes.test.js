const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const teacher = String(new mongoose.Types.ObjectId());
const classId = String(new mongoose.Types.ObjectId());
const authPath = require.resolve('../middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  requireAuth: (req, res, next) => { req.userId = teacher; next(); },
  requireRole: () => (req, res, next) => next(),
} };
const Class = require('../models/Class');
const Classwork = require('../models/ClassWork');
const StreamPost = require('../models/StreamPost');
const Enrollment = require('../models/Enrollment');
const gridfs = require('../utils/gridfs');
let uploaded = 0;
gridfs.saveBuffer = async () => { uploaded++; return new mongoose.Types.ObjectId(); };
let stored;
Class.findOne = async () => ({ _id: classId, teacher });
Enrollment.findOne = async () => ({});
Classwork.create = async (fields) => {
  stored = new Classwork(fields);
  await stored.validate();
  stored.populate = async () => stored;
  return stored;
};
Classwork.find = () => ({ populate: () => ({ sort: async () => [stored] }) });
StreamPost.create = async () => ({});
const { teacherRouter, learnerRouter } = require('../routes/classes');

test('multipart text/file creation round-trips through learner endpoint; invalid text is rejected before storage', async () => {
  const app = express();
  app.use('/classes', teacherRouter);
  app.use('/learner/classes', learnerRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const form = (source, text) => {
      const f = new FormData();
      for (const [key, value] of Object.entries({ title: 'Read', type: 'reading', assignToAll: 'true', readingSource: source, readingText: text, readingActivities: '["read-aloud"]' })) f.append(key, value);
      return f;
    };
    const text = 'The child reads.\n\nA new paragraph.';
    let response = await fetch(`${base}/classes/${classId}/classwork`, { method: 'POST', body: form('text', text) });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).classwork.readingText, text);
    response = await fetch(`${base}/learner/classes/${classId}/classwork`);
    assert.equal((await response.json()).classwork[0].readingText, text);
    assert.equal(uploaded, 0);
    response = await fetch(`${base}/classes/${classId}/classwork`, { method: 'POST', body: form('text', ' ') });
    assert.equal(response.status, 400);
    const file = form('file', '');
    file.append('file', new Blob(['file bytes'], { type: 'application/pdf' }), 'passage.pdf');
    response = await fetch(`${base}/classes/${classId}/classwork`, { method: 'POST', body: file });
    assert.equal(response.status, 201);
    const created = (await response.json()).classwork;
    assert.equal(created.readingSource, 'file');
    assert.equal(created.attachment.name, 'passage.pdf');
    assert.equal(created.readingText, '');
    assert.equal(uploaded, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

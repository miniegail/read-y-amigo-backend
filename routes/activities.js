const express = require('express'), mongoose = require('mongoose');
const { requireAuth, requireRole } = require('../middleware/auth');
const Class = require('../models/Class'), Work = require('../models/ClassWork'), Enrollment = require('../models/Enrollment');
const Activity = require('../models/ActivitySubmission');
const upload = require('../middleware/upload');
const { saveBuffer } = require('../utils/gridfs');
const { notifyTeacher } = require('../utils/notifications');
const router = express.Router(); router.use(requireAuth);
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const wrap = fn => async (req, res) => { try { await fn(req, res); } catch (error) {
  if (error.code === 11000) return res.status(409).json({ error: 'You already submitted this activity.' });
  if (!error.status) console.error(error);
  res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not process this activity.' });
} };
const validId = value => { if (!mongoose.isValidObjectId(value)) fail('Invalid identifier.'); return value; };
async function classroomFor(classId) {
  const classroom = await Class.findById(classId);
  if (!classroom || classroom.status !== 'active') fail('Classroom unavailable.', 404);
  return classroom;
}
router.get('/mine', requireRole('learner'), wrap(async (req, res) => {
  const classId = validId(req.query.classId); await classroomFor(classId);
  if (!await Enrollment.findOne({ class: classId, learner: req.userId })) fail('You are not enrolled in this classroom.', 403);
  res.json({ submissions: await Activity.find({ class: classId, learner: req.userId }).sort({ submittedAt: -1 }) });
}));
router.post('/classwork/:id', requireRole('learner'), upload.single('file'), wrap(async (req, res) => {
  const work = await Work.findById(validId(req.params.id));
  if (!work || work.type !== 'activity') fail('Activity not found.', 404);
  const classroom = await classroomFor(work.class);
  if (!await Enrollment.findOne({ class: classroom._id, learner: req.userId })) fail('You are not enrolled in this classroom.', 403);
  if (!work.assignToAll && !(work.assignedTo || []).some(id => String(id) === req.userId)) fail('This activity is not assigned to you.', 403);
  if (work.dueDate && new Date(work.dueDate).getTime() <= Date.now()) fail('The deadline has passed.', 403);
  if (await Activity.findOne({ classwork: work._id, learner: req.userId })) fail('You already submitted this activity.', 409);
  const text = req.body.text === undefined ? '' : req.body.text;
  if (typeof text !== 'string' || text.length > 20000 || (!text.trim() && !req.file)) fail('Add a written answer or attach a file before submitting.');
  let attachment;
  if (req.file) {
    const fileId = await saveBuffer({ buffer: req.file.buffer, filename: req.file.originalname, mimeType: req.file.mimetype,
      metadata: { class: classroom._id, uploadedBy: req.userId, kind: 'activity-submission' } });
    attachment = { fileId, name: req.file.originalname, url: `/api/files/${fileId}`, mimeType: req.file.mimetype, size: req.file.size };
  }
  const submission = await Activity.create({ class: classroom._id, classwork: work._id, learner: req.userId, text: text.trim(), attachment });
  await notifyTeacher(classroom, req.userId, { kind: 'activity', eventKey: `activity:${submission._id}`, title: work.title, classworkId: work._id, submissionId: submission._id });
  res.status(201).json({ submission });
}));
router.get('/:id', wrap(async (req, res) => {
  const submission = await Activity.findById(validId(req.params.id)).populate('learner', 'displayName firstName secondName');
  if (!submission) fail('Submission not found.', 404);
  const classroom = await classroomFor(submission.class);
  const learnerId = String(submission.learner?._id || submission.learner);
  if (String(classroom.teacher) !== req.userId && learnerId !== req.userId) fail('You do not have access to this submission.', 403);
  const work = await Work.findById(submission.classwork).select('title');
  res.json({ submission, title: work?.title || 'Activity' });
}));
router.patch('/:id/review', requireRole('teacher'), wrap(async (req, res) => {
  const submission = await Activity.findById(validId(req.params.id));
  if (!submission) fail('Submission not found.', 404);
  const classroom = await classroomFor(submission.class);
  if (String(classroom.teacher) !== req.userId) fail('You do not own this classroom.', 403);
  if (req.body.confirmed !== true || (req.body.feedback !== undefined && (typeof req.body.feedback !== 'string' || req.body.feedback.length > 6000))) fail('Confirm that you reviewed this activity.');
  const current = submission.checkedAt?.toISOString() || null;
  if (req.body.previousCheckedAt !== current) fail('This review changed. Reload before saving.', 409);
  const updated = await Activity.findOneAndUpdate({ _id: submission._id, checkedAt: submission.checkedAt || { $exists: false } }, { $set: {
    checkedAt: new Date(Math.max(Date.now(), (submission.checkedAt?.getTime() || 0) + 1)), checkedBy: req.userId, feedback: req.body.feedback || '',
  } }, { new: true, runValidators: true });
  if (!updated) fail('This review changed. Reload before saving.', 409);
  res.json({ submission: updated });
}));
module.exports = router;

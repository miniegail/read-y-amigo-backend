const express = require('express');
const mongoose = require('mongoose');
const { requireAuth, requireRole } = require('../middleware/auth');
const Class = require('../models/Class');
const Work = require('../models/ClassWork');
const Enrollment = require('../models/Enrollment');
const Attempt = require('../models/StandaloneQuizAttempt');
const { fail, answersFor, grade, publicAttempt } = require('../utils/comprehension');
const { resultSummary } = require('../utils/readingProgress');
const { standaloneConfig } = require('../utils/standaloneQuiz');
const router = express.Router();
router.use(requireAuth);
const wrap = fn => async (req, res) => { try { await fn(req, res); } catch (error) {
  if (!error.status) console.error(error);
  res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not process the classroom quiz. Please try again.' });
} };
function id(value) { if (!mongoose.isValidObjectId(value)) fail('Invalid identifier.'); return value; }
async function access(req, workId, teacher = false) {
  const work = await Work.findById(id(workId));
  if (!work || work.type !== 'quiz') fail('Classroom quiz not found.', 404);
  const classroom = await Class.findById(work.class);
  if (!classroom || classroom.status !== 'active') fail('Classroom unavailable.', 404);
  if (teacher) { if (String(classroom.teacher) !== req.userId) fail('You do not own this classroom.', 403); }
  else {
    if (!await Enrollment.findOne({ class: work.class, learner: req.userId })) fail('You are not enrolled in this classroom.', 403);
    if (!work.assignToAll && !(work.assignedTo || []).some(value => String(value) === req.userId)) fail('This quiz is not assigned to you.', 403);
  }
  return work;
}
function deadline(work) { if (work.dueDate && new Date(work.dueDate).getTime() <= Date.now()) fail('The deadline has passed.', 403); }
async function attemptAccess(req, attemptId, teacher = false, writing = false) {
  const attempt = await Attempt.findById(id(attemptId)).select('+quiz');
  if (!attempt) fail('Quiz attempt not found.', 404);
  if (!teacher && String(attempt.learner) !== req.userId) fail('This is not your attempt.', 403);
  const work = await access(req, attempt.classwork, teacher);
  if (writing) deadline(work);
  return attempt;
}
async function update(req, attempt, patch) {
  if (!Number.isSafeInteger(req.body.revision) || req.body.revision < 0) fail('A valid revision is required.');
  const updated = await Attempt.findOneAndUpdate({ _id: attempt._id, revision: req.body.revision, status: attempt.status }, { $set: patch, $inc: { revision: 1 } }, { new: true, runValidators: true }).select('+quiz');
  if (!updated) fail('This attempt changed in another session. Reload before saving.', 409);
  return updated;
}
router.get('/mine', requireRole('learner'), wrap(async (req, res) => {
  const classId = id(req.query.classId), classroom = await Class.findById(classId);
  if (!classroom || classroom.status !== 'active' || !await Enrollment.findOne({ class: classId, learner: req.userId })) fail('You do not have access to this classroom.', 403);
  const works = await Work.find({ class: classId, type: 'quiz', $or: [{ assignToAll: true }, { assignedTo: req.userId }] }).select('_id');
  const attempts = await Attempt.find({ class: classId, learner: req.userId, classwork: { $in: works.map(work => work._id) } }).select('title classwork assessmentType status result submittedAt reviewedAt');
  res.json({ attempts: attempts.map(attempt => ({ ...resultSummary(attempt), assessmentType: 'standalone' })), classworkIds: attempts.filter(attempt => attempt.status !== 'draft').map(attempt => String(attempt.classwork)) });
}));
router.post('/classwork/:id/start', requireRole('learner'), wrap(async (req, res) => {
  const work = await access(req, req.params.id);
  const filter = { classwork: work._id, learner: req.userId };
  let attempt = await Attempt.findOne(filter).select('+quiz');
  if (!attempt) {
    deadline(work);
    const quiz = standaloneConfig(work);
    try { attempt = await Attempt.create({ ...filter, class: work.class, title: work.title, quiz }); }
    catch (error) { if (error.code !== 11000) throw error; attempt = await Attempt.findOne(filter).select('+quiz'); }
  }
  res.json({ attempt: publicAttempt(attempt) });
}));
router.put('/attempts/:id/draft', requireRole('learner'), wrap(async (req, res) => {
  const attempt = await attemptAccess(req, req.params.id, false, true);
  if (attempt.status !== 'draft') fail('Submitted answers cannot be edited.', 409);
  res.json({ attempt: publicAttempt(await update(req, attempt, { answers: answersFor(attempt.quiz, req.body.answers, false) })) });
}));
router.post('/attempts/:id/submit', requireRole('learner'), wrap(async (req, res) => {
  const attempt = await attemptAccess(req, req.params.id, false, true);
  if (attempt.status !== 'draft') fail('This quiz has already been submitted.', 409);
  const answers = answersFor(attempt.quiz, req.body.answers, true), scored = grade(attempt.quiz, answers);
  res.json({ attempt: publicAttempt(await update(req, attempt, { answers, ...scored, status: scored.result.status, submittedAt: new Date() })) });
}));
router.get('/classwork/:id/attempts', requireRole('teacher'), wrap(async (req, res) => {
  const work = await access(req, req.params.id, true);
  const attempts = await Attempt.find({ classwork: work._id }).select('+quiz').populate('learner', 'displayName firstName secondName').sort({ createdAt: -1 });
  res.json({ title: work.title, attempts: attempts.map(attempt => publicAttempt(attempt, true)) });
}));
router.patch('/attempts/:id/grade', requireRole('teacher'), wrap(async (req, res) => {
  const attempt = await attemptAccess(req, req.params.id, true);
  if (attempt.status === 'draft') fail('The learner has not submitted this quiz.', 409);
  const questions = attempt.quiz.questions.filter(q => ['short-answer', 'essay'].includes(q.type));
  if (!Array.isArray(req.body.grades) || req.body.grades.length !== questions.length) fail('Grade every written response.');
  const seen = new Set();
  const manual = req.body.grades.map(g => {
    const q = questions.find(q => q.id === g.questionId);
    if (!q || seen.has(g.questionId) || typeof g.correct !== 'boolean' || !Number.isFinite(g.awardedPoints) || g.awardedPoints < 0 || g.awardedPoints > q.points || (g.feedback !== undefined && (typeof g.feedback !== 'string' || g.feedback.length > 6000))) fail('Invalid manual grade.');
    seen.add(g.questionId);
    return { questionId: g.questionId, correct: g.correct, awardedPoints: g.awardedPoints, feedback: g.feedback || '' };
  });
  const scored = grade(attempt.quiz, attempt.answers, manual);
  res.json({ attempt: publicAttempt(await update(req, attempt, { ...scored, status: scored.result.status, reviewedAt: new Date(), reviewedBy: req.userId }), true) });
}));
module.exports = router;

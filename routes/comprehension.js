const { resultSummary } = require('../utils/readingProgress');
const express = require('express');
const mongoose = require('mongoose');
const { requireAuth, requireRole } = require('../middleware/auth');
const Class = require('../models/Class');
const Classwork = require('../models/ClassWork');
const Enrollment = require('../models/Enrollment');
const Submission = require('../models/Submission');
const { Quiz, QuizSet, Attempt } = require('../models/Comprehension');
const { fail, passageHash, validateQuiz, answersFor, grade, publicQuiz, publicAttempt } = require('../utils/comprehension');
const router = express.Router();
router.use(requireAuth);
const wrap = fn => async (req, res) => { try { await fn(req, res); } catch (error) {
  if (error.code === 11000) return res.status(409).json({ error: 'This item already exists. Reload to continue.' });
  if (!error.status) console.error(error);
  res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not process comprehension. Please try again.' });
} };
function id(value) { if (!mongoose.isValidObjectId(value)) fail('Invalid identifier.'); return value; }
async function classworkAccess(req, classworkId, teacher = false) {
  const work = await Classwork.findById(id(classworkId));
  if (!work) fail('Classwork not found.', 404);
  const classroom = await Class.findById(work.class);
  if (!classroom || classroom.status !== 'active') fail('Classroom unavailable.', 404);
  if (teacher) { if (String(classroom.teacher) !== req.userId) fail('You do not own this classroom.', 403); }
  else {
    if (!await Enrollment.findOne({ class: work.class, learner: req.userId })) fail('You are not enrolled in this classroom.', 403);
    if (!work.assignToAll && !(work.assignedTo || []).some(value => String(value) === req.userId)) fail('This activity is not assigned to you.', 403);
  }
  return work;
}
function deadline(work) { if (work.dueDate && new Date(work.dueDate).getTime() <= Date.now()) fail('The deadline has passed.', 403); }
async function activeReading(req, work) {
  if (!(work.readingActivities || []).includes('read-aloud')) return null;
  const reading = await Submission.findOne({ classwork: work._id, learner: req.userId });
  if (!reading) fail('Submit your read-aloud recording before taking the quiz.', 409);
  return reading;
}
async function attemptAccess(req, attemptId, teacher = false, write = false) {
  const attempt = await Attempt.findById(id(attemptId)).select('+quiz +passage');
  if (!attempt) fail('Comprehension attempt not found.', 404);
  if (!teacher && String(attempt.learner) !== req.userId) fail('This is not your attempt.', 403);
  const work = await classworkAccess(req, attempt.classwork, teacher);
  if (!teacher && write) {
    deadline(work);
    const reading = await activeReading(req, work);
    if ((reading && String(reading._id) !== String(attempt.readingSubmission)) || (!reading && attempt.readingSubmission)) fail('This quiz belongs to an earlier reading attempt. Reopen comprehension from your current reading.', 409);
    if (passageHash(reading?.readingPassage || work.readingPassage) !== attempt.passageHash) fail('The passage has changed. Contact your teacher.', 409);
  }
  return attempt;
}
function revision(req) { if (!Number.isSafeInteger(req.body.revision) || req.body.revision < 0) fail('A valid revision is required.'); return req.body.revision; }
async function updateAttempt(attempt, expectedRevision, patch) {
  const updated = await Attempt.findOneAndUpdate({ _id: attempt._id, revision: expectedRevision, status: attempt.status },
    { $set: patch, $inc: { revision: 1 } }, { new: true, runValidators: true }).select('+quiz +passage');
  if (!updated) fail('This attempt changed in another session. Reload before saving.', 409);
  return updated;
}
router.get('/mine', requireRole('learner'), wrap(async (req, res) => {
  const classId = id(req.query.classId);
  const classroom = await Class.findById(classId);
  if (!classroom || classroom.status !== 'active' || !await Enrollment.findOne({ class: classId, learner: req.userId })) fail('You do not have access to this classroom.', 403);
  if (req.query.include === 'results') {
    const [all, readings, works] = await Promise.all([
      Attempt.find({ class: classId, learner: req.userId }).select('classwork readingSubmission title status result submittedAt reviewedAt createdAt'),
      Submission.find({ class: classId, learner: req.userId }).select('_id classwork'),
      Classwork.find({ class: classId, type: 'reading', readingActivities: 'comprehension',
        $or: [{ assignToAll: true }, { assignedTo: req.userId }] }).select('_id readingActivities'),
    ]);
    const assigned = new Map(works.map(work => [String(work._id), work]));
    const current = new Map(readings.map(reading => [String(reading.classwork), String(reading._id)]));
    const latest = new Map();
    for (const attempt of all.slice().sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))) {
      const work = assigned.get(String(attempt.classwork));
      if (!work) continue;
      const readingId = current.get(String(attempt.classwork));
      if (work.readingActivities?.includes('read-aloud') ? !readingId || String(attempt.readingSubmission) !== readingId : !!attempt.readingSubmission) continue;
      latest.set(String(attempt.classwork), attempt);
    }
    const visible = [...latest.values()];
    return res.json({ classworkIds: visible.filter(attempt => attempt.status !== 'draft').map(attempt => String(attempt.classwork)), attempts: visible.map(resultSummary) });
  }
  const attempts = await Attempt.find({ class: classId, learner: req.userId, status: { $in: ['pending-review', 'graded'] } }).select('classwork readingSubmission status');
  const readings = await Submission.find({ class: classId, learner: req.userId }).select('_id classwork');
  const current = new Set(readings.map(reading => String(reading._id)));
  res.json({ classworkIds: [...new Set(attempts.filter(attempt => !attempt.readingSubmission || current.has(String(attempt.readingSubmission))).map(attempt => String(attempt.classwork)))] });
}));
router.post('/validate', requireRole('teacher'), wrap(async (req, res) => {
  passageHash(req.body.passage); validateQuiz(req.body.quiz); res.json({ valid: true });
}));
router.get('/classwork/:id/config', requireRole('teacher'), wrap(async (req, res) => {
  const work = await classworkAccess(req, req.params.id, true);
  const config = await Quiz.findOne({ classwork: work._id }).select('+quiz');
  res.json({ title: work.title, passage: work.readingPassage, quiz: config?.quiz || null });
}));
router.post('/sets/search', requireRole('teacher'), wrap(async (req, res) => {
  const hash = passageHash(req.body.passage);
  const sets = await QuizSet.find({ teacher: req.userId, passageHash: hash }).select('+quiz').sort({ createdAt: -1 });
  res.json({ sets: sets.map(set => ({ _id: set._id, title: set.title, passageHash: hash, quiz: set.quiz })) });
}));
router.post('/sets', requireRole('teacher'), wrap(async (req, res) => {
  if (typeof req.body.title !== 'string' || !req.body.title.trim() || req.body.title.length > 200) fail('Enter a quiz set title (up to 200 characters).');
  const hash = passageHash(req.body.passage), quiz = validateQuiz(req.body.quiz);
  const set = await QuizSet.create({ teacher: req.userId, title: req.body.title.trim(), passageHash: hash, quiz });
  res.status(201).json({ set: { _id: set._id, title: set.title, passageHash: hash, quiz } });
}));
router.post('/classwork/:id/config', requireRole('teacher'), wrap(async (req, res) => {
  const work = await classworkAccess(req, req.params.id, true);
  if (work.type !== 'reading' || !work.readingActivities?.includes('comprehension')) fail('Enable comprehension on this reading assignment.');
  const hash = passageHash(work.readingPassage);
  if (passageHash(req.body.passage) !== hash) fail('The previewed passage does not match the published reading material.', 409);
  const quiz = validateQuiz(req.body.quiz);
  // A published quiz is immutable: retries with the same payload are safe; changing it requires a new assignment.
  const existing = await Quiz.findOne({ classwork: work._id }).select('+quiz');
  if (existing) {
    const equivalent = existing.passageHash === hash && JSON.stringify({ ...existing.quiz, version: '' }) === JSON.stringify({ ...quiz, version: '' });
    if (!equivalent) fail('A different quiz is already published. Create a new assignment to change its questions.', 409);
    return res.json({ quiz: publicQuiz(existing.quiz) });
  }
  await Quiz.create({ classwork: work._id, teacher: req.userId, passageHash: hash, quiz });
  res.status(201).json({ quiz: publicQuiz(quiz) });
}));
router.get('/classwork/:id', requireRole('learner'), wrap(async (req, res) => {
  const work = await classworkAccess(req, req.params.id);
  const config = await Quiz.findOne({ classwork: work._id }).select('+quiz');
  res.json({ available: !!config, questionCount: config?.quiz.questions.length || 0, requiresReading: work.readingActivities?.includes('read-aloud') || false });
}));
router.post('/classwork/:id/start', requireRole('learner'), wrap(async (req, res) => {
  const work = await classworkAccess(req, req.params.id);
  if (work.type !== 'reading' || !work.readingActivities?.includes('comprehension')) fail('This activity has no comprehension quiz.');
  const config = await Quiz.findOne({ classwork: work._id }).select('+quiz');
  if (!config) fail('Your teacher has not published the comprehension questions yet.', 409);
  const reading = await activeReading(req, work);
  const passage = reading?.readingPassage || work.readingPassage, hash = passageHash(passage);
  if (hash !== config.passageHash) fail('This quiz does not match your reading passage. Contact your teacher.', 409);
  const query = { classwork: work._id, learner: req.userId, attemptKey: reading ? String(reading._id) : 'comprehension-only' };
  let attempt = await Attempt.findOne(query).select('+quiz +passage');
  if (!attempt) {
    deadline(work);
    try { attempt = await Attempt.create({ ...query, title: work.title, class: work.class, passageHash: hash, passage, quiz: config.quiz, readingSubmission: reading?._id }); }
    catch (error) { if (error.code !== 11000) throw error; attempt = await Attempt.findOne(query).select('+quiz +passage'); }
  }
  res.json({ attempt: publicAttempt(attempt) });
}));
router.put('/attempts/:id/draft', requireRole('learner'), wrap(async (req, res) => {
  const attempt = await attemptAccess(req, req.params.id, false, true);
  if (attempt.status !== 'draft') fail('Submitted responses cannot be edited.', 409);
  const answers = answersFor(attempt.quiz, req.body.answers, false);
  const updated = await updateAttempt(attempt, revision(req), { answers });
  res.json({ attempt: publicAttempt(updated) });
}));
router.post('/attempts/:id/submit', requireRole('learner'), wrap(async (req, res) => {
  const attempt = await attemptAccess(req, req.params.id, false, true);
  if (attempt.status !== 'draft') fail('This quiz was already submitted.', 409);
  const answers = answersFor(attempt.quiz, req.body.answers, true), scored = grade(attempt.quiz, answers);
  const updated = await updateAttempt(attempt, revision(req), { answers, ...scored, status: scored.result.status, submittedAt: new Date() });
  res.json({ attempt: publicAttempt(updated) });
}));
router.get('/classwork/:id/attempts', requireRole('teacher'), wrap(async (req, res) => {
  const work = await classworkAccess(req, req.params.id, true);
  const attempts = await Attempt.find({ classwork: work._id }).select('+quiz +passage').populate('learner', 'displayName firstName secondName').sort({ createdAt: -1 });
  res.json({ title: work.title, attempts: attempts.map(a => publicAttempt(a, true)) });
}));
router.patch('/attempts/:id/grade', requireRole('teacher'), wrap(async (req, res) => {
  const attempt = await attemptAccess(req, req.params.id, true);
  if (attempt.status === 'draft') fail('The learner has not submitted this quiz.', 409);
  if (!Array.isArray(req.body.grades)) fail('Provide manual grades.');
  const manualQuestions = attempt.quiz.questions.filter(q => ['short-answer', 'essay'].includes(q.type));
  if (req.body.grades.length !== manualQuestions.length) fail('Grade every manual question before saving.');
  const seen = new Set();
  const manual = req.body.grades.map(g => {
    const question = manualQuestions.find(q => q.id === g.questionId);
    if (!question || seen.has(g.questionId) || typeof g.correct !== 'boolean' || !Number.isFinite(g.awardedPoints) || g.awardedPoints < 0 || g.awardedPoints > question.points || (g.feedback !== undefined && (typeof g.feedback !== 'string' || g.feedback.length > 6000))) fail('Invalid manual grade.');
    seen.add(g.questionId);
    return { questionId: g.questionId, correct: g.correct, awardedPoints: g.awardedPoints, feedback: g.feedback || '' };
  });
  const scored = grade(attempt.quiz, attempt.answers, manual);
  const updated = await updateAttempt(attempt, revision(req), { ...scored, status: scored.result.status, reviewedAt: new Date(), reviewedBy: req.userId });
  res.json({ attempt: publicAttempt(updated, true) });
}));
module.exports = router;

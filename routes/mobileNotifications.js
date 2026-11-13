const express = require('express');
const { requireAuth } = require('../middleware/auth');
const DeviceSession = require('../models/DeviceSession');
const Enrollment = require('../models/Enrollment');
const Class = require('../models/Class');
const Work = require('../models/ClassWork');
const Submission = require('../models/Submission');
const Activity = require('../models/ActivitySubmission');
const Quiz = require('../models/StandaloneQuizAttempt');
const { Attempt } = require('../models/Comprehension');
const { expoTokenPattern } = require('../utils/pushNotifications');

const router = express.Router();
router.use(requireAuth);

router.put('/device', async (req, res, next) => {
  try {
    if (!req.sessionId) return res.status(409).json({ error: 'Please sign in again to enable push notifications.' });
    const { token } = req.body;
    if (token !== null && (typeof token !== 'string' || !expoTokenPattern.test(token))) {
      return res.status(400).json({ error: 'Invalid Expo push token.' });
    }

    const session = { _id: req.sessionId, user: req.userId, expiresAt: { $gt: new Date() } };
    if (token === null) {
      await DeviceSession.updateOne(session, { $unset: { pushToken: 1 } });
    } else {
      await DeviceSession.updateMany({ _id: { $ne: req.sessionId }, pushToken: token }, { $unset: { pushToken: 1 } });
      await DeviceSession.updateOne(session, { $set: { pushToken: token } });
    }
    res.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

router.get('/deadlines', async (req, res, next) => {
  if (req.userRole !== 'learner') return res.status(403).json({ error: 'Learner account required.' });
  try {
    const enrolled = await Enrollment.distinct('class', { learner: req.userId });
    const classes = await Class.distinct('_id', { _id: { $in: enrolled }, status: 'active' });
    const works = await Work.find({
      class: { $in: classes },
      dueDate: { $gt: new Date() },
      $or: [{ assignToAll: true }, { assignedTo: req.userId }],
    }).select('type dueDate readingActivities').lean();
    const filter = { learner: req.userId, classwork: { $in: works.map(work => work._id) } };
    const [readings, activities, quizzes, comprehension] = await Promise.all([
      Submission.distinct('classwork', filter),
      Activity.distinct('classwork', filter),
      Quiz.distinct('classwork', { ...filter, status: { $in: ['pending-review', 'graded'] } }),
      Attempt.distinct('classwork', { ...filter, status: { $in: ['pending-review', 'graded'] } }),
    ]);
    const done = [readings, activities, quizzes, comprehension].map(ids => new Set(ids.map(String)));
    const deadlines = works.filter(work => {
      const id = String(work._id);
      if (work.type === 'activity') return !done[1].has(id);
      if (work.type === 'quiz') return !done[2].has(id);
      const tasks = work.readingActivities;
      const readAloud = !tasks?.length || tasks.includes('read-aloud');
      const quiz = tasks?.includes('comprehension');
      return (readAloud && !done[0].has(id)) || (quiz && !done[3].has(id));
    }).map(({ _id, dueDate }) => ({ _id, dueDate }));
    res.json({ deadlines });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

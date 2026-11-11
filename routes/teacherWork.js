const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const Class = require('../models/Class'), Work = require('../models/ClassWork'), Submission = require('../models/Submission');
const Activity = require('../models/ActivitySubmission'), Quiz = require('../models/StandaloneQuizAttempt');
const { Attempt } = require('../models/Comprehension');
const { toCheckItems } = require('../utils/teacherWork');
const router = express.Router(); router.use(requireAuth, requireRole('teacher'));
router.get('/to-check', async (req, res) => {
  try {
    const classes = await Class.find({ teacher: req.userId, status: 'active' }).select('title');
    const filter = { class: { $in: classes.map(row => row._id) } };
    const [works, readings, activities, comprehension, quizzes] = await Promise.all([
      Work.find(filter).select('class title'),
      Submission.find(filter).select('class classwork learner submittedAt verification readingRate wordAccuracy').populate('learner', 'displayName firstName secondName'),
      Activity.find({ ...filter, checkedAt: { $exists: false } }).select('class classwork learner submittedAt checkedAt').populate('learner', 'displayName firstName secondName'),
      Attempt.find({ ...filter, status: 'pending-review' }).select('class classwork title learner submittedAt status').populate('learner', 'displayName firstName secondName'),
      Quiz.find({ ...filter, status: 'pending-review' }).select('class classwork title learner submittedAt status').populate('learner', 'displayName firstName secondName'),
    ]);
    res.json({ items: toCheckItems(classes, works, readings, activities, comprehension, quizzes) });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Could not load work awaiting review.' }); }
});
module.exports = router;

const express = require('express');
const mongoose = require('mongoose');
const Class = require('../models/Class');
const Enrollment = require('../models/Enrollment');
const Submission = require('../models/Submission');
const Work = require('../models/ClassWork');
const { Attempt } = require('../models/Comprehension');
const { reportProjection } = require('../utils/reports');
const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();
router.use(requireAuth, requireRole('teacher'));
router.get('/', async (req, res) => {
  try {
    const from = req.query.from === undefined ? -Infinity : Date.parse(req.query.from);
    const to = req.query.to === undefined ? Infinity : Date.parse(req.query.to);
    if (Number.isNaN(from) || Number.isNaN(to) || from >= to) return res.status(400).json({ error: 'Choose a valid reporting period.' });
    if (req.query.classId && !mongoose.isValidObjectId(req.query.classId)) return res.status(400).json({ error: 'Invalid classroom id.' });
    const all = await Class.find({ teacher: req.userId, status: 'active' }).select('title code').sort({ title: 1 });
    if (req.query.classId && !all.some(cls => String(cls._id) === req.query.classId)) return res.status(403).json({ error: 'You do not own this classroom.' });
    const classes = req.query.classId ? all.filter(cls => String(cls._id) === req.query.classId) : all;
    const filter = { class: { $in: classes.map(cls => cls._id) } };
    const [enrollments, submissions, attempts, works] = await Promise.all([
      Enrollment.find(filter).select('class learner'),
      Submission.find(filter).select('class classwork learner submittedAt readingRate wordAccuracy'),
      Attempt.find({ ...filter, status: { $in: ['pending-review', 'graded'] } }).select('class classwork learner readingSubmission title status result submittedAt'),
      Work.find(filter).select('title readingActivities'),
    ]);
    res.json({ ...reportProjection(classes, enrollments, submissions, attempts, works, { from, to }), availableClasses: all.map(cls => ({ _id: String(cls._id), title: cls.title })), updatedAt: new Date() });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Could not load reading reports. Please try again.' }); }
});
module.exports = router;
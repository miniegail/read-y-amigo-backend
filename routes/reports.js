const express = require("express");
const mongoose = require("mongoose");
const Class = require("../models/Class");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// Every route below requires a logged-in teacher.
router.use(requireAuth, requireRole("teacher"));

// GET /api/reports - cross-class analytics for the logged-in teacher.
// Returns a per-class breakdown (learner count, avg streak, avg
// comprehension) plus overall totals across all of their active classes.
router.get("/", async (req, res) => {
  try {
    const classes = await Class.aggregate([
      {
        $match: {
          teacher: new mongoose.Types.ObjectId(req.userId),
          status: "active",
        },
      },
      {
        $lookup: {
          from: "enrollments",
          localField: "_id",
          foreignField: "class",
          as: "enrollments",
        },
      },
      {
        $addFields: {
          learnerCount: { $size: "$enrollments" },
          avgStreakDays: { $avg: "$enrollments.streakDays" },
          avgComprehension: { $avg: "$enrollments.comprehensionAvg" },
        },
      },
      {
        $project: {
          title: 1,
          code: 1,
          learnerCount: 1,
          avgStreakDays: { $ifNull: [{ $round: ["$avgStreakDays", 1] }, 0] },
          avgComprehension: { $ifNull: [{ $round: ["$avgComprehension", 1] }, 0] },
        },
      },
      { $sort: { title: 1 } },
    ]);

    // Classes with zero learners are excluded from the averages so they
    // don't drag an otherwise-healthy overall stat down to 0.
    const withLearners = classes.filter((c) => c.learnerCount > 0);

    const totals = {
      classCount: classes.length,
      totalLearners: classes.reduce((sum, c) => sum + c.learnerCount, 0),
      avgComprehension: withLearners.length
        ? Math.round(
            (withLearners.reduce((sum, c) => sum + c.avgComprehension, 0) /
              withLearners.length) *
              10
          ) / 10
        : 0,
      avgStreakDays: withLearners.length
        ? Math.round(
            (withLearners.reduce((sum, c) => sum + c.avgStreakDays, 0) /
              withLearners.length) *
              10
          ) / 10
        : 0,
    };

    res.json({ totals, classes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

module.exports = router;
const { notifyTeacher } = require('../utils/notifications');
const express = require("express");
const Class = require("../models/Class");
const Enrollment = require("../models/Enrollment");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// Every route below requires a logged-in learner.
router.use(requireAuth, requireRole("learner"));

// POST /api/enrollments/join
// Learner joins a classroom by entering the teacher's class code.
router.post("/join", async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: "A classroom code is required." });
    }

    const cls = await Class.findOne({ code: code.toUpperCase().trim(), status: "active" });
    if (!cls) {
      return res.status(404).json({ error: "No classroom found with that code. Double-check with your teacher." });
    }

    const existing = await Enrollment.findOne({ class: cls._id, learner: req.userId });
    if (existing) {
      return res.status(409).json({ error: "You've already joined this classroom." });
    }

    const enrollment = await Enrollment.create({
      class: cls._id,
      learner: req.userId,
      streakDays: 0,
      comprehensionAvg: 0,
    });

    await notifyTeacher(cls, req.userId, { kind: 'joined', eventKey: `joined:${enrollment._id}`, title: cls.title });
    res.status(201).json({ enrollment, class: cls });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/enrollments/mine
// Returns all classrooms the logged-in learner is enrolled in,
// with the class document populated so the dashboard can show titles/codes.
router.get("/mine", async (req, res) => {
  try {
    const enrollments = await Enrollment.find({ learner: req.userId })
      .populate("class")
      .sort({ createdAt: -1 });

    res.json({ enrollments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

module.exports = router;
const express = require("express");
const mongoose = require("mongoose");
const Class = require("../models/Class");
const StreamPost = require("../models/StreamPost");
const Classwork = require("../models/ClassWork");
const Enrollment = require("../models/Enrollment");
const { requireAuth, requireRole } = require("../middleware/auth");

// ── Teacher router ────────────────────────────────────────────────────────────

const router = express.Router();

router.use(requireAuth, requireRole("teacher"));

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateClassCode() {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

async function generateUniqueClassCode() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateClassCode();
    const taken = await Class.exists({ code });
    if (!taken) return code;
  }
  throw new Error("Couldn't generate a unique class code. Please try again.");
}

router.param("classId", async (req, res, next, classId) => {
  try {
    const classDoc = await Class.findOne({ _id: classId, status: "active" });

    if (!classDoc) {
      return res.status(404).json({ error: "Class not found." });
    }

    if (classDoc.teacher.toString() !== req.userId) {
      return res.status(403).json({ error: "You don't have access to this class." });
    }

    req.classDoc = classDoc;
    next();
  } catch (err) {
    res.status(400).json({ error: "Invalid class id." });
  }
});

// GET /api/classes/mine
router.get("/mine", async (req, res) => {
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
      { $addFields: { learnerCount: { $size: "$enrollments" } } },
      { $project: { enrollments: 0 } },
      { $sort: { createdAt: -1 } },
    ]);

    res.json({ classes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/classes/archived
router.get("/archived", async (req, res) => {
  try {
    const classes = await Class.aggregate([
      {
        $match: {
          teacher: new mongoose.Types.ObjectId(req.userId),
          status: "deleted",
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
      { $addFields: { learnerCount: { $size: "$enrollments" } } },
      { $project: { enrollments: 0 } },
      { $sort: { updatedAt: -1 } },
    ]);

    res.json({ classes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/classes
router.post("/", async (req, res) => {
  try {
    const { title, description } = req.body;

    if (!title) {
      return res.status(400).json({ error: "A class title is required." });
    }

    const code = await generateUniqueClassCode();

    const newClass = await Class.create({
      teacher: req.userId,
      title,
      description,
      code,
    });

    res.status(201).json({ class: newClass });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/classes/:classId
router.get("/:classId", async (req, res) => {
  try {
    const learnerCount = await Enrollment.countDocuments({ class: req.classDoc._id });
    res.json({ class: req.classDoc, learnerCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// PATCH /api/classes/:classId
router.patch("/:classId", async (req, res) => {
  try {
    const { title, description } = req.body;

    if (title !== undefined) {
      if (!title.trim()) {
        return res.status(400).json({ error: "A class title is required." });
      }
      req.classDoc.title = title.trim();
    }
    if (description !== undefined) {
      req.classDoc.description = description;
    }

    await req.classDoc.save();
    res.json({ class: req.classDoc });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// DELETE /api/classes/:classId
router.delete("/:classId", async (req, res) => {
  try {
    req.classDoc.status = "deleted";
    await req.classDoc.save();
    res.json({ class: req.classDoc });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// PATCH /api/classes/:archivedClassId/restore
router.patch("/:archivedClassId/restore", async (req, res) => {
  try {
    const classDoc = await Class.findOne({
      _id: req.params.archivedClassId,
      teacher: req.userId,
      status: "deleted",
    });

    if (!classDoc) {
      return res.status(404).json({ error: "Archived class not found." });
    }

    classDoc.status = "active";
    await classDoc.save();
    res.json({ class: classDoc });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/classes/:classId/stream
router.get("/:classId/stream", async (req, res) => {
  try {
    const posts = await StreamPost.find({ class: req.classDoc._id }).sort({ createdAt: -1 });
    res.json({ posts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/classes/:classId/stream
router.post("/:classId/stream", async (req, res) => {
  try {
    const { title, body } = req.body;

    if (!title) {
      return res.status(400).json({ error: "A title is required." });
    }

    const post = await StreamPost.create({
      class: req.classDoc._id,
      author: req.userId,
      title,
      body,
    });

    res.status(201).json({ post });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/classes/:classId/classwork
router.get("/:classId/classwork", async (req, res) => {
  try {
    const items = await Classwork.find({ class: req.classDoc._id }).sort({ dueDate: 1 });
    res.json({ classwork: items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/classes/:classId/classwork
router.post("/:classId/classwork", async (req, res) => {
  try {
    const { title, description, dueDate } = req.body;

    if (!title) {
      return res.status(400).json({ error: "A title is required." });
    }

    const item = await Classwork.create({
      class: req.classDoc._id,
      title,
      description,
      dueDate: dueDate ? new Date(dueDate) : undefined,
    });

    res.status(201).json({ classwork: item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/classes/:classId/learners
router.get("/:classId/learners", async (req, res) => {
  try {
    const enrollments = await Enrollment.find({ class: req.classDoc._id })
      .populate("learner", "displayName firstName secondName")
      .sort({ createdAt: 1 });

    res.json({ learners: enrollments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/classes/:classId/progress
router.get("/:classId/progress", async (req, res) => {
  try {
    const enrollments = await Enrollment.find({ class: req.classDoc._id })
      .populate("learner", "displayName firstName secondName")
      .sort({ comprehensionAvg: -1 });

    res.json({ progress: enrollments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── Learner router (read-only) ────────────────────────────────────────────────

const learnerRouter = express.Router();

learnerRouter.use(requireAuth, requireRole("learner"));

// GET /api/learner/classes/:classId
learnerRouter.get("/:classId", async (req, res) => {
  try {
    const cls = await Class.findOne({ _id: req.params.classId, status: "active" });
    if (!cls) {
      return res.status(404).json({ error: "Classroom not found." });
    }

    const enrolled = await Enrollment.findOne({ class: cls._id, learner: req.userId });
    if (!enrolled) {
      return res.status(403).json({ error: "You're not enrolled in this classroom." });
    }

    const learnerCount = await Enrollment.countDocuments({ class: cls._id });
    res.json({ class: cls, learnerCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/learner/classes/:classId/stream
learnerRouter.get("/:classId/stream", async (req, res) => {
  try {
    const enrolled = await Enrollment.findOne({ class: req.params.classId, learner: req.userId });
    if (!enrolled) {
      return res.status(403).json({ error: "You're not enrolled in this classroom." });
    }

    const posts = await StreamPost.find({ class: req.params.classId }).sort({ createdAt: -1 });
    res.json({ posts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/learner/classes/:classId/classwork
learnerRouter.get("/:classId/classwork", async (req, res) => {
  try {
    const enrolled = await Enrollment.findOne({ class: req.params.classId, learner: req.userId });
    if (!enrolled) {
      return res.status(403).json({ error: "You're not enrolled in this classroom." });
    }

    const items = await Classwork.find({ class: req.params.classId }).sort({ dueDate: 1 });
    res.json({ classwork: items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/learner/classes/:classId/learners
learnerRouter.get("/:classId/learners", async (req, res) => {
  try {
    const enrolled = await Enrollment.findOne({ class: req.params.classId, learner: req.userId });
    if (!enrolled) {
      return res.status(403).json({ error: "You're not enrolled in this classroom." });
    }

    const enrollments = await Enrollment.find({ class: req.params.classId })
      .populate("learner", "displayName firstName secondName")
      .sort({ createdAt: 1 });

    res.json({ learners: enrollments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

module.exports = { teacherRouter: router, learnerRouter };
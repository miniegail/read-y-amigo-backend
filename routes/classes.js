const express = require("express");
const mongoose = require("mongoose");
const Class = require("../models/Class");
const StreamPost = require("../models/StreamPost");
const Classwork = require("../models/ClassWork");
const Enrollment = require("../models/Enrollment");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// Every route below requires a logged-in teacher.
router.use(requireAuth, requireRole("teacher"));

// Avoids visually ambiguous characters (0/O, 1/I/L) in join codes.
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

// Loads req.params.classId, checks it exists, is active, AND belongs to the
// logged-in teacher, and attaches it as req.classDoc. Used by every
// /:classId/... route below, so ownership + active-status only need to be
// checked in one place. As a side effect, every nested route (stream,
// classwork, learners, progress, edit) automatically 404s once a class is
// soft-deleted.
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

// GET /api/classes/mine - the logged-in teacher's own active classes,
// each with a learnerCount computed from Enrollment.
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

// GET /api/classes/archived - the logged-in teacher's soft-deleted classes.
// Registered BEFORE "/:classId" below - otherwise Express would match
// "archived" as a classId value and 404 via the active-only lookup in
// router.param("classId", ...) above.
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

// POST /api/classes - create a new class owned by the logged-in teacher
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

// GET /api/classes/:classId - single class detail, with learner count
router.get("/:classId", async (req, res) => {
  try {
    const learnerCount = await Enrollment.countDocuments({ class: req.classDoc._id });
    res.json({ class: req.classDoc, learnerCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// PATCH /api/classes/:classId - update title/description.
// Code is immutable once created; use a dedicated regenerate endpoint if
// that's ever needed.
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

// DELETE /api/classes/:classId - soft delete (shown in the app as
// "Archive"). Marks the class as "deleted" so it disappears from the
// teacher's active list and API access, but nothing is actually removed -
// the Class document and all related Enrollment/StreamPost/Classwork
// records stay in the database untouched. Pairs with the /restore route
// below, which reverses this.
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

// PATCH /api/classes/:archivedClassId/restore - undoes a soft delete,
// bringing an archived class back to "active". Uses a different param
// name (archivedClassId, not classId) on purpose: router.param("classId", ...)
// above only loads documents with status "active", so a normal :classId
// route would 404 before ever reaching a deleted class. This route does
// its own lookup instead, explicitly allowing status: "deleted".
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

// ---------- Stream ----------

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

// ---------- Classwork ----------

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

// ---------- Learners & Progress ----------
// Both read from the same Enrollment records - one has the roster + streaks,
// the other surfaces comprehension scores. Kept as two endpoints so the
// frontend tabs can call exactly what they need.

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

module.exports = router;
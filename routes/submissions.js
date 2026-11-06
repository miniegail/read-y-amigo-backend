const { parseMeasurement, calculateRate, measureAudio, rejectAuthoredFields } = require("../utils/readingRate");
const express = require("express");
const mongoose = require("mongoose");

const Class = require("../models/Class");
const Classwork = require("../models/ClassWork");
const Enrollment = require("../models/Enrollment");
const Submission = require("../models/Submission");

const uploadAudio = require("../middleware/uploadAudio");
const { requireAuth, requireRole } = require("../middleware/auth");
const { saveBuffer } = require("../utils/gridfs");

const router = express.Router();

router.use(requireAuth);

// Runs multer but returns JSON errors (file too big, wrong type, etc.)
function handleAudioUpload(req, res, next) {
  uploadAudio.single("audio")(req, res, (err) => {
    if (err) {
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? "That recording is too large (25 MB max)."
          : err.message || "Couldn't upload the recording.";
      return res.status(400).json({ error: message });
    }
    next();
  });
}

// ── LEARNER ──────────────────────────────────────────────────────────────────

// POST /api/submissions/classwork/:classworkId
// multipart: "audio" (file) + "durationMs" (text)
router.post(
  "/classwork/:classworkId",
  requireRole("learner"),
  handleAudioUpload,
  async (req, res) => {
    try {
      const { classworkId } = req.params;

      if (!mongoose.isValidObjectId(classworkId)) {
        return res.status(400).json({ error: "Invalid classwork id." });
      }

      if (!req.file) {
        return res
          .status(400)
          .json({ error: "Please record your reading before submitting." });
      }

      const classwork = await Classwork.findById(classworkId);
      if (!classwork) {
        return res.status(404).json({ error: "Classwork not found." });
      }

      if (classwork.type !== "reading") {
        return res
          .status(400)
          .json({ error: "Only reading assignments accept a recording." });
      }

      const classDoc = await Class.findOne({
        _id: classwork.class,
        status: "active",
      });
      if (!classDoc) {
        return res.status(404).json({ error: "Classroom not found." });
      }

      const enrolled = await Enrollment.findOne({
        class: classDoc._id,
        learner: req.userId,
      });
      if (!enrolled) {
        return res
          .status(403)
          .json({ error: "You're not enrolled in this classroom." });
      }

      const assigned =
        classwork.assignToAll ||
        classwork.assignedTo.some((id) => String(id) === req.userId);
      if (!assigned) {
        return res
          .status(403)
          .json({ error: "This classwork isn't assigned to you." });
      }

      const existing = await Submission.findOne({
        classwork: classwork._id,
        learner: req.userId,
      });
      if (existing) {
        return res
          .status(409)
          .json({ error: "You've already submitted this classwork." });
      }

      if (req.body.transcript !== undefined && (typeof req.body.transcript !== "string" || req.body.transcript.length > 100000)) {
        return res.status(400).json({ error: "Transcript must be text of at most 100,000 characters." });
      }
      if (req.body.transcriptLocale && !["en-US", "fil-PH"].includes(req.body.transcriptLocale)) {
        return res.status(400).json({ error: "Unsupported transcript language." });
      }

      rejectAuthoredFields(req.body);
      if (req.body.readingPassage !== undefined) return res.status(400).json({ error: "Submission passage is server authored." });
      if (req.body.recordingInterrupted !== undefined && !['true', 'false'].includes(req.body.recordingInterrupted)) return res.status(400).json({ error: "recordingInterrupted must be true or false." });
      const recordingInterrupted = req.body.recordingInterrupted === 'true';
      const readingPassage = classwork.readingPassage
        ? JSON.parse(JSON.stringify(classwork.readingPassage)) : undefined;
      const measuredMs = await measureAudio(req.file.buffer);
      const readingMeasurement = parseMeasurement(req.body.readingMeasurement, readingPassage, measuredMs);
      if (readingMeasurement && recordingInterrupted) readingMeasurement.interrupted = true;
      const readingRate = calculateRate(readingMeasurement, readingPassage, measuredMs, "provisional");
      const legacyMs = Number(req.body.durationMs);
      const playbackMs = measuredMs ?? (Number.isFinite(legacyMs) && legacyMs > 0 ? legacyMs : 0);

      const fileId = await saveBuffer({
        buffer: req.file.buffer,
        filename: req.file.originalname || "reading.m4a",
        mimeType: req.file.mimetype,
        metadata: {
          class: classDoc._id,
          uploadedBy: req.userId,
          kind: "submission-audio",
        },
      });

      const submission = await Submission.create({
        readingPassage, readingMeasurement, readingRate, recordingInterrupted,
        transcript: req.body.transcript || "",
        transcriptLocale: req.body.transcriptLocale || undefined,
        class: classDoc._id,
        classwork: classwork._id,
        learner: req.userId,
        audio: {
          fileId,
          url: `/api/files/${fileId}`,
          mimeType: req.file.mimetype,
          size: req.file.size,
          durationMs: playbackMs,
          durationVerified: measuredMs !== null,
        },
      });

      res.status(201).json({ submission });
    } catch (err) {
      if (err.status === 400) return res.status(400).json({ error: err.message });
      if (err.code === 11000) {
        return res
          .status(409)
          .json({ error: "You've already submitted this classwork." });
      }
      console.error(err);
      res
        .status(500)
        .json({ error: "Something went wrong while submitting your reading." });
    }
  }
);

// GET /api/submissions/mine?classId=...
// The logged-in learner's own submissions (used to show "Submitted").
router.get("/mine", requireRole("learner"), async (req, res) => {
  try {
    const filter = { learner: req.userId };

    if (req.query.classId) {
      if (!mongoose.isValidObjectId(req.query.classId)) {
        return res.status(400).json({ error: "Invalid class id." });
      }
      filter.class = req.query.classId;
    }

    const submissions = await Submission.find(filter).sort({ submittedAt: -1 });
    res.json({ submissions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── TEACHER ──────────────────────────────────────────────────────────────────

// GET /api/submissions/classwork/:classworkId
// Every submission for a classwork, plus who hasn't submitted yet.
router.get(
  "/classwork/:classworkId",
  requireRole("teacher"),
  async (req, res) => {
    try {
      const { classworkId } = req.params;

      if (!mongoose.isValidObjectId(classworkId)) {
        return res.status(400).json({ error: "Invalid classwork id." });
      }

      const classwork = await Classwork.findById(classworkId);
      if (!classwork) {
        return res.status(404).json({ error: "Classwork not found." });
      }

      const classDoc = await Class.findById(classwork.class);
      if (!classDoc || String(classDoc.teacher) !== req.userId) {
        return res
          .status(403)
          .json({ error: "You don't have access to this classwork." });
      }

      const submissions = await Submission.find({ classwork: classwork._id })
        .populate("learner", "displayName firstName secondName")
        .sort({ submittedAt: -1 });

      const enrollments = await Enrollment.find({ class: classDoc._id }).populate(
        "learner",
        "displayName firstName secondName"
      );

      const submittedIds = new Set(
        submissions.map((s) => String(s.learner?._id ?? s.learner))
      );

      const assignedIds = new Set(classwork.assignedTo.map(String));

      const notSubmitted = enrollments
        .filter((e) => e.learner)
        .filter(
          (e) => classwork.assignToAll || assignedIds.has(String(e.learner._id))
        )
        .filter((e) => !submittedIds.has(String(e.learner._id)))
        .map((e) => ({
          _id: e.learner._id,
          displayName: e.learner.displayName,
        }));

      res.json({
        classwork: { _id: classwork._id, title: classwork.title, readingPassage: classwork.readingPassage },
        submissions,
        notSubmitted,
      });
    } catch (err) {
      console.error(err);
      res
        .status(500)
        .json({ error: "Something went wrong while loading submissions." });
    }
  }
);

// PATCH /api/submissions/:submissionId/reading-rate
router.patch("/:submissionId/reading-rate", requireRole("teacher"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.submissionId)) return res.status(400).json({ error: "Invalid submission id." });
    const submission = await Submission.findById(req.params.submissionId);
    if (!submission) return res.status(404).json({ error: "Submission not found." });
    const classroom = await Class.findById(submission.class);
    if (!classroom || String(classroom.teacher) !== req.userId) return res.status(403).json({ error: "You don't have access to this submission." });
    rejectAuthoredFields(req.body);
    if (!submission.audio?.durationVerified || !Number.isFinite(submission.audio.durationMs) || submission.audio.durationMs <= 0 || !submission.audio.fileId || !submission.readingPassage?.confirmed) return res.status(400).json({ error: "A confirmed passage snapshot and verified audio are required." });
    if (submission.recordingInterrupted || submission.readingMeasurement?.interrupted) return res.status(400).json({ error: "Interrupted recordings cannot be reviewed for reading speed." });
    const measurement = parseMeasurement(req.body, submission.readingPassage, submission.audio.durationMs);
    if (!measurement) return res.status(400).json({ error: "readingMeasurement is required." });
    submission.readingMeasurement = measurement;
    submission.readingRate = calculateRate(measurement, submission.readingPassage, submission.audio.durationMs, "reviewed");
    submission.reviewedBy = req.userId;
    submission.reviewedAt = new Date();
    await submission.save();
    return res.json({ submission });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: "Something went wrong while reviewing reading rate." });
  }
});

module.exports = router;
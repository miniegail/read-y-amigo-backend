const express = require("express");
const Class = require("../models/Class");
const { requireAuth } = require("../middleware/auth");
const { getBucket, findFile } = require("../utils/gridfs");

const router = express.Router();

// 1) Look up the file's metadata.
async function loadFile(req, res, next) {
  try {
    const file = await findFile(req.params.id);
    if (!file) return res.status(404).json({ error: "File not found." });
    req.fileDoc = file;
    next();
  } catch {
    res.status(400).json({ error: "Invalid file id." });
  }
}

// 2) Class attachments are open by link (same as the old /uploads folder).
//    Submission audio requires a logged-in user.
function authIfPrivate(req, res, next) {
  if (["submission-audio", "activity-submission"].includes(req.fileDoc.metadata?.kind)) {
    return requireAuth(req, res, next);
  }
  next();
}

// 3) Submission audio: only the learner who recorded it, or that class's teacher.
async function authorizePrivate(req, res, next) {
  try {
    const meta = req.fileDoc.metadata || {};
    if (!["submission-audio", "activity-submission"].includes(meta.kind)) return next();

    if (String(meta.uploadedBy) === req.userId) return next();

    const cls = await Class.findById(meta.class);
    if (cls && String(cls.teacher) === req.userId) return next();

    return res.status(403).json({ error: "You don't have access to this file." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
}

// GET /api/files/:id
router.get("/:id", loadFile, authIfPrivate, authorizePrivate, (req, res) => {
  const file = req.fileDoc;
  const size = file.length;
  const bucket = getBucket();

  res.set({
    "Content-Type": file.contentType || "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
  });

  const range = req.headers.range;

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    let start = 0;
    let end = size - 1;

    if (match) {
      if (match[1] !== "") {
        start = parseInt(match[1], 10);
        if (match[2] !== "") end = parseInt(match[2], 10);
      } else if (match[2] !== "") {
        // Suffix range, e.g. "bytes=-500" = the last 500 bytes
        start = Math.max(0, size - parseInt(match[2], 10));
      }
    }

    end = Math.min(end, size - 1);

    if (start >= size || end < start) {
      return res.status(416).set("Content-Range", `bytes */${size}`).end();
    }

    res.status(206).set({
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": end - start + 1,
    });

    // GridFS `end` is exclusive.
    return bucket
      .openDownloadStream(file._id, { start, end: end + 1 })
      .on("error", () => res.end())
      .pipe(res);
  }

  res.set("Content-Length", size);
  bucket
    .openDownloadStream(file._id)
    .on("error", () => res.end())
    .pipe(res);
});

module.exports = router;
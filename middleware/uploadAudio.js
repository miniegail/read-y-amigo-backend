const multer = require("multer");

const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // matches the "25 MB max" message
  fileFilter: function (req, file, cb) {
    // Accept by MIME type OR extension, since phones report these inconsistently
    const okMime = /^(audio\/|video\/mp4|application\/octet-stream)/.test(file.mimetype);
    const okExt = /\.(m4a|mp4|aac|mp3|wav|3gp|caf)$/i.test(file.originalname || "");

    if (!okMime && !okExt) {
      return cb(new Error("Unsupported audio type. Please record again."));
    }
    cb(null, true);
  },
});

module.exports = uploadAudio;
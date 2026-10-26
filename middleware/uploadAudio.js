const multer = require("multer");

const uploadAudio = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB (roughly 20+ minutes of speech)
  },

  fileFilter: function (req, file, cb) {
    if (!file.mimetype || !file.mimetype.startsWith("audio/")) {
      return cb(new Error("Only audio recordings can be submitted."));
    }
    cb(null, true);
  },
});

module.exports = uploadAudio;
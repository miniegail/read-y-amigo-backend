const multer = require("multer");
const path = require("path");

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },

  fileFilter: function (req, file, cb) {
    const allowedTypes = [
      ".pdf",
      ".doc",
      ".docx",
      ".ppt",
      ".pptx",
      ".xls",
      ".xlsx",
      ".jpg",
      ".jpeg",
      ".png",
      ".txt",
    ];

    const extension = path.extname(file.originalname).toLowerCase();

    if (!allowedTypes.includes(extension)) {
      return cb(
        new Error(
          "Unsupported file type. Please upload a PDF, document, presentation, spreadsheet, image, or text file."
        )
      );
    }

    cb(null, true);
  },
});

module.exports = upload;
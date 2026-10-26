const mongoose = require("mongoose");

const submissionSchema = new mongoose.Schema(
  {
    class: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Class",
      required: true,
    },

    classwork: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Classwork",
      required: true,
    },

    learner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // The recorded reading, stored in GridFS (uploads.files).
    audio: {
      fileId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
      },
      url: { type: String, required: true }, // e.g. /api/files/<fileId>
      mimeType: { type: String },
      size: { type: Number },
      durationMs: { type: Number, default: 0 },
    },

    status: {
      type: String,
      enum: ["submitted"],
      default: "submitted",
    },

    submittedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// A learner can submit a given classwork only once.
submissionSchema.index({ classwork: 1, learner: 1 }, { unique: true });

module.exports = mongoose.model("Submission", submissionSchema);
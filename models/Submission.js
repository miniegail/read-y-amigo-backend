const mongoose = require("mongoose");
const { readingPassageSchema, readingMeasurementSchema, readingRateSchema } = require("./readingSchemas");

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
      durationVerified: { type: Boolean, default: false },
      durationMs: { type: Number, default: 0 },
    },

    recordingInterrupted: { type: Boolean, default: false },
    readingPassage: { type: readingPassageSchema, default: undefined },
    readingMeasurement: { type: readingMeasurementSchema, default: undefined },
    readingRate: { type: readingRateSchema, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: Date,

    miscueReview: { type: new mongoose.Schema({
      algorithmVersion: { type: String, enum: ['v1'], required: true },
      listened: Boolean,
      comparedThrough: Number,
      events: [{ _id: false, id: String, kind: String, status: String,
        passageStart: Number, passageEnd: Number, transcriptStart: Number, transcriptEnd: Number,
        source: String, note: String }],
      reviewedAt: Date,
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    }, { _id: false }), default: undefined },

    wordAccuracy: { type: new mongoose.Schema({
      wordsAssessed: { type: Number, required: true }, errorCount: { type: Number, required: true },
      percentage: { type: Number, required: true }, listened: Boolean, reviewedAt: Date,
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    }, { _id: false }), default: undefined },

    verification: { type: new mongoose.Schema({ verifiedAt: Date, verifiedBy: mongoose.Schema.Types.ObjectId }, { _id: false }), default: undefined },
    transcript: { type: String, default: "", maxlength: 100000 },
    transcriptLocale: { type: String, enum: ["en-US", "fil-PH"] },

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
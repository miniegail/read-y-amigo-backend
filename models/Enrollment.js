const mongoose = require("mongoose");

const enrollmentSchema = new mongoose.Schema(
  {
    class: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Class",
      required: true,
    },
    learner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Simple progress fields for the Learners/Progress tabs.
    // Update these from wherever learner activity is recorded once that
    // flow exists (e.g. after a learner finishes a reading session).
    streakDays: { type: Number, default: 0 },
    comprehensionAvg: { type: Number, default: 0 }, // 0-100
  },
  { timestamps: true }
);

// A learner can only be enrolled in a given class once.
enrollmentSchema.index({ class: 1, learner: 1 }, { unique: true });

module.exports = mongoose.model("Enrollment", enrollmentSchema);
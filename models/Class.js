const mongoose = require("mongoose");

const classSchema = new mongoose.Schema(
  {
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    title: { type: String, required: true },
    description: { type: String },

    // Short code learners use to join this class.
    code: { type: String, required: true, unique: true },

    // "deleted" classes are soft-deleted: hidden from the teacher's active
    // list and inaccessible via the API, but the document (and all related
    // Enrollment/StreamPost/Classwork data) is kept intact. Codes are never
    // reused, so the unique index above still holds even after deletion.
    status: {
      type: String,
      enum: ["active", "deleted"],
      default: "active",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Class", classSchema);